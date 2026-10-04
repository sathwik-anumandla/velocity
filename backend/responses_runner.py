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
from backend.tavily_tool import TavilySearchTool, TAVILY_TOOL_DEFINITION
from backend.hindsight import HindsightClient
from backend.database import (
    create_artifact as db_create_artifact,
    update_artifact as db_update_artifact,
    create_staged_action as db_create_staged_action,
)
from backend.google_service import google_workspace
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

GCAL_LIST_EVENTS_TOOL_DEFINITION = {
    "type": "function",
    "name": "gcal_list_events",
    "description": (
        "List events from Google Calendar. Use this when Sathwik asks about schedule, "
        "agenda, availability, meetings, or free slots for today or upcoming days."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "time_min": {
                "type": "string",
                "description": "ISO 8601 start timestamp (e.g. 2026-10-04T00:00:00Z). Defaults to current time if omitted.",
            },
            "time_max": {
                "type": "string",
                "description": "ISO 8601 end timestamp (e.g. 2026-10-05T23:59:59Z). Defaults to 48 hours ahead if omitted.",
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum number of events to return (default: 10).",
            },
        },
        "additionalProperties": False,
    },
}

GCAL_CREATE_EVENT_TOOL_DEFINITION = {
    "type": "function",
    "name": "gcal_create_event",
    "description": (
        "Create an event on Google Calendar. Automatically schedules meetings, discussions, "
        "or timeblocks directly without blocking for confirmation."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": "Title or summary of the calendar event.",
            },
            "start_time": {
                "type": "string",
                "description": "ISO 8601 start datetime string, e.g. '2026-10-05T14:00:00Z'.",
            },
            "end_time": {
                "type": "string",
                "description": "ISO 8601 end datetime string, e.g. '2026-10-05T15:00:00Z'.",
            },
            "description": {
                "type": "string",
                "description": "Optional agenda, notes, or details for the event.",
            },
            "attendees": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional list of attendee email addresses to invite.",
            },
            "add_meet": {
                "type": "boolean",
                "description": "Whether to generate a Google Meet video conference link (default: true).",
            },
        },
        "required": ["summary", "start_time", "end_time"],
        "additionalProperties": False,
    },
}

GCAL_DELETE_EVENT_TOOL_DEFINITION = {
    "type": "function",
    "name": "gcal_delete_event",
    "description": "Delete a calendar event from Google Calendar by its event ID.",
    "parameters": {
        "type": "object",
        "properties": {
            "event_id": {
                "type": "string",
                "description": "The unique event ID of the calendar event to delete.",
            },
        },
        "required": ["event_id"],
        "additionalProperties": False,
    },
}

GTASKS_LIST_TASKS_TOOL_DEFINITION = {
    "type": "function",
    "name": "gtasks_list_tasks",
    "description": (
        "List to-do items from Google Tasks. Use when Sathwik asks about tasks, todos, "
        "action items, or pending work."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "include_completed": {
                "type": "boolean",
                "description": "Whether to include completed tasks (default: false).",
            },
            "due_max": {
                "type": "string",
                "description": "Optional ISO timestamp to filter tasks due before this time.",
            },
        },
        "additionalProperties": False,
    },
}

GTASKS_CREATE_TASK_TOOL_DEFINITION = {
    "type": "function",
    "name": "gtasks_create_task",
    "description": (
        "Create a new task in Google Tasks. Automatically captures to-dos, action items, "
        "and deadlines without blocking for confirmation."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "The title or description of the task.",
            },
            "notes": {
                "type": "string",
                "description": "Optional notes, details, or checklist items.",
            },
            "due": {
                "type": "string",
                "description": "Optional due date in ISO 8601 format (e.g. '2026-10-06T18:00:00Z' or '2026-10-06').",
            },
        },
        "required": ["title"],
        "additionalProperties": False,
    },
}

GTASKS_COMPLETE_TASK_TOOL_DEFINITION = {
    "type": "function",
    "name": "gtasks_complete_task",
    "description": "Mark a task as completed in Google Tasks by its task ID.",
    "parameters": {
        "type": "object",
        "properties": {
            "task_id": {
                "type": "string",
                "description": "The unique ID of the Google task to mark as completed.",
            },
        },
        "required": ["task_id"],
        "additionalProperties": False,
    },
}

GMAIL_LIST_UNREAD_TOOL_DEFINITION = {
    "type": "function",
    "name": "gmail_list_unread",
    "description": (
        "List recent unread emails and summaries from Gmail. "
        "Use when Sathwik asks about new emails, inbox status, or message digests."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query for filtering emails (default: 'is:unread category:primary').",
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum number of messages to return (default: 5).",
            },
        },
        "additionalProperties": False,
    },
}

GMAIL_CREATE_DRAFT_TOOL_DEFINITION = {
    "type": "function",
    "name": "gmail_create_draft",
    "description": (
        "Create a draft email in Gmail. Safely prepares the email without sending it to recipients. "
        "Use when Sathwik wants to draft, write, or stage an email."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "to": {
                "type": "string",
                "description": "Recipient email address.",
            },
            "subject": {
                "type": "string",
                "description": "Email subject line.",
            },
            "body": {
                "type": "string",
                "description": "Body content of the email.",
            },
        },
        "required": ["to", "subject", "body"],
        "additionalProperties": False,
    },
}

GMAIL_SEND_EMAIL_TOOL_DEFINITION = {
    "type": "function",
    "name": "gmail_send_email",
    "description": (
        "Stage sending an email via Gmail to external recipients. "
        "IMPORTANT: This tool will NOT immediately send the message. "
        "It generates an interactive confirmation card for Sathwik with Send and Decline buttons. "
        "Only when Sathwik clicks Send will the message be transmitted."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "to": {
                "type": "string",
                "description": "Recipient email address.",
            },
            "subject": {
                "type": "string",
                "description": "Subject line of the email.",
            },
            "body": {
                "type": "string",
                "description": "Full body text of the email.",
            },
        },
        "required": ["to", "subject", "body"],
        "additionalProperties": False,
    },
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
        is_thread: bool = False,
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

        # Side Chat proposal tool (available on main timeline only)
        if not is_thread:
            tools.append(PROPOSE_SIDE_CHAT_TOOL_DEFINITION)

        # Artifact Canvas tools (available in both main timeline and side chats)
        tools.append(CREATE_ARTIFACT_TOOL_DEFINITION)
        tools.append(UPDATE_ARTIFACT_TOOL_DEFINITION)

        # Google Workspace tools (available if connected)
        if google_workspace.is_connected():
            tools.append(GCAL_LIST_EVENTS_TOOL_DEFINITION)
            tools.append(GCAL_CREATE_EVENT_TOOL_DEFINITION)
            tools.append(GCAL_DELETE_EVENT_TOOL_DEFINITION)
            tools.append(GTASKS_LIST_TASKS_TOOL_DEFINITION)
            tools.append(GTASKS_CREATE_TASK_TOOL_DEFINITION)
            tools.append(GTASKS_COMPLETE_TASK_TOOL_DEFINITION)
            tools.append(GMAIL_LIST_UNREAD_TOOL_DEFINITION)
            tools.append(GMAIL_CREATE_DRAFT_TOOL_DEFINITION)
            tools.append(GMAIL_SEND_EMAIL_TOOL_DEFINITION)

        full_assistant_text = ""
        total_usage: Dict[str, Any] = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        last_proposal: Optional[Dict[str, Any]] = None
        last_artifact: Optional[Dict[str, Any]] = None
        last_staged_action: Optional[Dict[str, Any]] = None
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
                        f"[Proposed side chat '{title}' to Sathwik. "
                        "A proposal card is now displayed in the UI. "
                        "Provide a brief 1-2 sentence overview of why branching here keeps things clean "
                        "and what will be tackled in the side chat.]"
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

                elif fn_name == "gcal_list_events":
                    time_min, time_max, max_results = None, None, 10
                    try:
                        parsed_args = json.loads(fn_args_raw) if fn_args_raw else {}
                        time_min = parsed_args.get("time_min")
                        time_max = parsed_args.get("time_max")
                        max_results = int(parsed_args.get("max_results", 10))
                    except Exception:
                        pass

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Checking calendar"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "gcal_list_events", "query": "Upcoming calendar events"}),
                    }

                    try:
                        events = await loop.run_in_executor(
                            None, google_workspace.list_calendar_events, time_min, time_max, max_results
                        )
                        if events:
                            lines = []
                            for ev in events:
                                s = f"- {ev['summary']} ({ev['start']} to {ev['end']})"
                                if ev.get("meet_link"):
                                    s += f" [Meet: {ev['meet_link']}]"
                                if ev.get("attendees"):
                                    s += f" [Attendees: {', '.join(ev['attendees'])}]"
                                lines.append(s)
                            tool_output = f"[Google Calendar Events ({len(events)})]:\n" + "\n".join(lines)
                            result_msg = f"{len(events)} events found"
                        else:
                            tool_output = "[No calendar events found in the requested time window]"
                            result_msg = "No events"
                    except Exception as ge:
                        tool_output = f"[Failed to list calendar events: {str(ge)}]"
                        result_msg = "Error"

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "gcal_list_events", "result": result_msg}),
                    }

                elif fn_name == "gcal_create_event":
                    summary, start_time, end_time = "", "", ""
                    description, attendees, add_meet = None, None, True
                    try:
                        parsed_args = json.loads(fn_args_raw) if fn_args_raw else {}
                        summary = parsed_args.get("summary", "")
                        start_time = parsed_args.get("start_time", "")
                        end_time = parsed_args.get("end_time", "")
                        description = parsed_args.get("description")
                        attendees = parsed_args.get("attendees")
                        add_meet = bool(parsed_args.get("add_meet", True))
                    except Exception:
                        pass

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Scheduling event"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "gcal_create_event", "query": summary}),
                    }

                    try:
                        created = await loop.run_in_executor(
                            None,
                            google_workspace.create_calendar_event,
                            summary,
                            start_time,
                            end_time,
                            description,
                            attendees,
                            add_meet,
                        )
                        tool_output = (
                            f"[Successfully created calendar event '{summary}' from {start_time} to {end_time}. "
                            f"Meet link: {created.get('meet_link') or 'None'}. ID: {created.get('id')}]"
                        )
                        result_msg = f"Created: {summary}"
                    except Exception as ge:
                        tool_output = f"[Failed to create calendar event: {str(ge)}]"
                        result_msg = "Error"

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "gcal_create_event", "result": result_msg}),
                    }

                elif fn_name == "gcal_delete_event":
                    event_id = ""
                    try:
                        parsed_args = json.loads(fn_args_raw) if fn_args_raw else {}
                        event_id = parsed_args.get("event_id", "")
                    except Exception:
                        event_id = fn_args_raw

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Deleting event"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "gcal_delete_event", "query": event_id}),
                    }

                    try:
                        res = await loop.run_in_executor(None, google_workspace.delete_calendar_event, event_id)
                        tool_output = f"[Deleted calendar event {event_id}]"
                        result_msg = "Deleted"
                    except Exception as ge:
                        tool_output = f"[Failed to delete calendar event: {str(ge)}]"
                        result_msg = "Error"

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "gcal_delete_event", "result": result_msg}),
                    }

                elif fn_name == "gtasks_list_tasks":
                    include_completed, due_max = False, None
                    try:
                        parsed_args = json.loads(fn_args_raw) if fn_args_raw else {}
                        include_completed = bool(parsed_args.get("include_completed", False))
                        due_max = parsed_args.get("due_max")
                    except Exception:
                        pass

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Checking tasks"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "gtasks_list_tasks", "query": "Pending tasks"}),
                    }

                    try:
                        tasks = await loop.run_in_executor(
                            None, google_workspace.list_tasks, include_completed, due_max
                        )
                        if tasks:
                            lines = []
                            for t in tasks:
                                line = f"- [{t['status']}] {t['title']} (ID: {t['id']})"
                                if t.get("due"):
                                    line += f" [Due: {t['due']}]"
                                if t.get("notes"):
                                    line += f" - Notes: {t['notes']}"
                                lines.append(line)
                            tool_output = f"[Google Tasks ({len(tasks)})]:\n" + "\n".join(lines)
                            result_msg = f"{len(tasks)} tasks found"
                        else:
                            tool_output = "[No tasks found in Google Tasks]"
                            result_msg = "No tasks"
                    except Exception as ge:
                        tool_output = f"[Failed to list tasks: {str(ge)}]"
                        result_msg = "Error"

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "gtasks_list_tasks", "result": result_msg}),
                    }

                elif fn_name == "gtasks_create_task":
                    title, notes, due = "", None, None
                    try:
                        parsed_args = json.loads(fn_args_raw) if fn_args_raw else {}
                        title = parsed_args.get("title", "")
                        notes = parsed_args.get("notes")
                        due = parsed_args.get("due")
                    except Exception:
                        pass

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Creating task"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "gtasks_create_task", "query": title}),
                    }

                    try:
                        created_task = await loop.run_in_executor(
                            None, google_workspace.create_task, title, notes, due
                        )
                        tool_output = f"[Created Google Task '{title}' (ID: {created_task.get('id')})]"
                        result_msg = f"Created: {title}"
                    except Exception as ge:
                        tool_output = f"[Failed to create task: {str(ge)}]"
                        result_msg = "Error"

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "gtasks_create_task", "result": result_msg}),
                    }

                elif fn_name == "gtasks_complete_task":
                    task_id = ""
                    try:
                        parsed_args = json.loads(fn_args_raw) if fn_args_raw else {}
                        task_id = parsed_args.get("task_id", "")
                    except Exception:
                        task_id = fn_args_raw

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Completing task"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "gtasks_complete_task", "query": task_id}),
                    }

                    try:
                        done_task = await loop.run_in_executor(
                            None, google_workspace.complete_task, task_id
                        )
                        tool_output = f"[Marked task '{done_task.get('title')}' as completed]"
                        result_msg = "Completed"
                    except Exception as ge:
                        tool_output = f"[Failed to complete task: {str(ge)}]"
                        result_msg = "Error"

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "gtasks_complete_task", "result": result_msg}),
                    }

                elif fn_name == "gmail_list_unread":
                    query, max_results = "is:unread category:primary", 5
                    try:
                        parsed_args = json.loads(fn_args_raw) if fn_args_raw else {}
                        query = parsed_args.get("query", "is:unread category:primary")
                        max_results = int(parsed_args.get("max_results", 5))
                    except Exception:
                        pass

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Checking emails"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "gmail_list_unread", "query": query}),
                    }

                    try:
                        emails = await loop.run_in_executor(
                            None, google_workspace.list_unread_emails, query, max_results
                        )
                        if emails:
                            lines = []
                            for em in emails:
                                lines.append(
                                    f"- From: {em['from']} | Subject: '{em['subject']}' | Snippet: {em['snippet']} (ID: {em['id']})"
                                )
                            tool_output = f"[Unread Gmail Messages ({len(emails)})]:\n" + "\n".join(lines)
                            result_msg = f"{len(emails)} emails found"
                        else:
                            tool_output = "[No unread emails found matching criteria]"
                            result_msg = "No unread"
                    except Exception as ge:
                        tool_output = f"[Failed to read Gmail: {str(ge)}]"
                        result_msg = "Error"

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "gmail_list_unread", "result": result_msg}),
                    }

                elif fn_name == "gmail_create_draft":
                    to, subject, body = "", "", ""
                    try:
                        parsed_args = json.loads(fn_args_raw) if fn_args_raw else {}
                        to = parsed_args.get("to", "")
                        subject = parsed_args.get("subject", "")
                        body = parsed_args.get("body", "")
                    except Exception:
                        pass

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Drafting email"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "gmail_create_draft", "query": f"Draft to {to}"}),
                    }

                    try:
                        draft = await loop.run_in_executor(
                            None, google_workspace.create_draft, to, subject, body
                        )
                        tool_output = f"[Created Gmail draft (Draft ID: {draft.get('id')}) to '{to}' with subject '{subject}']"
                        result_msg = f"Drafted: {subject}"
                    except Exception as ge:
                        tool_output = f"[Failed to create Gmail draft: {str(ge)}]"
                        result_msg = "Error"

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "gmail_create_draft", "result": result_msg}),
                    }

                elif fn_name == "gmail_send_email":
                    to, subject, body = "", "", ""
                    try:
                        parsed_args = json.loads(fn_args_raw) if fn_args_raw else {}
                        to = parsed_args.get("to", "")
                        subject = parsed_args.get("subject", "")
                        body = parsed_args.get("body", "")
                    except Exception:
                        pass

                    yield {
                        "event": "status",
                        "data": json.dumps({"text": "Staging email for confirmation"}),
                    }
                    yield {
                        "event": "tool_start",
                        "data": json.dumps({"tool": "gmail_send_email", "query": f"Send email to {to}"}),
                    }

                    action_id = f"act_{uuid.uuid4().hex[:12]}"
                    action_payload = {
                        "id": action_id,
                        "session_id": session_id,
                        "provider": "gmail",
                        "action_type": "send_email",
                        "parameters": {
                            "to": to,
                            "subject": subject,
                            "body": body,
                        },
                        "status": "pending",
                    }

                    await loop.run_in_executor(
                        None,
                        db_create_staged_action,
                        action_id,
                        session_id,
                        "gmail",
                        "send_email",
                        action_payload["parameters"],
                        None,
                    )
                    last_staged_action = action_payload

                    yield {
                        "event": "action_proposal",
                        "data": json.dumps(action_payload),
                    }

                    tool_output = (
                        f"[Action staged for user confirmation: ID {action_id}. "
                        "An interactive approval card has been displayed to Sathwik with Send and Decline options. "
                        "Inform Sathwik that the email is drafted and staged, waiting for their confirmation to send.]"
                    )

                    yield {
                        "event": "tool_done",
                        "data": json.dumps({"tool": "gmail_send_email", "result": f"Staged: {subject}"}),
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
        done_payload: Dict[str, Any] = {
            "text": full_assistant_text,
            "usage": total_usage,
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

