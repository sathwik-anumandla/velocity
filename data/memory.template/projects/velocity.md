# Project: Velocity

## Overview
Velocity is Sathwik's personal AI agent, technical co-pilot, and lifelong companion.

## Architecture
- Backend: FastAPI, OpenAI Responses API, SQLite WAL, Hindsight episodic recall.
- Frontend: React + TypeScript + Vite, Tailwind CSS, OLED theme.
- Memory: Two-tier architecture combining a deterministic Markdown Vault with Hindsight temporal graph memory.

## Key Decisions & Milestones
- Nightly dream cycle scheduled at 23:00 UTC (04:30 AM IST).
- Retired synthetic mental model auto-injection in favor of deterministic markdown documents.
- Continuous main thread with autonomous side threads planned for Phase 2.
