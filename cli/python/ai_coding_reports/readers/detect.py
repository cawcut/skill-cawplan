"""Agent type detection from environment signals."""

from __future__ import annotations

import os

from ai_coding_reports.readers.agent_paths import codex_state_db

EXPORT_SCRIPTS: dict[str, str] = {
    "cursor": "export_cursor_session_data.py",
    "claude-code": "export_claude_code_session_data.py",
    "codex": "export_codex_session_data.py",
}


def _has_codex() -> bool:
    return codex_state_db().is_file()


def _is_cursor_agent() -> bool:
    return os.environ.get("CURSOR_AGENT") == "1"


def detect(prefer: str | None = None) -> str | None:
    """Detect which AI coding agent is active.

    Order: --prefer > CURSOR_AGENT > CLAUDE_CODE_SESSION_ID > CODEX_SESSION+state_5.
    Returns 'cursor', 'claude-code', 'codex', or None.
    """
    if prefer in EXPORT_SCRIPTS:
        return prefer
    if _is_cursor_agent():
        return "cursor"
    if os.environ.get("CLAUDE_CODE_SESSION_ID"):
        return "claude-code"
    if os.environ.get("CODEX_SESSION") and _has_codex():
        return "codex"
    return None


def detect_signals() -> dict:
    """Return the raw environment signals for debugging."""
    return {
        "CURSOR_AGENT": os.environ.get("CURSOR_AGENT"),
        "CURSOR_INVOKED_AS": os.environ.get("CURSOR_INVOKED_AS"),
        "CLAUDE_CODE_SESSION_ID": bool(os.environ.get("CLAUDE_CODE_SESSION_ID")),
        "CODEX_SESSION": bool(os.environ.get("CODEX_SESSION")),
    }
