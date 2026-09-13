# Velocity

Velocity is a personal AI assistant desktop and web application built with **Flutter**, powered by a **FastAPI** backend, and equipped with deterministic long-term recall and retention using **Vectorize Hindsight**.

---

## 🏗 Architecture

```text
┌────────────────────────────────────────────────────────┐
│               Velocity Client (Flutter)                │
│       • Native macOS Desktop App (Cocoa / AppKit)      │
│       • Web App (CanvasKit / WASM)                     │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP & SSE (EventStream)
                            ▼
┌────────────────────────────────────────────────────────┐
│               Velocity Backend (FastAPI)               │
│  • Classifier LLM Layer (Auto-titling sessions)        │
│  • Main LLM Generator (OpenAI / OpenRouter)            │
│  • SQLite + FTS5 Full-Text Search Engine               │
│  • Tavily Web Search Tool                              │
└─────────────────────┬───────────────────┬──────────────┘
                      │                   │
                      ▼                   ▼
      ┌──────────────────────┐   ┌──────────────────────┐
      │  Vectorize Hindsight │   │  PostgreSQL + pgvect │
      │  (Long-Term Memory)  │   │  (Vector Embeddings) │
      └──────────────────────┘   └──────────────────────┘
```

---

## 🚀 Quickstart

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
TAVILY_API_KEY=tvly-...             # Optional: web search
HINDSIGHT_API_URL=http://localhost:8888
HINDSIGHT_BANK_ID=personal-agent
```

### 2. Configure System Prompt (Private)

Your personal system prompt lives in `config/system_prompt.json` (or `.md`), which is automatically gitignored to prevent leaking your private prompt or personal details to GitHub:

```bash
cp config/system_prompt.example.json config/system_prompt.json
```

The backend dynamically monitors this file using mtime caching, so any edits you make to `config/system_prompt.json` take effect immediately on your next message without needing to restart the server.

---

### 3. Start Backend Infrastructure (Docker)

Start the PostgreSQL, Hindsight, and FastAPI backend stack:

```bash
docker-compose up -d
```

* **Velocity Backend API**: `http://localhost:8000` (Health: `http://localhost:8000/health`)
* **Hindsight Core API**: `http://localhost:8888`
* **Hindsight Control Plane**: `http://localhost:9999` (Visual inspector for learned memories)

---

### 4. Run the Client App

#### Native macOS Desktop App
Run the pre-compiled native release build:
```bash
open app/build/macos/Build/Products/Release/Velocity.app
```

To build or run from source:
```bash
cd app
flutter run -d macos
```

To install into your macOS Applications folder:
```bash
cp -R app/build/macos/Build/Products/Release/Velocity.app /Applications/
```

#### Android App
Run on an Android emulator or connected device:
```bash
cd app
# Start available emulator
flutter emulators --launch Medium_Phone_API_36.0
flutter run -d android
```

Build the Android APK:
```bash
cd app
flutter build apk
```
The compiled APK will be located at:
`app/build/app/outputs/flutter-apk/app-debug.apk` (or `app-release.apk`)

*Note: On Android emulators, `ApiService` automatically routes `localhost` requests to `http://10.0.2.2:8000`. For physical devices on your local Wi-Fi, pass `--dart-define=API_URL=http://<YOUR_LAN_IP>:8000`.*

#### Web App
To build the web version:
```bash
cd app
flutter build web --pwa-strategy=none
```

---

## 🧪 Testing

Run the end-to-end test suite against the running backend stack:

```bash
python3 tests/test_e2e_phases.py
```

Validates:
1. System health check across Backend, Hindsight, and PostgreSQL.
2. Session CRUD & sticky recall/reasoning toggles.
3. Fact retention via Hindsight background workers.
4. Fact recall injection into prompt context.
5. SQLite FTS5 global full-text search.
6. Temporary session privacy isolation.

---

## 📂 Repository Structure

```text
velocity/
├── backend/            # FastAPI server, Hindsight client, prompts, and SQLite FTS5
├── config/             # System prompt configuration (example template + private JSON)
├── app/                # Flutter application (macOS Desktop & Web)
│   ├── lib/            # Models, providers, views, and services
│   ├── macos/          # Native macOS Runner & entitlements
│   └── web/            # Web entry point and fonts
├── tests/              # End-to-end integration tests
├── docker-compose.yml  # Multi-container orchestration (Backend + Hindsight + Postgres)
├── Dockerfile          # Backend container specification
├── requirements.txt    # Python runtime dependencies
└── .env.example        # Environment variable template
```
