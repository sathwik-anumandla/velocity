"""
Pydantic Schemas for Velocity API
"""

from typing import Optional, List, Literal, Dict, Any
from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    session_id: str
    message: str
    message_id: Optional[str] = None
    recall_budget: Optional[Literal["low", "medium", "high"]] = None
    thinking_effort: Optional[Literal["none", "low", "medium", "high", "xhigh", "max"]] = None
    verbosity: Optional[Literal["low", "medium", "high"]] = None
    model: Optional[Literal["gpt-5.4-mini", "gpt-5.4"]] = None
    is_temporary: bool = False


class SessionCreate(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    recall_budget: Literal["low", "medium", "high"] = "medium"
    thinking_effort: Literal["none", "low", "medium", "high", "xhigh", "max"] = "medium"
    verbosity: Literal["low", "medium", "high"] = "low"
    model: Literal["gpt-5.4-mini", "gpt-5.4"] = "gpt-5.4-mini"


class SessionUpdate(BaseModel):
    name: Optional[str] = None
    recall_budget: Optional[Literal["low", "medium", "high"]] = None
    thinking_effort: Optional[Literal["none", "low", "medium", "high", "xhigh", "max"]] = None
    verbosity: Optional[Literal["low", "medium", "high"]] = None
    model: Optional[Literal["gpt-5.4-mini", "gpt-5.4"]] = None


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

