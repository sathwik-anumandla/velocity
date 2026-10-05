import json
import uuid

from backend.database import get_connection
from datetime import datetime, timezone


def message_page(session_id, limit=40, before=None):
    connection = get_connection()
    try:
        connection.execute("BEGIN")
        session = connection.execute("SELECT history_revision FROM sessions WHERE id=?", (session_id,)).fetchone()
        if session is None:
            raise LookupError("Conversation not found")
        cursor = None
        if before:
            row = connection.execute("SELECT rowid FROM messages WHERE id=? AND session_id=?", (before, session_id)).fetchone()
            if row is None:
                raise ValueError("History cursor no longer exists; reload the latest page")
            cursor = row[0]
        clause = " AND m.rowid < ?" if cursor is not None else ""
        params = [session_id] + ([cursor] if cursor is not None else []) + [limit + 1]
        rows = connection.execute(f"""SELECT m.*,m.rowid AS history_index,t.id AS turn_id,t.status AS turn_status
            FROM messages m LEFT JOIN chat_turns t ON t.assistant_id=m.id OR t.id=m.id
            WHERE m.session_id=?{clause} ORDER BY m.rowid DESC LIMIT ?""", params).fetchall()
        more = len(rows) > limit
        messages = [dict(row) for row in reversed(rows[:limit])]
        artifact_ids = [message["artifact_id"] for message in messages if message.get("artifact_id")]
        artifacts = {}
        if artifact_ids:
            placeholders = ",".join("?" for artifact_id in artifact_ids)
            artifacts = {row["id"]: dict(row) for row in connection.execute(f"SELECT id,title,artifact_type,language,summary,created_at FROM artifacts WHERE id IN ({placeholders})", artifact_ids)}
        actions = {}
        if messages:
            placeholders = ",".join("?" for message in messages)
            for row in connection.execute(f"SELECT * FROM staged_actions WHERE message_id IN ({placeholders})", [message["id"] for message in messages]):
                action = dict(row)
                action["parameters"] = json.loads(action["parameters"])
                action["result"] = json.loads(action["result"]) if action.get("result") else None
                actions[action["message_id"]] = action
        for message in messages:
            message["artifact"] = artifacts.get(message.get("artifact_id"))
            message["staged_action"] = actions.get(message["id"])
        return {"messages": messages, "has_more": more, "oldest_cursor": messages[0]["id"] if messages else None, "history_revision": session["history_revision"]}
    finally:
        connection.close()


def branch_message(session_id, message_id, name):
    connection = get_connection()
    try:
        connection.execute("BEGIN IMMEDIATE")
        session = connection.execute("SELECT model FROM sessions WHERE id=?", (session_id,)).fetchone()
        row = connection.execute("SELECT rowid FROM messages WHERE id=? AND session_id=?", (message_id, session_id)).fetchone()
        if row is None or session is None:
            raise LookupError("Message not found")
        if connection.execute("SELECT 1 FROM chat_turns WHERE session_id=? AND status='running'", (session_id,)).fetchone():
            raise ValueError("Stop the response before branching")
        prefix = connection.execute("SELECT role,content,created_at FROM messages WHERE session_id=? AND rowid<=? ORDER BY rowid", (session_id, row[0])).fetchall()
        thread_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        connection.execute("INSERT INTO sessions(id,name,model,is_thread,parent_session_id,parent_message_id,status,thinking_effort,verbosity,created_at,updated_at) VALUES(?,?,?,1,?,?,'active','high','high',?,?)", (thread_id, name, session["model"], session_id, message_id, now, now))
        connection.executemany("INSERT INTO messages(id,session_id,role,content,memory_status,created_at) VALUES(?,?,?,?,'ok',?)", [(str(uuid.uuid4()), thread_id, message["role"], message["content"], message["created_at"]) for message in prefix])
        thread = dict(connection.execute("SELECT * FROM sessions WHERE id=?", (thread_id,)).fetchone())
        connection.commit()
        return thread
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
