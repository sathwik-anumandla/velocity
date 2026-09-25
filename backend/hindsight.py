"""
Velocity Hindsight Client
Comprehensive memory integration with Hindsight:
- Bank configuration (domain missions, disposition traits)
- Foundational automated mental models (current-context, user-persona, projects-and-decisions, goals-and-interests)
- Fast hot-context retrieval (<25ms) with TTL caching for zero-turn prompt injection
- Rich structured JSON retention with stable document_id upserting and TEMPR timestamps
- Reflect multi-hop reasoning loop
"""

import os
import re
import json
import time
import logging
import requests
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple

logger = logging.getLogger("velocity.hindsight")
HINDSIGHT_DEFAULT_URL = "http://localhost:8888"

# 4 Foundational Mental Models for Velocity (aligned with user-persona, work, and cognitive architecture)
FOUNDATIONAL_MENTAL_MODELS: List[Dict[str, Any]] = [
    {
        "id": "current-context",
        "name": "Current Context & Open Loops",
        "source_query": (
            "What is the user actively working on right now? Identify strictly in English: "
            "(1) current focus and active project, "
            "(2) unresolved open loops or pending investigations, "
            "(3) recent decisions made, and "
            "(4) immediate next objectives. "
            "Synthesize strictly in English. Discard any non-English text or web scraping noise."
        ),
        "trigger": {
            "refresh_cron": "15 23 * * *",
        },
    },
    {
        "id": "user-persona",
        "name": "User Persona & Philosophy",
        "source_query": (
            "Summarize the user profile strictly in English: "
            "(1) communication preferences (verbosity, tone, structure), "
            "(2) engineering philosophy (practicality, cost-effectiveness, simplicity), "
            "(3) UI/UX aesthetic taste, and "
            "(4) mental models and core beliefs about software and AI. "
            "Synthesize strictly in English. Discard any non-English text or web scraping noise."
        ),
        "trigger": {
            "refresh_cron": "15 23 * * *",
        },
    },
    {
        "id": "projects-and-decisions",
        "name": "Projects & Technical Decisions",
        "source_query": (
            "For each project the user is building (including Velocity), summarize strictly in English: "
            "(1) project objective, "
            "(2) current architecture and tech stack, "
            "(3) major technical decisions with their rationale (why it was chosen), and "
            "(4) key constraints. "
            "Synthesize strictly in English. Include only user-initiated projects and decisions. "
            "Ignore non-English text, web scraping artifacts, and third-party forum content."
        ),
        "trigger": {
            "refresh_cron": "15 23 * * *",
        },
    },
    {
        "id": "goals-and-interests",
        "name": "Goals & Long-Term Interests",
        "source_query": (
            "What are the user primary long-term goals, recurring areas of curiosity, "
            "and research topics in technology, AI agents, and system architecture? "
            "Synthesize strictly in English."
        ),
        "trigger": {
            "refresh_cron": "15 23 * * *",
        },
    },
]


class HindsightClient:
    def __init__(
        self,
        base_url: Optional[str] = None,
        bank_id: Optional[str] = None,
        recall_timeout: int = 15,
        retain_timeout: int = 45,
    ):
        self.base_url = (base_url or os.getenv("HINDSIGHT_API_URL", HINDSIGHT_DEFAULT_URL)).rstrip("/")
        self.bank_id = bank_id or os.getenv("HINDSIGHT_BANK_ID", "personal-agent")
        self.recall_timeout = recall_timeout
        self.retain_timeout = retain_timeout
        self.retry_queue: List[Dict[str, Any]] = []

        # In-memory hot cache for mental models (TTL: 60 seconds)
        self._hot_context_cache: Dict[str, str] = {}
        self._hot_context_last_fetched: float = 0.0
        self._hot_context_ttl: float = 60.0

    def check_health(self) -> bool:
        try:
            resp = requests.get(f"{self.base_url}/health", timeout=2)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, dict):
                    return data.get("status") in ("healthy", "alive", "ready", "ok")
                return True
            return False
        except Exception:
            return False

    def bootstrap_memory_bank(self) -> None:
        """
        Idempotently configures the memory bank with domain missions and disposition traits,
        and initializes or updates the 4 foundational mental models.
        Runs safely on startup without crashing if Hindsight is temporarily unreachable.
        """
        try:
            logger.info(f"Bootstrapping Hindsight memory bank '{self.bank_id}'...")

            # 1. Update bank configuration (missions + disposition)
            config_url = f"{self.base_url}/v1/default/banks/{self.bank_id}/config"
            config_payload = {
                "updates": {
                    "retain_mission": (
                        "Extract technical decisions with rationale, architecture choices, "
                        "user preferences, current focus, open loops, and project requirements. "
                        "Extract strictly in English. Completely ignore non-English text, foreign-language noise, "
                        "web scraping artifacts, pleasantries, greetings, and temporary conversational filler."
                    ),
                    "observations_mission": (
                        "Synthesize durable user preferences, behavioral patterns, "
                        "technical decisions, and mental models strictly in English. "
                        "Highlight contradictions or evolving choices. Discard any foreign-language text."
                    ),
                    "reflect_mission": (
                        "You are a technical co-pilot and second brain for thinking, building, "
                        "debugging, and deciding. Base your reasoning on past user decisions, "
                        "stated preferences, and current context. Be direct, concise, and technically grounded. "
                        "Respond strictly in English."
                    ),
                    "disposition_skepticism": 3,
                    "disposition_literalism": 4,
                    "disposition_empathy": 2,
                }
            }
            resp = requests.patch(config_url, json=config_payload, timeout=10)
            if resp.status_code in (200, 201):
                logger.info(f"Hindsight bank '{self.bank_id}' configuration updated successfully.")
            else:
                logger.warning(f"Could not update bank config: status {resp.status_code}, response: {resp.text}")

            # 2. Check and register or update foundational mental models
            models_url = f"{self.base_url}/v1/default/banks/{self.bank_id}/mental-models"
            list_resp = requests.get(models_url, timeout=10)
            existing_ids = set()
            if list_resp.status_code == 200:
                items = list_resp.json().get("items", [])
                existing_ids = {m.get("id") for m in items if isinstance(m, dict)}

            for model_spec in FOUNDATIONAL_MENTAL_MODELS:
                model_id = model_spec["id"]
                if model_id not in existing_ids:
                    logger.info(f"Registering foundational mental model '{model_id}'...")
                    create_resp = requests.post(models_url, json=model_spec, timeout=15)
                    if create_resp.status_code in (200, 201):
                        logger.info(f"Mental model '{model_id}' created successfully.")
                    else:
                        logger.warning(f"Failed to create mental model '{model_id}': {create_resp.text}")
                else:
                    # Update existing model with latest source_query and trigger
                    patch_url = f"{models_url}/{model_id}"
                    patch_payload = {
                        "name": model_spec.get("name"),
                        "source_query": model_spec.get("source_query"),
                        "trigger": model_spec.get("trigger"),
                    }
                    try:
                        patch_resp = requests.patch(patch_url, json=patch_payload, timeout=10)
                        if patch_resp.status_code == 200:
                            logger.info(f"Mental model '{model_id}' updated with latest source_query & trigger.")
                        else:
                            logger.warning(f"Could not patch mental model '{model_id}': {patch_resp.text}")
                    except Exception as pe:
                        logger.warning(f"Failed to patch mental model '{model_id}': {pe}")

        except Exception as e:
            logger.warning(f"Hindsight bank bootstrap failed or timed out (will retry later): {e}")

    def clear_mental_model(self, model_id: str) -> bool:
        """
        Clears the cached content of a mental model, forcing the next refresh to be a full re-synthesis.
        """
        url = f"{self.base_url}/v1/default/banks/{self.bank_id}/mental-models/{model_id}/clear"
        try:
            resp = requests.post(url, timeout=10)
            return resp.status_code in (200, 201, 204)
        except Exception as e:
            logger.warning(f"Failed to clear mental model '{model_id}': {e}")
            return False

    def refresh_mental_model(self, model_id: str) -> Optional[str]:
        """
        Triggers a fresh reflect re-synthesis of a mental model.
        Returns the operation_id if queued/started, or None on failure.
        """
        url = f"{self.base_url}/v1/default/banks/{self.bank_id}/mental-models/{model_id}/refresh"
        try:
            resp = requests.post(url, timeout=15)
            if resp.status_code in (200, 201, 202):
                data = resp.json()
                return data.get("operation_id") if isinstance(data, dict) else "ok"
            return None
        except Exception as e:
            logger.warning(f"Failed to refresh mental model '{model_id}': {e}")
            return None

    def consolidate(self) -> bool:
        """
        Manually triggers an offline consolidation pass across unconsolidated memories in Hindsight.
        """
        url = f"{self.base_url}/v1/default/banks/{self.bank_id}/consolidate"
        try:
            resp = requests.post(url, timeout=20)
            return resp.status_code in (200, 201, 202)
        except Exception as e:
            logger.warning(f"Failed to trigger Hindsight consolidation: {e}")
            return False

    def get_mental_model(self, model_id: str) -> Optional[str]:
        """
        Fetches the pre-computed markdown content of a mental model.
        Returns None if not found or still generating.
        """
        url = f"{self.base_url}/v1/default/banks/{self.bank_id}/mental-models/{model_id}?detail=content"
        try:
            resp = requests.get(url, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                content = (data.get("content") or "").strip()
                if content and content != "Generating content...":
                    return content
            return None
        except Exception:
            return None

    def get_hot_context(self) -> Dict[str, str]:
        """
        Retrieves the hot mental models ('user-persona' and 'current-context') for Turn 0 prompt injection.
        Employs a 60-second in-memory cache to guarantee sub-millisecond overhead during conversation turns.
        """
        now = time.time()
        if self._hot_context_cache and (now - self._hot_context_last_fetched) < self._hot_context_ttl:
            return self._hot_context_cache

        hot_models: Dict[str, str] = {}
        for mid in ("user-persona", "current-context"):
            content = self.get_mental_model(mid)
            if content:
                hot_models[mid] = content

        if hot_models:
            self._hot_context_cache = hot_models
            self._hot_context_last_fetched = now

        return self._hot_context_cache

    def recall(self, query: str, budget: str = "medium", top_k: int = 5) -> Tuple[List[str], str]:
        """
        Unconditional synchronous memory recall from Hindsight.
        budget: 'low' | 'medium' | 'high' (mapped to Hindsight API budget 'low' | 'mid' | 'high').
        Returns (memories_list, memory_status).
        """
        api_budget = "mid" if budget == "medium" else budget
        url = f"{self.base_url}/v1/default/banks/{self.bank_id}/memories/recall"
        payload = {
            "query": query,
            "budget": api_budget,
            "max_tokens": 2048,
        }

        try:
            resp = requests.post(url, json=payload, timeout=self.recall_timeout)
            if resp.status_code != 200:
                return [], "degraded"

            data = resp.json()
            raw_results = data.get("results", []) if isinstance(data, dict) else []

            memories: List[str] = []
            for r in raw_results[:top_k]:
                if isinstance(r, dict):
                    text = r.get("text", "").strip()
                    if text:
                        memories.append(text)
                elif isinstance(r, str) and r.strip():
                    memories.append(r.strip())

            return memories, "ok"
        except Exception:
            return [], "degraded"

    def reflect(self, query: str, budget: str = "mid") -> Tuple[Optional[str], List[Dict[str, Any]], str]:
        """
        Runs Hindsight's autonomous reflect loop.
        Searches mental models -> observations -> raw facts with citations and disposition reasoning.
        Returns (answer_text, citations_list, status).
        """
        url = f"{self.base_url}/v1/default/banks/{self.bank_id}/reflect"
        payload = {
            "query": query,
            "budget": budget,
        }

        try:
            resp = requests.post(url, json=payload, timeout=90)
            if resp.status_code != 200:
                return None, [], "degraded"

            data = resp.json()
            answer = data.get("answer") or data.get("text")
            citations = data.get("based_on", []) or data.get("citations", [])
            return answer, citations, "ok"
        except Exception:
            return None, [], "degraded"

    def retain(
        self,
        content: str,
        context: Optional[str] = None,
        document_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, str]] = None,
        timestamp: Optional[str] = None,
        update_mode: str = "replace",
        async_retain: bool = True,
    ) -> str:
        """
        Ingests a generic content document into Hindsight memory.
        """
        self._drain_retry_queue()

        now_iso = timestamp or datetime.now(timezone.utc).isoformat()
        url = f"{self.base_url}/v1/default/banks/{self.bank_id}/memories"

        item: Dict[str, Any] = {
            "content": content,
            "timestamp": now_iso,
        }
        if context:
            item["context"] = context
        if document_id:
            item["document_id"] = document_id
            item["update_mode"] = update_mode
        if tags:
            item["tags"] = tags
        if metadata:
            item["metadata"] = metadata

        payload = {
            "async": async_retain,
            "items": [item],
        }

        try:
            resp = requests.post(url, json=payload, timeout=self.retain_timeout)
            if resp.status_code in (200, 201, 202):
                return "ok"
            else:
                logger.warning(f"Hindsight retain returned status {resp.status_code}: {resp.text}")
                if resp.status_code >= 500:
                    self.retry_queue.append(payload)
                return "degraded"
        except Exception as e:
            logger.warning(f"Hindsight retain request failed: {e}")
            self.retry_queue.append(payload)
            return "degraded"

    def retain_turn(
        self,
        user_message: str,
        assistant_response: str,
        session_id: str,
        session_name: Optional[str] = None,
        async_retain: bool = True,
    ) -> str:
        """
        Retains an interaction turn into Hindsight following best practices:
        - Structured JSON conversation format (serialized as valid JSON string)
        - Stable document_id (`session-{session_id}`) with update_mode='append' to maintain full conversation thread
        - Descriptive domain context
        - Tagging for strict session filtering
        - ISO-8601 timestamps for TEMPR temporal reasoning
        """
        user_clean = user_message.strip()
        assistant_clean = assistant_response.strip()
        if not user_clean or not assistant_clean:
            logger.info("Skipping Hindsight retain for empty turn.")
            return "ok"

        # Ingress filter 1: Skip conversational filler and short acknowledgments
        filler_words = {
            "ok", "okay", "thanks", "thank you", "got it", "sure", "cool",
            "great", "yes", "no", "yep", "nope", "perfect", "done", "nice",
            "alright", "sounds good", "continue", "go ahead"
        }
        if user_clean.lower().strip("!.,? ") in filler_words and len(assistant_clean) < 80:
            logger.info(f"Skipping Hindsight retain for conversational filler: '{user_clean}'")
            return "ok"

        # Ingress filter 2: Skip retention if foreign CJK characters are detected (prevents web-scrape contamination)
        if re.search(r'[\u4e00-\u9fff]', user_clean) or re.search(r'[\u4e00-\u9fff]', assistant_clean):
            logger.warning("Skipping Hindsight retain: CJK characters detected in turn content.")
            return "ok"

        self._drain_retry_queue()

        now_iso = datetime.now(timezone.utc).isoformat()
        url = f"{self.base_url}/v1/default/banks/{self.bank_id}/memories"

        conversation = [
            {"role": "user", "content": user_message.strip(), "timestamp": now_iso},
            {"role": "assistant", "content": assistant_response.strip(), "timestamp": now_iso},
        ]

        payload = {
            "async": async_retain,
            "items": [
                {
                    "content": json.dumps(conversation),
                    "document_id": f"session-{session_id}",
                    "update_mode": "append",
                    "context": f"Velocity pair-programming chat in session '{session_name or session_id}'",
                    "tags": [f"session:{session_id}", "source:velocity-chat"],
                    "timestamp": now_iso,
                    "metadata": {"session_id": session_id},
                }
            ],
        }

        try:
            resp = requests.post(url, json=payload, timeout=self.retain_timeout)
            if resp.status_code in (200, 201, 202):
                return "ok"
            else:
                logger.warning(f"Hindsight retain returned status {resp.status_code}: {resp.text}")
                if resp.status_code >= 500:
                    self.retry_queue.append(payload)
                return "degraded"
        except Exception as e:
            logger.warning(f"Hindsight retain request failed: {e}")
            self.retry_queue.append(payload)
            return "degraded"

    def retain_sync(
        self,
        user_message: str,
        assistant_response: str,
        session_id: str,
        session_name: Optional[str] = None,
    ) -> str:
        """
        Backwards-compatible retain method calling retain_turn.
        """
        return self.retain_turn(
            user_message=user_message,
            assistant_response=assistant_response,
            session_id=session_id,
            session_name=session_name,
            async_retain=True,
        )

    def _drain_retry_queue(self) -> None:
        if not self.retry_queue:
            return

        url = f"{self.base_url}/v1/default/banks/{self.bank_id}/memories"
        pending = list(self.retry_queue)
        self.retry_queue.clear()

        for item in pending:
            try:
                resp = requests.post(url, json=item, timeout=self.retain_timeout)
                if resp.status_code not in (200, 201, 202):
                    if resp.status_code >= 500:
                        self.retry_queue.append(item)
                    else:
                        logger.warning(f"Dropping unretryable item from retry queue ({resp.status_code}): {resp.text}")
            except Exception:
                self.retry_queue.append(item)

