"""
Velocity Persistence Layer (SQLite + FTS5)
Manages persistent sessions, messages with memory_status, and full-text search.
Temporary sessions are ephemeral and intentionally NOT persisted here.
"""

import os
import re
import json
import uuid
import sqlite3
from pathlib import Path
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
    if "summarized_through" not in existing_cols:
        cursor.execute("ALTER TABLE sessions ADD COLUMN summarized_through TEXT DEFAULT NULL;")
    if "history_revision" not in existing_cols:
        cursor.execute("ALTER TABLE sessions ADD COLUMN history_revision INTEGER NOT NULL DEFAULT 0;")

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
    if "artifact_id" not in existing_msg_cols:
        cursor.execute("ALTER TABLE messages ADD COLUMN artifact_id TEXT DEFAULT NULL;")

    # Ensure canonical main timeline session exists
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_history ON messages(session_id)")
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

    # 5. Artifacts table for Document & PDF Canvas
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        message_id TEXT DEFAULT NULL,
        title TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        language TEXT DEFAULT 'markdown',
        content TEXT NOT NULL,
        summary TEXT DEFAULT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        file_path TEXT DEFAULT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    """)

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_artifacts_updated ON artifacts(updated_at DESC);")

    # 6. Integration Tokens table for OAuth (Google Workspace)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS integration_tokens (
        provider TEXT PRIMARY KEY,
        access_token TEXT,
        refresh_token TEXT,
        expires_at TEXT,
        scopes TEXT,
        metadata TEXT,
        updated_at TEXT NOT NULL
    );
    """)

    # 7. Staged Actions table for write approval workflows (e.g. gmail_send_email)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS staged_actions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        message_id TEXT DEFAULT NULL,
        provider TEXT NOT NULL,
        action_type TEXT NOT NULL,
        parameters TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT DEFAULT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_staged_actions_session ON staged_actions(session_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_staged_actions_status ON staged_actions(status);")

    # 8. Scheduled Events table for proactive reminders and recurring crons (Phase 5)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS scheduled_events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK(event_type IN ('recurring', 'one_shot')),
        cron_expression TEXT,
        run_at TEXT,
        timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
        prompt TEXT NOT NULL,
        skill_id TEXT,
        session_id TEXT NOT NULL DEFAULT 'main',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed', 'cancelled')),
        last_run_at TEXT,
        next_run_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_scheduled_events_next_run ON scheduled_events(next_run_at, status);")

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
    ordered by insertion position. Used when editing an earlier prompt.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT rowid AS position FROM messages WHERE id = ? AND session_id = ?",
        (from_message_id, session_id),
    )
    row = cursor.fetchone()
    if not row:
        cursor.execute(
            "SELECT rowid AS position FROM messages WHERE (id LIKE ? OR id LIKE ?) AND session_id = ?",
            (f"%{from_message_id}%", f"{from_message_id}%", session_id),
        )
        row = cursor.fetchone()

    if not row:
        conn.close()
        return 0
    position = row["position"]
    cursor.execute(
        "DELETE FROM messages WHERE session_id = ? AND rowid >= ?",
        (session_id, position),
    )
    deleted_count = cursor.rowcount
    cursor.execute("UPDATE sessions SET summary=NULL, summarized_through=NULL, history_revision=history_revision+1 WHERE id=?", (session_id,))
    if cursor.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_turns'").fetchone():
        cursor.execute("DELETE FROM chat_turns WHERE session_id=? AND (id NOT IN (SELECT id FROM messages) OR assistant_id NOT IN (SELECT id FROM messages))", (session_id,))
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
    artifact_id: Optional[str] = None,
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
        INSERT INTO messages (id, session_id, role, content, memory_status, thread_id, thread_proposal, artifact_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (message_id, session_id, role, content, memory_status, thread_id, thread_proposal, artifact_id, now),
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
        "artifact_id": artifact_id,
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
            "description": t["rollup_summary"] or f"Thread status: {t['status']}",
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

    # 3. Artifact / Document events
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
        SELECT id, session_id, title, artifact_type, version, summary, created_at, updated_at
        FROM artifacts
        ORDER BY created_at DESC
        LIMIT ?
        """, (limit,))
        artifacts = cursor.fetchall()
        conn.close()

        for a in artifacts:
            events.append({
                "type": "document_event",
                "title": f"Document: {a['title']}",
                "description": a["summary"] or f"Version {a.get('version', 1)} ({a.get('artifact_type', 'document')})",
                "timestamp": a["updated_at"] or a["created_at"],
                "metadata": {"artifact_id": a["id"], "session_id": a["session_id"]},
            })
    except Exception:
        pass

    # 4. Vault activity log entries
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
    if limit is not None:
        query = """
        SELECT * FROM (
            SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
        ) ORDER BY created_at ASC
        """
        params = [session_id, limit]
    else:
        query = "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC"
        params = [session_id]

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


def save_artifact_to_vault(artifact_id: str, title: str, artifact_type: str, content: str, version: int = 1) -> str:
    """
    Mirrors an artifact to data/memory/documents/<slug>.md with frontmatter.
    """
    vault_docs_dir = Path("data/memory/documents")
    vault_docs_dir.mkdir(parents=True, exist_ok=True)

    slug = re.sub(r'[^a-zA-Z0-9_-]+', '-', title.lower()).strip('-')
    if not slug:
        slug = artifact_id
    filename = f"{slug}.md"
    file_path = vault_docs_dir / filename

    now_iso = datetime.now(timezone.utc).isoformat()
    doc_content = (
        f"---\n"
        f"id: {artifact_id}\n"
        f"title: \"{title}\"\n"
        f"type: {artifact_type}\n"
        f"version: {version}\n"
        f"updated_at: {now_iso}\n"
        f"---\n\n"
        f"{content}\n"
    )
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(doc_content)

    return str(file_path)


def create_artifact(
    artifact_id: str,
    session_id: str,
    title: str,
    artifact_type: str,
    content: str,
    message_id: Optional[str] = None,
    language: str = "markdown",
    summary: Optional[str] = None,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    file_path = None
    try:
        file_path = save_artifact_to_vault(artifact_id, title, artifact_type, content, version=1)
    except Exception as e:
        print(f"Warning: Failed to mirror artifact to vault: {e}")

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO artifacts (
        id, session_id, message_id, title, artifact_type, language,
        content, summary, version, file_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    """, (
        artifact_id, session_id, message_id, title, artifact_type, language,
        content, summary, file_path, now, now
    ))
    conn.commit()
    conn.close()

    return {
        "id": artifact_id,
        "session_id": session_id,
        "message_id": message_id,
        "title": title,
        "artifact_type": artifact_type,
        "language": language,
        "content": content,
        "summary": summary,
        "version": 1,
        "file_path": file_path,
        "created_at": now,
        "updated_at": now,
    }


def get_artifact(artifact_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM artifacts WHERE id = ?", (artifact_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def list_artifacts(session_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    if session_id:
        cursor.execute(
            "SELECT * FROM artifacts WHERE session_id = ? ORDER BY updated_at DESC LIMIT ?",
            (session_id, limit),
        )
    else:
        cursor.execute(
            "SELECT * FROM artifacts ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def update_artifact(
    artifact_id: str,
    title: Optional[str] = None,
    content: Optional[str] = None,
    summary: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    current = get_artifact(artifact_id)
    if not current:
        return None

    new_title = title if title is not None else current["title"]
    new_content = content if content is not None else current["content"]
    new_summary = summary if summary is not None else current["summary"]
    new_version = current["version"] + 1
    now = datetime.now(timezone.utc).isoformat()

    file_path = current.get("file_path")
    try:
        file_path = save_artifact_to_vault(
            artifact_id, new_title, current["artifact_type"], new_content, version=new_version
        )
    except Exception as e:
        print(f"Warning: Failed to update vault mirror: {e}")

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE artifacts SET
        title = ?,
        content = ?,
        summary = ?,
        version = ?,
        file_path = ?,
        updated_at = ?
    WHERE id = ?
    """, (new_title, new_content, new_summary, new_version, file_path, now, artifact_id))
    conn.commit()
    conn.close()

    return get_artifact(artifact_id)


def delete_artifact(artifact_id: str) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM artifacts WHERE id = ?", (artifact_id,))
    affected = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return affected


# ==============================================================================
# Phase 4: Integration Tokens & Staged Actions CRUD
# ==============================================================================

def save_integration_token(
    provider: str,
    access_token: str,
    refresh_token: Optional[str] = None,
    expires_at: Optional[str] = None,
    scopes: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    meta_json = json.dumps(metadata) if metadata else None

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO integration_tokens (provider, access_token, refresh_token, expires_at, scopes, metadata, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = COALESCE(excluded.refresh_token, integration_tokens.refresh_token),
        expires_at = excluded.expires_at,
        scopes = COALESCE(excluded.scopes, integration_tokens.scopes),
        metadata = COALESCE(excluded.metadata, integration_tokens.metadata),
        updated_at = excluded.updated_at
    """, (provider, access_token, refresh_token, expires_at, scopes, meta_json, now))
    conn.commit()
    conn.close()

    return get_integration_token(provider) or {}


def get_integration_token(provider: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM integration_tokens WHERE provider = ?", (provider,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    if d.get("metadata"):
        try:
            d["metadata"] = json.loads(d["metadata"])
        except Exception:
            pass
    return d


def delete_integration_token(provider: str) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM integration_tokens WHERE provider = ?", (provider,))
    affected = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return affected


def create_staged_action(
    action_id: str,
    session_id: str,
    provider: str,
    action_type: str,
    parameters: Dict[str, Any],
    message_id: Optional[str] = None,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    params_json = json.dumps(parameters)

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO staged_actions (
        id, session_id, message_id, provider, action_type, parameters, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    """, (action_id, session_id, message_id, provider, action_type, params_json, now, now))
    conn.commit()
    conn.close()

    return {
        "id": action_id,
        "session_id": session_id,
        "message_id": message_id,
        "provider": provider,
        "action_type": action_type,
        "parameters": parameters,
        "status": "pending",
        "result": None,
        "created_at": now,
        "updated_at": now,
    }


def get_staged_action(action_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM staged_actions WHERE id = ?", (action_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    if d.get("parameters"):
        try:
            d["parameters"] = json.loads(d["parameters"])
        except Exception:
            pass
    if d.get("result"):
        try:
            d["result"] = json.loads(d["result"])
        except Exception:
            pass
    return d


def update_staged_action_status(
    action_id: str,
    status: str,
    result: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    now = datetime.now(timezone.utc).isoformat()
    result_json = json.dumps(result) if result else None

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE staged_actions SET
        status = ?,
        result = ?,
        updated_at = ?
    WHERE id = ?
    """, (status, result_json, now, action_id))
    conn.commit()
    conn.close()

    return get_staged_action(action_id)


def claim_staged_action(action_id: str, status: str = "executing") -> bool:
    connection = get_connection()
    try:
        with connection:
            claimed = connection.execute("UPDATE staged_actions SET status=?, updated_at=? WHERE id=? AND status='pending'", (status, datetime.now(timezone.utc).isoformat(), action_id)).rowcount
        return bool(claimed)
    finally:
        connection.close()


def list_staged_actions(
    session_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    query = "SELECT * FROM staged_actions WHERE 1=1"
    params: List[Any] = []
    if session_id:
        query += " AND session_id = ?"
        params.append(session_id)
    if status:
        query += " AND status = ?"
        params.append(status)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    cursor.execute(query, tuple(params))
    rows = cursor.fetchall()
    conn.close()

    results = []
    for r in rows:
        d = dict(r)
        if d.get("parameters"):
            try:
                d["parameters"] = json.loads(d["parameters"])
            except Exception:
                pass
        if d.get("result"):
            try:
                d["result"] = json.loads(d["result"])
            except Exception:
                pass
        results.append(d)
    return results


def update_staged_action_message_id(action_id: str, message_id: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE staged_actions SET
        message_id = ?,
        updated_at = ?
    WHERE id = ?
    """, (message_id, now, action_id))
    conn.commit()
    conn.close()


# ==============================================================================
# Phase 5: Scheduled Events CRUD (Proactive Engine)
# ==============================================================================

def create_scheduled_event(
    name: str,
    event_type: str,
    prompt: str,
    cron_expression: Optional[str] = None,
    run_at: Optional[str] = None,
    timezone_str: str = "Asia/Kolkata",
    skill_id: Optional[str] = None,
    session_id: str = "main",
    status: str = "active",
    next_run_at: Optional[str] = None,
    event_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Creates a new scheduled event (recurring cron or one-shot reminder).
    """
    if not event_id:
        event_id = f"sched_{uuid.uuid4().hex[:8]}"

    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO scheduled_events (
        id, name, event_type, cron_expression, run_at, timezone, prompt,
        skill_id, session_id, status, last_run_at, next_run_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?);
    """, (
        event_id, name, event_type, cron_expression, run_at, timezone_str,
        prompt, skill_id, session_id, status, next_run_at, now, now
    ))
    conn.commit()
    conn.close()
    return get_scheduled_event(event_id) or {}


def get_scheduled_event(event_id: str) -> Optional[Dict[str, Any]]:
    """
    Retrieves a single scheduled event by ID.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM scheduled_events WHERE id = ?;", (event_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None


def update_scheduled_event(event_id: str, **kwargs) -> Optional[Dict[str, Any]]:
    """
    Updates fields of an existing scheduled event.
    """
    allowed_fields = {
        "name", "event_type", "cron_expression", "run_at", "timezone",
        "prompt", "skill_id", "session_id", "status", "last_run_at", "next_run_at"
    }
    updates = {k: v for k, v in kwargs.items() if k in allowed_fields}
    if not updates:
        return get_scheduled_event(event_id)

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
    values = list(updates.values())
    values.append(event_id)

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(f"UPDATE scheduled_events SET {set_clause} WHERE id = ?;", tuple(values))
    conn.commit()
    conn.close()
    return get_scheduled_event(event_id)


def list_scheduled_events(
    status: Optional[str] = None,
    event_type: Optional[str] = None,
    session_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Lists scheduled events matching optional filters.
    """
    conn = get_connection()
    cursor = conn.cursor()
    query = "SELECT * FROM scheduled_events WHERE 1=1"
    params: List[Any] = []
    if status:
        query += " AND status = ?"
        params.append(status)
    if event_type:
        query += " AND event_type = ?"
        params.append(event_type)
    if session_id:
        query += " AND session_id = ?"
        params.append(session_id)
    query += " ORDER BY next_run_at ASC, created_at DESC;"

    cursor.execute(query, tuple(params))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_scheduled_event(event_id: str) -> bool:
    """
    Deletes a scheduled event.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM scheduled_events WHERE id = ?;", (event_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted


def get_due_scheduled_events(as_of_iso: str) -> List[Dict[str, Any]]:
    """
    Retrieves all active scheduled events where next_run_at <= as_of_iso.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT * FROM scheduled_events
    WHERE status = 'active'
      AND next_run_at IS NOT NULL
      AND next_run_at <= ?
    ORDER BY next_run_at ASC;
    """, (as_of_iso,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]
