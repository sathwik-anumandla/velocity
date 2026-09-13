"""
Tavily Search Client for Velocity
Provides web search integration as an OpenAI tool.
"""

import os
import requests
from typing import List, Dict, Any, Optional

TAVILY_TOOL_DEFINITION = {
    "type": "function",
    "name": "tavily_search",
    "description": "Search the live web for real-time news, current events, technical documentation, or factual queries.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query to execute on the web.",
            }
        },
        "required": ["query"],
        "additionalProperties": False,
    },
}


class TavilySearchTool:
    def __init__(self, api_key: Optional[str] = None, timeout: int = 15):
        self.api_key = api_key or os.getenv("TAVILY_API_KEY", "")
        self.endpoint = "https://api.tavily.com/search"
        self.timeout = timeout

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key and "your-tavily" not in self.api_key)

    def search(self, query: str, max_results: int = 5) -> str:
        """
        Execute web search query on Tavily and return a compact summary.
        """
        if not self.is_configured:
            return "[Error: TAVILY_API_KEY is not configured in environment]"

        if not query or not str(query).strip():
            return "[Error: Search query cannot be empty]"

        payload = {
            "api_key": self.api_key,
            "query": str(query).strip(),
            "search_depth": "basic",
            "max_results": max_results,
            "include_answer": True,
        }

        try:
            resp = requests.post(self.endpoint, json=payload, timeout=self.timeout)
            resp.raise_for_status()
            data = resp.json()

            results: List[Dict[str, Any]] = data.get("results", []) if isinstance(data, dict) else []
            direct_answer = data.get("answer") if isinstance(data, dict) else None

            parts = []
            if direct_answer:
                parts.append(f"Direct Answer: {direct_answer}\n")

            if results:
                parts.append("Web Results:")
                for i, r in enumerate(results[:max_results], 1):
                    if isinstance(r, dict):
                        title = r.get("title", "Untitled")
                        url = r.get("url", "")
                        snippet = r.get("content", "").strip()
                        parts.append(f"{i}. [{title}]({url})\n   {snippet}")
            elif not direct_answer:
                parts.append("No results found.")

            return "\n\n".join(parts)

        except requests.exceptions.Timeout:
            return f"[Error: Tavily search timed out after {self.timeout}s]"
        except Exception as e:
            return f"[Error executing Tavily search: {str(e)}]"
