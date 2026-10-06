# Interface guide

## Appearance

Choose **Settings → General → Appearance** on the web or Android app. Light,
Dark, and OLED themes apply to chat, document readers, menus, and settings.
The choice is saved on the current browser or device; OLED uses a black canvas.
The base palette stays monochrome. Muted indigo is the only accent: `#575F9F`
on light surfaces and `#9AA3D0` on dark surfaces. Statuses also use labels, not
red/green color coding. The Velocity wordmark uses Satoshi.

## Conversations

Short message capsules fit their content, while longer messages wrap within a
bounded width. Thread replies retain the full-width document-style layout.
The down-arrow button appears at the bottom right of the conversation when you
scroll away from the latest message. It stays above the composer as it grows.
On Android, Back closes an open overlay first, then returns a thread to the main
timeline rather than leaving the app.

## Documents

Open a document from its chat pill or the Documents list. The reader separates
the title, summary, and metadata from the Markdown body, with Copy, Share
(Android), and PDF actions. The web reader supports a resizable split view,
full-screen reading, and a full-width layout on smaller screens.
Choose Editorial (serif), Clean, Technical, or Midnight appearance in either
reader. Appearance is saved per document on the backend without incrementing its
content version. PDF exports use the saved preset, embedded Unicode fonts, and
paginated tables. PDF typography follows the preset but is not a pixel-identical
browser capture. Remote images and unsafe HTML are excluded from PDF exports.

## Search and saved context

Web Search and Cmd/Ctrl+K, and Android Search, group documents, messages, and
threads. Unquoted words use prefix matching; quoted phrases require an exact
phrase. Filter by category, current conversation, author, and dates. Message
results jump to and briefly highlight the original message; Android loads older
history pages as needed. Search is local SQLite full-text search, not an LLM call.

Velocity can discover and read canonical documents and saved thread summaries
with `search_artifacts`, `read_artifact`, `search_threads`, and `read_thread`.
Reads are bounded and paginated. Thread documents belong to their source thread
but remain globally discoverable. New threads always belong to the main timeline;
nested creation and branching from a side thread are rejected by the backend.

## Usage

Settings → Usage groups spending, tokens, and activity into separate sections.
Input includes cached input; output includes reasoning. These subset counts must
not be added to the input/output total. Unreported provider breakdowns are marked
as unavailable rather than shown as zero. Daily activity uses UTC and left/right
arrow controls. Switch between model and activity breakdowns; expand pricing for
optional model rates. Spending limits remain disabled.
Prompt caching now has separate main-timeline and side-thread statistics for
the selected period. Completed turns preserve their recalled context and paired
tool calls/results; unchanged core memory is not duplicated on every turn.
Stable tool ordering, session cache keys, and deterministic vault ordering keep
prefixes reusable. Summarization, model/tool/skill changes, expiry, and provider
routing can still reduce hits. Cache rates are measured from provider usage, not
assumed from the presence of a cache key. Historical chat/routine calls are
categorized when their source conversation is known; other calls remain separate.

## Android schedules

Settings → Schedules supports creating, editing, pausing, and deleting routines.
Tap the pencil to change a name, instructions, timing, or IANA time zone.
Recurring routines support Daily, Weekdays, Weekends, and custom cron expressions;
one-time routines use a future ISO date/time with an explicit offset. Editing
preserves the linked skill and current status. Changes are saved to the backend
only after Save succeeds; failed saves keep the editor open.
