#!/bin/bash
set -e

# ==============================================================================
# Velocity Production Backup Script
# Backs up PostgreSQL (Hindsight Memory), SQLite (Chats), and .env
# Syncs locally and off-site to Cloudflare R2 (if configured)
# ==============================================================================

BACKUP_DIR="${BACKUP_DIR:-/root/backups/velocity}"
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
DEST="$BACKUP_DIR/$TIMESTAMP"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
R2_BUCKET="${R2_BUCKET:-r2:velocity-backups}"

mkdir -p "$DEST"
echo "[$TIMESTAMP] Starting Velocity backup..."

# 1. Backup PostgreSQL (Hindsight Memory & Vector DB)
echo "--> Dumping PostgreSQL (Hindsight memory)..."
docker exec velocity-postgres pg_dump -U hindsight hindsight | gzip > "$DEST/hindsight_postgres.sql.gz"

# 2. Backup SQLite (Chats & Sessions) safely using SQLite online backup
echo "--> Backing up SQLite (Chats & Sessions)..."
docker exec velocity-backend sqlite3 /app/data/velocity.db ".backup '/app/data/backup_temp.db'"
docker cp velocity-backend:/app/data/backup_temp.db "$DEST/velocity.db"
docker exec velocity-backend rm -f /app/data/backup_temp.db
gzip "$DEST/velocity.db"

# 3. Backup Configuration & Custom Prompts
echo "--> Backing up configuration..."
if [ -f /root/velocity/.env ]; then
    cp /root/velocity/.env "$DEST/.env.bak"
    chmod 600 "$DEST/.env.bak"
fi
if [ -f /root/velocity/config/system_prompt.json ]; then
    cp /root/velocity/config/system_prompt.json "$DEST/system_prompt.json.bak"
fi

# 4. Create final compressed tarball
cd "$BACKUP_DIR"
ARCHIVE_NAME="velocity_backup_$TIMESTAMP.tar.gz"
tar -czf "$ARCHIVE_NAME" "$TIMESTAMP"
rm -rf "$DEST"

echo "--> Local backup created: $BACKUP_DIR/$ARCHIVE_NAME ($(du -h "$ARCHIVE_NAME" | cut -f1))"

# 5. Off-site sync to Cloudflare R2 (if rclone is configured)
if command -v rclone &> /dev/null && rclone listremotes 2>/dev/null | grep -q "r2:"; then
    echo "--> Uploading off-site to Cloudflare R2 ($R2_BUCKET)..."
    if rclone copy "$BACKUP_DIR/$ARCHIVE_NAME" "$R2_BUCKET/" --s3-no-head; then
        echo "--> Cloudflare R2 upload successful!"
        # Prune remote backups older than RETENTION_DAYS
        rclone delete --min-age "${RETENTION_DAYS}d" "$R2_BUCKET/" 2>/dev/null || true
    else
        echo "⚠️ Cloudflare R2 upload failed, but local backup is preserved."
    fi
fi

# 6. Prune local backups older than RETENTION_DAYS
find "$BACKUP_DIR" -name "velocity_backup_*.tar.gz" -type f -mtime +"$RETENTION_DAYS" -delete

echo "[$TIMESTAMP] Backup completed successfully."
