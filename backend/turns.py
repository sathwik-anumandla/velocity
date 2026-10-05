import asyncio
import json
from datetime import datetime, timezone

from backend.database import get_connection
from backend.usage import transaction


tasks = {}


def init_turns():
    with transaction() as connection:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS chat_turns (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
                message TEXT NOT NULL, assistant_id TEXT NOT NULL,
                status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_active_turn_session
                ON chat_turns(session_id) WHERE status='running';
            CREATE INDEX IF NOT EXISTS idx_turn_assistant ON chat_turns(assistant_id);
            CREATE TABLE IF NOT EXISTS chat_turn_events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                turn_id TEXT NOT NULL, event TEXT NOT NULL, data TEXT NOT NULL,
                FOREIGN KEY(turn_id) REFERENCES chat_turns(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_turn_events ON chat_turn_events(turn_id,sequence);
        """)
        connection.execute("UPDATE chat_turns SET status='interrupted',error='Server restarted before completion' WHERE status='running'")


def get_turn(turn_id):
    connection = get_connection()
    try:
        row = connection.execute("SELECT * FROM chat_turns WHERE id=?", (turn_id,)).fetchone()
        return dict(row) if row else None
    finally:
        connection.close()


def session_running(session_id):
    return any(turn and turn["session_id"] == session_id and turn["status"] == "running" for turn in (get_turn(turn_id) for turn_id in list(tasks)))


def claim_turn(turn_id, session_id, message):
    with transaction() as connection:
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute("SELECT * FROM chat_turns WHERE id=?", (turn_id,)).fetchone()
        if existing:
            if existing["session_id"] != session_id or existing["message"] != message:
                raise ValueError("Message ID already belongs to a different request")
            return dict(existing), False
        if connection.execute("SELECT 1 FROM chat_turns WHERE session_id=? AND status='running'", (session_id,)).fetchone():
            raise ValueError("A response is already running in this conversation")
        if connection.execute("SELECT 1 FROM messages WHERE id IN (?, ?)", (turn_id, f"{turn_id}:assistant")).fetchone():
            raise ValueError("Message ID already exists in conversation history")
        assistant_id = f"{turn_id}:assistant"
        now = datetime.now(timezone.utc).isoformat()
        connection.execute("INSERT INTO chat_turns VALUES(?,?,?,?,'running',NULL,?)", (turn_id, session_id, message, assistant_id, now))
        for message_id, role, content in ((turn_id, "user", message), (assistant_id, "assistant", "")):
            connection.execute("INSERT INTO messages(id,session_id,role,content,memory_status,created_at) VALUES(?,?,?,?,'pending',?)", (message_id, session_id, role, content, now))
        connection.execute("UPDATE sessions SET updated_at=? WHERE id=?", (now, session_id))
    return get_turn(turn_id), True


def save_event(turn_id, event):
    with transaction() as connection:
        connection.execute("INSERT INTO chat_turn_events(turn_id,event,data) VALUES(?,?,?)", (turn_id, event["event"], event["data"]))
        payload = json.loads(event["data"])
        if event["event"] == "delta":
            connection.execute("UPDATE messages SET content=content || ? WHERE id=(SELECT assistant_id FROM chat_turns WHERE id=?)", (payload.get("text", ""), turn_id))
        elif event["event"] == "thread_proposal":
            connection.execute("UPDATE messages SET thread_proposal=? WHERE id=(SELECT assistant_id FROM chat_turns WHERE id=?)", (json.dumps(payload), turn_id))
        elif event["event"] == "artifact_created" and payload.get("id"):
            connection.execute("UPDATE messages SET artifact_id=? WHERE id=(SELECT assistant_id FROM chat_turns WHERE id=?)", (payload["id"], turn_id))
            connection.execute("UPDATE artifacts SET message_id=(SELECT assistant_id FROM chat_turns WHERE id=?) WHERE id=?", (turn_id, payload["id"]))
        elif event["event"] == "action_proposal" and payload.get("id"):
            connection.execute("UPDATE staged_actions SET message_id=(SELECT assistant_id FROM chat_turns WHERE id=?) WHERE id=?", (turn_id, payload["id"]))


def finish_turn(turn_id, status, error=None):
    with transaction() as connection:
        connection.execute("UPDATE chat_turns SET status=?,error=? WHERE id=? AND status='running'", (status, error, turn_id))
        connection.execute("UPDATE messages SET memory_status=? WHERE id IN (?,(SELECT assistant_id FROM chat_turns WHERE id=?)) AND memory_status='pending'", ("ok" if status == "completed" else "degraded", turn_id, turn_id))


def enrich_message(message):
    connection = get_connection()
    try:
        turn = connection.execute("SELECT id,status FROM chat_turns WHERE id=? OR assistant_id=?", (message["id"], message["id"])).fetchone()
        if turn:
            message.update(turn_id=turn["id"], turn_status=turn["status"])
        return message
    finally:
        connection.close()


async def run_turn(turn_id, generator):
    try:
        async for event in generator:
            save_event(turn_id, event)
            if event["event"] == "error":
                finish_turn(turn_id, "failed", json.loads(event["data"]).get("error"))
                return
            if event["event"] == "complete":
                finish_turn(turn_id, "completed")
        if get_turn(turn_id)["status"] == "running":
            finish_turn(turn_id, "interrupted", "The response ended without a completion event")
    except asyncio.CancelledError:
        finish_turn(turn_id, "cancelled", "Generation stopped")
    except Exception as error:
        save_event(turn_id, {"event": "error", "data": json.dumps({"error": str(error)})})
        finish_turn(turn_id, "failed", str(error))
    finally:
        try:
            await generator.aclose()
        finally:
            tasks.pop(turn_id, None)


async def replay_events(turn_id, after=0):
    while True:
        connection = get_connection()
        try:
            events = connection.execute("SELECT * FROM chat_turn_events WHERE turn_id=? AND sequence>? ORDER BY sequence", (turn_id, after)).fetchall()
            turn = connection.execute("SELECT * FROM chat_turns WHERE id=?", (turn_id,)).fetchone()
        finally:
            connection.close()
        for event in events:
            after = event["sequence"]
            yield {"id": str(after), "event": event["event"], "data": event["data"]}
        if turn is None or turn["status"] != "running":
            if turn and turn["status"] != "completed" and not any(event["event"] == "error" for event in events):
                yield {"event": "cancelled" if turn["status"] == "cancelled" else "error", "data": json.dumps({"error": turn["error"] or "Generation interrupted", "turn_id": turn_id})}
            return
        await asyncio.sleep(0.1)
