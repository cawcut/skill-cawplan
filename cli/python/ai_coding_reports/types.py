"""Shared type definitions for AI Coding Reports."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import TypedDict


class AgentType(str, Enum):
    CURSOR = "cursor"
    CLAUDE_CODE = "claude-code"
    CODEX = "codex"


# ---------------------------------------------------------------------------
# Data source references
# ---------------------------------------------------------------------------


@dataclass
class CursorSessionRef:
    """Identifies a Cursor session by transcript + optional store.db."""

    session_id: str
    transcript_path: Path
    project_slug: str
    store_db_path: Path | None = None
    session_name: str | None = None
    mtime: float = 0.0


@dataclass
class SessionInfo:
    """Generic session metadata."""

    session_id: str
    session_name: str
    agent: str
    model: str
    project: str
    cwd: str
    time_range: dict | None = None


# ---------------------------------------------------------------------------
# Metric types
# ---------------------------------------------------------------------------


class MessageStats(TypedDict, total=False):
    user: int
    assistant: int
    tool_calls: int


class ModelUsageEntry(TypedDict, total=False):
    api_calls: int
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int
    cache_creation_input_tokens: int
    cost: float | str
    currency: str
    note: str


class FileChange(TypedDict):
    path: str
    added: int
    deleted: int
    repo: str


class RepoTouched(TypedDict):
    repo: str
    files: int
    added: int
    deleted: int


class TokenEstimation(TypedDict):
    token_source: str
    estimation_method: str
    input_chars: int
    output_chars: int
    estimated_input_tokens: int
    estimated_output_tokens: int
    estimated_total_tokens: int


class TimelineEntry(TypedDict):
    session_id: str
    session_name: str
    preview: str


# ---------------------------------------------------------------------------
# Usage API types (Cursor dashboard)
# ---------------------------------------------------------------------------


class UsageBucket(TypedDict):
    events: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    total_tokens: int
    token_cents: float
    cursor_fee_cents: float
    charged_cents: float


# ---------------------------------------------------------------------------
# Export protocol types
# ---------------------------------------------------------------------------


class ExportStats(TypedDict, total=False):
    message_count: int
    user_messages: int
    assistant_messages: int
    tool_messages: int
    system_messages: int
    output_messages: int
    conv_message_count: int
    data_size_bytes: int
    tokens_used: int
    token_source: str
    estimated_input_tokens: int
    estimated_output_tokens: int
    token_estimation_method: str
    tool_breakdown: dict[str, int] | None
    skill_breakdown: dict[str, int] | None


@dataclass
class ExportMeta:
    version: str = "1.0"
    agent: str = ""
    session_id: str = ""
    session_name: str = ""
    model: str = ""
    created_at: str = ""
    stats: ExportStats = field(default_factory=dict)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Report types
# ---------------------------------------------------------------------------


@dataclass
class DailySessionEntry:
    date: str = ""
    agent: str = ""
    session_id: str = ""
    session_name: str = ""
    time_range: dict | None = None
    project: str = ""
    model_usage: dict[str, ModelUsageEntry] = field(default_factory=dict)
    repos: list[RepoTouched] = field(default_factory=list)
    files_changed_count: int = 0
    skills: list[str] = field(default_factory=list)
    message_stats: MessageStats = field(default_factory=dict)  # type: ignore[arg-type]
    timeline_count: int = 0


@dataclass
class DailyReport:
    report_type: str = "daily"
    date: str = ""
    author: str = ""
    generated_at: str = ""
    totals: dict = field(default_factory=dict)
    model_usage_combined: dict = field(default_factory=dict)
    repos_combined: list = field(default_factory=list)
    skills_combined: list = field(default_factory=list)
    sessions: list[DailySessionEntry] = field(default_factory=list)


@dataclass
class WeeklyReport:
    report_type: str = "weekly"
    week: str = ""
    date_range: str = ""
    year: int = 0
    author: str = ""
    generated_at: str = ""
    totals: dict = field(default_factory=dict)
    model_usage_combined: dict = field(default_factory=dict)
    repos_combined: list = field(default_factory=list)
    skills_combined: list = field(default_factory=list)
    daily_breakdown: dict = field(default_factory=dict)
    sessions: list = field(default_factory=list)
