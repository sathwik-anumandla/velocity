"""
Velocity Hindsight Client
Deterministic unconditional sync recall() and synchronous per-exchange retain()
with session_id tagging and graceful degradation.
"""

import os
import requests
from typing import List, Dict, Any, Optional, Tuple

HINDSIGHT_DEFAULT_URL = "http://localhost:8888"


class HindsightClient:
    def __init__(
        self,
        base_url: Optional[str] = None,
        bank_id: Optional[str] = None,
        recall_timeout: int = 15,
        retain_timeout: int = 90,
    ):
        self.base_url = (base_url or os.getenv("HINDSIGHT_API_URL", HINDSIGHT_DEFAULT_URL)).rstrip("/")
        self.bank_id = bank_id or os.getenv("HINDSIGHT_BANK_ID", "personal-agent")
        self.recall_timeout = recall_timeout
        self.retain_timeout = retain_timeout
        self.retry_queue: List[Dict[str, Any]] = []

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

    def retain_sync(
        self,
        user_message: str,
        assistant_response: str,
        session_id: str,
    ) -> str:
        """
        Synchronous retain after every exchange (user message + assistant response).
        Tagged with current session_id as metadata.
        Does NOT retain raw search results.
        Returns memory_status: 'ok' or 'degraded'.
        """
        # First attempt to drain any queued retries if Hindsight is back up
        self._drain_retry_queue()

        url = f"{self.base_url}/v1/default/banks/{self.bank_id}/memories"
        content = f"User: {user_message}\nAssistant: {assistant_response}"
        payload = {
            "async": False,  # Synchronous retention per spec
            "items": [
                {
                    "content": content,
                    "metadata": {"session_id": session_id},
                }
            ],
        }

        try:
            resp = requests.post(url, json=payload, timeout=self.retain_timeout)
            if resp.status_code in (200, 201):
                return "ok"
            else:
                self.retry_queue.append(payload)
                return "degraded"
        except Exception:
            self.retry_queue.append(payload)
            return "degraded"

    def _drain_retry_queue(self) -> None:
        if not self.retry_queue:
            return

        url = f"{self.base_url}/v1/default/banks/{self.bank_id}/memories"
        pending = list(self.retry_queue)
        self.retry_queue.clear()

        for item in pending:
            try:
                resp = requests.post(url, json=item, timeout=self.retain_timeout)
                if resp.status_code not in (200, 201):
                    self.retry_queue.append(item)
            except Exception:
                self.retry_queue.append(item)
