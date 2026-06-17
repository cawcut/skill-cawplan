"""Claude Code JSONL reader — session discovery and event parsing."""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path
from urllib.parse import unquote

from ai_coding_reports.utils.timezone import parse_iso_date

from ai_coding_reports.readers.agent_paths import claude_projects_dir


def decode_project_name(encoded: str) -> str:
    """Decode URL-encoded project path to readable form.

    Claude Code encodes absolute paths by replacing all non-alphanumeric
    characters with '-'. We dynamically strip the current machine's home
    directory prefix so the result shows a relative project path.
    """
    decoded = unquote(encoded)
    home_encoded = re.sub(r"[^a-zA-Z0-9]", "-", str(Path.home()))
    if decoded.startswith(home_encoded):
        decoded = decoded[len(home_encoded):]
    parts = [s for s in decoded.replace("-", "/").split("/") if s]
    return "/".join(parts[-3:]) if len(parts) >= 3 else "/".join(parts) if parts else decoded


def _jsonl_date_range(jsonl_path: str) -> tuple[date | None, date | None]:
    """Read first and last timestamps in a JSONL file."""
    try:
        with open(jsonl_path, "r", encoding="utf-8") as f:
            first_ts = None
            for line in f:
                try:
                    evt = json.loads(line)
                    ts = evt.get("timestamp", "")
                    if ts:
                        first_ts = parse_iso_date(ts)
                        break
                except json.JSONDecodeError:
                    continue
            if first_ts is None:
                return (None, None)

            f.seek(0, 2)
            file_size = f.tell()
            last_ts = None
            read_size = min(16384, file_size)
            if read_size > 0:
                f.seek(file_size - read_size)
                lines = f.read(read_size).split("\n")
                for line in reversed(lines):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        ts = json.loads(line).get("timestamp", "")
                        if ts:
                            last_ts = parse_iso_date(ts)
                            break
                    except json.JSONDecodeError:
                        pass
            return (first_ts, last_ts or first_ts)
    except Exception:
        return (None, None)


def find_session_jsonl(session_id: str | None = None) -> tuple[str, str]:
    """Find JSONL by session ID (default: $CLAUDE_CODE_SESSION_ID).

    Returns (jsonl_path, project_name).
    """
    if not session_id:
        session_id = os.environ.get("CLAUDE_CODE_SESSION_ID", "")
    if not session_id:
        print("Error: no session ID", file=sys.stderr)
        sys.exit(1)

    projects = claude_projects_dir()
    if not projects.is_dir():
        print(f"Error: projects dir not found {projects}", file=sys.stderr)
        sys.exit(1)

    for project_dir in projects.iterdir():
        if not project_dir.is_dir():
            continue
        jsonl_path = project_dir / f"{session_id}.jsonl"
        if jsonl_path.exists():
            return str(jsonl_path), decode_project_name(project_dir.name)

    print(f"Error: session {session_id} JSONL not found", file=sys.stderr)
    sys.exit(1)


def find_sessions_by_date(target_date: date, end_date: date | None = None) -> list[tuple[str, str, str]]:
    """Find all sessions active in a date range.

    When end_date is None, finds sessions active on target_date exactly (single day).
    When end_date is provided, finds sessions overlapping [target_date, end_date].

    Returns [(jsonl_path, project_name, session_id), ...].
    """
    projects = claude_projects_dir()
    if not projects.is_dir():
        print(f"Warning: Claude Code projects dir not found: {projects}", file=sys.stderr)
        return []

    sessions = []
    for project_dir in sorted(projects.iterdir()):
        if not project_dir.is_dir():
            continue
        for jsonl_file in sorted(project_dir.glob("*.jsonl")):
            first_d, last_d = _jsonl_date_range(str(jsonl_file))
            if first_d is None:
                continue
            last = last_d or first_d
            if end_date is None:
                if first_d <= target_date <= last:
                    sessions.append((str(jsonl_file), decode_project_name(project_dir.name), jsonl_file.stem))
            else:
                if first_d <= end_date and target_date <= last:
                    sessions.append((str(jsonl_file), decode_project_name(project_dir.name), jsonl_file.stem))

    return sessions


def parse_events(jsonl_path: str, filter_date: date | None = None, end_date: date | None = None) -> list[dict]:
    """Parse JSONL events, optionally filtered by date or date range."""
    events: list[dict] = []
    try:
        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    evt = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if filter_date:
                    ts = evt.get("timestamp", "")
                    if ts:
                        try:
                            evt_date = date.fromisoformat(ts[:10])
                            if end_date is None:
                                if evt_date != filter_date:
                                    continue
                            else:
                                if evt_date < filter_date or evt_date > end_date:
                                    continue
                        except ValueError:
                            pass

                events.append(evt)
    except (IOError, OSError) as e:
        print(f"Warning: failed to read JSONL: {e}", file=sys.stderr)

    return events


def parse_chat_messages(jsonl_path: str, filter_date: date | None = None) -> list[dict]:
    """Parse a Claude Code JSONL into chat-export message list."""
    messages: list[dict] = []
    try:
        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    evt = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if filter_date:
                    ts = evt.get("timestamp", "")
                    if ts:
                        try:
                            evt_date = date.fromisoformat(ts[:10])
                            if evt_date != filter_date:
                                continue
                        except ValueError:
                            pass

                t = evt.get("type", "")

                if t == "user":
                    msg = evt.get("message", {})
                    content = msg.get("content", "")
                    if not content:
                        continue
                    if isinstance(content, str):
                        stripped = content.strip()
                        if stripped.startswith("[{'type': 'tool_result'"):
                            continue
                        if stripped == "[Request interrupted by user for tool use]":
                            continue
                        if "<local-command-caveat>" in stripped[:200]:
                            continue
                    elif isinstance(content, list):
                        if any(
                            isinstance(c, dict) and c.get("type") == "tool_result"
                            for c in content
                        ):
                            continue
                    messages.append({"role": "user", "content": content})

                elif t == "assistant":
                    msg = evt.get("message", {})
                    content = msg.get("content", [])
                    if not isinstance(content, list):
                        continue
                    texts = []
                    tool_calls = []
                    for c in content:
                        ct = c.get("type", "")
                        if ct == "text":
                            texts.append(c.get("text", ""))
                        elif ct == "tool_use":
                            name = c.get("name", "?")
                            inp = c.get("input", {})
                            tool_calls.append(
                                f"[Tool: {name}] {json.dumps(inp, ensure_ascii=False)[:500]}"
                            )
                    if texts or tool_calls:
                        messages.append({
                            "role": "assistant",
                            "text": "\n\n".join(texts) if texts else "",
                            "tool_calls": tool_calls,
                        })

                elif t == "system":
                    sub = evt.get("subtype", "")
                    if sub == "init":
                        msg = evt.get("message", {})
                        content = msg.get("content", "")
                        if content:
                            messages.append({"role": "system", "content": content})

    except (IOError, OSError) as e:
        print(f"Warning: {jsonl_path}: {e}", file=sys.stderr)

    return messages


def collect_chat_sessions() -> list[dict]:
    """Find all Claude Code session JSONL files across projects."""
    sessions = []
    projects = claude_projects_dir()
    if not projects.is_dir():
        return sessions

    for project_dir in sorted(projects.iterdir()):
        if not project_dir.is_dir():
            continue
        project_name = project_dir.name

        for f in sorted(project_dir.glob("*.jsonl")):
            session_id = f.stem
            first_ts = ""
            title = ""
            cwd = ""
            model = ""
            first_user_msg = ""

            try:
                with open(f, "r", encoding="utf-8") as fh:
                    for line in fh:
                        try:
                            evt = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        t = evt.get("type", "")

                        if t == "user" and not first_ts:
                            first_ts = evt.get("timestamp", "")
                            cwd = evt.get("cwd", cwd)
                            msg = evt.get("message", {})
                            content = msg.get("content", "")
                            if isinstance(content, str) and content.strip():
                                first_user_msg = content.strip()[:80]
                        elif t == "ai-title":
                            title = evt.get("aiTitle", title)
                        elif t == "assistant" and not model:
                            model = evt.get("message", {}).get("model", "")
            except (IOError, OSError):
                continue

            sessions.append({
                "id": session_id,
                "path": str(f),
                "project": decode_project_name(project_name),
                "title": title or first_user_msg,
                "cwd": cwd,
                "model": model,
                "first_ts": first_ts,
                "file_size": f.stat().st_size,
            })

    sessions.sort(key=lambda s: s.get("first_ts", ""), reverse=True)
    return sessions
