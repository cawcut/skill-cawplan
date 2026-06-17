"""Configurable data roots for Cursor, Claude Code, and Codex."""

from __future__ import annotations

import os
from pathlib import Path


def _expand(path: str | Path) -> Path:
    return Path(path).expanduser()


def cursor_home() -> Path:
    return _expand(os.environ.get("CURSOR_HOME", Path.home() / ".cursor"))


def cursor_chats_dir() -> Path:
    return cursor_home() / "chats"


def cursor_projects_dir() -> Path:
    return cursor_home() / "projects"


def claude_home() -> Path:
    return _expand(os.environ.get("CLAUDE_HOME", Path.home() / ".claude"))


def claude_projects_dir() -> Path:
    return claude_home() / "projects"


def claude_file_history_dir() -> Path:
    return claude_home() / "file-history"


def codex_home() -> Path:
    return _expand(os.environ.get("CODEX_HOME", Path.home() / ".codex"))


def codex_state_db() -> Path:
    return codex_home() / "state_5.sqlite"


def codex_sessions_dir() -> Path:
    return codex_home() / "sessions"


def cursor_usage_api_file(target_date) -> Path:
    return cursor_home() / f"usage-api-{target_date.isoformat()}.json"
