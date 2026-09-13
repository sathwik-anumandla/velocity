"""
Velocity Prompt Composition and Summarization Engine
Strictly follows the prompt caching order:
system prompt -> windowed conversation history -> recall results -> new user message

Implements the 5-tier summarization waterfall preserving the last 6 messages verbatim.
"""

import os
import json
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple
import requests

# Base directory (project root)
BASE_DIR = Path(__file__).resolve().parent.parent

_CACHED_SYSTEM_PROMPT: Optional[str] = None
_CACHED_PROMPT_MTIME: Optional[float] = None
_CACHED_PROMPT_PATH: Optional[str] = None

DEFAULT_FALLBACK_PROMPT = """You are Velocity, a personal AI agent and technical co-pilot.
Your mission is to help the user think, build, decide, research, remember, and execute with maximum leverage and minimal friction.
Deliver direct answers, maintain production-ready code standards, and treat recalled context as native knowledge.
"""


def load_system_prompt() -> str:
    """
    Loads the system prompt dynamically from external configuration files with mtime caching.
    This keeps personal prompts private (gitignored) and allows live updates without restarting.

    Search priority:
    1. SYSTEM_PROMPT_PATH environment variable (if explicitly set)
    2. config/system_prompt.json (private, gitignored)
    3. config/system_prompt.md   (private, gitignored)
    4. system_prompt.json        (private, gitignored)
    5. system_prompt.md          (private, gitignored)
    6. config/system_prompt.example.json (public template fallback)
    7. Built-in default fallback
    """
    global _CACHED_SYSTEM_PROMPT, _CACHED_PROMPT_MTIME, _CACHED_PROMPT_PATH

    candidate_paths: List[Path] = []
    env_path = os.getenv("SYSTEM_PROMPT_PATH", "").strip()
    if env_path:
        candidate_paths.append(Path(env_path))

    candidate_paths.extend([
        BASE_DIR / "config" / "system_prompt.json",
        BASE_DIR / "config" / "system_prompt.md",
        BASE_DIR / "system_prompt.json",
        BASE_DIR / "system_prompt.md",
        BASE_DIR / "config" / "system_prompt.example.json",
    ])

    found_path: Optional[Path] = None
    for p in candidate_paths:
        if p.is_file():
            found_path = p
            break

    if not found_path:
        return DEFAULT_FALLBACK_PROMPT.strip()

    try:
        current_mtime = found_path.stat().st_mtime
        if (
            _CACHED_SYSTEM_PROMPT is not None
            and _CACHED_PROMPT_PATH == str(found_path)
            and _CACHED_PROMPT_MTIME == current_mtime
        ):
            return _CACHED_SYSTEM_PROMPT

        content = ""
        if found_path.suffix == ".json":
            with open(found_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    prompt_val = data.get("system_prompt", "")
                    if isinstance(prompt_val, list):
                        content = "\n".join(str(line) for line in prompt_val)
                    elif isinstance(prompt_val, str):
                        content = prompt_val
                elif isinstance(data, list):
                    content = "\n".join(str(line) for line in data)
                elif isinstance(data, str):
                    content = data
        else:
            with open(found_path, "r", encoding="utf-8") as f:
                content = f.read()

        content = content.strip()
        if not content:
            return DEFAULT_FALLBACK_PROMPT.strip()

        _CACHED_SYSTEM_PROMPT = content
        _CACHED_PROMPT_MTIME = current_mtime
        _CACHED_PROMPT_PATH = str(found_path)
        return _CACHED_SYSTEM_PROMPT
    except Exception:
        if _CACHED_SYSTEM_PROMPT:
            return _CACHED_SYSTEM_PROMPT
        return DEFAULT_FALLBACK_PROMPT.strip()


# Backward-compatible module attribute
SYSTEM_PROMPT = load_system_prompt()



def evaluate_summarization_waterfall(
    total_turns: int,
    total_tokens: int,
    last_message_timestamp: Optional[str],
    has_unsummarized_tail: bool = True,
) -> Tuple[bool, str]:
    """
    Evaluates the 5-tier summarization waterfall in exact spec order:
    1. total_turns < 8 -> do not summarize
    2. total_tokens > ~200K -> force summarize now, unconditionally
    3. time_since_last_message > 25 min -> summarize now (opportunistic cache expiration)
    4. total_turns > 24 AND total_tokens > 25K -> soft periodic summarize
    5. else -> append verbatim, no action
    """
    if not has_unsummarized_tail:
        return False, "no_unsummarized_tail"

    # Tier 1: Floor
    if total_turns < 8:
        return False, "turns_under_floor"

    # Tier 2: Hard ceiling (~200k tokens under 272k billing cliff)
    if total_tokens > 200_000:
        return True, "hard_ceiling_tokens"

    # Tier 3: Opportunistic idle (>25 min since last message)
    if last_message_timestamp:
        try:
            # Parse ISO timestamp
            clean_ts = last_message_timestamp.replace("Z", "+00:00")
            dt = datetime.fromisoformat(clean_ts)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            idle_seconds = (now - dt).total_seconds()
            if idle_seconds > 25 * 60:
                return True, "idle_timeout_25min"
        except Exception:
            pass

    # Tier 4: Soft periodic trigger (>24 turns AND >25k tokens)
    if total_turns > 24 and total_tokens > 25_000:
        return True, "soft_periodic_trigger"

    # Tier 5: Else no action
    return False, "verbatim_append"


def generate_summary(
    existing_summary: Optional[str],
    messages_to_summarize: List[Dict[str, Any]],
) -> Optional[str]:
    """
    Summarize older messages using a fast, cheap model (decoupled from Luna).
    """
    if not messages_to_summarize:
        return existing_summary

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    base_url = (os.getenv("OPENAI_BASE_URL", "") or "https://api.openai.com/v1").strip().rstrip("/")
    # Use cheap retain/summarize model
    cheap_model = (os.getenv("RETAIN_LLM_MODEL") or "gpt-4o-mini").strip()

    convo_text = []
    if existing_summary:
        convo_text.append(f"Existing Summary:\n{existing_summary}\n")
    convo_text.append("New Conversation Segment to Incorporate:")
    for m in messages_to_summarize:
        role = m.get("role", "user").capitalize()
        content = m.get("content", "")
        convo_text.append(f"{role}: {content}")

    prompt = (
        "Condense and synthesize the following conversation into a concise, factual, and structured summary. "
        "Preserve key facts, decisions, user preferences, and ongoing tasks for Sathwik. "
        "Be compact and objective.\n\n" + "\n".join(convo_text)
    )

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": cheap_model,
        "input": prompt,
        "max_output_tokens": 1000,
    }

    try:
        resp = requests.post(f"{base_url}/responses", json=payload, headers=headers, timeout=20)
        if resp.status_code == 200:
            data = resp.json()
            # Extract output text from responses API format
            output_items = data.get("output", [])
            for item in output_items:
                if item.get("type") == "message":
                    contents = item.get("content", [])
                    for c in contents:
                        if c.get("type") == "output_text":
                            return c.get("text", "").strip()
        # Fallback to chat completions if responses endpoint fails
        chat_payload = {
            "model": cheap_model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 1000,
        }
        resp2 = requests.post(f"{base_url}/chat/completions", json=chat_payload, headers=headers, timeout=20)
        if resp2.status_code == 200:
            d2 = resp2.json()
            return d2["choices"][0]["message"]["content"].strip()
    except Exception:
        pass

    return existing_summary


def compose_responses_input(
    messages: List[Dict[str, Any]],
    current_summary: Optional[str],
    recall_memories: List[str],
    new_user_message: str,
) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Composes the Responses API input strictly following the cache-optimal order:
    1. system prompt (returned as instructions)
    2. windowed conversation history (summary + verbatim tail of last 6 messages)
    3. recall results (this turn)
    4. new user message

    Returns:
    (instructions, input_items)
    """
    instructions = load_system_prompt()
    input_items: List[Dict[str, Any]] = []

    # 2. Windowed conversation history
    # If a summary exists, include it as context at the head of the history window
    if current_summary and current_summary.strip():
        input_items.append({
            "role": "system",
            "content": f"[Conversation Summary of earlier turns]:\n{current_summary.strip()}",
        })

    # Windowed tail: if messages exist, preserve the last 6 messages verbatim
    # (or fewer if total messages <= 6)
    tail = messages[-6:] if len(messages) > 6 else messages
    for msg in tail:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        # Responses API easy input format
        if role in ("user", "assistant", "system", "developer") and content:
            input_items.append({
                "role": role,
                "content": content,
            })

    # 3. Recall results (this turn) — volatile, placed AFTER history to protect prefix cache
    if recall_memories:
        memory_bullets = "\n".join(f"- {mem}" for mem in recall_memories if mem.strip())
        if memory_bullets:
            input_items.append({
                "role": "system",
                "content": (
                    "[Retrieved Long-Term Memories for this turn]:\n"
                    f"{memory_bullets}\n\n"
                    "Use these memories if relevant to Sathwik's query."
                ),
            })

    # 4. New user message
    input_items.append({
        "role": "user",
        "content": new_user_message,
    })

    return instructions, input_items
