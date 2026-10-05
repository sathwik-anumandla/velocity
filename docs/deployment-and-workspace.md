# Reliable Builds, History and Workspace Tools

## Deployment

Commit and push backend/web changes together before deploying. On the VPS, run:

```sh
bash scripts/deploy.sh
```

The script requires a clean checkout, pulls with `--ff-only`, builds an immutable backend image containing the web client, restarts it, and checks matching revisions at `/api/version`. It never deletes your data volumes. Docker Compose no longer mounts repository source or an anonymous `/app/web/dist` volume, preventing old UI assets from hiding a new build. `data/` stays writable; private prompts live in the read-only mounted `config/` directory. Move root-level private prompts into `config/`, or configure an explicit private file mount before deployment.

Settings → General shows backend, web and Android build versions. Web also detects a stale browser bundle. GitHub Actions runs offline backend regressions, web and Docker builds; Android CI builds and uploads a debug APK. Debug builds are not signed production releases. Backend dependency versions remain minimum constraints, while web and Android dependencies use existing lock/configuration files.

For local development, use your existing Python environment with `uvicorn backend.main:app --reload --port 8001` and `cd web && npm run dev`. Production code changes require an image rebuild, not just a container restart.

## Android History and Actions

- Initial history downloads 40 messages. **Load older messages** uses an ID cursor, avoiding duplicates when newer replies arrive. Edits invalidate cache revisions.
- Previously loaded messages and thread navigation are saved in app-private SQLite, scoped to server URL and Cloudflare credentials. Offline browsing is read-only; it does not queue sends or cache every conversation automatically. Unloaded pages and artifact contents still require the backend. Android backup is disabled for cached private chat data.
- Replies follow the viewport only while near the bottom; dragging upward stops following. **Jump to latest** resumes it, and switching threads restores the reading position.
- Long-press a message to copy, share, edit, regenerate or branch. Editing/regeneration requires confirmation because later replies are removed. Regeneration permits only read tools and warns that completed external actions cannot be undone. Branches copy the prefix, but never copy pending approvals or thread proposals.

## Google Workspace

Calendar supports calendar discovery, event patching, location, recurrence, reminders, visibility, busy/free state, colors and guest permissions. Use `calendar_id` to select the destination. Recurring timed events require an IANA `time_zone`; all-day `end_time` is exclusive. Guest invitations are controlled explicitly by `send_updates`.

Google Tasks supports list discovery, pagination, native subtasks and status updates. **Google due dates are date-only.** Velocity stores priority, labels, planning start and exact deadline as visible JSON metadata in notes; these are not native Google fields or timed notifications. Recurrence creates a distinct task per occurrence using Velocity's scheduler, without an LLM call.

Gmail supports query search/pagination, thread reading, labels, archive/read/star/trash actions, CC/BCC and threaded replies. Replies require both Gmail `thread_id` and the RFC `in_reply_to` Message-ID. Sending, including `send_at`, requires explicit approval, with recipients and timing shown in the confirmation card.

Snooze and future sends are **Velocity-managed**, not Gmail's native Snoozed/Send Later features. Snooze removes INBOX and restores it later. The backend must be running; overdue jobs execute on resume, and recurring tasks coalesce missed occurrences rather than backfilling them all. Jobs persist in SQLite; uncertain/failed executions pause instead of automatically risking duplicate deliveries. Inspect with `workspace_list_jobs`, cancel with `workspace_cancel_job`; cancelling a snooze restores INBOX. Jobs and new email approvals record their original Google account and refuse delivery/restore through a different account. Cancel outstanding jobs before switching accounts where possible.

The dynamic integration prompt applies these limitations even to existing private prompts. The new `/workspace` skill is seeded without overwriting customized skills. Reconnect Google only if your existing token lacks the already-used Calendar/Tasks/Gmail modify scopes.

## Offline Regression Checks

```sh
python -m unittest discover -s tests -p 'test_usage_recovery.py'
python -m unittest discover -s tests -p 'test_history.py'
python -m unittest discover -s tests -p 'test_google_tools.py'
cd web && npm run build
```

Google tests mock provider calls: they do not send email or mutate a live Google account. Actual OAuth/account behavior and device gestures still require an authenticated integration/device smoke test.
