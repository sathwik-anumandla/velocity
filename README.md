# Velocity

Velocity is a sovereign personal AI assistant and technical thought partner engineered for deep cognitive leverage, persistent memory, and borderless minimalist execution.

---

## Architecture

```text
┌────────────────────────────────────────────────────────┐
│              Velocity Web Client (React)               │
│       • Borderless Monochrome UI (Satoshi Medium)      │
│       • Per-Session Thinking & Recall Budget Controls  │
│       • In-App Hindsight Memory Inspector Modal        │
│       • Mobile Companion QR Pairing Route (/mobile)    │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP & SSE (EventStream)
                            ▼
┌────────────────────────────────────────────────────────┐
│               Velocity Backend (FastAPI)               │
│  • Dynamic System Prompt Loader (mtime hot-reload)     │
│  • Classifier LLM Layer (Auto-titling sessions)        │
│  • Main LLM Generator (OpenAI / OpenRouter)            │
│  • Cognitive Tools (Tavily Search, Memory & Models)    │
│  • SQLite + FTS5 Full-Text Search Engine               │
└─────────────────────┬───────────────────┬──────────────┘
                      │                   │
                      ▼                   ▼
      ┌──────────────────────┐   ┌──────────────────────┐
      │  Vectorize Hindsight │   │  PostgreSQL + pgvect │
      │  (Long-Term Memory)  │   │  (Vector Embeddings) │
      └──────────────────────┘   └──────────────────────┘
                      │
                      ▼
      ┌──────────────────────────────────────────────────┐
      │  Automated Backups & Cloudflare R2 Sync          │
      │  (Postgres Dump + SQLite + Config -> R2 Bucket)  │
      └──────────────────────────────────────────────────┘
```

---

## Key Capabilities

- **Deterministic Memory & Recall**: Powered by Vectorize Hindsight on PostgreSQL pgvector. Every interaction queries standing memory, executes with real-time reasoning, and asynchronously retains new observations.
- **Foundational Mental Models**: Continuous background synthesis across four structured dimensions:
  - `current-context`: Active focus, open loops, recent decisions, and immediate objectives.
  - `user-persona`: Communication preferences, engineering beliefs, and technical taste.
  - `projects-and-decisions`: Architecture choices, tech stack, and decision rationale.
  - `goals-and-interests`: Long-term directions and research topics.
- **Flat Monochrome Interface**: Built with React 19, TypeScript, and Tailwind CSS. Employs a borderless design system anchored in Satoshi Medium typography and pitch-black OLED surfaces.
- **Per-Session Cognitive Controls**: Popover controls for Thinking Effort (`none` to `max`), Recall Budget (`low`, `medium`, `high`), and Verbosity (`low`, `medium`, `high`).
- **Dynamic System Prompt**: System prompts are isolated in gitignored configuration files (`config/system_prompt.json`) and hot-reloaded dynamically on file modification without server restarts.
- **Hardened Cloud Edge**: Designed for a 2 GB VPS backed by Cloudflare Tunnel (zero open inbound ports), Cloudflare Zero Trust OTP access, and off-site Cloudflare R2 disaster recovery.

---

## Quickstart (Local Development)

### 1. Configure Environment

Copy `.env.example` to `.env` and provide your API keys:

```bash
cp .env.example .env
```

Key environment variables in `.env`:
```ini
OPENAI_API_KEY=sk-...
LLM_MODEL_ID=gpt-5.4-mini          # Main model for chat completions
CLASSIFIER_MODEL_ID=gpt-4o-mini     # Fast classifier model for real-time session titling
TAVILY_API_KEY=tvly-...             # Optional: web search tool
HINDSIGHT_API_URL=http://localhost:8888
HINDSIGHT_BANK_ID=personal-agent
```

### 2. Configure System Prompt (Private)

Your personal system prompt lives in `config/system_prompt.json`, which is automatically gitignored to prevent leaking personal context to GitHub:

```bash
cp config/system_prompt.example.json config/system_prompt.json
```

The backend monitors this file using mtime caching; any edits take effect immediately on your next message without restarting the server.

---

### 3. Start Backend Infrastructure (Docker)

Start PostgreSQL, Hindsight, and the FastAPI backend stack:

```bash
docker compose up -d
```

- **Velocity Backend API**: `http://localhost:8000` (Health: `http://localhost:8000/health`)
- **Hindsight Core API**: `http://localhost:8888`
- **Hindsight Control Plane**: `http://localhost:9999` (Visual inspector for learned memories)

---

### 4. Run the Web Client

Start the Vite development server:

```bash
cd web
npm install
npm run dev
```

The web client will be available at `http://localhost:5173`.

To build the static web bundle to be served directly by the FastAPI backend:

```bash
cd web
npm run build
```

The compiled assets in `web/dist` are automatically mounted by FastAPI at `/` and `/ui`.

---

## Production Deployment (VPS + Cloudflare)

Velocity is optimized to run on a 2 GB RAM VPS (e.g. Linode / Akamai) with an NVMe swapfile.

### 1. Host Hardening

Add a 4 GB NVMe swap partition and set swappiness to prevent OOM events:

```bash
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl vm.swappiness=10
echo 'vm.swappiness=10' >> /etc/sysctl.conf
```

Lock down the host firewall with UFW:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw enable
```

All Docker container ports in `docker-compose.yml` are bound strictly to `127.0.0.1` so no backend or database services are exposed to the public internet.

### 2. Cloudflare Tunnel & Zero Trust

Install and authenticate `cloudflared` on the VPS to route traffic without opening any public inbound ports:

```yaml
# ~/.cloudflared/config.yml
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: chat.<your-domain>
    service: http://127.0.0.1:8000
  - hostname: memory.<your-domain>
    service: http://127.0.0.1:9999
  - service: http_status:404
```

Protect both hostnames in the Cloudflare Zero Trust dashboard using an Access Application configured with One-Time PIN (OTP) email verification.

---

## Disaster Recovery & Backups

### Create a Backup

Run the automated backup script:

```bash
./scripts/backup.sh
```

This dumps the PostgreSQL database (Hindsight memories and mental models), SQLite database (chats and sessions), and configuration files into an encrypted timestamped archive and uploads it off-site to Cloudflare R2 (`r2:velocity-backups`).

To schedule nightly snapshots, add a cron job:

```bash
0 3 * * * /root/velocity/scripts/backup.sh >> /var/log/velocity-backup.log 2>&1
```

### Restore from Backup

To restore the complete state from any backup archive:

```bash
./scripts/restore.sh /path/to/velocity_backup_YYYY-MM-DD_HHMMSS.tar.gz
```

The restore script stops the running containers, restores PostgreSQL pgvector, SQLite database files, and system configuration, restarts services, and verifies system health.

---

## Mobile Client Companion

Velocity includes a complete mobile client specification in `MOBILE_SPEC.md` for building a native Flutter mobile companion.

To pair a mobile client:
1. Navigate to `/mobile` in the web client.
2. Scan the dark-mode pairing QR code to transfer API endpoint and Cloudflare Service Token credentials.

---

## Testing

Run the end-to-end test suite against the running backend stack:

```bash
python3 tests/test_e2e_phases.py
```

Validates:
1. System health check across Backend, Hindsight, and PostgreSQL.
2. Session CRUD and sticky recall/reasoning toggles.
3. Fact retention via Hindsight background workers.
4. Fact recall injection into prompt context.
5. SQLite FTS5 global full-text search.
6. Temporary session privacy isolation.

---

## Repository Structure

```text
velocity/
├── backend/            # FastAPI server, Hindsight client, prompts, and SQLite FTS5
├── config/             # System prompt configuration (example template + private JSON)
├── web/                # React 19 + Vite + Tailwind CSS web client
├── landing/            # Public showcase landing page (Vercel deployment)
├── scripts/            # Disaster recovery scripts (backup.sh, restore.sh)
├── branding/           # Brand identity, SVG marks, and app icon specifications
├── docs/               # Architecture documents and release notes
├── data/               # Persistent SQLite database (velocity.db)
├── tests/              # End-to-end integration tests
├── docker-compose.yml  # Multi-container orchestration (Backend + Hindsight + Postgres)
├── Dockerfile          # Backend container specification
├── requirements.txt    # Python runtime dependencies
├── MOBILE_SPEC.md      # Mobile client companion specification
├── UI_STYLE_GUIDE.md   # Design tokens, color palette, and layout principles
└── .env.example        # Environment variable template
```
