"""
Velocity Persistence Layer (SQLite + FTS5)
Manages persistent sessions, messages with memory_status, and full-text search.
Temporary sessions are ephemeral and intentionally NOT persisted here.
"""

import os
import sqlite3
from datetime import datetime
from typing import List, Dict, Any, Optional

DEFAULT_DB_PATH = "./data/velocity.db"


def get_db_path() -> str:
    path = os.getenv("SQLITE_DB_PATH", DEFAULT_DB_PATH)
    directory = os.path.dirname(path)
    if directory and not os.path.exists(directory):
        os.makedirs(directory, exist_ok=True)
    return path


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(get_db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db() -> None:
    """
    Initialize SQLite database schema with sessions, messages, and FTS5 triggers.
    """
    conn = get_connection()
    cursor = conn.cursor()

    # 1. Sessions table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        recall_budget TEXT NOT NULL DEFAULT 'medium',
        thinking_effort TEXT NOT NULL DEFAULT 'medium',
        verbosity TEXT NOT NULL DEFAULT 'low',
        model TEXT NOT NULL DEFAULT 'gpt-5.4-mini',
        summary TEXT DEFAULT NULL,
        last_tokens INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """)

    # Non-destructive migrations: ensure all columns exist if DB was created with older schema
    cursor.execute("PRAGMA table_info(sessions);")
    existing_cols = [col[1] for col in cursor.fetchall()]
    if "recall_budget" not in existing_cols:
        cursor.execute("ALTER TABLE sessions ADD COLUMN recall_budget TEXT NOT NULL DEFAULT 'medium';")
    if "thinking_effort" not in existing_cols:
        cursor.execute("ALTER TABLE sessions ADD COLUMN thinking_effort TEXT NOT NULL DEFAULT 'medium';")
    if "verbosity" not in existing_cols:
        cursor.execute("ALTER TABLE sessions ADD COLUMN verbosity TEXT NOT NULL DEFAULT 'low';")
    if "model" not in existing_cols:
        cursor.execute("ALTER TABLE sessions ADD COLUMN model TEXT NOT NULL DEFAULT 'gpt-5.4-mini';")
    if "summary" not in existing_cols:
        cursor.execute("ALTER TABLE sessions ADD COLUMN summary TEXT DEFAULT NULL;")
    if "last_tokens" not in existing_cols:
        cursor.execute("ALTER TABLE sessions ADD COLUMN last_tokens INTEGER DEFAULT 0;")

    # 2. Messages table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        memory_status TEXT DEFAULT 'ok',
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    """)

    # Ensure messages table has memory_status (for older DB schemas)
    cursor.execute("PRAGMA table_info(messages);")
    existing_msg_cols = [col[1] for col in cursor.fetchall()]
    if "memory_status" not in existing_msg_cols:
        cursor.execute("ALTER TABLE messages ADD COLUMN memory_status TEXT DEFAULT 'ok';")

    # 3. FTS5 Virtual Table for full-text message search
    cursor.execute("""
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        message_id UNINDEXED,
        session_id UNINDEXED,
        role UNINDEXED,
        content
    );
    """)

    # 4. Triggers to keep FTS5 in sync with messages table
    cursor.execute("""
    CREATE TRIGGER IF NOT EXISTS trg_messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(message_id, session_id, role, content)
        VALUES (new.id, new.session_id, new.role, new.content);
    END;
    """)

    cursor.execute("""
    CREATE TRIGGER IF NOT EXISTS trg_messages_ad AFTER DELETE ON messages BEGIN
        DELETE FROM messages_fts WHERE message_id = old.id;
    END;
    """)

    cursor.execute("""
    CREATE TRIGGER IF NOT EXISTS trg_messages_au AFTER UPDATE ON messages BEGIN
        DELETE FROM messages_fts WHERE message_id = old.id;
        INSERT INTO messages_fts(message_id, session_id, role, content)
        VALUES (new.id, new.session_id, new.role, new.content);
    END;
    """)

    conn.commit()
    conn.close()


def create_session(
    session_id: str,
    name: Optional[str] = None,
    recall_budget: str = "medium",
    thinking_effort: str = "medium",
    verbosity: str = "low",
    model: str = "gpt-5.4-mini",
) -> Dict[str, Any]:
    """
    Create a persistent named session. (Temporary sessions bypass SQLite entirely).
    """
    conn = get_connection()
    now = datetime.utcnow().isoformat()
    session_name = name or "New Chat"

    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO sessions (id, name, recall_budget, thinking_effort, verbosity, model, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (session_id, session_name, recall_budget, thinking_effort, verbosity, model, now, now),
    )
    conn.commit()
    conn.close()
    return {
        "id": session_id,
        "name": session_name,
        "recall_budget": recall_budget,
        "thinking_effort": thinking_effort,
        "verbosity": verbosity,
        "model": model,
        "created_at": now,
        "updated_at": now,
    }


def update_session(
    session_id: str,
    name: Optional[str] = None,
    recall_budget: Optional[str] = None,
    thinking_effort: Optional[str] = None,
    verbosity: Optional[str] = None,
    model: Optional[str] = None,
    summary: Optional[str] = None,
    last_tokens: Optional[int] = None,
) -> bool:
    conn = get_connection()
    now = datetime.utcnow().isoformat()
    cursor = conn.cursor()

    updates = ["updated_at = ?"]
    params: List[Any] = [now]

    if name is not None:
        updates.append("name = ?")
        params.append(name)
    if recall_budget is not None:
        updates.append("recall_budget = ?")
        params.append(recall_budget)
    if thinking_effort is not None:
        updates.append("thinking_effort = ?")
        params.append(thinking_effort)
    if verbosity is not None:
        updates.append("verbosity = ?")
        params.append(verbosity)
    if model is not None:
        updates.append("model = ?")
        params.append(model)
    if summary is not None:
        updates.append("summary = ?")
        params.append(summary)
    if last_tokens is not None:
        updates.append("last_tokens = ?")
        params.append(last_tokens)

    params.append(session_id)
    sql = f"UPDATE sessions SET {', '.join(updates)} WHERE id = ?"
    cursor.execute(sql, tuple(params))
    affected = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return affected


def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def list_sessions() -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM sessions ORDER BY updated_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def rename_session(session_id: str, name: str) -> bool:
    return update_session(session_id, name=name)


def delete_session(session_id: str) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    affected = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return affected


def truncate_messages_from(session_id: str, from_message_id: str) -> int:
    """
    Deletes the message with from_message_id and all subsequent messages in the session
    ordered by created_at. Used when editing an earlier prompt or branching conversation.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT created_at FROM messages WHERE id = ? AND session_id = ?",
        (from_message_id, session_id),
    )
    row = cursor.fetchone()
    if not row:
        cursor.execute(
            "SELECT created_at FROM messages WHERE (id LIKE ? OR id LIKE ?) AND session_id = ?",
            (f"%{from_message_id}%", f"{from_message_id}%", session_id),
        )
        row = cursor.fetchone()

    if not row:
        conn.close()
        return 0
    target_ts = row["created_at"]
    cursor.execute(
        "DELETE FROM messages WHERE session_id = ? AND created_at >= ?",
        (session_id, target_ts),
    )
    deleted_count = cursor.rowcount
    conn.commit()
    conn.close()
    return deleted_count


def add_message(
    message_id: str,
    session_id: str,
    role: str,
    content: str,
    memory_status: str = "ok",
) -> Dict[str, Any]:
    conn = get_connection()
    now = datetime.utcnow().isoformat()
    cursor = conn.cursor()

    # Touch session updated_at
    cursor.execute(
        "UPDATE sessions SET updated_at = ? WHERE id = ?",
        (now, session_id),
    )

    cursor.execute(
        """
        INSERT INTO messages (id, session_id, role, content, memory_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (message_id, session_id, role, content, memory_status, now),
    )
    conn.commit()
    conn.close()

    return {
        "id": message_id,
        "session_id": session_id,
        "role": role,
        "content": content,
        "memory_status": memory_status,
        "created_at": now,
    }


def get_messages(session_id: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    query = "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC"
    params = [session_id]
    if limit is not None:
        query += " LIMIT ?"
        params.append(limit)

    cursor.execute(query, tuple(params))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def search_messages(query: str, limit: int = 50) -> List[Dict[str, Any]]:
    """
    FTS5 Full-Text Search across all sessions (global scope by default).
    Returns matched message with session ID and session name.
    """
    if not query or not query.strip():
        return []

    conn = get_connection()
    cursor = conn.cursor()

    # Escape special FTS5 operators for safety unless structured
    clean_query = query.replace('"', '""').strip()
    fts_query = f'"{clean_query}"'

    sql = """
    SELECT
        m.id AS message_id,
        m.session_id,
        s.name AS session_name,
        m.role,
        m.content,
        m.memory_status,
        m.created_at,
        snippet(messages_fts, 3, '<mark>', '</mark>', '...', 20) AS snippet
    FROM messages_fts fts
    JOIN messages m ON fts.message_id = m.id
    JOIN sessions s ON m.session_id = s.id
    WHERE messages_fts MATCH ?
    ORDER BY m.created_at DESC
    LIMIT ?
    """

    cursor.execute(sql, (fts_query, limit))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]
