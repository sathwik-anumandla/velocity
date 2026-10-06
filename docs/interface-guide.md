# Interface guide

## Appearance

Choose **Settings → General → Appearance** on the web or Android app. Light,
Dark, and OLED themes apply to chat, document readers, menus, and settings.
The choice is saved on the current browser or device; OLED uses a black canvas.

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

## Usage

Settings → Usage groups spending, tokens, and activity into separate sections.
Input includes cached input; output includes reasoning. These subset counts must
not be added to the input/output total. Unreported provider breakdowns are marked
as unavailable rather than shown as zero. Daily activity uses UTC and left/right
arrow controls. Switch between model and activity breakdowns; expand pricing for
optional model rates. Spending limits remain disabled.

## Android schedules

Settings → Schedules supports creating, editing, pausing, and deleting routines.
Tap the pencil to change a name, instructions, timing, or IANA time zone.
Recurring routines support Daily, Weekdays, Weekends, and custom cron expressions;
one-time routines use a future ISO date/time with an explicit offset. Editing
preserves the linked skill and current status. Changes are saved to the backend
only after Save succeeds; failed saves keep the editor open.
