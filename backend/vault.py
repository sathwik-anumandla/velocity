"""
Velocity Deterministic Memory Vault Manager
Manages the structured Markdown Vault in data/memory/:
- Atomic reads and writes with concurrency locking
- Section-based markdown mutation (no blind full-file overwrites)
- Structured activity logging (data/memory/activity.log)
- Core context compilation for zero-cost prompt caching
- One-time bootstrapping / seeding from templates and Hindsight
"""

import os
import re
import shutil
import asyncio
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

BASE_DIR = Path(__file__).resolve().parent.parent
VAULT_DIR = Path(os.getenv("VAULT_DIR", str(BASE_DIR / "data" / "memory"))).resolve()
TEMPLATE_DIR = (BASE_DIR / "data" / "memory.template").resolve()
ACTIVITY_LOG_FILE = VAULT_DIR / "activity.log"

_vault_lock = asyncio.Lock()


def _sanitize_path(relative_path: str) -> Path:
    """
    Validates and resolves a relative path within the vault.
    Guards strictly against directory traversal.
    """
    clean_path = relative_path.strip().lstrip("/")
    target = (VAULT_DIR / clean_path).resolve()
    if not str(target).startswith(str(VAULT_DIR)):
        raise ValueError("Access denied: path outside memory vault.")
    return target


def log_activity_sync(source: str, action: str, path: str, detail: str) -> None:
    """
    Appends a single structured entry to data/memory/activity.log.
    Format: ISO_TIMESTAMP | SOURCE | ACTION | PATH | DETAIL
    """
    try:
        VAULT_DIR.mkdir(parents=True, exist_ok=True)
        now_iso = datetime.now(timezone.utc).isoformat()
        line = f"{now_iso} | {source.upper()} | {action.upper()} | {path} | {detail.strip()}\n"
        with open(ACTIVITY_LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception as e:
        print(f"[Vault] Failed to write activity log: {e}")


async def log_activity(source: str, action: str, path: str, detail: str) -> None:
    async with _vault_lock:
        await asyncio.to_thread(log_activity_sync, source, action, path, detail)


def get_activity_log(limit: int = 50) -> List[Dict[str, str]]:
    """
    Returns the most recent activity log entries, newest first.
    """
    if not ACTIVITY_LOG_FILE.is_file():
        return []

    entries: List[Dict[str, str]] = []
    try:
        with open(ACTIVITY_LOG_FILE, "r", encoding="utf-8") as f:
            lines = f.readlines()

        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            parts = [p.strip() for p in line.split("|")]
            if len(parts) >= 5:
                entries.append({
                    "timestamp": parts[0],
                    "source": parts[1],
                    "action": parts[2],
                    "path": parts[3],
                    "detail": " | ".join(parts[4:]),
                })
            elif len(parts) == 4:
                entries.append({
                    "timestamp": parts[0],
                    "source": parts[1],
                    "action": parts[2],
                    "path": parts[3],
                    "detail": "",
                })
            if len(entries) >= limit:
                break
    except Exception as e:
        print(f"[Vault] Error reading activity log: {e}")

    return entries


def seed_vault_if_needed(hindsight_client: Optional[Any] = None) -> bool:
    """
    Bootstraps the vault if data/memory/core/profile.md does not exist:
    1. Copies template files from data/memory.template/
    2. Enriches with existing Hindsight mental models if available
    3. Seeds activity.log
    """
    profile_path = VAULT_DIR / "core" / "profile.md"
    if profile_path.is_file():
        return False

    try:
        VAULT_DIR.mkdir(parents=True, exist_ok=True)
        if TEMPLATE_DIR.is_dir():
            for item in TEMPLATE_DIR.rglob("*"):
                if item.is_file():
                    rel = item.relative_to(TEMPLATE_DIR)
                    target = VAULT_DIR / rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if not target.exists():
                        shutil.copy2(item, target)

        # Attempt to pull existing Hindsight mental models
        if hindsight_client:
            try:
                # 1. Persona -> profile / preferences
                persona = hindsight_client.get_mental_model("user-persona")
                if persona and persona.strip() and persona != "Generating content...":
                    with open(VAULT_DIR / "core" / "profile.md", "a", encoding="utf-8") as f:
                        f.write(f"\n\n## Historical Persona Notes (From Hindsight)\n{persona.strip()}\n")

                # 2. Context -> active_context
                ctx = hindsight_client.get_mental_model("current-context")
                if ctx and ctx.strip() and ctx != "Generating content...":
                    with open(VAULT_DIR / "core" / "active_context.md", "a", encoding="utf-8") as f:
                        f.write(f"\n\n## Historical Active Context (From Hindsight)\n{ctx.strip()}\n")

                # 3. Projects -> projects/velocity.md
                proj = hindsight_client.get_mental_model("projects-and-decisions")
                if proj and proj.strip() and proj != "Generating content...":
                    with open(VAULT_DIR / "projects" / "velocity.md", "a", encoding="utf-8") as f:
                        f.write(f"\n\n## Historical Decisions & Stack (From Hindsight)\n{proj.strip()}\n")

                # 4. Goals -> study/learning.md
                goals = hindsight_client.get_mental_model("goals-and-interests")
                if goals and goals.strip() and goals != "Generating content...":
                    goals_path = VAULT_DIR / "study" / "learning.md"
                    goals_path.parent.mkdir(parents=True, exist_ok=True)
                    with open(goals_path, "w", encoding="utf-8") as f:
                        f.write(f"# Learning & Goals\n\n{goals.strip()}\n")
            except Exception as e:
                print(f"[Vault] Could not fetch Hindsight mental models for seeding: {e}")

        log_activity_sync("SYSTEM", "INITIALIZE", "data/memory", "Bootstrapped memory vault from template and historical state")
        return True
    except Exception as e:
        print(f"[Vault] Seeding failed: {e}")
        return False


def get_vault_tree() -> List[Dict[str, Any]]:
    """
    Returns a structured tree list of all documents in the vault.
    Excludes activity.log, hidden files, and temporary files.
    """
    if not VAULT_DIR.is_dir():
        return []

    items: List[Dict[str, Any]] = []
    for root, dirs, files in os.walk(VAULT_DIR):
        # Skip hidden directories
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for file in sorted(files):
            if file.startswith(".") or file == "activity.log" or file.endswith(".tmp"):
                continue
            full_path = Path(root) / file
            rel_path = full_path.relative_to(VAULT_DIR)
            stat = full_path.stat()

            # Extract first heading as title if available
            title = file
            try:
                with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("#"):
                            title = line.lstrip("#").strip()
                            break
            except Exception:
                pass

            category = rel_path.parts[0] if len(rel_path.parts) > 1 else "root"
            items.append({
                "path": str(rel_path),
                "name": file,
                "title": title,
                "category": category,
                "size_bytes": stat.st_size,
                "updated_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
            })

    return items


def read_memory_doc(relative_path: str) -> Optional[str]:
    """
    Reads the full content of a memory document.
    """
    try:
        target = _sanitize_path(relative_path)
        if not target.is_file():
            return None
        with open(target, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        print(f"[Vault] Error reading doc '{relative_path}': {e}")
        return None


def write_memory_doc_sync(relative_path: str, content: str, source: str = "MANUAL", action: str = "UPDATE") -> bool:
    """
    Synchronously writes a memory document atomically via a temporary file.
    """
    try:
        target = _sanitize_path(relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp_target = target.with_suffix(target.suffix + ".tmp")

        with open(tmp_target, "w", encoding="utf-8") as f:
            f.write(content)

        # Atomic replacement
        tmp_target.replace(target)
        log_activity_sync(source, action, relative_path, f"Document saved ({len(content)} chars)")
        return True
    except Exception as e:
        print(f"[Vault] Failed to write doc '{relative_path}': {e}")
        return False


async def write_memory_doc(relative_path: str, content: str, source: str = "MANUAL", action: str = "UPDATE") -> bool:
    async with _vault_lock:
        return await asyncio.to_thread(write_memory_doc_sync, relative_path, content, source, action)


def update_memory_section_sync(relative_path: str, section_heading: str, new_content: str, source: str = "CONVERSATION") -> bool:
    """
    Replaces only the body of a specific section in the document, keeping all other
    sections intact. If the heading does not exist, appends it as a new section.
    """
    try:
        target = _sanitize_path(relative_path)
        if not target.is_file():
            # If file does not exist, create it with this section
            new_doc = f"# {target.stem.replace('_', ' ').title()}\n\n## {section_heading.strip()}\n{new_content.strip()}\n"
            return write_memory_doc_sync(relative_path, new_doc, source=source, action="CREATE")

        with open(target, "r", encoding="utf-8") as f:
            original = f.read()

        # Match heading: e.g. ## Heading Name
        pattern = re.compile(
            r'^(#{1,6})\s+' + re.escape(section_heading.strip()) + r'\s*$',
            re.IGNORECASE | re.MULTILINE
        )
        match = pattern.search(original)

        if match:
            heading_level = len(match.group(1))
            start_pos = match.end()

            # Find the next heading of same or higher level
            next_heading_pattern = re.compile(
                r'^(#{1,' + str(heading_level) + r'})\s+',
                re.MULTILINE
            )
            next_match = next_heading_pattern.search(original, start_pos)

            if next_match:
                end_pos = next_match.start()
                updated_text = (
                    original[:start_pos]
                    + "\n"
                    + new_content.strip()
                    + "\n\n"
                    + original[end_pos:]
                )
            else:
                updated_text = (
                    original[:start_pos]
                    + "\n"
                    + new_content.strip()
                    + "\n"
                )
        else:
            # Heading does not exist; append it cleanly
            updated_text = (
                original.rstrip()
                + f"\n\n## {section_heading.strip()}\n"
                + new_content.strip()
                + "\n"
            )

        return write_memory_doc_sync(relative_path, updated_text, source=source, action="UPDATE")
    except Exception as e:
        print(f"[Vault] Failed section update on '{relative_path}': {e}")
        return False


async def update_memory_section(relative_path: str, section_heading: str, new_content: str, source: str = "CONVERSATION") -> bool:
    async with _vault_lock:
        return await asyncio.to_thread(update_memory_section_sync, relative_path, section_heading, new_content, source)


def create_memory_doc_sync(relative_path: str, content: str, source: str = "CONVERSATION") -> bool:
    """
    Creates a new memory document. Refuses overwrite if file already exists.
    """
    try:
        target = _sanitize_path(relative_path)
        if target.is_file():
            return False
        return write_memory_doc_sync(relative_path, content, source=source, action="CREATE")
    except Exception as e:
        print(f"[Vault] Failed to create doc '{relative_path}': {e}")
        return False


async def create_memory_doc(relative_path: str, content: str, source: str = "CONVERSATION") -> bool:
    async with _vault_lock:
        return await asyncio.to_thread(create_memory_doc_sync, relative_path, content, source)


def get_core_context() -> str:
    """
    Loads and compiles the core memory documents (profile, preferences, active_context)
    and an index of available documents into a prompt-ready markdown string.
    Optimized for OpenAI prefix caching.
    """
    blocks: List[str] = []

    # 1. Profile
    profile = read_memory_doc("core/profile.md")
    if profile and profile.strip():
        blocks.append(f"[Deterministic Memory - User Profile]:\n{profile.strip()}")

    # 2. Preferences
    preferences = read_memory_doc("core/preferences.md")
    if preferences and preferences.strip():
        blocks.append(f"[Deterministic Memory - Preferences & Constraints]:\n{preferences.strip()}")

    # 3. Active Context
    active_ctx = read_memory_doc("core/active_context.md")
    if active_ctx and active_ctx.strip():
        blocks.append(f"[Deterministic Memory - Current Focus & Open Loops]:\n{active_ctx.strip()}")

    # 4. Vault Catalog / Index (excluding core)
    tree = get_vault_tree()
    dossiers = [item for item in tree if not item["path"].startswith("core/")]
    if dossiers:
        dossier_lines = []
        for d in dossiers:
            dossier_lines.append(f"- {d['path']}: {d['title']}")
        index_str = "\n".join(dossier_lines)
        blocks.append(
            f"[Deterministic Memory - Available Dossiers Index]:\n"
            f"You have access to detailed dossiers via the `read_memory_doc` tool:\n{index_str}\n"
            f"When answering questions relevant to these topics or projects, consult them using `read_memory_doc`."
        )

    return "\n\n".join(blocks)
