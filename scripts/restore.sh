#!/bin/bash
set -e

# ==============================================================================
# Velocity Disaster Recovery / Restore Script
# Restores PostgreSQL (Hindsight Memory) and SQLite (Chats) from a backup archive
# Usage: ./scripts/restore.sh /path/to/velocity_backup_YYYY-MM-DD_HHMMSS.tar.gz
# ==============================================================================

ARCHIVE="$1"

if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
    echo "Usage: $0 <path_to_velocity_backup_YYYY-MM-DD_HHMMSS.tar.gz>"
    echo "Example: $0 /root/backups/velocity/velocity_backup_2026-09-20_112313.tar.gz"
    exit 1
fi

TEMP_RESTORE_DIR="/tmp/velocity_restore_$(date +%s)"
mkdir -p "$TEMP_RESTORE_DIR"

echo "--> Extracting backup archive: $ARCHIVE"
tar -xzf "$ARCHIVE" -C "$TEMP_RESTORE_DIR"

# Find the extracted folder inside
EXTRACTED_DIR=$(find "$TEMP_RESTORE_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)

if [ -z "$EXTRACTED_DIR" ]; then
    echo "❌ Error: Could not find extracted backup folder."
    rm -rf "$TEMP_RESTORE_DIR"
    exit 1
fi

echo "--> Restoring PostgreSQL (Hindsight Memory)..."
if [ -f "$EXTRACTED_DIR/hindsight_postgres.sql.gz" ]; then
    zcat "$EXTRACTED_DIR/hindsight_postgres.sql.gz" | docker exec -i velocity-postgres psql -U hindsight -d hindsight
    echo "--> PostgreSQL memory bank restored successfully!"
else
    echo "⚠️ Warning: hindsight_postgres.sql.gz not found in archive."
fi

echo "--> Restoring SQLite (Chats & Sessions)..."
if [ -f "$EXTRACTED_DIR/velocity.db.gz" ]; then
    gunzip -f "$EXTRACTED_DIR/velocity.db.gz"
    docker cp "$EXTRACTED_DIR/velocity.db" velocity-backend:/app/data/velocity.db
    echo "--> SQLite database restored successfully!"
else
    echo "⚠️ Warning: velocity.db.gz not found in archive."
fi

echo "--> Restarting Velocity backend..."
docker compose restart backend

rm -rf "$TEMP_RESTORE_DIR"

echo "✅ Velocity restoration completed successfully!"
