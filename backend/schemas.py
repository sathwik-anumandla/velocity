"""
Pydantic Schemas for Velocity API
"""

from typing import Optional, List, Literal, Dict, Any
from pydantic import BaseModel, Field, field_validator


def _norm_model(v: Any) -> Optional[str]:
    if v is None:
        return None
    s = str(v).lower().strip()
    if not s:
        return "gpt-5.4-mini"
    if "mini" in s:
        return "gpt-5.4-mini"
    if any(k in s for k in ["gpt-5", "o1", "o3", "flagship", "4.5"]):
        return "gpt-5.4"
    if s in ["gpt-5.4-mini", "gpt-5.4"]:
        return s
    return "gpt-5.4-mini"


def _norm_verbosity(v: Any) -> Optional[str]:
    if v is None:
        return None
    s = str(v).lower().strip()
    if s in ["concise", "low"]:
        return "low"
    if s in ["comprehensive", "high", "exhaustive"]:
        return "high"
    return "medium"


def _norm_effort(v: Any) -> Optional[str]:
    if v is None:
        return None
    s = str(v).lower().strip()
    if s in ["none", "low", "medium", "high", "xhigh", "max"]:
        return s
    return "medium"


def _norm_recall(v: Any) -> Optional[str]:
    if v is None:
        return None
    s = str(v).lower().strip()
    if s in ["low", "medium", "high"]:
        return s
    return "medium"


class ChatRequest(BaseModel):
    session_id: str
    message: str = Field(min_length=1)
    message_id: Optional[str] = None
    recall_budget: Optional[str] = None
    thinking_effort: Optional[str] = None
    verbosity: Optional[str] = None
    model: Optional[str] = None
    is_temporary: bool = False
    regeneration_context: Optional[str] = Field(default=None, max_length=30000)

    @field_validator("message")
    @classmethod
    def val_message(cls, value):
        if not value.strip():
            raise ValueError("Message cannot be blank")
        return value

    @field_validator("model", mode="before")
    @classmethod
    def val_model(cls, v):
        return _norm_model(v)

    @field_validator("verbosity", mode="before")
    @classmethod
    def val_verbosity(cls, v):
        return _norm_verbosity(v)

    @field_validator("thinking_effort", mode="before")
    @classmethod
    def val_effort(cls, v):
        return _norm_effort(v)

    @field_validator("recall_budget", mode="before")
    @classmethod
    def val_recall(cls, v):
        return _norm_recall(v)


class SessionCreate(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    recall_budget: str = "medium"
    thinking_effort: str = "medium"
    verbosity: str = "low"
    model: str = "gpt-5.4-mini"

    @field_validator("model", mode="before")
    @classmethod
    def val_model(cls, v):
        return _norm_model(v) or "gpt-5.4-mini"

    @field_validator("verbosity", mode="before")
    @classmethod
    def val_verbosity(cls, v):
        return _norm_verbosity(v) or "low"

    @field_validator("thinking_effort", mode="before")
    @classmethod
    def val_effort(cls, v):
        return _norm_effort(v) or "medium"

    @field_validator("recall_budget", mode="before")
    @classmethod
    def val_recall(cls, v):
        return _norm_recall(v) or "medium"


class SessionUpdate(BaseModel):
    name: Optional[str] = None
    recall_budget: Optional[str] = None
    thinking_effort: Optional[str] = None
    verbosity: Optional[str] = None
    model: Optional[str] = None

    @field_validator("model", mode="before")
    @classmethod
    def val_model(cls, v):
        return _norm_model(v)

    @field_validator("verbosity", mode="before")
    @classmethod
    def val_verbosity(cls, v):
        return _norm_verbosity(v)

    @field_validator("thinking_effort", mode="before")
    @classmethod
    def val_effort(cls, v):
        return _norm_effort(v)

    @field_validator("recall_budget", mode="before")
    @classmethod
    def val_recall(cls, v):
        return _norm_recall(v)


class SessionResponse(BaseModel):
    id: str
    name: str
    recall_budget: str
    thinking_effort: str
    verbosity: str = "low"
    model: str = "gpt-5.4-mini"
    is_thread: Optional[int] = 0
    parent_session_id: Optional[str] = None
    created_at: str
    updated_at: str


class MessageResponse(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    memory_status: str
    created_at: str
    thread_id: Optional[str] = None
    thread_proposal: Optional[str] = None
    artifact_id: Optional[str] = None
    artifact: Optional[Dict[str, Any]] = None
    turn_id: Optional[str] = None
    turn_status: Optional[str] = None
    staged_action: Optional[Dict[str, Any]] = None


class ArtifactCreate(BaseModel):
    title: str
    artifact_type: str = "document"
    language: str = "markdown"
    content: str
    summary: Optional[str] = None
    session_id: Optional[str] = "main"
    message_id: Optional[str] = None


class ArtifactUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    summary: Optional[str] = None


class ArtifactResponse(BaseModel):
    id: str
    session_id: str
    message_id: Optional[str] = None
    title: str
    artifact_type: str
    language: Optional[str] = "markdown"
    content: str
    summary: Optional[str] = None
    version: int = 1
    file_path: Optional[str] = None
    created_at: str
    updated_at: str


class SearchResult(BaseModel):
    message_id: str
    session_id: str
    session_name: str
    role: str
    content: str
    memory_status: str
    created_at: str
    snippet: str


class ThreadCreate(BaseModel):
    name: str
    parent_message_id: Optional[str] = None
    parent_session_id: str = "main"
    model: str = "gpt-5.4-mini"
    initial_summary: Optional[str] = None


class ThreadUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    rollup_summary: Optional[str] = None


class ThreadResponse(BaseModel):
    id: str
    name: str
    is_thread: int = 1
    parent_session_id: Optional[str] = None
    parent_message_id: Optional[str] = None
    status: str
    rollup_summary: Optional[str] = None
    model: str = "gpt-5.4-mini"
    created_at: str
    updated_at: str
    message_count: Optional[int] = 0


class ProposalResponseAction(BaseModel):
    action: Literal["accept", "decline"]


# ==============================================================================
# Phase 4: Integrations & Staged Actions Schemas
# ==============================================================================

class IntegrationServiceStatus(BaseModel):
    calendar: bool = False
    tasks: bool = False
    gmail: bool = False


class IntegrationStatusResponse(BaseModel):
    google_connected: bool = False
    google_user_email: Optional[str] = None
    services: IntegrationServiceStatus = IntegrationServiceStatus()
    updated_at: Optional[str] = None


class GoogleAuthUrlResponse(BaseModel):
    url: str


class StagedActionResponse(BaseModel):
    id: str
    session_id: str
    message_id: Optional[str] = None
    provider: str
    action_type: str
    parameters: Dict[str, Any]
    status: str
    result: Optional[Dict[str, Any]] = None
    created_at: str
    updated_at: str


class ActionRespondRequest(BaseModel):
    action: Literal["confirm", "decline"]


# ==============================================================================
# Phase 5: Scheduled Events & Skills Schemas (Proactive Engine)
# ==============================================================================

class ScheduledEventCreate(BaseModel):
    name: str
    event_type: Literal["recurring", "one_shot"]
    prompt: str
    cron_expression: Optional[str] = None
    run_at: Optional[str] = None
    timezone: str = "Asia/Kolkata"
    skill_id: Optional[str] = None
    session_id: str = "main"


class ScheduledEventUpdate(BaseModel):
    name: Optional[str] = None
    event_type: Optional[Literal["recurring", "one_shot"]] = None
    prompt: Optional[str] = None
    cron_expression: Optional[str] = None
    run_at: Optional[str] = None
    timezone: Optional[str] = None
    skill_id: Optional[str] = None
    status: Optional[Literal["active", "paused", "completed", "cancelled"]] = None


class ScheduledEventResponse(BaseModel):
    id: str
    name: str
    event_type: str
    cron_expression: Optional[str] = None
    run_at: Optional[str] = None
    timezone: str
    prompt: str
    skill_id: Optional[str] = None
    session_id: str
    status: str
    last_run_at: Optional[str] = None
    next_run_at: Optional[str] = None
    created_at: str
    updated_at: str


class SkillResponse(BaseModel):
    id: str
    name: str
    description: str
    enabled: bool = True
    slash_command: Optional[str] = None
    allowed_tools: List[str] = []
    memory_files: List[str] = []
    instructions: Optional[str] = None


class SkillCreateRequest(BaseModel):
    id: str
    name: str
    description: str
    enabled: bool = True
    slash_command: Optional[str] = None
    allowed_tools: List[str] = []
    memory_files: List[str] = []
    instructions: str


class SkillUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None
    slash_command: Optional[str] = None
    allowed_tools: Optional[List[str]] = None
    memory_files: Optional[List[str]] = None
    instructions: Optional[str] = None
