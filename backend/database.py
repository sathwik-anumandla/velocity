"""
Velocity Persistence Layer (SQLite + FTS5)
Manages persistent sessions, messages with memory_status, and full-text search.
Temporary sessions are ephemeral and intentionally NOT persisted here.
"""

import os
import json
import sqlite3
from datetime import datetime, timezone
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
    if "is_thread" not in existing_cols:
        cursor.execute("ALTER TABLE sessions ADD COLUMN is_thread INTEGER NOT NULL DEFAULT 0;")
    if "parent_session_id" not in existing_cols:
        cursor.execute("ALTER TABLE sessions ADD COLUMN parent_session_id TEXT DEFAULT NULL;")
    if "parent_message_id" not in existing_cols:
        cursor.execute("ALTER TABLE sessions ADD COLUMN parent_message_id TEXT DEFAULT NULL;")
    if "status" not in existing_cols:
        cursor.execute("ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active';")
    if "rollup_summary" not in existing_cols:
        cursor.execute("ALTER TABLE sessions ADD COLUMN rollup_summary TEXT DEFAULT NULL;")

    # 2. Messages table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        memory_status TEXT DEFAULT 'ok',
        thread_id TEXT DEFAULT NULL,
        thread_proposal TEXT DEFAULT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    """)

    # Ensure messages table has all columns (for older DB schemas)
    cursor.execute("PRAGMA table_info(messages);")
    existing_msg_cols = [col[1] for col in cursor.fetchall()]
    if "memory_status" not in existing_msg_cols:
        cursor.execute("ALTER TABLE messages ADD COLUMN memory_status TEXT DEFAULT 'ok';")
    if "thread_id" not in existing_msg_cols:
        cursor.execute("ALTER TABLE messages ADD COLUMN thread_id TEXT DEFAULT NULL;")
    if "thread_proposal" not in existing_msg_cols:
        cursor.execute("ALTER TABLE messages ADD COLUMN thread_proposal TEXT DEFAULT NULL;")

    # Ensure canonical main timeline session exists
    cursor.execute("SELECT id FROM sessions WHERE id = 'main';")
    if not cursor.fetchone():
        now_iso = datetime.now(timezone.utc).isoformat()
        cursor.execute("""
        INSERT INTO sessions (id, name, recall_budget, thinking_effort, verbosity, model, is_thread, status, created_at, updated_at)
        VALUES ('main', 'Velocity', 'medium', 'medium', 'low', 'gpt-5.4-mini', 0, 'active', ?, ?);
        """, (now_iso, now_iso))

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
    thread_id: Optional[str] = None,
    thread_proposal: Optional[str] = None,
) -> Dict[str, Any]:
    conn = get_connection()
    now = datetime.now(timezone.utc).isoformat()
    cursor = conn.cursor()

    # Touch session updated_at
    cursor.execute(
        "UPDATE sessions SET updated_at = ? WHERE id = ?",
        (now, session_id),
    )

    cursor.execute(
        """
        INSERT INTO messages (id, session_id, role, content, memory_status, thread_id, thread_proposal, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (message_id, session_id, role, content, memory_status, thread_id, thread_proposal, now),
    )
    conn.commit()
    conn.close()

    return {
        "id": message_id,
        "session_id": session_id,
        "role": role,
        "content": content,
        "memory_status": memory_status,
        "thread_id": thread_id,
        "thread_proposal": thread_proposal,
        "created_at": now,
    }


def list_threads(status: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Lists all side chats (threads), along with message count and latest message timestamp.
    """
    conn = get_connection()
    cursor = conn.cursor()

    sql = """
    SELECT
        s.id,
        s.name,
        s.parent_session_id,
        s.parent_message_id,
        s.status,
        s.rollup_summary,
        s.model,
        s.created_at,
        s.updated_at,
        COUNT(m.id) AS message_count
    FROM sessions s
    LEFT JOIN messages m ON s.id = m.session_id
    WHERE s.is_thread = 1
    """
    params: List[Any] = []
    if status:
        sql += " AND s.status = ?"
        params.append(status)

    sql += " GROUP BY s.id ORDER BY s.updated_at DESC"

    cursor.execute(sql, tuple(params))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_thread(
    thread_id: str,
    name: str,
    parent_message_id: Optional[str] = None,
    parent_session_id: str = "main",
    model: str = "gpt-5.4-mini",
    initial_summary: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Creates a new side chat (thread) row.
    """
    conn = get_connection()
    now = datetime.now(timezone.utc).isoformat()
    cursor = conn.cursor()

    cursor.execute(
        """
        INSERT INTO sessions (
            id, name, recall_budget, thinking_effort, verbosity, model,
            is_thread, parent_session_id, parent_message_id, status, rollup_summary,
            created_at, updated_at
        ) VALUES (?, ?, 'medium', 'high', 'high', ?, 1, ?, ?, 'active', ?, ?, ?)
        """,
        (thread_id, name, model, parent_session_id, parent_message_id, initial_summary, now, now),
    )
    conn.commit()
    conn.close()

    return {
        "id": thread_id,
        "name": name,
        "is_thread": 1,
        "parent_session_id": parent_session_id,
        "parent_message_id": parent_message_id,
        "status": "active",
        "rollup_summary": initial_summary,
        "created_at": now,
        "updated_at": now,
    }


def update_thread(
    thread_id: str,
    name: Optional[str] = None,
    status: Optional[str] = None,
    rollup_summary: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    now = datetime.now(timezone.utc).isoformat()

    updates = []
    params = []
    if name is not None:
        updates.append("name = ?")
        params.append(name)
    if status is not None:
        updates.append("status = ?")
        params.append(status)
    if rollup_summary is not None:
        updates.append("rollup_summary = ?")
        params.append(rollup_summary)

    if not updates:
        conn.close()
        return get_thread(thread_id)

    updates.append("updated_at = ?")
    params.append(now)
    params.append(thread_id)

    sql = f"UPDATE sessions SET {', '.join(updates)} WHERE id = ? AND is_thread = 1"
    cursor.execute(sql, tuple(params))
    conn.commit()
    conn.close()
    return get_thread(thread_id)


def get_thread(thread_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT
        s.*,
        COUNT(m.id) AS message_count
    FROM sessions s
    LEFT JOIN messages m ON s.id = m.session_id
    WHERE s.id = ? AND s.is_thread = 1
    GROUP BY s.id
    """, (thread_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def update_message_proposal(message_id: str, proposal_data: Dict[str, Any]) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE messages SET thread_proposal = ? WHERE id = ?",
        (json.dumps(proposal_data), message_id),
    )
    conn.commit()
    success = cursor.rowcount > 0
    conn.close()
    return success


def get_extracted_links(limit: int = 100) -> List[Dict[str, Any]]:
    """
    Extracts all markdown links and URLs found across messages in chronological order.
    """
    import re
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT m.id AS message_id, m.session_id, s.name AS session_name, s.is_thread, m.content, m.created_at
    FROM messages m
    JOIN sessions s ON m.session_id = s.id
    WHERE m.content LIKE '%http%'
    ORDER BY m.created_at DESC
    LIMIT ?
    """, (limit * 2,))
    rows = cursor.fetchall()
    conn.close()

    md_link_regex = re.compile(r'\[([^\]]+)\]\((https?://[^\s\)]+)\)')
    raw_url_regex = re.compile(r'(https?://[^\s\)\>\]]+)')

    results: List[Dict[str, Any]] = []
    seen_urls = set()

    for r in rows:
        content = r["content"]
        # Extract markdown links first
        for title, url in md_link_regex.findall(content):
            if url not in seen_urls:
                seen_urls.add(url)
                results.append({
                    "url": url,
                    "title": title.strip() or url,
                    "message_id": r["message_id"],
                    "session_id": r["session_id"],
                    "session_name": r["session_name"],
                    "is_thread": bool(r["is_thread"]),
                    "created_at": r["created_at"],
                })

        # Extract raw URLs that were not part of markdown links
        for url in raw_url_regex.findall(content):
            clean_url = url.rstrip(".,;:)")
            if clean_url not in seen_urls:
                seen_urls.add(clean_url)
                results.append({
                    "url": clean_url,
                    "title": clean_url,
                    "message_id": r["message_id"],
                    "session_id": r["session_id"],
                    "session_name": r["session_name"],
                    "is_thread": bool(r["is_thread"]),
                    "created_at": r["created_at"],
                })

        if len(results) >= limit:
            break

    return results


def get_chronology_events(limit: int = 50) -> List[Dict[str, Any]]:
    """
    Combines thread lifecycle milestones, shared links, and vault activity logs into
    a unified chronological stream (newest first).
    """
    events: List[Dict[str, Any]] = []

    # 1. Thread creation and conclusion events
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, name, status, rollup_summary, created_at, updated_at
    FROM sessions
    WHERE is_thread = 1
    ORDER BY updated_at DESC
    LIMIT ?
    """, (limit,))
    threads = cursor.fetchall()
    conn.close()

    for t in threads:
        events.append({
            "type": "thread_event",
            "title": f"Thread: {t['name']}",
            "description": t["rollup_summary"] or f"Side chat status: {t['status']}",
            "status": t["status"],
            "timestamp": t["updated_at"] or t["created_at"],
            "metadata": {"thread_id": t["id"]},
        })

    # 2. Extracted links
    links = get_extracted_links(limit=limit)
    for l in links:
        events.append({
            "type": "link_event",
            "title": l["title"],
            "description": f"Shared in {l['session_name']}",
            "timestamp": l["created_at"],
            "metadata": {"url": l["url"], "session_id": l["session_id"]},
        })

    # 3. Vault activity log entries
    try:
        from backend.vault import get_activity_log
        vault_logs = get_activity_log(limit=limit)
        for vl in vault_logs:
            events.append({
                "type": "vault_event",
                "title": f"Memory: {vl.get('action', 'UPDATE')} {vl.get('path', '')}",
                "description": vl.get("detail", ""),
                "timestamp": vl.get("timestamp", ""),
                "metadata": {"source": vl.get("source", "SYSTEM"), "path": vl.get("path", "")},
            })
    except Exception:
        pass

    # Sort all events newest first
    events.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
    return events[:limit]


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
