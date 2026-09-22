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

from fastapi import FastAPI, HTTPException, Query, Path, Request
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

    overall_memory_status = "ok"

    async def event_generator():
        nonlocal overall_memory_status
        full_assistant_response = ""
        usage_data = {}

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

        # Check if waterfall triggers summarization of older history (>6 messages)
        local_summary = current_summary
        if len(history_messages) > 6:
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
                to_summarize = history_messages[:-6]
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
        )

        # Step 4: Real-time status for Model Thinking
        yield {
            "event": "status",
            "data": json.dumps({"text": "Thinking"})
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
            )
            db_update_session(
                session_id=session_id,
                last_tokens=new_total_tokens,
            )

        # Emit final completion event with message IDs, memory status and usage
        yield {
            "event": "complete",
            "data": json.dumps({
                "text": full_assistant_response,
                "memory_status": overall_memory_status,
                "usage": usage_data,
                "user_message_id": user_msg_id,
                "assistant_message_id": asst_msg_id,
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

    qr_container = "<div id='qrcode' class='qr-wrapper'></div>" if has_creds else ""
    copy_btn = f"<button class='btn' onclick='navigator.clipboard.writeText({json.dumps(payload)}); alert(`Copied connection payload to clipboard!`);'>Copy Connection Payload</button>" if has_creds else ""
    warning_box = "" if has_creds else "<div class='warning'>⚠️ <b>Service Token not configured in .env</b><br><br>Add <code>CF_ACCESS_CLIENT_ID</code> and <code>CF_ACCESS_CLIENT_SECRET</code> to your VPS <code>/root/velocity/.env</code>, then restart the backend.</div>"

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



