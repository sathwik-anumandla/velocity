"""
Velocity Responses API Runner
Invokes Luna (OpenAI GPT-5.6 / configured model) via the Responses API.
Handles reasoning effort toggle, prompt_cache_key, Tavily search tool calling,
and buffered streaming (flushed every ~20-30 tokens or at sentence boundaries).
"""

import os
import re
import json
import logging
import asyncio
from typing import List, Dict, Any, Optional, AsyncGenerator
from dotenv import load_dotenv
import openai
from backend.tavily_tool import TavilySearchTool, TAVILY_TOOL_DEFINITION

load_dotenv()

logger = logging.getLogger("velocity.runner")

# Sentence boundary patterns: period/exclamation/question mark followed by space or newline, or double newline
SENTENCE_BOUNDARY_PATTERN = re.compile(r'([.?!](\s+|$))|(\n\n)')


class ResponsesRunner:
    def __init__(self):
        self.api_key = os.getenv("OPENAI_API_KEY", "").strip()
        self.base_url = (os.getenv("OPENAI_BASE_URL", "") or "https://api.openai.com/v1").strip().rstrip("/")
        self.model = os.getenv("LLM_MODEL_ID", "gpt-5.6-luna").strip()
        self.client = openai.OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
        )
        self.tavily = TavilySearchTool()

    def _should_flush(self, buffer: str) -> bool:
        """
        Flushes when buffer reaches ~20-30 tokens (~80-120 chars) or hits a sentence boundary.
        """
        if not buffer:
            return False

        # Check sentence boundary
        if SENTENCE_BOUNDARY_PATTERN.search(buffer):
            return True

        # Check token count estimate (~4 chars per token, 25 tokens ~= 100 chars)
        words = buffer.split()
        if len(words) >= 20 or len(buffer) >= 100:
            return True

        return False

    async def stream_turn(
        self,
        instructions: str,
        input_items: List[Dict[str, Any]],
        session_id: str,
        thinking_effort: str = "medium",
        is_temporary: bool = False,
        max_tool_hops: int = 5,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Executes a multi-turn turn loop with the Responses API and streams buffered deltas.
        Yields SSE dictionaries: {"event": str, "data": str}.
        """
        # Dynamically reload environment from .env if updated
        load_dotenv(override=True)
        active_model = os.getenv("LLM_MODEL_ID", self.model).strip()
        active_api_key = os.getenv("OPENAI_API_KEY", self.api_key).strip()
        active_base_url = (os.getenv("OPENAI_BASE_URL", "") or "https://api.openai.com/v1").strip().rstrip("/")
        if active_api_key != self.api_key or active_base_url != self.base_url:
            self.api_key = active_api_key
            self.base_url = active_base_url
            self.client = openai.OpenAI(api_key=self.api_key, base_url=self.base_url)
        self.model = active_model

        prompt_cache_key = f"temp:{session_id}" if is_temporary else session_id
        current_input = list(input_items)
        tools = [TAVILY_TOOL_DEFINITION] if self.tavily.is_configured else []

        full_assistant_text = ""
        total_usage: Dict[str, Any] = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        thinking_emitted = False

        for hop in range(max_tool_hops):
            # Run stream in thread pool to avoid blocking asyncio event loop
            loop = asyncio.get_running_loop()

            def make_stream():
                # Note: reasoning effort toggle passed to Responses API
                req_kwargs: Dict[str, Any] = {
                    "model": self.model,
                    "instructions": instructions,
                    "input": current_input,
                    "prompt_cache_key": prompt_cache_key,
                    "stream": True,
                }
                if tools:
                    req_kwargs["tools"] = tools
                if thinking_effort in ("low", "medium", "high"):
                    req_kwargs["reasoning"] = {"effort": thinking_effort}

                logger.info(f"Invoking Responses API with model='{self.model}' (reasoning='{thinking_effort}')")
                return self.client.responses.create(**req_kwargs)

            try:
                stream_obj = await loop.run_in_executor(None, make_stream)
            except Exception as e:
                logger.error(f"Error calling Responses API: {e}")
                yield {
                    "event": "error",
                    "data": json.dumps({"error": f"Responses API call failed: {str(e)}"}),
                }
                return

            text_buffer = ""
            active_tool_calls: List[Dict[str, Any]] = []

            # Consume stream items
            def get_next_event(iterator):
                try:
                    return next(iterator), False
                except StopIteration:
                    return None, True
                except Exception as ex:
                    raise ex

            iterator = iter(stream_obj)
            while True:
                try:
                    event, done = await loop.run_in_executor(None, get_next_event, iterator)
                except Exception as stream_err:
                    logger.error(f"Error reading stream: {stream_err}")
                    yield {
                        "event": "error",
                        "data": json.dumps({"error": f"Stream error: {str(stream_err)}"}),
                    }
                    return

                if done or event is None:
                    break

                ev_type = getattr(event, "type", "")

                # 1. Reasoning / Thinking indicator
                if "reasoning" in ev_type:
                    if not thinking_emitted:
                        thinking_emitted = True
                        yield {
                            "event": "thinking",
                            "data": json.dumps({"status": "thinking"}),
                        }

                # 2. Output text delta
                elif ev_type == "response.output_text.delta":
                    delta = getattr(event, "delta", "")
                    if delta:
                        text_buffer += delta
                        if self._should_flush(text_buffer):
                            full_assistant_text += text_buffer
                            yield {
                                "event": "delta",
                                "data": json.dumps({"text": text_buffer}),
                            }
                            text_buffer = ""

                # 3. Tool call detection
                elif ev_type == "response.output_item.done":
                    item = getattr(event, "item", None)
                    if item and getattr(item, "type", "") == "function_call":
                        active_tool_calls.append({
                            "call_id": getattr(item, "call_id", ""),
                            "name": getattr(item, "name", ""),
                            "arguments": getattr(item, "arguments", ""),
                        })

                # 4. Completion & usage stats
                elif ev_type in ("response.completed", "response.incomplete"):
                    resp = getattr(event, "response", None)
                    if resp and hasattr(resp, "usage") and resp.usage:
                        total_usage = {
                            "input_tokens": getattr(resp.usage, "input_tokens", 0),
                            "output_tokens": getattr(resp.usage, "output_tokens", 0),
                            "total_tokens": getattr(resp.usage, "total_tokens", 0),
                        }

            # Flush remaining buffer from this stream iteration
            if text_buffer:
                full_assistant_text += text_buffer
                yield {
                    "event": "delta",
                    "data": json.dumps({"text": text_buffer}),
                }
                text_buffer = ""

            # If no tool calls were made, we have the complete response
            if not active_tool_calls:
                break

            # If tool calls were made, execute them and continue the Responses loop
            for tc in active_tool_calls:
                call_id = tc["call_id"]
                fn_name = tc["name"]
                fn_args_raw = tc["arguments"]

                if fn_name == "tavily_search":
                    query = ""
                    try:
                        parsed_args = json.loads(fn_args_raw) if fn_args_raw else {}
                        query = parsed_args.get("query", "")
                    except Exception:
                        query = fn_args_raw

                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "tavily_search", "query": query}),
                    }

                    # Execute Tavily search
                    tool_output = await loop.run_in_executor(None, self.tavily.search, query)

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "tavily_search"}),
                    }

                    # Append function call and function call output to current input
                    current_input.append({
                        "type": "function_call",
                        "call_id": call_id,
                        "name": fn_name,
                        "arguments": fn_args_raw,
                    })
                    current_input.append({
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": tool_output,
                    })

        # Completed all iterations
        yield {
            "event": "done",
            "data": json.dumps({
                "text": full_assistant_text,
                "usage": total_usage,
            }),
        }
