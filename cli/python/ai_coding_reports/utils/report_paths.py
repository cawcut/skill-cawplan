"""Paths and cleanup helpers for Outputs/reports daily pipeline."""

from __future__ import annotations

import shutil
from pathlib import Path

ALL_REPORT_AGENTS = ("claude-code", "cursor", "codex")


def report_day_dir(repo_root: str | Path, date_str: str) -> Path:
    return Path(repo_root) / "Outputs" / "reports" / date_str


def clean_report_day_dir(repo_root: str | Path, date_str: str) -> None:
    """Remove Outputs/reports/{date}/ (session JSON, chunks, summaries, daily.json)."""
    day_dir = report_day_dir(repo_root, date_str)
    if day_dir.is_dir():
        shutil.rmtree(day_dir)


def session_file_matches_agent(filename: str, agent: str) -> bool:
    if agent == "claude-code":
        return filename.startswith("claude-code-")
    if agent == "codex":
        return filename.startswith("codex-")
    if agent == "cursor":
        return filename.startswith("cursor-") or filename.startswith("cursor-gui-")
    return False


def list_session_files(day_dir: Path, agents: list[str] | None = None) -> list[Path]:
    """Session JSON files in day_dir, optionally filtered by agent."""
    def _looks_like_session_file(name: str) -> bool:
        return (
            name.startswith("claude-code-")
            or name.startswith("codex-")
            or name.startswith("cursor-")
            or name.startswith("cursor-gui-")
        )

    all_files = sorted(
        f for f in day_dir.glob("*.json")
        if _looks_like_session_file(f.name)
    )
    if not agents:
        return all_files
    allowed = set(agents)
    return [
        f for f in all_files
        if any(session_file_matches_agent(f.name, a) for a in allowed)
    ]


def resolve_export_agents(agents: tuple[str, ...] | list[str] | None) -> list[str]:
    if agents:
        return list(agents)
    return list(ALL_REPORT_AGENTS)
