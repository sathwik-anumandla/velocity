# Usage and chat recovery

## Usage

Open **Settings → Usage** in Android or the web app for today's, this month's,
and all-time statistics. Periods use UTC. Tracking starts when this version of
the backend is deployed; historical usage cannot be reconstructed from chat text.

The ledger records provider-reported input/output tokens for every Responses
tool hop, chat title, conversation summary, thread rollup, nightly vault synthesis,
and scheduled model call. Reasoning tokens are a subset of output tokens, not an
additional charge. Missing reasoning/cache details are distinguished from reported
zero values. Cache effectiveness includes cached input tokens, weighted token hit
rate, hit-call count, and estimated USD savings.
Rates and percentages use calls whose provider reports the relevant token details;
missing details are shown as unavailable, not as a confirmed zero cache/reasoning result.

USD amounts are estimates, not billing statements. Default rates apply only to
the official OpenAI endpoint and the supported models; dated model IDs inherit
their base model's rate. Custom endpoints and unknown models remain **unpriced**
unless configured. Use the model-prices editor in Usage or `USAGE_MODEL_PRICES`:

```json
{"my-model":{"input":0.75,"cached_input":0.075,"output":4.5}}
```

Rates are USD per million tokens. Each call snapshots its rates; changing prices
does not rewrite past costs. Interrupted calls without final usage retain a
separate conservative pending/unknown estimate rather than falsely reporting free
usage. Hindsight's internal LLM/embedding calls and external tool charges are not
observable through the chat API and are excluded. No spending limits are enforced.

Default price references: [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini),
[GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4), and
[GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini).

API: `GET /api/usage`, `PUT /api/usage/prices` with `{"prices": {...}}`.

## Recovery and cancellation

Persistent chats save the user message and assistant placeholder before generation.
Clients send a stable `message_id`; repeating that ID with the same session and
message replays the existing turn instead of starting another paid generation.
Only one interactive turn can run per conversation. SSE IDs are persistent cursors;
send `Last-Event-ID` to resume without duplicate deltas.

Android reconnects automatically after transient disconnections and reattaches to
running turns when loading a conversation. **Stop** cancels generation; partial text
and already-created artifacts/proposals remain available. Cancellation does not undo
completed tool actions. After a backend restart, incomplete turns are marked
interrupted; restore the prompt to explicitly start a new response. Temporary chats
remain ephemeral and do not support durable recovery.

Endpoints: `GET /api/chat/turns/{id}`, `GET /api/chat/turns/{id}/events`, and
`POST /api/chat/turns/{id}/cancel`. Run one backend worker: active tasks live in the
worker process, while messages/events survive in SQLite. Deploy the updated backend
with the updated Android app; older servers do not expose these endpoints.

## Context and artifacts

Summaries keep an explicit message watermark, so already-covered messages are not
summarized again. The raw archive remains intact. Unsummarized context is not silently
truncated if summarization fails. `CONTEXT_MAX_BYTES` defaults to 200000 for the raw
history guard; `LLM_MAX_OUTPUT_TOKENS` defaults to 8192 per model hop. Mutable memory
is placed after stable instructions/history to preserve reusable prompt prefixes.

Android opens artifact details from chat pills and Documents, fetches current content,
renders Markdown, and supports copying, sharing, refreshing, and authenticated PDF
export. PDF sharing uses restricted cache-file grants, not public unauthenticated URLs.

Run offline regressions with:
`.venv/bin/python -m unittest discover -s tests -p 'test_usage_recovery.py'`.
