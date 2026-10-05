"""
Velocity Proactive Scheduler & Decoupled Event Dispatcher
Executes time-triggered autonomous turns (recurring cron and one-shot reminders)
respecting the user's timezone (Asia/Kolkata by default) with a 2-hour wake-up grace period.

Dispatches results through a decoupled event bus:
1. Timeline persistence (SQLite sessions/main)
2. Live streaming broadcast to connected Web clients via SSE
3. Future hook for Flutter mobile push notifications (FCM/APNs)

Strict design constraint: ZERO EMOJIS across all code, strings, and logs.
"""

import os
import json
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Callable, Awaitable
from zoneinfo import ZoneInfo
from croniter import croniter

from backend.database import (
    get_due_scheduled_events,
    update_scheduled_event,
    get_scheduled_event,
    list_scheduled_events,
    create_scheduled_event,
    add_message,
    get_messages,
    get_session,
)
from backend.skills_manager import get_skill_instructions

logger = logging.getLogger("velocity.scheduler")


def get_user_timezone_str() -> str:
    """
    Returns the user's configured timezone string from environment or default.
    """
    return os.getenv("USER_TIMEZONE", "Asia/Kolkata").strip() or "Asia/Kolkata"


def get_user_timezone() -> ZoneInfo:
    """
    Returns ZoneInfo object for the configured user timezone.
    """
    tz_str = get_user_timezone_str()
    try:
        return ZoneInfo(tz_str)
    except Exception as e:
        logger.warning(f"Invalid timezone '{tz_str}', falling back to Asia/Kolkata: {e}")
        return ZoneInfo("Asia/Kolkata")


def compute_next_run(
    cron_expr: Optional[str] = None,
    run_at: Optional[str] = None,
    timezone_str: Optional[str] = None,
    base_dt: Optional[datetime] = None,
) -> Optional[str]:
    """
    Computes the next ISO 8601 execution timestamp.
    For one-shot events: parses run_at and returns its ISO representation.
    For recurring events: uses croniter with the specified timezone.
    """
    tz_name = timezone_str or get_user_timezone_str()
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("Asia/Kolkata")

    # One-shot event
    if run_at:
        try:
            dt = datetime.fromisoformat(run_at.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=tz)
            return dt.astimezone(timezone.utc).isoformat()
        except Exception as e:
            logger.error(f"Error parsing run_at '{run_at}': {e}")
            return None

    # Recurring cron event
    if cron_expr:
        try:
            if not base_dt:
                base_dt = datetime.now(tz)
            else:
                if base_dt.tzinfo is None:
                    base_dt = base_dt.replace(tzinfo=timezone.utc)
                base_dt = base_dt.astimezone(tz)

            itr = croniter(cron_expr.strip(), base_dt)
            next_dt = itr.get_next(datetime)
            return next_dt.astimezone(timezone.utc).isoformat()
        except Exception as e:
            logger.error(f"Error evaluating cron '{cron_expr}' with timezone '{tz_name}': {e}")
            return None

    return None


def seed_default_schedules_if_needed() -> None:
    """
    Seeds starter scheduled events (morning briefing and evening reflection)
    if no scheduled events currently exist in the database.
    """
    try:
        events = list_scheduled_events()
        if events:
            return

        tz_str = get_user_timezone_str()
        # 1. Daily Morning Briefing at 08:00 AM daily
        next_morning = compute_next_run(cron_expr="0 8 * * *", timezone_str=tz_str)
        create_scheduled_event(
            name="Daily Morning Briefing",
            event_type="recurring",
            cron_expression="0 8 * * *",
            timezone_str=tz_str,
            prompt="Synthesize today's morning briefing: summarize upcoming calendar events, pending tasks, priorities, and recent updates.",
            skill_id="morning_briefing",
            session_id="main",
            status="active",
            next_run_at=next_morning,
            event_id="sched_morning_briefing",
        )
        logger.info(f"Seeded default schedule 'Daily Morning Briefing' (next run: {next_morning})")

        # 2. Daily Evening Reflection at 09:00 PM daily
        next_evening = compute_next_run(cron_expr="0 21 * * *", timezone_str=tz_str)
        create_scheduled_event(
            name="Daily Evening Reflection",
            event_type="recurring",
            cron_expression="0 21 * * *",
            timezone_str=tz_str,
            prompt="Conduct evening reflection: review completed tasks, reflect on today's progress, and set initial thoughts for tomorrow.",
            skill_id="evening_reflection",
            session_id="main",
            status="active",
            next_run_at=next_evening,
            event_id="sched_evening_reflection",
        )
        logger.info(f"Seeded default schedule 'Daily Evening Reflection' (next run: {next_evening})")
    except Exception as e:
        logger.error(f"Failed to seed default scheduled events: {e}")


class ProactiveEventDispatcher:
    """
    Decoupled event dispatcher for autonomous proactive events.
    Broadcasting to:
    1. SQLite database timeline
    2. Connected Web SSE clients
    3. Future mobile push listeners
    """
    def __init__(self):
        self._listeners: List[Callable[[Dict[str, Any]], Awaitable[None]]] = []
        self._sse_queues: List[asyncio.Queue] = []

    def register_listener(self, listener: Callable[[Dict[str, Any]], Awaitable[None]]) -> None:
        """
        Registers an async listener for proactive events (e.g. mobile push notification sender).
        """
        self._listeners.append(listener)

    def subscribe_sse(self) -> asyncio.Queue:
        """
        Subscribes a web client to receive proactive events in real time.
        """
        q: asyncio.Queue = asyncio.Queue()
        self._sse_queues.append(q)
        return q

    def unsubscribe_sse(self, q: asyncio.Queue) -> None:
        """
        Unsubscribes a web client queue.
        """
        if q in self._sse_queues:
            self._sse_queues.remove(q)

    async def dispatch(self, event: Dict[str, Any]) -> None:
        """
        Dispatches a proactive event to all registered listeners and SSE queues.
        """
        # Broadcast to active SSE queues
        dead_queues = []
        for q in self._sse_queues:
            try:
                q.put_nowait(event)
            except Exception:
                dead_queues.append(q)
        for dq in dead_queues:
            self.unsubscribe_sse(dq)

        # Execute registered external listeners asynchronously
        for listener in self._listeners:
            try:
                await listener(event)
            except Exception as e:
                logger.error(f"Proactive event listener failed: {e}")


# Global singleton dispatcher
event_dispatcher = ProactiveEventDispatcher()


class ProactiveScheduler:
    """
    Background scheduler loop that runs inside FastAPI lifespan.
    Monitors due scheduled events, enforces wake-up grace windows, and triggers autonomous execution.
    """
    def __init__(self, runner_factory: Optional[Callable[[], Any]] = None):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._runner_factory = runner_factory

    def set_runner_factory(self, runner_factory: Callable[[], Any]) -> None:
        self._runner_factory = runner_factory

    def start(self) -> None:
        """
        Starts the background scheduler loop if not already running.
        """
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._scheduler_loop())
        logger.info("ProactiveScheduler started.")

    def stop(self) -> None:
        """
        Stops the scheduler loop.
        """
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
        logger.info("ProactiveScheduler stopped.")

    async def _scheduler_loop(self) -> None:
        """
        Main loop: checks for due events every 30 seconds.
        """
        while self._running:
            try:
                await self._check_and_execute_due_events()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Unexpected error in scheduler loop: {e}", exc_info=True)

            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                break

    async def _check_and_execute_due_events(self) -> None:
        """
        Queries database for events whose next_run_at <= current UTC time.
        """
        now_utc = datetime.now(timezone.utc)
        now_iso = now_utc.isoformat()

        # Run DB query in executor to avoid blocking the asyncio event loop
        loop = asyncio.get_running_loop()
        due_events = await loop.run_in_executor(None, get_due_scheduled_events, now_iso)

        if not due_events:
            return

        logger.info(f"Found {len(due_events)} due scheduled event(s).")
        for event in due_events:
            try:
                await self._process_due_event(event, now_utc)
            except Exception as e:
                logger.error(f"Error processing scheduled event '{event.get('id')}': {e}", exc_info=True)

    async def _process_due_event(self, event: Dict[str, Any], now_utc: datetime) -> None:
        """
        Processes a single due event: checks 2-hour grace period, runs turn, and advances schedule.
        """
        event_id = event["id"]
        next_run_str = event.get("next_run_at")
        event_type = event.get("event_type", "one_shot")
        cron_expr = event.get("cron_expression")
        tz_str = event.get("timezone", get_user_timezone_str())

        # Parse scheduled run time
        scheduled_dt: Optional[datetime] = None
        if next_run_str:
            try:
                scheduled_dt = datetime.fromisoformat(next_run_str.replace("Z", "+00:00"))
            except Exception:
                pass

        # 2-hour wake-up grace period check (7200 seconds)
        if scheduled_dt:
            elapsed_seconds = (now_utc - scheduled_dt).total_seconds()
            if elapsed_seconds > 7200:
                logger.warning(
                    f"Scheduled event '{event_id}' missed its run by {int(elapsed_seconds)}s "
                    "(exceeds 2-hour grace period)."
                )
                if event_type == "recurring" and cron_expr:
                    next_iso = compute_next_run(cron_expr=cron_expr, timezone_str=tz_str, base_dt=now_utc)
                    await asyncio.to_thread(
                        update_scheduled_event,
                        event_id,
                        last_run_at=now_utc.isoformat(),
                        next_run_at=next_iso,
                    )
                    logger.info(f"Advanced recurring event '{event_id}' to next occurrence: {next_iso}")
                else:
                    await asyncio.to_thread(
                        update_scheduled_event,
                        event_id,
                        status="cancelled",
                        next_run_at=None,
                    )
                    logger.info(f"Cancelled stale one-shot event '{event_id}'.")
                return

        # Execute the autonomous turn
        await self._execute_autonomous_turn(event, now_utc)

        # Update event schedule after execution
        if event_type == "recurring" and cron_expr:
            next_iso = compute_next_run(cron_expr=cron_expr, timezone_str=tz_str, base_dt=now_utc)
            await asyncio.to_thread(
                update_scheduled_event,
                event_id,
                last_run_at=now_utc.isoformat(),
                next_run_at=next_iso,
            )
            logger.info(f"Recurring event '{event_id}' completed run. Next run scheduled for {next_iso}.")
        else:
            await asyncio.to_thread(
                update_scheduled_event,
                event_id,
                last_run_at=now_utc.isoformat(),
                status="completed",
                next_run_at=None,
            )
            logger.info(f"One-shot event '{event_id}' completed and marked as completed.")

    async def _execute_autonomous_turn(self, event: Dict[str, Any], now_utc: datetime) -> None:
        """
        Executes an autonomous assistant turn in the target session (default: 'main').
        """
        if not self._runner_factory:
            logger.error("Cannot execute turn: runner_factory is not configured on ProactiveScheduler.")
            return

        runner = self._runner_factory()
        session_id = event.get("session_id") or "main"
        event_name = event.get("name", "Scheduled Event")
        prompt = event.get("prompt", "")
        skill_id = event.get("skill_id")

        # Load skill instructions if attached
        skill_instructions = ""
        if skill_id:
            skill_instructions = get_skill_instructions(skill_id) or ""

        # Compose Turn 0 autonomous instructions
        now_local = now_utc.astimezone(get_user_timezone()).strftime("%Y-%m-%d %H:%M:%S %Z")
        turn_prompt = (
            f"[AUTONOMOUS SCHEDULED TRIGGER: {event_name}]\n"
            f"Current Local Time: {now_local}\n"
            f"Directive: {prompt}\n"
            "Operate autonomously. Execute required actions via available tools directly. "
            "Deliver a structured, high-signal briefing or reflection without conversational filler or pleasantries.\n"
        )
        if skill_instructions:
            turn_prompt += f"\nSkill Specific Instructions:\n{skill_instructions}\n"

        logger.info(f"Executing autonomous scheduled turn for event '{event_name}' in session '{session_id}'...")

        try:
            # Run stream turn, collecting full assistant output
            from backend.prompt import compose_responses_input
            history_messages = await asyncio.to_thread(get_messages, session_id)
            session_data = await asyncio.to_thread(get_session, session_id)
            current_summary = session_data.get("summary") if session_data else None
            watermark = session_data.get("summarized_through") if session_data else None
            if watermark:
                covered = next((index for index, message in enumerate(history_messages) if message["id"] == watermark), None)
                if covered is not None:
                    history_messages = history_messages[covered + 1:]
            else:
                current_summary = None
            if sum(len(message.get("content", "").encode("utf-8")) for message in history_messages) > int(os.getenv("CONTEXT_MAX_BYTES", "200000")):
                raise ValueError("Scheduled conversation exceeds the context budget; send a chat turn to summarize it first")

            instructions, input_items = compose_responses_input(
                messages=history_messages,
                current_summary=current_summary,
                recall_memories=[],
                new_user_message=turn_prompt,
                verbosity="medium",
                hot_memory=None,
                is_thread=False,
                is_autonomous_routine=True,
            )

            assistant_text = ""
            thread_proposal = None
            artifact_payload = None
            staged_action_payload = None

            async for chunk in runner.stream_turn(
                source="scheduled",
                instructions=instructions,
                input_items=input_items,
                session_id=session_id,
                thinking_effort="medium",
                verbosity="medium",
            ):
                event_type = chunk.get("event")
                if event_type == "error":
                    raise RuntimeError(json.loads(chunk.get("data", "{}")).get("error", "Scheduled response failed"))
                if event_type == "delta":
                    try:
                        d = json.loads(chunk.get("data", "{}"))
                        assistant_text += d.get("text", "")
                    except Exception:
                        pass
                elif event_type == "done":
                    try:
                        d = json.loads(chunk.get("data", "{}"))
                        assistant_text = d.get("text", assistant_text)
                        thread_proposal = d.get("thread_proposal")
                        artifact_payload = d.get("artifact")
                        staged_action_payload = d.get("staged_action")
                    except Exception:
                        pass

            # Save assistant message to database
            msg_id = f"msg_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_{os.urandom(3).hex()}"
            artifact_id = artifact_payload.get("id") if artifact_payload else None

            await asyncio.to_thread(
                add_message,
                session_id=session_id,
                role="assistant",
                content=assistant_text,
                message_id=msg_id,
                thread_proposal=thread_proposal,
                artifact_id=artifact_id,
            )

            # Build event payload for dispatcher
            proactive_event = {
                "type": "proactive_turn",
                "session_id": session_id,
                "event_id": event.get("id"),
                "event_name": event_name,
                "message": {
                    "id": msg_id,
                    "session_id": session_id,
                    "role": "assistant",
                    "content": assistant_text,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "thread_proposal": thread_proposal,
                    "artifact_id": artifact_id,
                    "staged_action": staged_action_payload,
                }
            }

            # Dispatch to Web SSE and registered listeners
            await event_dispatcher.dispatch(proactive_event)
            logger.info(f"Autonomous turn for '{event_name}' executed and dispatched successfully.")

        except Exception as e:
            logger.error(f"Failed to execute autonomous turn for event '{event_name}': {e}", exc_info=True)


# Global singleton scheduler
proactive_scheduler = ProactiveScheduler()
