"""
Velocity Responses API Runner
Invokes the OpenAI Responses API with:
- Reasoning effort toggles
- Output text verbosity controls
- Prompt cache key
- Web search tool (Tavily)
- Cognitive memory tools (Hindsight: consult_memory, read_mental_model)
- Buffered streaming deltas (flushed every ~20-30 tokens or at sentence boundaries)
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
from backend.hindsight import HindsightClient
from backend.vault import (
    read_memory_doc as vault_read_doc,
    update_memory_section as vault_update_section,
    create_memory_doc as vault_create_doc,
)

load_dotenv()

logger = logging.getLogger("velocity.runner")

# Sentence boundary patterns: period/exclamation/question mark followed by space or newline, or double newline
SENTENCE_BOUNDARY_PATTERN = re.compile(r'([.?!](\s+|$))|(\n\n)')

READ_MEMORY_DOC_TOOL_DEFINITION = {
    "type": "function",
    "name": "read_memory_doc",
    "description": (
        "Read a specific markdown document from the deterministic memory vault. "
        "Use this when Sathwik mentions or asks about specific projects (e.g. 'projects/velocity.md'), "
        "study areas ('study/dsa.md'), topic dossiers ('topics/...'), or people ('people/directory.md')."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Relative path of the document in the vault, e.g. 'projects/velocity.md' or 'study/dsa.md'.",
            }
        },
        "required": ["path"],
        "additionalProperties": False,
    },
}

UPDATE_MEMORY_SECTION_TOOL_DEFINITION = {
    "type": "function",
    "name": "update_memory_section",
    "description": (
        "Update or add a designated section inside an existing memory vault document. "
        "Replaces only the target section heading and its body, preserving the rest of the document. "
        "Use when Sathwik updates preferences, changes a tech stack choice, finishes a task, or sets a new priority."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Relative path of the document, e.g. 'core/tech_stack.md', 'core/preferences.md', or 'core/active_context.md'.",
            },
            "section": {
                "type": "string",
                "description": "Markdown heading of the section to update or create, e.g. 'Primary Languages & Frameworks', 'Immediate Focus', or 'Backend'.",
            },
            "content": {
                "type": "string",
                "description": "The updated markdown content body for this section.",
            },
        },
        "required": ["path", "section", "content"],
        "additionalProperties": False,
    },
}

CREATE_MEMORY_DOC_TOOL_DEFINITION = {
    "type": "function",
    "name": "create_memory_doc",
    "description": (
        "Create a brand new markdown document in the memory vault. "
        "Use when Sathwik starts a distinct new project (e.g. 'projects/new_project.md') or explicitly asks to create a new topic dossier."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Relative path for the new document, e.g. 'projects/new_app.md' or 'topics/neuroscience.md'.",
            },
            "content": {
                "type": "string",
                "description": "Full initial markdown content with proper headings.",
            },
        },
        "required": ["path", "content"],
        "additionalProperties": False,
    },
}

SEARCH_PAST_CONVERSATIONS_TOOL_DEFINITION = {
    "type": "function",
    "name": "search_past_conversations",
    "description": (
        "Search past conversation history and episodic memory in Hindsight. "
        "Use when Sathwik asks about past discussions, previous bugs, past decisions made in conversations, "
        "or when you need temporal historical context."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query to look up in past conversation logs.",
            }
        },
        "required": ["query"],
        "additionalProperties": False,
    },
}

CONSULT_MEMORY_TOOL_DEFINITION = {
    "type": "function",
    "name": "consult_memory",
    "description": SEARCH_PAST_CONVERSATIONS_TOOL_DEFINITION["description"],
    "parameters": SEARCH_PAST_CONVERSATIONS_TOOL_DEFINITION["parameters"],
}


class ResponsesRunner:
    def __init__(self, hindsight: Optional[HindsightClient] = None):
        self.api_key = os.getenv("OPENAI_API_KEY", "").strip()
        self.base_url = (os.getenv("OPENAI_BASE_URL", "") or "https://api.openai.com/v1").strip().rstrip("/")
        self.model = os.getenv("LLM_MODEL_ID", "gpt-5.6-luna").strip()
        self.client = openai.OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
        )
        self.tavily = TavilySearchTool()
        self.hindsight = hindsight or HindsightClient()

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
        verbosity: str = "low",
        model: Optional[str] = None,
        is_temporary: bool = False,
        max_tool_hops: int = 5,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Executes a multi-turn loop with the Responses API and streams buffered deltas.
        Yields SSE dictionaries: {"event": str, "data": str}.
        """
        # Dynamically reload environment from .env if updated
        load_dotenv(override=True)
        active_model = (model or os.getenv("LLM_MODEL_ID", self.model)).strip()
        active_api_key = os.getenv("OPENAI_API_KEY", self.api_key).strip()
        active_base_url = (os.getenv("OPENAI_BASE_URL", "") or "https://api.openai.com/v1").strip().rstrip("/")
        if active_api_key != self.api_key or active_base_url != self.base_url:
            self.api_key = active_api_key
            self.base_url = active_base_url
            self.client = openai.OpenAI(api_key=self.api_key, base_url=self.base_url)
        self.model = active_model

        prompt_cache_key = f"temp:{session_id}" if is_temporary else session_id
        current_input = list(input_items)

        # Assemble active tools
        tools: List[Dict[str, Any]] = []
        if self.tavily.is_configured:
            tools.append(TAVILY_TOOL_DEFINITION)

        # Deterministic Memory Vault tools
        tools.append(READ_MEMORY_DOC_TOOL_DEFINITION)
        tools.append(UPDATE_MEMORY_SECTION_TOOL_DEFINITION)
        tools.append(CREATE_MEMORY_DOC_TOOL_DEFINITION)

        # Episodic Hindsight tools
        if self.hindsight.check_health():
            tools.append(SEARCH_PAST_CONVERSATIONS_TOOL_DEFINITION)
            tools.append(CONSULT_MEMORY_TOOL_DEFINITION)

        full_assistant_text = ""
        total_usage: Dict[str, Any] = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        thinking_emitted = False

        for hop in range(max_tool_hops):
            # Run stream in thread pool to avoid blocking asyncio event loop
            loop = asyncio.get_running_loop()

            def make_stream():
                # Reasoning effort & verbosity passed to Responses API
                req_kwargs: Dict[str, Any] = {
                    "model": active_model,
                    "instructions": instructions,
                    "input": current_input,
                    "prompt_cache_key": prompt_cache_key,
                    "stream": True,
                }
                if tools:
                    req_kwargs["tools"] = tools
                if thinking_effort in ("none", "low", "medium", "high", "xhigh", "max"):
                    req_kwargs["reasoning"] = {"effort": thinking_effort}
                if verbosity in ("low", "medium", "high"):
                    req_kwargs["text"] = {"verbosity": verbosity}

                logger.info(f"Invoking Responses API with model='{active_model}' (effort='{thinking_effort}', verbosity='{verbosity}', tools={[t['name'] for t in tools]})")
                try:
                    return self.client.responses.create(**req_kwargs)
                except Exception as err:
                    # If the model does not support 'max', gracefully fallback to 'xhigh'
                    if ("reasoning.effort" in str(err) or "unsupported_value" in str(err)) and req_kwargs.get("reasoning", {}).get("effort") == "max":
                        logger.info(f"Model '{active_model}' does not support effort='max', falling back to 'xhigh'")
                        req_kwargs["reasoning"] = {"effort": "xhigh"}
                        return self.client.responses.create(**req_kwargs)
                    raise err

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
                            "event": "status",
                            "data": json.dumps({"text": "Thinking"}),
                        }
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
                        "event": "status",
                        "data": json.dumps({"text": "Searching"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "tavily_search", "query": f"Searching web: {query}"}),
                    }

                    tool_output = await loop.run_in_executor(None, self.tavily.search, query)

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "tavily_search"}),
                    }

                elif fn_name == "read_memory_doc":
                    path = ""
                    try:
                        parsed_args = json.loads(fn_args_raw) if fn_args_raw else {}
                        path = parsed_args.get("path", "")
                    except Exception:
                        path = fn_args_raw

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Reading memory"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "read_memory_doc", "query": path}),
                    }

                    doc_content = await loop.run_in_executor(None, vault_read_doc, path)
                    if doc_content is not None:
                        tool_output = f"[Document '{path}']:\n{doc_content}"
                        result_msg = f"Read {len(doc_content)} chars"
                    else:
                        tool_output = f"[Document '{path}' not found in memory vault]"
                        result_msg = "Not found"

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "read_memory_doc", "result": result_msg}),
                    }

                elif fn_name == "update_memory_section":
                    path, section, content = "", "", ""
                    try:
                        parsed_args = json.loads(fn_args_raw) if fn_args_raw else {}
                        path = parsed_args.get("path", "")
                        section = parsed_args.get("section", "")
                        content = parsed_args.get("content", "")
                    except Exception:
                        pass

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Updating memory"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "update_memory_section", "query": f"{path} -> ## {section}"}),
                    }

                    success = await vault_update_section(path, section, content, source="CONVERSATION")
                    if success:
                        tool_output = f"[Successfully updated section '## {section}' in '{path}']"
                        result_msg = "Updated"
                    else:
                        tool_output = f"[Failed to update section '## {section}' in '{path}']"
                        result_msg = "Failed"

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "update_memory_section", "result": result_msg}),
                    }

                elif fn_name == "create_memory_doc":
                    path, content = "", ""
                    try:
                        parsed_args = json.loads(fn_args_raw) if fn_args_raw else {}
                        path = parsed_args.get("path", "")
                        content = parsed_args.get("content", "")
                    except Exception:
                        pass

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Creating memory doc"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "create_memory_doc", "query": path}),
                    }

                    success = await vault_create_doc(path, content, source="CONVERSATION")
                    if success:
                        tool_output = f"[Successfully created memory document '{path}']"
                        result_msg = "Created"
                    else:
                        tool_output = f"[Document '{path}' already exists or failed to create]"
                        result_msg = "Exists/Failed"

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "create_memory_doc", "result": result_msg}),
                    }

                elif fn_name in ("search_past_conversations", "consult_memory"):
                    query = ""
                    try:
                        parsed_args = json.loads(fn_args_raw) if fn_args_raw else {}
                        query = parsed_args.get("query", "")
                    except Exception:
                        query = fn_args_raw

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Searching past conversations"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": fn_name, "query": f"Searching logs: {query}"}),
                    }

                    memories, status = await loop.run_in_executor(
                        None, self.hindsight.recall, query, "mid", 5
                    )
                    if memories:
                        facts_text = "\n".join(f"- {m}" for m in memories)
                        tool_output = f"[Hindsight Memories Found]:\n{facts_text}"
                        result_msg = f"{len(memories)} memories found"
                    else:
                        tool_output = "[No specific memories found for this query in Hindsight]"
                        result_msg = "No memories found"

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": fn_name, "result": result_msg}),
                    }

                elif fn_name == "read_mental_model":
                    model_name = ""
                    try:
                        parsed_args = json.loads(fn_args_raw) if fn_args_raw else {}
                        model_name = parsed_args.get("model_name", "")
                    except Exception:
                        model_name = fn_args_raw

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Fetching mental model"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "read_mental_model", "query": f"Reading: {model_name}"}),
                    }

                    content = await loop.run_in_executor(
                        None, self.hindsight.get_mental_model, model_name
                    )
                    if content:
                        tool_output = f"[Mental Model '{model_name}']:\n{content}"
                        result_msg = "Ready"
                    else:
                        tool_output = f"[Mental Model '{model_name}' is not yet available or empty]"
                        result_msg = "Empty"

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "read_mental_model", "result": result_msg}),
                    }

                else:
                    tool_output = f"[Unknown tool: {fn_name}]"

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
