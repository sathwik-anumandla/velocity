"""
Velocity Backend
FastAPI server implementing the deterministic recall -> Luna -> retain loop.
Manages persistent sessions (SQLite + FTS5), ephemeral temporary sessions,
unconditional Hindsight recall/retain with graceful degradation, and SSE streaming.
"""

import os
import uuid
import json
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from contextlib import asynccontextmanager
from typing import List, Dict, Any, Optional, Literal
from pydantic import BaseModel

from fastapi import FastAPI, HTTPException, Query, Path, Request, Response
from fastapi.responses import HTMLResponse, FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse
from dotenv import load_dotenv

from backend.database import (
    init_db,
    get_connection,
    create_session as db_create_session,
    get_session as db_get_session,
    update_session as db_update_session,
    list_sessions as db_list_sessions,
    delete_session as db_delete_session,
    add_message as db_add_message,
    get_messages as db_get_messages,
    truncate_messages_from as db_truncate_messages_from,
    search_messages as db_search_messages,
    list_threads as db_list_threads,
    create_thread as db_create_thread,
    update_thread as db_update_thread,
    get_thread as db_get_thread,
    update_message_proposal as db_update_message_proposal,
    get_extracted_links as db_get_extracted_links,
    get_chronology_events as db_get_chronology_events,
    create_artifact as db_create_artifact,
    get_artifact as db_get_artifact,
    list_artifacts as db_list_artifacts,
    update_artifact as db_update_artifact,
    delete_artifact as db_delete_artifact,
    get_integration_token,
    get_staged_action as db_get_staged_action,
    update_staged_action_status as db_update_staged_action_status,
    list_staged_actions as db_list_staged_actions,
    update_staged_action_message_id as db_update_staged_action_message_id,
    create_scheduled_event as db_create_scheduled_event,
    get_scheduled_event as db_get_scheduled_event,
    update_scheduled_event as db_update_scheduled_event,
    list_scheduled_events as db_list_scheduled_events,
    delete_scheduled_event as db_delete_scheduled_event,
)
from backend.schemas import (
    ChatRequest,
    SessionCreate,
    SessionUpdate,
    SessionResponse,
    MessageResponse,
    SearchResult,
    ThreadCreate,
    ThreadUpdate,
    ThreadResponse,
    ProposalResponseAction,
    ArtifactCreate,
    ArtifactUpdate,
    ArtifactResponse,
    IntegrationServiceStatus,
    IntegrationStatusResponse,
    GoogleAuthUrlResponse,
    StagedActionResponse,
    ActionRespondRequest,
    ScheduledEventCreate,
    ScheduledEventUpdate,
    ScheduledEventResponse,
    SkillResponse,
    SkillCreateRequest,
    SkillUpdateRequest,
)
from backend.skills_manager import (
    seed_skills_if_needed,
    list_skills as sm_list_skills,
    get_skill as sm_get_skill,
    create_or_update_skill as sm_create_or_update_skill,
    delete_skill as sm_delete_skill,
)
from backend.scheduler import (
    proactive_scheduler,
    event_dispatcher,
    compute_next_run,
    get_user_timezone_str,
    seed_default_schedules_if_needed,
)
from backend.pdf_service import generate_artifact_pdf
from backend.hindsight import HindsightClient
from backend.google_service import google_workspace
from backend.prompt import (
    compose_responses_input,
    evaluate_summarization_waterfall,
    generate_summary,
)
import openai
from backend.responses_runner import ResponsesRunner
from backend.vault import (
    seed_vault_if_needed,
    get_vault_tree,
    read_memory_doc,
    write_memory_doc,
    update_memory_section,
    create_memory_doc,
    get_activity_log,
    log_activity,
)

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("velocity.main")

def classify_and_rename_session(user_message: str, session_id: str) -> Optional[str]:
    """
    Uses the classifier LLM model (from CLASSIFIER_MODEL_ID in .env) to rename the chat
    before sending it to the main model.
    """
    load_dotenv(override=True)
    classifier_model = os.getenv("CLASSIFIER_MODEL_ID", "").strip()
    if not classifier_model:
        classifier_model = os.getenv("RETAIN_LLM_MODEL", "").strip() or os.getenv("LLM_MODEL_ID", "gpt-4o-mini").strip()

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    base_url = (os.getenv("OPENAI_BASE_URL", "") or "https://api.openai.com/v1").strip().rstrip("/")
    if not api_key:
        return None

    try:
        client = openai.OpenAI(api_key=api_key, base_url=base_url)
        is_reasoning = any(prefix in classifier_model for prefix in ("o1", "o3", "gpt-5"))
        kwargs = {
            "model": classifier_model,
            "messages": [
                {
                    "role": "user",
                    "content": (
                        "Generate a clean 3 to 5 word title for a conversation that starts with this message:\n"
                        f"<user_message>\n{user_message}\n</user_message>\n"
                        "Return ONLY the plain title text with no quotes, no markdown, and no punctuation at the end."
                    )
                }
            ],
            "max_completion_tokens": 500 if is_reasoning else 50,
        }
        if is_reasoning:
            kwargs["reasoning_effort"] = "low"
        else:
            kwargs["temperature"] = 0.3
        response = client.chat.completions.create(**kwargs)
        title = response.choices[0].message.content.strip().strip('"\'')
        if title:
            db_update_session(session_id, name=title)
            logger.info(f"Classifier [{classifier_model}] renamed session {session_id} to: '{title}'")
            return title
    except Exception as e:
        logger.warning(f"Classifier renaming failed with model {classifier_model}: {e}")
    return None

# Ephemeral in-memory store for temporary sessions
# Structure: {session_id: {"messages": [...], "summary": None, "last_tokens": 0, "recall_budget": "medium", "thinking_effort": "medium"}}
temp_sessions: Dict[str, Dict[str, Any]] = {}

# Global clients
hindsight_client = HindsightClient()
responses_runner = ResponsesRunner(hindsight=hindsight_client)


async def run_nightly_vault_synthesis(hindsight: HindsightClient) -> Dict[str, Any]:
    """
    Synthesizes daily insights into the deterministic Markdown Vault:
    1. Reads active_context.md and profile.
    2. Queries recent memories/observations from Hindsight.
    3. Calls gpt-5.4-mini with a structured synthesis prompt.
    4. Updates vault sections and logs to activity.log.
    """
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    base_url = (os.getenv("OPENAI_BASE_URL", "") or "https://api.openai.com/v1").strip().rstrip("/")
    cheap_model = (os.getenv("SYNTHESIS_MODEL_ID") or os.getenv("CLASSIFIER_MODEL_ID") or "gpt-5.4-mini").strip()

    if not api_key:
        logger.warning("[Nightly Synthesis] OPENAI_API_KEY not configured, skipping synthesis.")
        return {"status": "skipped", "reason": "no_api_key"}

    logger.info(f"[Nightly Synthesis] Starting vault synthesis with model [{cheap_model}]...")

    try:
        memories, status = await asyncio.to_thread(
            hindsight.recall, "today's tasks, priorities, progress, open loops, and key topics", "high", 10
        )
        memories_text = "\n".join(f"- {m}" for m in memories) if memories else "No new memories retrieved."

        current_active = await asyncio.to_thread(read_memory_doc, "core/active_context.md") or ""

        synthesis_prompt = f"""You are the Velocity Nightly Memory Synthesizer.
Review the following recent memories and the current active context for Sathwik.
Identify:
1. Are there any completed tasks or newly opened priorities for active_context.md?
2. Did any project state change?
3. Was there a deep discussion on a new intellectual topic that warrants a new dossier?

Memories Retrieved:
{memories_text}

Current active_context.md:
{current_active}

Output your response strictly as a JSON object with this schema:
{{
  "actions": [
    {{
      "action": "update_section",
      "path": "core/active_context.md",
      "section": "Immediate Focus",
      "content": "new markdown content"
    }}
  ]
}}
If no updates are needed, output strictly: {{"actions": []}}
Do not include markdown fences, backticks, or any other text outside the JSON object."""

        client = openai.OpenAI(api_key=api_key, base_url=base_url)
        is_reasoning = any(m in cheap_model.lower() for m in ["o1", "o3", "o4", "gpt-5"])
        kwargs: Dict[str, Any] = {
            "model": cheap_model,
            "messages": [{"role": "user", "content": synthesis_prompt}],
            "max_completion_tokens": 3000 if is_reasoning else 1500,
            "response_format": {"type": "json_object"},
        }
        if is_reasoning:
            kwargs["reasoning_effort"] = "low"
        else:
            kwargs["temperature"] = 0.2

        response = await asyncio.to_thread(client.chat.completions.create, **kwargs)
        raw_output = response.choices[0].message.content.strip()

        clean_json = raw_output
        if clean_json.startswith("```"):
            clean_json = re.sub(r"^```(?:json)?\n", "", clean_json)
            clean_json = re.sub(r"\n```$", "", clean_json)

        parsed_data = json.loads(clean_json)
        actions = []
        if isinstance(parsed_data, dict) and "actions" in parsed_data:
            actions = parsed_data["actions"]
        elif isinstance(parsed_data, list):
            actions = parsed_data

        applied_count = 0
        if isinstance(actions, list):
            for act in actions:
                action_type = act.get("action")
                path = act.get("path")
                if action_type == "update_section" and path:
                    sec = act.get("section", "Immediate Focus")
                    content = act.get("content", "")
                    if sec and content:
                        ok = await update_memory_section(path, sec, content, source="NIGHTLY_SYNTHESIS")
                        if ok:
                            applied_count += 1
                elif action_type == "create_doc" and path:
                    content = act.get("content", "")
                    if content:
                        ok = await create_memory_doc(path, content, source="NIGHTLY_SYNTHESIS")
                        if ok:
                            applied_count += 1

        await log_activity(
            "NIGHTLY_SYNTHESIS",
            "CYCLE_COMPLETE",
            "data/memory",
            f"Synthesized memory updates: {applied_count} actions applied",
        )
        logger.info(f"[Nightly Synthesis] Successfully applied {applied_count} memory actions.")
        return {"status": "success", "actions_applied": applied_count}

    except Exception as e:
        logger.error(f"[Nightly Synthesis] Failed during synthesis: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


async def execute_dream_cycle(hindsight: HindsightClient) -> Dict[str, Any]:
    """
    Executes the nightly dreaming pass:
    1. Triggers Hindsight memory consolidation to extract observations from retained facts.
    2. Runs nightly vault synthesis using gpt-5.4-mini to reconcile active_context,
       update project statuses, and log to activity.log.
    """
    logger.info("[Dream Cycle] Starting scheduled offline memory consolidation...")
    consolidate_ok = await asyncio.to_thread(hindsight.consolidate)
    logger.info(
        f"[Dream Cycle] Consolidation request dispatched: success={consolidate_ok}. "
        "Mental models will auto-refresh natively in Hindsight once consolidation completes."
    )

    # Run deterministic vault synthesis
    synthesis_result = await run_nightly_vault_synthesis(hindsight)

    return {
        "consolidation": "dispatched" if consolidate_ok else "failed",
        "synthesis": synthesis_result,
    }


async def run_nightly_dream_scheduler(hindsight: HindsightClient):
    """
    Continuous background loop that schedules the dreaming cycle every day at 23:00 UTC (04:30 AM IST).
    Hour is configurable via NIGHTLY_DREAM_UTC_HOUR environment variable (default: 23).
    """
    target_hour = int(os.getenv("NIGHTLY_DREAM_UTC_HOUR", "23"))
    target_minute = int(os.getenv("NIGHTLY_DREAM_UTC_MINUTE", "0"))
    ist_hour = (target_hour + 5 + (target_minute + 30) // 60) % 24
    ist_minute = (target_minute + 30) % 60
    logger.info(f"[Dream Scheduler] Active. Target: {target_hour:02d}:{target_minute:02d} UTC ({ist_hour:02d}:{ist_minute:02d} IST).")

    while True:
        try:
            now_utc = datetime.now(timezone.utc)
            target_utc = now_utc.replace(hour=target_hour, minute=target_minute, second=0, microsecond=0)
            if now_utc >= target_utc:
                target_utc += timedelta(days=1)

            sleep_seconds = (target_utc - now_utc).total_seconds()
            hours_left = int(sleep_seconds // 3600)
            mins_left = int((sleep_seconds % 3600) // 60)
            logger.info(f"[Dream Scheduler] Next dream cycle scheduled at {target_utc.isoformat()} (in {hours_left}h {mins_left}m).")

            await asyncio.sleep(sleep_seconds)

            # Wake up and execute dream cycle
            await execute_dream_cycle(hindsight)

            # Sleep 60 seconds buffer to avoid double triggering in the same minute
            await asyncio.sleep(60)

        except asyncio.CancelledError:
            logger.info("[Dream Scheduler] Background task cancelled for server shutdown.")
            break
        except Exception as e:
            logger.error(f"[Dream Scheduler] Unexpected error in scheduler loop: {e}", exc_info=True)
            await asyncio.sleep(300)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Ensure local data directories and SQLite database exist
    db_path = os.getenv("SQLITE_DB_PATH", "./data/velocity.db")
    db_dir = os.path.dirname(db_path)
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    init_db()
    logger.info("Velocity Persistence initialized (SQLite + FTS5)")

    # Seed and bootstrap deterministic memory vault from template if not present
    await asyncio.to_thread(seed_vault_if_needed, hindsight_client)
    logger.info("Deterministic Memory Vault checked/initialized")

    # Seed modular skills from template if not present
    await asyncio.to_thread(seed_skills_if_needed)
    logger.info("Modular Skills checked/initialized")

    # Seed default scheduled events if not present
    await asyncio.to_thread(seed_default_schedules_if_needed)
    logger.info("Default Scheduled Events checked/initialized")

    # Bootstrap Hindsight memory bank & foundational mental models in the background
    asyncio.create_task(asyncio.to_thread(hindsight_client.bootstrap_memory_bank))

    # Launch automated nightly dreaming scheduler (23:00 UTC / 04:30 AM IST)
    dream_task = asyncio.create_task(run_nightly_dream_scheduler(hindsight_client))

    # Launch proactive scheduler
    proactive_scheduler.set_runner_factory(lambda: responses_runner)
    proactive_scheduler.start()

    yield
    # Shutdown
    proactive_scheduler.stop()
    dream_task.cancel()
    try:
        await dream_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="Velocity AI Assistant API",
    version="1.0.0",
    lifespan=lifespan,
)

# Enable CORS for local app and web UI clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Web UI (Flutter web or frontend dist)
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, FileResponse, Response, HTMLResponse


class NoCacheStaticFiles(StaticFiles):
    def is_not_modified(self, response_headers, request_headers) -> bool:
        return False

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response


dist_dir: Optional[str] = None
for candidate_path in [
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "dist"),
    "/app/web/dist",
    "./web/dist",
]:
    if os.path.exists(candidate_path):
        dist_dir = candidate_path
        assets_path = os.path.join(candidate_path, "assets")
        if os.path.exists(assets_path):
            app.mount("/assets", NoCacheStaticFiles(directory=assets_path), name="assets")
        # Also keep /ui mounted for backwards compatibility
        app.mount("/ui", NoCacheStaticFiles(directory=candidate_path, html=True), name="ui")
        logger.info(f"Mounted Web UI from {candidate_path} at / and /ui (no-cache enabled)")
        break


@app.get("/favicon.svg")
async def get_favicon():
    if dist_dir:
        fav_file = os.path.join(dist_dir, "favicon.svg")
        if os.path.isfile(fav_file):
            return FileResponse(fav_file)
    return Response(status_code=404)


# ==============================================================================
# 1. Root & Health Endpoints
# ==============================================================================
@app.get("/")
async def root():
    if dist_dir:
        index_file = os.path.join(dist_dir, "index.html")
        if os.path.isfile(index_file):
            return FileResponse(index_file)
    return {
        "status": "online",
        "service": "Velocity Assistant Backend",
        "version": "1.0.0",
    }


@app.get("/health")
async def health_check():
    """
    Health check endpoint for the macOS app and orchestrator.
    Checks backend status, database accessibility, and Hindsight connectivity.
    """
    hindsight_healthy = hindsight_client.check_health()

    db_ok = True
    try:
        # Quick query to verify SQLite health
        db_list_sessions()
    except Exception:
        db_ok = False

    status = "ok" if (hindsight_healthy and db_ok) else "degraded"

    return {
        "status": status,
        "backend": "healthy",
        "hindsight": "healthy" if hindsight_healthy else "unreachable",
        "database": "healthy" if db_ok else "error",
    }


# ==============================================================================
# 2. Session Management Endpoints
# ==============================================================================
@app.post("/sessions", response_model=SessionResponse)
async def create_session(session_in: SessionCreate):
    """
    Create a new persistent named session.
    """
    session_id = session_in.id or str(uuid.uuid4())
    existing = db_get_session(session_id)
    if existing:
        return SessionResponse(**existing)

    sess = db_create_session(
        session_id=session_id,
        name=session_in.name,
        recall_budget=session_in.recall_budget,
        thinking_effort=session_in.thinking_effort,
        verbosity=session_in.verbosity,
        model=session_in.model or os.getenv("LLM_MODEL_ID", "gpt-5.4-mini"),
    )
    return SessionResponse(**sess)


@app.get("/sessions", response_model=List[SessionResponse])
async def list_sessions():
    """
    List all persistent sessions ordered by most recently updated.
    """
    sessions = db_list_sessions()
    return [SessionResponse(**s) for s in sessions]


@app.get("/sessions/{session_id}")
async def get_session_details(session_id: str = Path(...)):
    """
    Get session metadata and all historical messages.
    """
    session = db_get_session(session_id)
    if not session and session_id == "main":
        init_db()
        session = db_get_session("main")

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    messages = db_get_messages(session_id)
    staged_actions = db_list_staged_actions(session_id=session_id)
    staged_by_msg = {sa["message_id"]: sa for sa in staged_actions if sa.get("message_id")}

    enriched_messages = []
    for m in messages:
        m_dict = dict(m)
        if m_dict.get("artifact_id"):
            m_dict["artifact"] = db_get_artifact(m_dict["artifact_id"])
        if m_dict["id"] in staged_by_msg:
            m_dict["staged_action"] = staged_by_msg[m_dict["id"]]
        enriched_messages.append(MessageResponse(**m_dict))

    return {
        "session": SessionResponse(**session),
        "messages": enriched_messages,
    }


@app.patch("/sessions/{session_id}", response_model=SessionResponse)
async def update_session_meta(session_id: str, patch: SessionUpdate):
    """
    Update session name or sticky settings (recall_budget, thinking_effort, verbosity, model).
    """
    session = db_get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    db_update_session(
        session_id=session_id,
        name=patch.name,
        recall_budget=patch.recall_budget,
        thinking_effort=patch.thinking_effort,
        verbosity=patch.verbosity,
        model=patch.model,
    )
    updated = db_get_session(session_id)
    return SessionResponse(**updated)


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """
    Delete a session and all its associated messages.
    """
    success = db_delete_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "deleted", "session_id": session_id}


@app.delete("/sessions/{session_id}/messages")
async def truncate_session_messages(
    session_id: str,
    from_message_id: str = Query(..., description="Message ID to truncate from"),
):
    """
    Truncates a session from a given message ID onward (deleting it and all subsequent messages).
    Handles both persistent SQLite sessions and ephemeral temporary sessions.
    """
    if session_id in temp_sessions:
        msgs = temp_sessions[session_id].get("messages", [])
        idx = next((i for i, m in enumerate(msgs) if m.get("id") == from_message_id), None)
        if idx is not None:
            temp_sessions[session_id]["messages"] = msgs[:idx]
            return {"status": "truncated", "deleted": len(msgs) - idx}
        return {"status": "truncated", "deleted": 0}

    deleted_count = db_truncate_messages_from(session_id, from_message_id)
    return {"status": "truncated", "deleted": deleted_count}


# ==============================================================================
# 3. Global Full-Text Search (FTS5)
# ==============================================================================
@app.get("/search", response_model=List[SearchResult])
async def search(q: str = Query(..., min_length=1, description="Search query")):
    """
    Search messages across all sessions using SQLite FTS5.
    """
    results = db_search_messages(query=q)
    return [SearchResult(**r) for r in results]


# ==============================================================================
# 4. Turn Execution Loop with Buffered SSE Streaming
# ==============================================================================
@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """
    Per-turn loop:
    1. Unconditional sync recall from Hindsight (with sticky budget toggle).
    2. Context composition (5-tier summarization waterfall, cache-optimal order).
    3. Stream Luna via OpenAI Responses API (reasoning effort toggle, tool calls, buffered stream).
    4. Synchronous retain after exchange (tagged with session_id, no raw search results).
    5. Persistence to SQLite (bypassed if is_temporary is true).
    """
    session_id = request.session_id
    user_message = request.message
    is_temp = request.is_temporary

    # Step 1: Session Resolution & Sticky Toggles
    if is_temp:
        if session_id not in temp_sessions:
            temp_sessions[session_id] = {
                "messages": [],
                "summary": None,
                "last_tokens": 0,
                "recall_budget": request.recall_budget or "medium",
                "thinking_effort": request.thinking_effort or "medium",
                "verbosity": request.verbosity or "low",
                "model": request.model or os.getenv("LLM_MODEL_ID", "gpt-5.4-mini"),
            }
        temp_state = temp_sessions[session_id]
        if request.recall_budget:
            temp_state["recall_budget"] = request.recall_budget
        if request.thinking_effort:
            temp_state["thinking_effort"] = request.thinking_effort
        if request.verbosity:
            temp_state["verbosity"] = request.verbosity
        if request.model:
            temp_state["model"] = request.model

        recall_budget = temp_state["recall_budget"]
        thinking_effort = temp_state["thinking_effort"]
        verbosity = temp_state.get("verbosity", "low")
        model = temp_state.get("model") or os.getenv("LLM_MODEL_ID", "gpt-5.4-mini")
        history_messages = list(temp_state["messages"])
        current_summary = temp_state["summary"]
        last_tokens = temp_state["last_tokens"]
    else:
        session = db_get_session(session_id)
        if not session:
            session = db_create_session(
                session_id=session_id,
                recall_budget=request.recall_budget or "medium",
                thinking_effort=request.thinking_effort or "medium",
                verbosity=request.verbosity or "low",
                model=request.model or os.getenv("LLM_MODEL_ID", "gpt-5.4-mini"),
            )

        # Update sticky toggles if provided
        to_update = {}
        if request.recall_budget and request.recall_budget != session["recall_budget"]:
            to_update["recall_budget"] = request.recall_budget
        if request.thinking_effort and request.thinking_effort != session["thinking_effort"]:
            to_update["thinking_effort"] = request.thinking_effort
        if request.verbosity and request.verbosity != session.get("verbosity"):
            to_update["verbosity"] = request.verbosity
        if request.model and request.model != session.get("model"):
            to_update["model"] = request.model
        if to_update:
            db_update_session(session_id, **to_update)
            session = db_get_session(session_id)

        recall_budget = session["recall_budget"]
        thinking_effort = session["thinking_effort"]
        verbosity = session.get("verbosity", "low")
        model = session.get("model") or request.model or os.getenv("LLM_MODEL_ID", "gpt-5.4-mini")
        history_limit = 100 if session_id == "main" else None
        history_messages = db_get_messages(session_id, limit=history_limit)
        current_summary = session.get("summary")
        last_tokens = session.get("last_tokens") or 0

    is_thread = False
    if not is_temp:
        is_thread = bool(session and session.get("is_thread"))

    # Renaming layer: Before sending to main model, send to classifier model to rename the chat
    # Never rename main timeline ('main') or side chats (is_thread)
    renamed_title = None
    if not is_temp and session_id != "main" and not is_thread and (len(history_messages) == 0 or session["name"].startswith("Session ") or session["name"] in ["New Chat", "New Conversation"]):
        renamed_title = await asyncio.to_thread(classify_and_rename_session, user_message, session_id)
        if renamed_title and session:
            session["name"] = renamed_title

    overall_memory_status = "ok"

    async def event_generator():
        nonlocal overall_memory_status
        full_assistant_response = ""
        usage_data = {}
        thread_proposal_data = None

        if renamed_title:
            yield {
                "event": "session_renamed",
                "data": json.dumps({"session_id": session_id, "name": renamed_title})
            }

        # Step 2: Real-time status for Hindsight Recall
        yield {
            "event": "status",
            "data": json.dumps({"text": "Fetching recall"})
        }

        recalled_memories, recall_status = await asyncio.to_thread(
            hindsight_client.recall,
            query=user_message,
            budget=recall_budget,
        )
        overall_memory_status = recall_status

        # Step 3: Real-time status for Mental Model retrieval
        yield {
            "event": "status",
            "data": json.dumps({"text": "Fetching mental model"})
        }

        # Hot mental models (user-persona & current-context) from cache (< 1ms warm, < 30ms cold)
        hot_memory = await asyncio.to_thread(hindsight_client.get_hot_context)

        # Check if waterfall triggers summarization of older history
        cutoff = 30 if is_thread else (16 if session_id == "main" else 6)
        local_summary = current_summary
        if len(history_messages) > cutoff:
            total_turns = len(history_messages) // 2
            last_msg_ts = history_messages[-1]["created_at"] if history_messages else None
            should_sum, reason = evaluate_summarization_waterfall(
                total_turns=total_turns,
                total_tokens=last_tokens,
                last_message_timestamp=last_msg_ts,
                has_unsummarized_tail=True,
            )
            if should_sum:
                logger.info(f"Summarization waterfall triggered: {reason}")
                to_summarize = history_messages[:-cutoff]
                new_summary = await asyncio.to_thread(generate_summary, local_summary, to_summarize)
                if new_summary:
                    local_summary = new_summary
                    if is_temp:
                        temp_sessions[session_id]["summary"] = new_summary
                    else:
                        db_update_session(session_id, summary=new_summary)

        # Compose Responses API input in strict cache-optimal order
        instructions, input_items = compose_responses_input(
            messages=history_messages,
            current_summary=local_summary,
            recall_memories=recalled_memories,
            new_user_message=user_message,
            verbosity=verbosity,
            hot_memory=hot_memory,
            is_thread=is_thread,
        )

        # Step 4: Real-time status for Model Thinking
        yield {
            "event": "status",
            "data": json.dumps({"text": "Thinking"})
        }

        thread_proposal_data = None
        artifact_data = None
        artifact_id = None

        # Stream from Responses API runner
        async for sse_item in responses_runner.stream_turn(
            instructions=instructions,
            input_items=input_items,
            session_id=session_id,
            thinking_effort=thinking_effort,
            verbosity=verbosity,
            model=model,
            is_temporary=is_temp,
            is_thread=is_thread,
        ):
            ev = sse_item["event"]
            raw_data = sse_item["data"]

            if ev == "done":
                try:
                    payload = json.loads(raw_data)
                    full_assistant_response = payload.get("text", "")
                    usage_data = payload.get("usage", {})
                    thread_proposal_data = payload.get("thread_proposal", None)
                    artifact_data = payload.get("artifact", None)
                    artifact_id = payload.get("artifact_id", None)
                    staged_action_data = payload.get("staged_action", None)
                except Exception:
                    pass
            else:
                yield {
                    "event": ev,
                    "data": raw_data,
                }

        # Step 4: Retain after exchange using structured format, stable document_id & TEMPR tags
        if not is_temp:
            session_title = renamed_title or (session.get("name") if session else "New Chat")
            retain_status = await asyncio.to_thread(
                hindsight_client.retain_turn,
                user_message=user_message,
                assistant_response=full_assistant_response,
                session_id=session_id,
                session_name=session_title,
                async_retain=True,
            )
            if retain_status == "degraded" or overall_memory_status == "degraded":
                overall_memory_status = "degraded"
            else:
                overall_memory_status = "ok"

        # Step 5: Persistence
        new_total_tokens = usage_data.get("total_tokens", last_tokens)
        now_iso = datetime.utcnow().isoformat()

        user_msg_id = request.message_id or str(uuid.uuid4())
        asst_msg_id = str(uuid.uuid4())

        if is_temp:
            # Ephemeral memory only
            temp_sessions[session_id]["messages"].append({
                "id": user_msg_id,
                "session_id": session_id,
                "role": "user",
                "content": user_message,
                "memory_status": overall_memory_status,
                "created_at": now_iso,
            })
            temp_sessions[session_id]["messages"].append({
                "id": asst_msg_id,
                "session_id": session_id,
                "role": "assistant",
                "content": full_assistant_response,
                "memory_status": overall_memory_status,
                "artifact_id": artifact_id,
                "artifact": artifact_data,
                "staged_action": staged_action_data,
                "created_at": now_iso,
            })
            temp_sessions[session_id]["last_tokens"] = new_total_tokens
        else:
            # Persistent SQLite store
            db_add_message(
                message_id=user_msg_id,
                session_id=session_id,
                role="user",
                content=user_message,
                memory_status=overall_memory_status,
            )
            db_add_message(
                message_id=asst_msg_id,
                session_id=session_id,
                role="assistant",
                content=full_assistant_response,
                memory_status=overall_memory_status,
                thread_proposal=json.dumps(thread_proposal_data) if thread_proposal_data else None,
                artifact_id=artifact_id,
            )
            if artifact_id:
                try:
                    conn = get_connection()
                    cursor = conn.cursor()
                    cursor.execute("UPDATE artifacts SET message_id = ? WHERE id = ?", (asst_msg_id, artifact_id))
                    conn.commit()
                    conn.close()
                except Exception as ex:
                    logger.warning(f"Could not link artifact {artifact_id} with message {asst_msg_id}: {ex}")

            if staged_action_data and staged_action_data.get("id"):
                try:
                    await asyncio.to_thread(
                        db_update_staged_action_message_id,
                        staged_action_data["id"],
                        asst_msg_id,
                    )
                except Exception as ex:
                    logger.warning(f"Could not link staged action {staged_action_data['id']} with message {asst_msg_id}: {ex}")

            db_update_session(
                session_id=session_id,
                last_tokens=new_total_tokens,
            )

        # Emit final completion event with message IDs, memory status, thread proposal, artifact and usage
        yield {
            "event": "complete",
            "data": json.dumps({
                "text": full_assistant_response,
                "memory_status": overall_memory_status,
                "usage": usage_data,
                "user_message_id": user_msg_id,
                "assistant_message_id": asst_msg_id,
                "thread_proposal": thread_proposal_data,
                "artifact": artifact_data,
                "artifact_id": artifact_id,
                "staged_action": staged_action_data,
            }),
        }

    return EventSourceResponse(event_generator())


# ==============================================================================
# 4. Cognitive Memory Endpoints (Mental Models & Reflect)
# ==============================================================================
class ReflectRequest(BaseModel):
    query: str
    budget: Optional[Literal["low", "mid", "high"]] = "mid"


@app.get("/memory/mental-models")
async def get_mental_models():
    """
    Retrieve all foundational mental models and their synthesized markdown content.
    """
    model_ids = ["current-context", "user-persona", "projects-and-decisions", "goals-and-interests"]
    items = []
    for mid in model_ids:
        content = await asyncio.to_thread(hindsight_client.get_mental_model, mid)
        items.append({
            "id": mid,
            "content": content,
            "is_ready": bool(content and content != "Generating content..."),
        })
    return {"items": items}


@app.post("/memory/mental-models/{model_id}/refresh")
async def refresh_mental_model_endpoint(model_id: str):
    """
    Clears cached content and triggers a fresh reflect re-synthesis for a mental model.
    """
    cleared = await asyncio.to_thread(hindsight_client.clear_mental_model, model_id)
    op_id = await asyncio.to_thread(hindsight_client.refresh_mental_model, model_id)
    return {
        "model_id": model_id,
        "cleared": cleared,
        "operation_id": op_id,
        "status": "refreshing" if op_id else "error",
    }


@app.post("/memory/consolidate")
async def trigger_consolidation_endpoint():
    """
    Triggers an offline observation consolidation pass across unconsolidated memories in Hindsight.
    """
    success = await asyncio.to_thread(hindsight_client.consolidate)
    return {
        "status": "triggered" if success else "error"
    }


@app.post("/memory/dream")
async def trigger_dream_endpoint():
    """
    Manually triggers an immediate dreaming pass (consolidation followed by mental model refresh)
    in the background.
    """
    asyncio.create_task(execute_dream_cycle(hindsight_client))
    return {
        "status": "triggered",
        "message": "Nightly dream cycle (consolidation followed by mental model refresh) started in background."
    }


@app.post("/memory/reflect")
async def reflect_memory(req: ReflectRequest):
    """
    Execute an agentic reflect query across mental models, observations, and raw facts.
    """
    answer, citations, status = await asyncio.to_thread(
        hindsight_client.reflect, req.query, req.budget or "mid"
    )
    return {
        "query": req.query,
        "answer": answer,
        "citations": citations,
        "status": status,
    }


class SaveDocRequest(BaseModel):
    path: str
    content: str


@app.get("/api/memory/tree")
async def get_vault_tree_endpoint():
    """
    Returns the structured catalog of documents in the deterministic memory vault.
    """
    tree = await asyncio.to_thread(get_vault_tree)
    return {"tree": tree}


@app.get("/api/memory/doc")
async def get_memory_doc_endpoint(path: str = Query(..., description="Relative path in vault")):
    """
    Reads a document from the memory vault.
    """
    content = await asyncio.to_thread(read_memory_doc, path)
    if content is None:
        raise HTTPException(status_code=404, detail=f"Document '{path}' not found")
    return {"path": path, "content": content}


@app.put("/api/memory/doc")
async def save_memory_doc_endpoint(req: SaveDocRequest):
    """
    Saves a document to the memory vault with atomic replacement.
    """
    success = await write_memory_doc(req.path, req.content, source="USER_UI", action="UPDATE")
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save document")
    return {"status": "ok", "path": req.path}


@app.get("/api/memory/activity")
async def get_memory_activity_endpoint(limit: int = 50):
    """
    Returns recent structured activity log entries from the memory vault.
    """
    entries = await asyncio.to_thread(get_activity_log, limit)
    return {"entries": entries}


@app.post("/api/memory/synthesis")
async def trigger_vault_synthesis_endpoint():
    """
    Manually triggers the nightly memory vault synthesis in the background.
    """
    asyncio.create_task(run_nightly_vault_synthesis(hindsight_client))
    return {
        "status": "triggered",
        "message": "Vault synthesis triggered in background."
    }


# ==============================================================================
# Phase 2: Side Chats (Threads) & Navigation Rail Endpoints
# ==============================================================================
async def synthesize_thread_rollup(thread: Dict[str, Any], messages: List[Dict[str, Any]], conclude: bool = False):
    """
    Background worker that synthesizes an updated rollup summary for a side chat using gpt-5.4-mini,
    updates the session in SQLite, and posts a 1-line update bump in the main timeline.
    """
    thread_id = thread["id"]
    thread_name = thread.get("name", "Thread")
    parent_session_id = thread.get("parent_session_id") or "main"

    recent = messages[-20:]
    if not recent:
        return None

    formatted_convo = "\n".join([f"{m['role'].upper()}: {m['content']}" for m in recent])

    prompt = (
        "You are Velocity's background thread synthesizer.\n"
        f"Thread Title: {thread_name}\n\n"
        "Recent Thread History:\n"
        f"{formatted_convo}\n\n"
        "Instructions:\n"
        "Summarize what was accomplished in this thread, current technical state, and key decisions.\n"
        "- Exactly 2 to 3 punchy, high-signal sentences.\n"
        "- Strictly NO emojis anywhere in your output.\n"
        "- No introductory filler (e.g. 'In this thread...', 'Here is a summary'). Direct, sharp statement."
    )

    try:
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        base_url = (os.getenv("OPENAI_BASE_URL", "") or "https://api.openai.com/v1").strip().rstrip("/")
        cheap_model = (os.getenv("SYNTHESIS_MODEL_ID") or os.getenv("CLASSIFIER_MODEL_ID") or "gpt-5.4-mini").strip()
        client = openai.OpenAI(api_key=api_key, base_url=base_url)

        resp = await asyncio.to_thread(
            client.chat.completions.create,
            model=cheap_model,
            messages=[
                {"role": "system", "content": "You are a concise engineering synthesizer. Output strictly 2-3 sentences. No emojis."},
                {"role": "user", "content": prompt},
            ],
            max_completion_tokens=400,
        )
        summary = (resp.choices[0].message.content or "").strip() if resp.choices and resp.choices[0].message else ""
        if not summary or len(summary) < 8:
            return None

        # Update thread in DB
        new_status = "concluded" if conclude else thread.get("status", "active")
        db_update_thread(thread_id, rollup_summary=summary, status=new_status)

        prefix = "Thread Concluded" if conclude else "Thread Update"
        bump_content = f"[{prefix}: {thread_name}]\n{summary}"

        # Prevent duplicate update bumps if parent session already has a recent update for this thread
        recent_parent = db_get_messages(parent_session_id, limit=5)
        for pm in recent_parent:
            if pm.get("thread_id") == thread_id and (pm.get("content") == bump_content or summary in pm.get("content", "")):
                logger.info(f"Rollup for thread {thread_id} already posted; skipping duplicate bump.")
                return summary

        # Drop update bump in main timeline
        bump_id = str(uuid.uuid4())
        db_add_message(
            message_id=bump_id,
            session_id=parent_session_id,
            role="assistant",
            content=bump_content,
            thread_id=thread_id,
        )
        logger.info(f"Synthesized rollup for thread {thread_id}: {summary}")
        return summary
    except Exception as e:
        logger.error(f"Error synthesizing thread rollup for {thread_id}: {e}")
        return None


@app.get("/api/threads")
async def list_threads_endpoint(status: Optional[str] = None):
    """
    Lists all side chats (threads), ordered newest first.
    """
    threads = await asyncio.to_thread(db_list_threads, status)
    return {"threads": threads}


@app.post("/api/threads")
async def create_thread_endpoint(req: ThreadCreate):
    """
    Creates a new side chat thread.
    """
    thread_id = f"thread_{uuid.uuid4().hex[:12]}"
    thread = await asyncio.to_thread(
        db_create_thread,
        thread_id=thread_id,
        name=req.name,
        parent_message_id=req.parent_message_id,
        parent_session_id=req.parent_session_id,
        model=req.model,
        initial_summary=req.initial_summary,
    )

    if req.parent_message_id:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM messages WHERE id = ?", (req.parent_message_id,))
        pm = cursor.fetchone()
        if pm:
            parent_sess = pm["session_id"]
            if pm["role"] == "assistant":
                cursor.execute("""
                    SELECT * FROM messages
                    WHERE session_id = ? AND role = 'user' AND created_at <= ?
                    ORDER BY created_at DESC LIMIT 1
                """, (parent_sess, pm["created_at"]))
                user_msg = cursor.fetchone()
                if user_msg:
                    await asyncio.to_thread(
                        db_add_message,
                        message_id=str(uuid.uuid4()),
                        session_id=thread_id,
                        role="user",
                        content=user_msg["content"],
                    )
            await asyncio.to_thread(
                db_add_message,
                message_id=str(uuid.uuid4()),
                session_id=thread_id,
                role=pm["role"],
                content=pm["content"],
            )
        conn.close()

    return thread


@app.get("/api/threads/{thread_id}")
async def get_thread_endpoint(thread_id: str):
    """
    Retrieves metadata for a specific side chat thread.
    """
    thread = await asyncio.to_thread(db_get_thread, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


@app.patch("/api/threads/{thread_id}")
async def update_thread_endpoint(thread_id: str, req: ThreadUpdate):
    """
    Updates side chat thread metadata (name, status, rollup_summary).
    """
    thread = await asyncio.to_thread(
        db_update_thread,
        thread_id=thread_id,
        name=req.name,
        status=req.status,
        rollup_summary=req.rollup_summary,
    )
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


@app.post("/api/threads/{thread_id}/rollup")
async def trigger_thread_rollup_endpoint(thread_id: str, conclude: bool = False):
    """
    Triggers rollup synthesis for a side chat.
    """
    thread = await asyncio.to_thread(db_get_thread, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    messages = await asyncio.to_thread(db_get_messages, thread_id)
    if not messages:
        if conclude:
            await asyncio.to_thread(db_update_thread, thread_id, status="concluded")
        return {"status": "ok", "message": "No messages in thread to synthesize."}

    summary = await synthesize_thread_rollup(thread, messages, conclude=conclude)
    return {
        "status": "completed",
        "summary": summary,
        "message": "Thread rollup synthesized successfully.",
    }


@app.post("/api/threads/proposals/{message_id}/respond")
async def respond_to_thread_proposal_endpoint(message_id: str, body: ProposalResponseAction):
    """
    Handles user action on a side chat proposal card: accept or decline.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM messages WHERE id = ?", (message_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Message not found")

    raw_proposal = row["thread_proposal"]
    if not raw_proposal:
        raise HTTPException(status_code=400, detail="Message has no thread proposal")

    try:
        proposal_data = json.loads(raw_proposal)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid proposal data in message")

    if body.action == "accept":
        thread_id = f"thread_{uuid.uuid4().hex[:12]}"
        thread_name = proposal_data.get("title", "Side Chat")
        initial_summary = proposal_data.get("reason", "")
        parent_session_id = row["session_id"] or "main"

        created_thread = await asyncio.to_thread(
            db_create_thread,
            thread_id=thread_id,
            name=thread_name,
            parent_message_id=message_id,
            parent_session_id=parent_session_id,
            initial_summary=initial_summary,
        )

        proposal_data["status"] = "accepted"
        proposal_data["thread_id"] = thread_id
        await asyncio.to_thread(db_update_message_proposal, message_id, proposal_data)

        # Look up originating user prompt that led to this proposal and seed the thread
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT content FROM messages
            WHERE session_id = ? AND role = 'user' AND created_at <= ?
            ORDER BY created_at DESC LIMIT 1
        """, (parent_session_id, row["created_at"]))
        user_row = cursor.fetchone()
        conn.close()

        originating_user_prompt = user_row["content"] if user_row else ""
        if originating_user_prompt:
            await asyncio.to_thread(
                db_add_message,
                message_id=str(uuid.uuid4()),
                session_id=thread_id,
                role="user",
                content=originating_user_prompt,
            )

        # If suggested_first_turn was provided, seed the assistant response
        suggested = proposal_data.get("suggested_first_turn")
        if suggested:
            await asyncio.to_thread(
                db_add_message,
                message_id=str(uuid.uuid4()),
                session_id=thread_id,
                role="assistant",
                content=suggested,
            )
        elif proposal_data.get("reason"):
            await asyncio.to_thread(
                db_add_message,
                message_id=str(uuid.uuid4()),
                session_id=thread_id,
                role="assistant",
                content=f"Branching into side chat: {thread_name}.\n\n{proposal_data.get('reason')}",
            )

        return {"status": "accepted", "thread": created_thread, "proposal": proposal_data}

    else:
        proposal_data["status"] = "declined"
        await asyncio.to_thread(db_update_message_proposal, message_id, proposal_data)
        return {"status": "declined", "proposal": proposal_data}


@app.get("/api/navigation/links")
async def get_navigation_links_endpoint(limit: int = 50):
    """
    Extracts all URLs and markdown links shared across messages.
    """
    links = await asyncio.to_thread(db_get_extracted_links, limit)
    return {"links": links}


@app.get("/api/navigation/chronology")
async def get_navigation_chronology_endpoint(limit: int = 50):
    """
    Returns unified chronological events across threads, links, and vault activity.
    """
    events = await asyncio.to_thread(db_get_chronology_events, limit)
    return {"events": events}


# ==============================================================================
# Phase 3: Artifact Canvas & PDF Export Engine Endpoints
# ==============================================================================

@app.get("/api/artifacts")
async def list_artifacts_endpoint(session_id: Optional[str] = None, limit: int = 50):
    """
    List all artifacts, optionally filtered by session_id.
    """
    artifacts = await asyncio.to_thread(db_list_artifacts, session_id=session_id, limit=limit)
    return {"artifacts": [ArtifactResponse(**a) for a in artifacts]}


@app.get("/api/artifacts/{artifact_id}", response_model=ArtifactResponse)
async def get_artifact_endpoint(artifact_id: str):
    """
    Get full artifact metadata and markdown content.
    """
    artifact = await asyncio.to_thread(db_get_artifact, artifact_id)
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return ArtifactResponse(**artifact)


@app.post("/api/artifacts", response_model=ArtifactResponse)
async def create_artifact_endpoint(req: ArtifactCreate):
    """
    Manually create a new artifact document.
    """
    art_id = f"art_{uuid.uuid4().hex[:12]}"
    artifact = await asyncio.to_thread(
        db_create_artifact,
        artifact_id=art_id,
        session_id=req.session_id or "main",
        title=req.title,
        artifact_type=req.artifact_type,
        content=req.content,
        message_id=req.message_id,
        language=req.language,
        summary=req.summary,
    )
    return ArtifactResponse(**artifact)


@app.patch("/api/artifacts/{artifact_id}", response_model=ArtifactResponse)
async def update_artifact_endpoint(artifact_id: str, req: ArtifactUpdate):
    """
    Update an artifact document (title, content, or summary).
    """
    updated = await asyncio.to_thread(
        db_update_artifact,
        artifact_id=artifact_id,
        title=req.title,
        content=req.content,
        summary=req.summary,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return ArtifactResponse(**updated)


@app.delete("/api/artifacts/{artifact_id}")
async def delete_artifact_endpoint(artifact_id: str):
    """
    Delete an artifact.
    """
    success = await asyncio.to_thread(db_delete_artifact, artifact_id)
    if not success:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return {"status": "deleted", "artifact_id": artifact_id}


@app.get("/api/artifacts/{artifact_id}/export/pdf")
async def export_artifact_pdf_endpoint(artifact_id: str):
    """
    Export artifact as a publication-grade A4 PDF document.
    """
    import re
    artifact = await asyncio.to_thread(db_get_artifact, artifact_id)
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")

    pdf_bytes = await asyncio.to_thread(
        generate_artifact_pdf,
        title=artifact["title"],
        content=artifact["content"],
        artifact_type=artifact["artifact_type"],
        version=artifact.get("version", 1),
        created_at=artifact.get("created_at"),
    )

    slug = re.sub(r'[^a-zA-Z0-9_-]+', '-', artifact["title"].lower()).strip('-')
    if not slug:
        slug = f"artifact-{artifact_id}"
    filename = f"{slug}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache",
        },
    )


# ==============================================================================
# Phase 4: Integrations & Google Workspace Endpoints
# ==============================================================================

@app.get("/api/integrations/status", response_model=IntegrationStatusResponse)
async def get_integrations_status():
    """
    Returns the current connection status of external integrations (Google Workspace).
    """
    is_conn = google_workspace.is_connected()
    user_email = google_workspace.get_user_email() if is_conn else None
    token_row = get_integration_token("google")
    updated_at = token_row.get("updated_at") if token_row else None

    return IntegrationStatusResponse(
        google_connected=is_conn,
        google_user_email=user_email,
        services=IntegrationServiceStatus(
            calendar=is_conn,
            tasks=is_conn,
            gmail=is_conn,
        ),
        updated_at=updated_at,
    )


@app.delete("/api/integrations/google")
async def disconnect_google_workspace():
    """
    Disconnects Google Workspace and deletes stored OAuth tokens.
    """
    success = await asyncio.to_thread(google_workspace.disconnect)
    return {"status": "disconnected", "provider": "google", "success": success}


@app.get("/api/auth/google/login", response_model=GoogleAuthUrlResponse)
async def google_auth_login():
    """
    Generates and returns the Google OAuth consent URL.
    """
    try:
        url = google_workspace.get_auth_url()
        return GoogleAuthUrlResponse(url=url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error generating Google OAuth URL: {e}")
        raise HTTPException(status_code=500, detail="Failed to initialize Google OAuth flow")


@app.get("/api/auth/google/callback")
async def google_auth_callback(code: Optional[str] = Query(None), error: Optional[str] = Query(None)):
    """
    Receives OAuth callback from Google, exchanges authorization code for tokens,
    and redirects the user back to the web application Settings dialog.
    """
    if error:
        logger.error(f"Google OAuth authorization error: {error}")
        return RedirectResponse(url=f"/?settings=plugins&error={error}")

    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    try:
        await asyncio.to_thread(google_workspace.exchange_code, code)
        return RedirectResponse(url="/?settings=plugins&connected=google")
    except Exception as e:
        logger.error(f"Google token exchange failed: {e}")
        return RedirectResponse(url=f"/?settings=plugins&error={str(e)}")


# ==============================================================================
# Phase 4: Staged Actions Endpoints (Controlled Operations)
# ==============================================================================

@app.get("/api/actions", response_model=List[StagedActionResponse])
async def list_actions(
    session_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
):
    """
    List staged actions, optionally filtered by session or status.
    """
    actions = await asyncio.to_thread(db_list_staged_actions, session_id=session_id, status=status)
    return [StagedActionResponse(**a) for a in actions]


@app.get("/api/actions/{action_id}", response_model=StagedActionResponse)
async def get_action(action_id: str):
    """
    Get details of a specific staged action.
    """
    action = await asyncio.to_thread(db_get_staged_action, action_id)
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")
    return StagedActionResponse(**action)


@app.post("/api/actions/{action_id}/respond", response_model=StagedActionResponse)
async def respond_to_action(action_id: str, payload: ActionRespondRequest):
    """
    Respond to a staged action (e.g. approve or decline sending an email).
    """
    action = await asyncio.to_thread(db_get_staged_action, action_id)
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")

    if action["status"] != "pending":
        return StagedActionResponse(**action)

    if payload.action == "decline":
        updated = await asyncio.to_thread(
            db_update_staged_action_status,
            action_id,
            status="declined",
            result={"message": "Action declined by user"},
        )
        return StagedActionResponse(**updated)

    # payload.action == "confirm"
    if action["provider"] == "gmail" and action["action_type"] == "send_email":
        params = action.get("parameters", {})
        to = params.get("to", "")
        subject = params.get("subject", "")
        body = params.get("body", "")

        try:
            res = await asyncio.to_thread(google_workspace.send_email, to, subject, body)
            updated = await asyncio.to_thread(
                db_update_staged_action_status,
                action_id,
                status="executed",
                result=res,
            )
            return StagedActionResponse(**updated)
        except Exception as e:
            logger.error(f"Failed to execute staged email action {action_id}: {e}")
            updated = await asyncio.to_thread(
                db_update_staged_action_status,
                action_id,
                status="failed",
                result={"error": str(e)},
            )
            return StagedActionResponse(**updated)

    raise HTTPException(
        status_code=400,
        detail=f"Unsupported action provider/type: {action.get('provider')}.{action.get('action_type')}",
    )


# ==============================================================================
# Phase 5: Proactive Schedules Endpoints
# ==============================================================================

@app.get("/api/schedules", response_model=List[ScheduledEventResponse])
async def list_schedules(
    status: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
):
    """
    List scheduled events matching optional filters.
    """
    events = await asyncio.to_thread(
        db_list_scheduled_events, status=status, event_type=event_type, session_id=session_id
    )
    return [ScheduledEventResponse(**e) for e in events]


@app.post("/api/schedules", response_model=ScheduledEventResponse)
async def create_schedule(payload: ScheduledEventCreate):
    """
    Create a new scheduled event (recurring cron or one-shot reminder).
    """
    tz_str = payload.timezone or get_user_timezone_str()
    next_run_iso = compute_next_run(
        cron_expr=payload.cron_expression,
        run_at=payload.run_at,
        timezone_str=tz_str,
    )
    event = await asyncio.to_thread(
        db_create_scheduled_event,
        name=payload.name,
        event_type=payload.event_type,
        prompt=payload.prompt,
        cron_expression=payload.cron_expression,
        run_at=payload.run_at,
        timezone_str=tz_str,
        skill_id=payload.skill_id,
        session_id=payload.session_id,
        status="active",
        next_run_at=next_run_iso,
    )
    return ScheduledEventResponse(**event)


@app.patch("/api/schedules/{event_id}", response_model=ScheduledEventResponse)
async def update_schedule(event_id: str, payload: ScheduledEventUpdate):
    """
    Update fields of an existing scheduled event.
    """
    existing = await asyncio.to_thread(db_get_scheduled_event, event_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Scheduled event not found")

    updates = payload.model_dump(exclude_unset=True)
    if "cron_expression" in updates or "run_at" in updates or "timezone" in updates:
        cron_expr = updates.get("cron_expression", existing.get("cron_expression"))
        run_at = updates.get("run_at", existing.get("run_at"))
        tz_str = updates.get("timezone", existing.get("timezone", get_user_timezone_str()))
        next_run_iso = compute_next_run(cron_expr=cron_expr, run_at=run_at, timezone_str=tz_str)
        updates["next_run_at"] = next_run_iso

    updated = await asyncio.to_thread(db_update_scheduled_event, event_id, **updates)
    return ScheduledEventResponse(**updated)


@app.delete("/api/schedules/{event_id}")
async def delete_schedule(event_id: str):
    """
    Delete a scheduled event.
    """
    success = await asyncio.to_thread(db_delete_scheduled_event, event_id)
    if not success:
        raise HTTPException(status_code=404, detail="Scheduled event not found")
    return {"status": "deleted", "id": event_id}


# ==============================================================================
# Phase 5: Modular Skills Endpoints
# ==============================================================================

@app.get("/api/skills", response_model=List[SkillResponse])
async def list_installed_skills():
    """
    List all installed modular skills and their manifests.
    """
    skills = await asyncio.to_thread(sm_list_skills)
    return [SkillResponse(**s) for s in skills]


@app.get("/api/skills/{skill_id}", response_model=SkillResponse)
async def get_single_skill(skill_id: str):
    """
    Retrieve details and instructions for a specific skill.
    """
    skill = await asyncio.to_thread(sm_get_skill, skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    return SkillResponse(**skill)


@app.post("/api/skills", response_model=SkillResponse)
async def create_new_skill(payload: SkillCreateRequest):
    """
    Create a new modular skill in data/skills/.
    """
    try:
        saved = await asyncio.to_thread(
            sm_create_or_update_skill,
            skill_id=payload.id,
            name=payload.name,
            description=payload.description,
            instructions=payload.instructions,
            enabled=payload.enabled,
            slash_command=payload.slash_command,
            allowed_tools=payload.allowed_tools,
            memory_files=payload.memory_files,
        )
        return SkillResponse(**saved)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating skill: {e}")
        raise HTTPException(status_code=500, detail="Failed to create skill")


@app.put("/api/skills/{skill_id}", response_model=SkillResponse)
async def update_existing_skill(skill_id: str, payload: SkillUpdateRequest):
    """
    Update an existing modular skill.
    """
    existing = await asyncio.to_thread(sm_get_skill, skill_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Skill not found")

    name = payload.name if payload.name is not None else existing.get("name", "")
    description = payload.description if payload.description is not None else existing.get("description", "")
    instructions = payload.instructions if payload.instructions is not None else existing.get("instructions", "")
    enabled = payload.enabled if payload.enabled is not None else existing.get("enabled", True)
    slash_command = payload.slash_command if payload.slash_command is not None else existing.get("slash_command")
    allowed_tools = payload.allowed_tools if payload.allowed_tools is not None else existing.get("allowed_tools")
    memory_files = payload.memory_files if payload.memory_files is not None else existing.get("memory_files")

    saved = await asyncio.to_thread(
        sm_create_or_update_skill,
        skill_id=skill_id,
        name=name,
        description=description,
        instructions=instructions,
        enabled=enabled,
        slash_command=slash_command,
        allowed_tools=allowed_tools,
        memory_files=memory_files,
    )
    return SkillResponse(**saved)


@app.delete("/api/skills/{skill_id}")
async def delete_existing_skill(skill_id: str):
    """
    Delete a modular skill directory.
    """
    success = await asyncio.to_thread(sm_delete_skill, skill_id)
    if not success:
        raise HTTPException(status_code=404, detail="Skill not found")
    return {"status": "deleted", "id": skill_id}


# ==============================================================================
# Phase 5: Real-Time Proactive Events Stream (SSE)
# ==============================================================================

@app.get("/api/stream/events")
async def stream_proactive_events(request: Request):
    """
    Server-Sent Events (SSE) stream for real-time proactive events and timeline push.
    Connected web clients receive autonomous turns and reminders live.
    """
    q = event_dispatcher.subscribe_sse()

    async def event_generator():
        try:
            yield {
                "event": "connected",
                "data": json.dumps({"status": "connected", "time": datetime.now(timezone.utc).isoformat()})
            }
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(q.get(), timeout=25.0)
                    yield {
                        "event": "proactive_event",
                        "data": json.dumps(event),
                    }
                except asyncio.TimeoutError:
                    yield {
                        "event": "ping",
                        "data": json.dumps({"ping": "keep-alive"})
                    }
        finally:
            event_dispatcher.unsubscribe_sse(q)

    return EventSourceResponse(event_generator())





# ==============================================================================
# Mobile Link & QR Code Setup Page
# ==============================================================================
@app.get("/mobile", response_class=HTMLResponse)
async def mobile_setup_page(request: Request):
    client_id = os.getenv("CF_ACCESS_CLIENT_ID") or os.getenv("MOBILE_CF_CLIENT_ID") or ""
    client_secret = os.getenv("CF_ACCESS_CLIENT_SECRET") or os.getenv("MOBILE_CF_CLIENT_SECRET") or ""
    base_url = str(request.base_url).rstrip("/")
    if "https://" not in base_url and not base_url.startswith("http://localhost") and not base_url.startswith("http://127.0.0.1"):
        base_url = base_url.replace("http://", "https://")

    payload = json.dumps({
        "url": base_url,
        "client_id": client_id,
        "client_secret": client_secret,
    })
    has_creds = bool(client_id and client_secret)

    qr_container = "<div id='qrcode' class='qr-wrapper'></div>"
    copy_btn = f"<button class='btn' onclick='navigator.clipboard.writeText({json.dumps(payload)}); alert(`Copied connection payload to clipboard!`);'>Copy Connection Payload</button>"
    warning_box = "" if has_creds else "<div class='warning' style='margin-top: 16px; font-size: 11.5px; color: #a1a1aa; background: #141416; padding: 12px; border-radius: 12px;'>Direct connection mode. (Optional: To authenticate through Cloudflare Access, add CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET to .env)</div>"

    html_content = f"""<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Velocity — Mobile Setup</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link href="https://api.fontshare.com/v2/css?f[]=satoshi@500,600,700&display=swap" rel="stylesheet">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <style>
        body {{
            margin: 0;
            padding: 0;
            background-color: #000000;
            color: #FFFFFF;
            font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }}
        .card {{
            background-color: #0A0A0A;
            border-radius: 24px;
            padding: 40px;
            max-width: 380px;
            width: 90%;
            text-align: center;
            box-shadow: 0 20px 50px rgba(0,0,0,0.8);
        }}
        h1 {{
            font-size: 22px;
            font-weight: 700;
            margin: 0 0 8px 0;
            letter-spacing: -0.5px;
        }}
        p {{
            font-size: 13.5px;
            color: #A1A1AA;
            margin: 0 0 24px 0;
            line-height: 1.5;
        }}
        .qr-wrapper {{
            background: #FFFFFF;
            padding: 16px;
            border-radius: 16px;
            display: inline-block;
            margin-bottom: 24px;
            min-width: 220px;
            min-height: 220px;
        }}
        .qr-wrapper canvas {{
            display: none !important;
        }}
        .qr-wrapper img {{
            display: block;
            margin: 0 auto;
        }}
        .badge {{
            display: inline-block;
            background: #141414;
            color: #71717A;
            font-size: 11.5px;
            font-family: monospace;
            padding: 6px 12px;
            border-radius: 9999px;
            margin-bottom: 16px;
        }}
        .warning {{
            background: #27272A;
            color: #F59E0B;
            padding: 16px;
            border-radius: 12px;
            font-size: 12.5px;
            line-height: 1.5;
            text-align: left;
        }}
        .btn {{
            background: #27272A;
            color: #FFFFFF;
            border: none;
            padding: 12px 18px;
            border-radius: 12px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
            width: 100%;
        }}
        .btn:hover {{
            background: #343438;
        }}
    </style>
</head>
<body>
    <div class="card">
        <div class="badge">{base_url}</div>
        <h1>Link Mobile App</h1>
        <p>Open Velocity on your mobile device and scan this QR code to connect securely.</p>
        
        {qr_container}
        {copy_btn}
        {warning_box}
    </div>

    <script>
      const payloadStr = {json.dumps(payload)};
      function renderQR() {{
        const el = document.getElementById("qrcode");
        if (!el) return;
        if (window.QRCode) {{
          el.innerHTML = "";
          new QRCode(el, {{
            text: payloadStr,
            width: 220,
            height: 220,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
          }});
        }} else {{
          setTimeout(renderQR, 80);
        }}
      }}
      if (document.readyState === "loading") {{
        document.addEventListener("DOMContentLoaded", renderQR);
      }} else {{
        renderQR();
      }}
      window.addEventListener("load", renderQR);
    </script>
</body>
</html>"""
    return HTMLResponse(content=html_content)


# ==============================================================================
# SPA Fallback (Client-side routing & deep links)
# ==============================================================================
@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    if dist_dir:
        target_file = os.path.join(dist_dir, full_path)
        if os.path.isfile(target_file):
            return FileResponse(target_file)
        index_file = os.path.join(dist_dir, "index.html")
        if os.path.isfile(index_file):
            return FileResponse(index_file)
    raise HTTPException(status_code=404, detail="Not Found")



