# Morning Executive Briefing Procedure

Execute this procedure when preparing the morning briefing:

1. Query Google Calendar events for today using `gcal_list_events`.
2. Query pending Google Tasks using `gtasks_list_tasks`.
3. Query unread priority messages using `gmail_list_unread` (max_results=5).
4. Inspect current study topic in `data/memory/study/` or `data/memory/core/active_context.md`.
5. Identify a 60-90 minute free time slot in today's calendar. Suggest a study block; create it only when Sathwik explicitly requests booking, after checking for an existing block.
6. Suggest a concrete task for the day's primary objective. Create it only when Sathwik requests it, after checking existing tasks. Google due dates are date-only; Velocity priorities, labels, start and exact deadline are metadata in notes, not native fields or timed notifications.
7. Output a concise briefing with:
   - Agenda overview (time and event title).
   - Priority items and scheduled focus block.
   - Any urgent emails requiring attention.
8. Style constraints:
   - Punchy, direct peer tone.
   - Zero filler or generic morning greetings.
   - Do not ask open-ended questions that cause decision fatigue.
9. Handling disconnected or empty integrations:
   - If Google Calendar, Tasks, or Gmail are disconnected or return no entries, explicitly report that status (e.g. 'No calendar events scheduled today', 'Google Workspace disconnected').
   - Never fabricate, simulate, or hallucinate mock appointments, tasks, or emails.
