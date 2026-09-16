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
from datetime import datetime
from contextlib import asynccontextmanager
from typing import List, Dict, Any, Optional, Literal
from pydantic import BaseModel

from fastapi import FastAPI, HTTPException, Query, Path
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse
from dotenv import load_dotenv

from backend.database import (
    init_db,
    create_session as db_create_session,
    get_session as db_get_session,
    update_session as db_update_session,
    list_sessions as db_list_sessions,
    delete_session as db_delete_session,
    add_message as db_add_message,
    get_messages as db_get_messages,
    truncate_messages_from as db_truncate_messages_from,
    search_messages as db_search_messages,
)
from backend.schemas import (
    ChatRequest,
    SessionCreate,
    SessionUpdate,
    SessionResponse,
    MessageResponse,
    SearchResult,
)
from backend.hindsight import HindsightClient
from backend.prompt import (
    compose_responses_input,
    evaluate_summarization_waterfall,
    generate_summary,
)
import openai
from backend.responses_runner import ResponsesRunner

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
                    "content": f"Generate a clean 3 to 5 word title for a conversation that starts with this prompt: \"{user_message}\". Return ONLY the title with no quotes, no markdown, and no punctuation at the end."
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Ensure local data directories and SQLite database exist
    db_path = os.getenv("SQLITE_DB_PATH", "./data/velocity.db")
    db_dir = os.path.dirname(db_path)
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    init_db()
    logger.info("Velocity Persistence initialized (SQLite + FTS5)")

    # Bootstrap Hindsight memory bank & foundational mental models in the background
    asyncio.create_task(asyncio.to_thread(hindsight_client.bootstrap_memory_bank))

    yield
    # Shutdown


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
from fastapi.responses import RedirectResponse


class NoCacheStaticFiles(StaticFiles):
    def is_not_modified(self, response_headers, request_headers) -> bool:
        return False

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response


for candidate_path in [
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "dist"),
    "/app/web/dist",
    "./web/dist",
]:
    if os.path.exists(candidate_path):
        app.mount("/ui", NoCacheStaticFiles(directory=candidate_path, html=True), name="ui")
        logger.info(f"Mounted Web UI from {candidate_path} at /ui (no-cache enabled)")
        break


@app.get("/ui")
async def ui_redirect():
    return RedirectResponse(url="/ui/")


# ==============================================================================
# 1. Health Endpoint
# ==============================================================================
@app.get("/")
async def root():
    return {
        "status": "online",
        "service": "Velocity Assistant Backend",
        "version": "1.0.0",
        "ui": "/ui/",
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
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    messages = db_get_messages(session_id)
    return {
        "session": SessionResponse(**session),
        "messages": [MessageResponse(**m) for m in messages],
    }


@app.patch("/sessions/{session_id}", response_model=SessionResponse)
async def update_session_meta(session_id: str, patch: SessionUpdate):
    """
    Update session name or sticky settings (recall_budget, thinking_effort, verbosity).
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
            }
        temp_state = temp_sessions[session_id]
        if request.recall_budget:
            temp_state["recall_budget"] = request.recall_budget
        if request.thinking_effort:
            temp_state["thinking_effort"] = request.thinking_effort
        if request.verbosity:
            temp_state["verbosity"] = request.verbosity

        recall_budget = temp_state["recall_budget"]
        thinking_effort = temp_state["thinking_effort"]
        verbosity = temp_state.get("verbosity", "low")
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
            )

        # Update sticky toggles if provided
        to_update = {}
        if request.recall_budget and request.recall_budget != session["recall_budget"]:
            to_update["recall_budget"] = request.recall_budget
        if request.thinking_effort and request.thinking_effort != session["thinking_effort"]:
            to_update["thinking_effort"] = request.thinking_effort
        if request.verbosity and request.verbosity != session.get("verbosity"):
            to_update["verbosity"] = request.verbosity
        if to_update:
            db_update_session(session_id, **to_update)
            session = db_get_session(session_id)

        recall_budget = session["recall_budget"]
        thinking_effort = session["thinking_effort"]
        verbosity = session.get("verbosity", "low")
        history_messages = db_get_messages(session_id)
        current_summary = session.get("summary")
        last_tokens = session.get("last_tokens") or 0

    # Renaming layer: Before sending to main model, send to classifier model to rename the chat
    renamed_title = None
    if not is_temp and (len(history_messages) == 0 or session["name"].startswith("Session ") or session["name"] in ["New Chat", "New Conversation"]):
        renamed_title = await asyncio.to_thread(classify_and_rename_session, user_message, session_id)
        if renamed_title and session:
            session["name"] = renamed_title

    # Step 2: Recall from Hindsight (Unconditional, pure retrieval)
    recalled_memories, recall_status = await asyncio.to_thread(
        hindsight_client.recall,
        query=user_message,
        budget=recall_budget,
    )
    overall_memory_status = recall_status

    # Step 3: Summarization Waterfall & Prompt Composition
    total_turns = len(history_messages) // 2
    last_msg_ts = history_messages[-1]["created_at"] if history_messages else None

    # Check if waterfall triggers summarization of older history (>6 messages)
    if len(history_messages) > 6:
        should_sum, reason = evaluate_summarization_waterfall(
            total_turns=total_turns,
            total_tokens=last_tokens,
            last_message_timestamp=last_msg_ts,
            has_unsummarized_tail=True,
        )
        if should_sum:
            logger.info(f"Summarization waterfall triggered: {reason}")
            to_summarize = history_messages[:-6]
            new_summary = await asyncio.to_thread(generate_summary, current_summary, to_summarize)
            if new_summary:
                current_summary = new_summary
                if is_temp:
                    temp_sessions[session_id]["summary"] = new_summary
                else:
                    db_update_session(session_id, summary=new_summary)

    # Fetch hot mental models (user-persona & current-context) from cache (< 1ms warm, < 30ms cold)
    hot_memory = await asyncio.to_thread(hindsight_client.get_hot_context)

    # Compose Responses API input in strict cache-optimal order
    instructions, input_items = compose_responses_input(
        messages=history_messages,
        current_summary=current_summary,
        recall_memories=recalled_memories,
        new_user_message=user_message,
        verbosity=verbosity,
        hot_memory=hot_memory,
    )

    async def event_generator():
        nonlocal overall_memory_status
        full_assistant_response = ""
        usage_data = {}

        if renamed_title:
            yield {
                "event": "session_renamed",
                "data": json.dumps({"session_id": session_id, "name": renamed_title})
            }

        # Stream from Responses API runner
        async for sse_item in responses_runner.stream_turn(
            instructions=instructions,
            input_items=input_items,
            session_id=session_id,
            thinking_effort=thinking_effort,
            verbosity=verbosity,
            is_temporary=is_temp,
        ):
            ev = sse_item["event"]
            raw_data = sse_item["data"]

            if ev == "done":
                try:
                    payload = json.loads(raw_data)
                    full_assistant_response = payload.get("text", "")
                    usage_data = payload.get("usage", {})
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

        if is_temp:
            # Ephemeral memory only
            temp_sessions[session_id]["messages"].append({
                "id": str(uuid.uuid4()),
                "session_id": session_id,
                "role": "user",
                "content": user_message,
                "memory_status": overall_memory_status,
                "created_at": now_iso,
            })
            temp_sessions[session_id]["messages"].append({
                "id": str(uuid.uuid4()),
                "session_id": session_id,
                "role": "assistant",
                "content": full_assistant_response,
                "memory_status": overall_memory_status,
                "created_at": now_iso,
            })
            temp_sessions[session_id]["last_tokens"] = new_total_tokens
        else:
            # Persistent SQLite store
            user_msg_id = str(uuid.uuid4())
            asst_msg_id = str(uuid.uuid4())
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
            )
            db_update_session(
                session_id=session_id,
                last_tokens=new_total_tokens,
            )

        # Emit final completion event with memory status and usage
        yield {
            "event": "complete",
            "data": json.dumps({
                "text": full_assistant_response,
                "memory_status": overall_memory_status,
                "usage": usage_data,
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

