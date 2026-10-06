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
import uuid
import logging
import asyncio
from typing import List, Dict, Any, Optional, AsyncGenerator
from dotenv import load_dotenv
import openai
from backend.usage import reserve_call, finish_call, mark_call
from backend.repository_tools import REPOSITORY_TOOLS, execute as execute_repository_tool
from backend.tavily_tool import TavilySearchTool, TAVILY_TOOL_DEFINITION
from backend.hindsight import HindsightClient
from backend.database import (
    create_artifact as db_create_artifact,
    update_artifact as db_update_artifact,
    create_staged_action as db_create_staged_action,
    create_scheduled_event as db_create_scheduled_event,
    list_scheduled_events as db_list_scheduled_events,
    delete_scheduled_event as db_delete_scheduled_event,
)
from backend.scheduler import compute_next_run, get_user_timezone_str
from backend.skills_manager import (
    create_or_update_skill as sm_create_or_update_skill,
    list_skills as sm_list_skills,
    delete_skill as sm_delete_skill,
)
from backend.google_service import google_workspace
from backend.workspace_tools import (
    GCAL_LIST_EVENTS_TOOL_DEFINITION, GCAL_CREATE_EVENT_TOOL_DEFINITION,
    GCAL_DELETE_EVENT_TOOL_DEFINITION, GTASKS_LIST_TASKS_TOOL_DEFINITION,
    GTASKS_CREATE_TASK_TOOL_DEFINITION, GTASKS_COMPLETE_TASK_TOOL_DEFINITION,
    GMAIL_LIST_UNREAD_TOOL_DEFINITION, GMAIL_CREATE_DRAFT_TOOL_DEFINITION,
    GMAIL_SEND_EMAIL_TOOL_DEFINITION, WORKSPACE_TOOLS, WORKSPACE_TOOL_NAMES,
    WORKSPACE_READ_ONLY, validate_arguments,
)
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

PROPOSE_SIDE_CHAT_TOOL_DEFINITION = {
    "type": "function",
    "name": "propose_side_chat",
    "description": (
        "Propose branching a complex, multi-turn, or deep technical task into a dedicated Side Chat (thread) "
        "to keep Sathwik's main timeline clean. Use this when the request requires deep iterative debugging, "
        "large multi-file code generation, or extensive research exploration. "
        "State your reason and proposed title clearly."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Short, clean 3-5 word title for the side chat, e.g. 'PostgreSQL WAL Optimization'.",
            },
            "reason": {
                "type": "string",
                "description": "Brief explanation of why this warrants a side chat (e.g. 'Requires multi-step config tuning and benchmark iterations').",
            },
            "suggested_first_turn": {
                "type": "string",
                "description": "Initial analysis or high-level outline to start the side chat with.",
            },
        },
        "required": ["title", "reason"],
        "additionalProperties": False,
    },
}

CONSULT_MEMORY_TOOL_DEFINITION = {
    "type": "function",
    "name": "consult_memory",
    "description": SEARCH_PAST_CONVERSATIONS_TOOL_DEFINITION["description"],
    "parameters": SEARCH_PAST_CONVERSATIONS_TOOL_DEFINITION["parameters"],
}

CREATE_ARTIFACT_TOOL_DEFINITION = {
    "type": "function",
    "name": "create_artifact",
    "description": (
        "Create a standalone structured document, architectural specification, RFC, detailed research report, "
        "or comprehensive guide to be rendered in the dedicated Artifact Canvas panel alongside the chat. "
        "Use this for content longer than 3-4 paragraphs or reference documents that Sathwik will want to read, "
        "inspect, or export to PDF."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Clear, concise title for the document, e.g. 'Raft Consensus Implementation RFC'.",
            },
            "artifact_type": {
                "type": "string",
                "enum": ["document", "rfc", "architecture", "report", "guide", "spec"],
                "description": "The category of the artifact.",
            },
            "language": {
                "type": "string",
                "description": "Programming language if code_file, or 'markdown' for formatted prose (default: markdown).",
            },
            "content": {
                "type": "string",
                "description": "Full Markdown content of the artifact with structured headings, code blocks, and tables.",
            },
            "summary": {
                "type": "string",
                "description": "1-2 sentence executive summary of what this document covers.",
            },
        },
        "required": ["title", "content"],
        "additionalProperties": False,
    },
}

UPDATE_ARTIFACT_TOOL_DEFINITION = {
    "type": "function",
    "name": "update_artifact",
    "description": "Update an existing artifact in the canvas with revisions or requested sections.",
    "parameters": {
        "type": "object",
        "properties": {
            "artifact_id": {
                "type": "string",
                "description": "The ID of the artifact to update.",
            },
            "title": {
                "type": "string",
                "description": "Optional updated title.",
            },
            "content": {
                "type": "string",
                "description": "Full revised Markdown content of the artifact.",
            },
            "summary": {
                "type": "string",
                "description": "Updated 1-2 sentence summary of what changed.",
            },
        },
        "required": ["artifact_id", "content"],
        "additionalProperties": False,
    },
}

CREATE_SCHEDULED_EVENT_TOOL_DEFINITION = {
    "type": "function",
    "name": "create_scheduled_event",
    "description": (
        "Schedule an autonomous reminder or recurring routine in Velocity. "
        "For one-shot timed events (e.g. 'at 10pm', 'tomorrow at 4pm', 'in 30 minutes'), "
        "set event_type='one_shot' and provide run_at in ISO 8601 format. "
        "For recurring routines (e.g. 'every morning at 8am', 'weekdays at 10am'), "
        "set event_type='recurring' and provide cron_expression (e.g. '0 8 * * *'). "
        "Prompt is the exact prompt/directive that will be executed when triggered."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Short name for the event, e.g. 'Daily Tech Briefing' or 'Review Raft Paper'.",
            },
            "event_type": {
                "type": "string",
                "enum": ["recurring", "one_shot"],
                "description": "Whether the event repeats via cron or runs once at a specific timestamp.",
            },
            "prompt": {
                "type": "string",
                "description": "The instruction or directive to execute autonomously when the event fires.",
            },
            "cron_expression": {
                "type": "string",
                "description": "Standard 5-field cron expression for recurring events (e.g. '0 10 * * *' for 10:00 AM daily).",
            },
            "run_at": {
                "type": "string",
                "description": "ISO 8601 timestamp for one_shot events (e.g. '2026-10-04T22:00:00+05:30').",
            },
            "skill_id": {
                "type": "string",
                "description": "Optional skill ID to associate with this routine (e.g. 'morning_briefing').",
            },
        },
        "required": ["name", "event_type", "prompt"],
        "additionalProperties": False,
    },
}

LIST_SCHEDULED_EVENTS_TOOL_DEFINITION = {
    "type": "function",
    "name": "list_scheduled_events",
    "description": "List existing scheduled reminders and recurring cron jobs in Velocity.",
    "parameters": {
        "type": "object",
        "properties": {
            "status": {
                "type": "string",
                "enum": ["active", "paused", "completed", "cancelled"],
                "description": "Optional status filter.",
            }
        },
        "additionalProperties": False,
    },
}

DELETE_SCHEDULED_EVENT_TOOL_DEFINITION = {
    "type": "function",
    "name": "delete_scheduled_event",
    "description": "Delete or cancel a scheduled event or reminder by its ID.",
    "parameters": {
        "type": "object",
        "properties": {
            "event_id": {
                "type": "string",
                "description": "The unique event ID (e.g. 'sched_abcd1234').",
            }
        },
        "required": ["event_id"],
        "additionalProperties": False,
    },
}

CREATE_OR_UPDATE_SKILL_TOOL_DEFINITION = {
    "type": "function",
    "name": "create_or_update_skill",
    "description": (
        "Create or modify a modular skill in Velocity. "
        "Writes instructions.md and skill.json manifest into data/skills/{skill_id}/. "
        "Use this whenever Sathwik establishes a new repeatable workflow or asks to alter an existing skill's behavior."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "skill_id": {
                "type": "string",
                "description": "Unique identifier, lowercase alphanumeric with underscores (e.g. 'morning_briefing', 'tech_interviewer').",
            },
            "name": {
                "type": "string",
                "description": "Human-readable skill name.",
            },
            "description": {
                "type": "string",
                "description": "Short summary of what this skill does and when it should be used.",
            },
            "instructions": {
                "type": "string",
                "description": "Detailed markdown procedural instructions for executing this skill.",
            },
            "slash_command": {
                "type": "string",
                "description": "Optional shortcut command starting with slash (e.g. '/briefing').",
            },
            "allowed_tools": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional list of tool names this skill uses.",
            },
            "enabled": {
                "type": "boolean",
                "description": "Whether the skill is active.",
            },
        },
        "required": ["skill_id", "name", "description", "instructions"],
        "additionalProperties": False,
    },
}

LIST_SKILLS_TOOL_DEFINITION = {
    "type": "function",
    "name": "list_skills",
    "description": "List all installed modular skills, their descriptions, and slash commands.",
    "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    },
}

DELETE_SKILL_TOOL_DEFINITION = {
    "type": "function",
    "name": "delete_skill",
    "description": "Delete a modular skill by its ID.",
    "parameters": {
        "type": "object",
        "properties": {
            "skill_id": {
                "type": "string",
                "description": "The skill ID to delete.",
            }
        },
        "required": ["skill_id"],
        "additionalProperties": False,
    },
}


class ResponsesRunner:
    def __init__(self, hindsight: Optional[HindsightClient] = None):
        self.api_key = os.getenv("OPENAI_API_KEY", "").strip()
        self.base_url = (os.getenv("OPENAI_BASE_URL", "") or "https://api.openai.com/v1").strip().rstrip("/")
        self.model = os.getenv("LLM_MODEL_ID", "gpt-5.4-mini").strip()
        self.client = openai.AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            max_retries=0,
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
        is_thread: bool = False,
        max_tool_hops: int = 5,
        source: str = "chat",
        read_only: bool = False,
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
            self.client = openai.AsyncOpenAI(api_key=self.api_key, base_url=self.base_url, max_retries=0)
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
        tools.append(SEARCH_PAST_CONVERSATIONS_TOOL_DEFINITION)
        tools.append(CONSULT_MEMORY_TOOL_DEFINITION)

        # Side Chat proposal tool (available on main timeline only)
        if not is_thread:
            tools.append(PROPOSE_SIDE_CHAT_TOOL_DEFINITION)

        # Artifact Canvas tools (available in both main timeline and side chats)
        tools.append(CREATE_ARTIFACT_TOOL_DEFINITION)
        tools.append(UPDATE_ARTIFACT_TOOL_DEFINITION)
        tools.extend(REPOSITORY_TOOLS)

        # Google Workspace tools (available if connected)
        if google_workspace.is_connected():
            tools.extend(WORKSPACE_TOOLS)
        else:
            tools.extend(definition for definition in WORKSPACE_TOOLS if definition["name"] in {"workspace_list_jobs", "workspace_cancel_job"})

        # Phase 5: Proactive Scheduling and Skills tools
        tools.append(CREATE_SCHEDULED_EVENT_TOOL_DEFINITION)
        tools.append(LIST_SCHEDULED_EVENTS_TOOL_DEFINITION)
        tools.append(DELETE_SCHEDULED_EVENT_TOOL_DEFINITION)
        tools.append(CREATE_OR_UPDATE_SKILL_TOOL_DEFINITION)
        tools.append(LIST_SKILLS_TOOL_DEFINITION)
        tools.append(DELETE_SKILL_TOOL_DEFINITION)


        full_assistant_text = ""
        if read_only:
            tools = [tool for tool in tools if tool["name"] in WORKSPACE_READ_ONLY | {"tavily_search", "read_memory_doc", "search_past_conversations", "consult_memory", "list_scheduled_events", "list_skills", "search_artifacts", "read_artifact", "search_threads", "read_thread"}]
        total_usage: Dict[str, Any] = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        last_proposal: Optional[Dict[str, Any]] = None
        last_artifact: Optional[Dict[str, Any]] = None
        last_staged_action: Optional[Dict[str, Any]] = None
        thinking_emitted = False


        for hop in range(max_tool_hops):
            # Run stream in thread pool to avoid blocking asyncio event loop
            loop = asyncio.get_running_loop()
            max_output = int(os.getenv("LLM_MAX_OUTPUT_TOKENS", "8192"))
            try:
                usage_id = reserve_call(active_model, source, session_id, {"instructions": instructions, "input": current_input, "tools": tools}, max_output, conversation_kind="thread" if is_thread else "main", hop=hop)
            except Exception as error:
                yield {"event": "error", "data": json.dumps({"error": str(error)})}
                return

            async def make_stream():
                # Reasoning effort & verbosity passed to Responses API
                req_kwargs: Dict[str, Any] = {
                    "model": active_model,
                    "instructions": instructions,
                    "input": current_input,
                    "prompt_cache_key": prompt_cache_key,
                    "stream": True,
                    "max_output_tokens": max_output,
                }
                if tools:
                    req_kwargs["tools"] = tools
                if thinking_effort in ("none", "low", "medium", "high", "xhigh", "max"):
                    req_kwargs["reasoning"] = {"effort": thinking_effort}
                if verbosity in ("low", "medium", "high"):
                    req_kwargs["text"] = {"verbosity": verbosity}

                logger.info(f"Invoking Responses API with model='{active_model}' (effort='{thinking_effort}', verbosity='{verbosity}', tools={[t['name'] for t in tools]})")
                try:
                    return await self.client.responses.create(**req_kwargs)
                except Exception as err:
                    # If the model does not support 'max', gracefully fallback to 'xhigh'
                    if ("reasoning.effort" in str(err) or "unsupported_value" in str(err)) and req_kwargs.get("reasoning", {}).get("effort") == "max":
                        logger.info(f"Model '{active_model}' does not support effort='max', falling back to 'xhigh'")
                        req_kwargs["reasoning"] = {"effort": "xhigh"}
                        return await self.client.responses.create(**req_kwargs)
                    raise err

            try:
                stream_obj = await make_stream()
            except asyncio.CancelledError:
                mark_call(usage_id, "unreported")
                raise
            except Exception as e:
                mark_call(usage_id, "failed" if isinstance(e, openai.APIStatusError) and e.status_code < 500 else "unreported")
                logger.error(f"Error calling Responses API: {e}")
                yield {
                    "event": "error",
                    "data": json.dumps({"error": f"Responses API call failed: {str(e)}"}),
                }
                return

            text_buffer = ""
            received_terminal = False
            active_tool_calls: List[Dict[str, Any]] = []

            # Consume stream items
            async def get_next_event(iterator):
                try:
                    return await iterator.__anext__(), False
                except StopAsyncIteration:
                    return None, True
                except Exception as ex:
                    raise ex

            try:
                iterator = stream_obj.__aiter__()
                while True:
                    try:
                        event, done = await get_next_event(iterator)
                    except Exception as stream_err:
                        logger.error(f"Error reading stream: {stream_err}")
                        if text_buffer:
                            yield {"event": "delta", "data": json.dumps({"text": text_buffer})}
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
                        received_terminal = True
                        resp = getattr(event, "response", None)
                        if resp and hasattr(resp, "usage") and resp.usage:
                            hop_usage = finish_call(usage_id, resp.usage, getattr(resp, "id", None), getattr(resp, "model", None))
                            for key, value in hop_usage.items():
                                if isinstance(value, int):
                                    total_usage[key] = total_usage.get(key, 0) + value
                        if ev_type == "response.incomplete":
                            if text_buffer:
                                yield {"event": "delta", "data": json.dumps({"text": text_buffer})}
                            yield {"event": "error", "data": json.dumps({"error": "Response interrupted by output limit. Partial text has been saved."})}
                            return
                    elif ev_type in ("response.failed", "error"):
                        if text_buffer:
                            yield {"event": "delta", "data": json.dumps({"text": text_buffer})}
                        yield {"event": "error", "data": json.dumps({"error": "Provider failed to finish the response. Partial text has been saved."})}
                        return
            finally:
                mark_call(usage_id, "unreported")
                await stream_obj.close()

            # Flush remaining buffer from this stream iteration
            if text_buffer:
                full_assistant_text += text_buffer
                yield {
                    "event": "delta",
                    "data": json.dumps({"text": text_buffer}),
                }
                text_buffer = ""

            if not received_terminal:
                yield {"event": "error", "data": json.dumps({"error": "Provider stream ended before completion. Partial text has been saved."})}
                return

            # If no tool calls were made, we have the complete response
            if not active_tool_calls:
                break

            # If tool calls were made, execute them and continue the Responses loop
            for tc in active_tool_calls:
                call_id = tc["call_id"]
                fn_name = tc["name"]
                fn_args_raw = tc["arguments"]

                if fn_name not in {definition["name"] for definition in tools}:
                    tool_output = json.dumps({"error": "This tool is unavailable or disallowed. Regeneration is read-only."})
                elif fn_name in {tool["name"] for tool in REPOSITORY_TOOLS}:
                    yield {"event": "tool_start", "data": json.dumps({"tool": fn_name, "query": "Reading saved context"})}
                    try:
                        arguments = json.loads(fn_args_raw) if fn_args_raw else {}
                        result = await asyncio.to_thread(execute_repository_tool, fn_name, arguments)
                        tool_output = json.dumps(result, ensure_ascii=False)
                        result_label = "Saved context retrieved"
                    except (LookupError, ValueError, TypeError) as error:
                        tool_output = json.dumps({"error": str(error)})
                        result_label = str(error)
                    yield {"event": "tool_done", "data": json.dumps({"tool": fn_name, "result": result_label})}
                elif fn_name == "tavily_search":
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
                    if status != "ok":
                        tool_output = "[Memory service unavailable. Do not treat this as an empty search or claim there are no memories.]"
                        result_msg = "Memory service unavailable"
                    elif memories:
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

                elif fn_name == "propose_side_chat":
                    title, reason, suggested_first_turn = "", "", ""
                    try:
                        parsed_args = json.loads(fn_args_raw) if fn_args_raw else {}
                        title = parsed_args.get("title", "Side Chat")
                        reason = parsed_args.get("reason", "")
                        suggested_first_turn = parsed_args.get("suggested_first_turn", "")
                    except Exception:
                        title = "Side Chat"

                    proposal_data = {
                        "title": title,
                        "reason": reason,
                        "suggested_first_turn": suggested_first_turn,
                        "status": "pending",
                    }
                    last_proposal = proposal_data

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Proposing side chat"}),
                    }
                    yield {
                        "event": "thread_proposal",
                        "data": json.dumps(proposal_data),
                    }

                    tool_output = (
                        f"[Thread proposal card for '{title}' is now rendered in the UI with action buttons. "
                        "Output exactly ONE forward-looking orientation sentence in your response. "
                        "Do NOT repeat the thread title or reason, and do NOT ask for confirmation.]"
                    )

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "propose_side_chat", "result": f"Proposed: {title}"}),
                    }

                elif fn_name == "create_artifact":
                    title, artifact_type, language, content, summary = "", "document", "markdown", "", ""
                    try:
                        parsed_args = json.loads(fn_args_raw) if fn_args_raw else {}
                        title = parsed_args.get("title", "Untitled Document")
                        artifact_type = parsed_args.get("artifact_type", "document")
                        language = parsed_args.get("language", "markdown")
                        content = parsed_args.get("content", "")
                        summary = parsed_args.get("summary", "")
                    except Exception:
                        title = "Untitled Document"

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Creating artifact"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "create_artifact", "query": title}),
                    }

                    art_id = f"art_{uuid.uuid4().hex[:12]}"
                    artifact_record = await loop.run_in_executor(
                        None,
                        db_create_artifact,
                        art_id,
                        session_id,
                        title,
                        artifact_type,
                        content,
                        None,  # message_id
                        language,
                        summary,
                    )
                    last_artifact = artifact_record

                    yield {
                        "event": "artifact_created",
                        "data": json.dumps(artifact_record),
                    }

                    tool_output = (
                        f"[Created artifact '{title}' (ID: {art_id}). "
                        "The artifact card is now visible to Sathwik with an 'Open in Canvas' action. "
                        "Provide a concise conversational reply summarizing what was drafted in the document.]"
                    )

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "create_artifact", "result": f"Created: {title}"}),
                    }

                elif fn_name == "update_artifact":
                    art_id, updated_title, updated_content, updated_summary = "", None, "", None
                    try:
                        parsed_args = json.loads(fn_args_raw) if fn_args_raw else {}
                        art_id = parsed_args.get("artifact_id", "")
                        updated_title = parsed_args.get("title")
                        updated_content = parsed_args.get("content", "")
                        updated_summary = parsed_args.get("summary")
                    except Exception:
                        pass

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Updating artifact"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "update_artifact", "query": art_id}),
                    }

                    updated_record = await loop.run_in_executor(
                        None,
                        db_update_artifact,
                        art_id,
                        updated_title,
                        updated_content,
                        updated_summary,
                    )
                    if updated_record:
                        last_artifact = updated_record
                        yield {
                            "event": "artifact_created",
                            "data": json.dumps(updated_record),
                        }
                        tool_output = f"[Successfully updated artifact '{art_id}' to version {updated_record.get('version')}]."
                        result_msg = f"Updated: {updated_record.get('title')}"
                    else:
                        tool_output = f"[Failed to update artifact '{art_id}': not found]."
                        result_msg = "Not found"

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "update_artifact", "result": result_msg}),
                    }

                elif fn_name in WORKSPACE_TOOL_NAMES:
                    yield {"event": "tool_start", "data": json.dumps({"tool": fn_name, "query": fn_name.replace("_", " ")})}
                    try:
                        arguments = json.loads(fn_args_raw) if fn_args_raw else {}
                        validate_arguments(fn_name, arguments)
                        if fn_name == "gmail_send_email":
                            mail_fields = {key: value for key, value in arguments.items() if key != "send_at"}
                            google_workspace._mail_payload(**mail_fields)
                            if arguments.get("send_at"):
                                from backend.workspace_jobs import parse_time
                                from datetime import datetime, timezone
                                if parse_time(arguments["send_at"]) <= datetime.now(timezone.utc):
                                    raise ValueError("send_at must be in the future.")
                            action_id = f"act_{uuid.uuid4().hex[:12]}"
                            arguments["_account_email"] = await asyncio.to_thread(google_workspace._job_account)
                            action_payload = {
                                "id": action_id, "session_id": session_id, "provider": "gmail",
                                "action_type": "send_email", "parameters": arguments, "status": "pending",
                            }
                            await asyncio.to_thread(db_create_staged_action, action_id, session_id, "gmail", "send_email", arguments, None)
                            last_staged_action = action_payload
                            yield {"event": "action_proposal", "data": json.dumps(action_payload)}
                            tool_output = json.dumps({"status": "awaiting_user_approval", "action_id": action_id, "message": "Approval card shown. Nothing sent or scheduled until the user confirms."})
                        else:
                            result = await asyncio.to_thread(google_workspace.execute_tool, fn_name, arguments, session_id)
                            tool_output = json.dumps(result, ensure_ascii=False, default=str)
                        yield {"event": "tool_done", "data": json.dumps({"tool": fn_name, "result": "Awaiting approval" if fn_name == "gmail_send_email" else "Completed; inspect tool output for results or partial errors"})}
                    except Exception as error:
                        logger.warning("Workspace tool %s failed: %s", fn_name, error)
                        tool_output = json.dumps({"error": str(error), "instruction": "Do not claim success or automatically repeat mutations; inspect provider state first if execution was uncertain."})
                        yield {"event": "tool_done", "data": json.dumps({"tool": fn_name, "result": str(error)})}
                elif fn_name == "create_scheduled_event":
                    name = parsed_args.get("name", "Scheduled Event")
                    event_type = parsed_args.get("event_type", "one_shot")
                    prompt_str = parsed_args.get("prompt", "")
                    cron_expr = parsed_args.get("cron_expression")
                    run_at = parsed_args.get("run_at")
                    skill_id = parsed_args.get("skill_id")
                    tz_str = get_user_timezone_str()

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": f"Scheduling {event_type} event: {name}"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "create_scheduled_event", "query": f"{event_type}: {name}"}),
                    }

                    next_run_iso = compute_next_run(cron_expr=cron_expr, run_at=run_at, timezone_str=tz_str)
                    created = await loop.run_in_executor(
                        None,
                        db_create_scheduled_event,
                        name,
                        event_type,
                        prompt_str,
                        cron_expr,
                        run_at,
                        tz_str,
                        skill_id,
                        session_id,
                        "active",
                        next_run_iso,
                    )
                    tool_output = json.dumps({
                        "status": "created",
                        "event": created,
                        "next_run_at": next_run_iso,
                        "timezone": tz_str,
                    })
                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "create_scheduled_event", "result": f"Scheduled for {next_run_iso}"}),
                    }

                elif fn_name == "list_scheduled_events":
                    st = parsed_args.get("status")
                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Listing scheduled events"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "list_scheduled_events", "query": st or "all"}),
                    }
                    events = await loop.run_in_executor(None, db_list_scheduled_events, st)
                    tool_output = json.dumps({"count": len(events), "events": events})
                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "list_scheduled_events", "result": f"Found {len(events)} events"}),
                    }

                elif fn_name == "delete_scheduled_event":
                    ev_id = parsed_args.get("event_id", "")
                    yield {
                        "event": "status",
                        "data": json.dumps({"text": f"Deleting scheduled event {ev_id}"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "delete_scheduled_event", "query": ev_id}),
                    }
                    deleted = await loop.run_in_executor(None, db_delete_scheduled_event, ev_id)
                    tool_output = json.dumps({"event_id": ev_id, "deleted": deleted})
                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "delete_scheduled_event", "result": "Deleted" if deleted else "Not found"}),
                    }

                elif fn_name == "create_or_update_skill":
                    sk_id = parsed_args.get("skill_id", "")
                    sk_name = parsed_args.get("name", "")
                    sk_desc = parsed_args.get("description", "")
                    sk_instr = parsed_args.get("instructions", "")
                    sk_slash = parsed_args.get("slash_command")
                    sk_tools = parsed_args.get("allowed_tools")
                    sk_en = parsed_args.get("enabled", True)

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": f"Saving skill: {sk_name}"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "create_or_update_skill", "query": sk_id}),
                    }
                    saved_skill = await loop.run_in_executor(
                        None,
                        sm_create_or_update_skill,
                        sk_id,
                        sk_name,
                        sk_desc,
                        sk_instr,
                        sk_en,
                        sk_slash,
                        sk_tools,
                    )
                    tool_output = json.dumps({"status": "saved", "skill": saved_skill})
                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "create_or_update_skill", "result": f"Saved {sk_id}"}),
                    }

                elif fn_name == "list_skills":
                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Listing skills"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "list_skills", "query": "all"}),
                    }
                    skills = await loop.run_in_executor(None, sm_list_skills)
                    tool_output = json.dumps({"count": len(skills), "skills": skills})
                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "list_skills", "result": f"Found {len(skills)} skills"}),
                    }

                elif fn_name == "delete_skill":
                    sk_id = parsed_args.get("skill_id", "")
                    yield {
                        "event": "status",
                        "data": json.dumps({"text": f"Deleting skill {sk_id}"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "delete_skill", "query": sk_id}),
                    }
                    del_ok = await loop.run_in_executor(None, sm_delete_skill, sk_id)
                    tool_output = json.dumps({"skill_id": sk_id, "deleted": del_ok})
                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "delete_skill", "result": "Deleted" if del_ok else "Not found"}),
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
        if active_tool_calls:
            yield {"event": "error", "data": json.dumps({"error": "Tool iteration limit reached. Partial response and completed tool actions are saved."})}
            return
        done_payload: Dict[str, Any] = {
            "text": full_assistant_text,
            "usage": total_usage,
            "tool_context": current_input[len(input_items):],
        }
        if last_proposal:
            done_payload["thread_proposal"] = last_proposal
        if last_artifact:
            done_payload["artifact"] = last_artifact
            done_payload["artifact_id"] = last_artifact.get("id")
        if last_staged_action:
            done_payload["staged_action"] = last_staged_action

        yield {
            "event": "done",
            "data": json.dumps(done_payload),
        }
