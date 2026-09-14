"""
Pydantic Schemas for Velocity API
"""

from typing import Optional, List, Literal, Dict, Any
from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    session_id: str
    message: str
    recall_budget: Optional[Literal["low", "medium", "high"]] = None
    thinking_effort: Optional[Literal["low", "medium", "high"]] = None
    verbosity: Optional[Literal["low", "medium", "high"]] = None
    is_temporary: bool = False


class SessionCreate(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    recall_budget: Literal["low", "medium", "high"] = "medium"
    thinking_effort: Literal["low", "medium", "high"] = "medium"
    verbosity: Literal["low", "medium", "high"] = "low"


class SessionUpdate(BaseModel):
    name: Optional[str] = None
    recall_budget: Optional[Literal["low", "medium", "high"]] = None
    thinking_effort: Optional[Literal["low", "medium", "high"]] = None
    verbosity: Optional[Literal["low", "medium", "high"]] = None


class SessionResponse(BaseModel):
    id: str
    name: str
    recall_budget: str
    thinking_effort: str
    verbosity: str = "low"
    created_at: str
    updated_at: str


class MessageResponse(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    memory_status: str
    created_at: str


class SearchResult(BaseModel):
    message_id: str
    session_id: str
    session_name: str
    role: str
    content: str
    memory_status: str
    created_at: str
    snippet: str
