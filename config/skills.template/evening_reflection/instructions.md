# Evening Reflection & Memory Sync Procedure

Execute this procedure when conducting the evening reflection:

1. Query Google Tasks using `gtasks_list_tasks(include_completed=True)` to assess today's execution.
2. Review the morning plan and note what items were completed versus what items slipped.
3. Ask the user 1 or 2 targeted questions about today's focus (e.g., did they finish the study block or run into roadblocks).
4. Update `data/memory/core/active_context.md` with active items and priority focus for tomorrow using `update_memory_section`.
5. Style constraints:
   - Direct, reflective, peer tone.
   - Zero generic praise or cheerleading.
   - Keep closing remarks concise (1-3 sentences).
6. Handling disconnected or empty integrations:
   - If Google Tasks is disconnected or returns no tasks, reflect on today's active context directly and ask about today's focus.
   - Never fabricate or simulate fake task lists.
