#!/usr/bin/env python3
"""Parse Cursor agent-transcripts for tool I/O and session time windows."""

from __future__ import annotations

import json
import re
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

CHARS_PER_TOKEN = 4
from ai_coding_reports.readers.agent_paths import cursor_chats_dir, cursor_projects_dir
TIMESTAMP_RE = re.compile(r"<timestamp>([^<]+)</timestamp>")

EDIT_TOOLS = {
    "StrReplace",
    "Write",
    "Delete",
    "MultiEdit",
    "Edit",
    "EditNotebook",
}

CODEGRAPH_TOOLS = {
    "codegraph_search",
    "codegraph_context",
    "codegraph_explore",
    "codegraph_node",
    "codegraph_trace",
    "codegraph_callers",
    "codegraph_callees",
    "codegraph_impact",
    "codegraph_files",
    "codegraph_status",
}


@dataclass
class ToolCallRecord:
    tool: str
    input_chars: int = 0
    result_chars: int = 0
    result_source: str = "none"  # none | measured_read | tool_result | store_db
    line_index: int = 0


@dataclass
class SessionWindow:
    """Time window for attributing dashboard API usage events to a session."""

    session_id: str
    activity_start: datetime | None
    activity_end: datetime | None
    source: str = "cli"


ANCHOR_ASSISTANT_OFFSET_SEC = 30
ANCHOR_MAX_DISTANCE_SEC = 2 * 3600


@dataclass
class MessageAnchor:
    """Point-in-time message reference for nearest-neighbor usage attribution."""

    session_id: str
    ms: int
    role: str
    source: str = "cli"


@dataclass
class SessionIO:
    session_id: str
    project_slug: str
    jsonl_path: Path
    codegraph: Counter = field(default_factory=Counter)
    grep_calls: int = 0
    read_calls: int = 0
    tool_calls: list[ToolCallRecord] = field(default_factory=list)
    measured_read_result_chars: int = 0
    measured_grep_result_chars: int = 0
    measured_cg_result_chars: int = 0
    tool_result_rows: int = 0
    activity_start: datetime | None = None
    activity_end: datetime | None = None
    user_timestamps_on_date: list[datetime] = field(default_factory=list)

    @property
    def codegraph_total(self) -> int:
        return sum(self.codegraph.values())

    def avg_read_result_tokens(self) -> int:
        reads = [t for t in self.tool_calls if t.tool == "Read" and t.result_chars > 0]
        if not reads:
            return 0
        return sum(t.result_chars for t in reads) // CHARS_PER_TOKEN // len(reads)

    def avg_grep_result_tokens(self) -> int:
        greps = [t for t in self.tool_calls if t.tool == "Grep" and t.result_chars > 0]
        if not greps:
            return 0
        return sum(t.result_chars for t in greps) // CHARS_PER_TOKEN // len(greps)


def local_tz():
    return datetime.now().astimezone().tzinfo or timezone.utc


def parse_user_timestamp(text: str) -> datetime | None:
    """Parse `<timestamp>Monday, Jun 1, 2026, 5:49 PM (UTC+8)</timestamp>`."""
    m = TIMESTAMP_RE.search(text)
    if not m:
        return None
    raw = m.group(1).strip()
    normalized = raw.replace("(UTC+8)", "(+0800)").replace("(UTC-8)", "(-0800)")
    for fmt in (
        "%A, %b %d, %Y, %I:%M %p (%z)",
        "%A, %B %d, %Y, %I:%M %p (%z)",
    ):
        try:
            return datetime.strptime(normalized, fmt)
        except ValueError:
            continue
    return None


def _coerce_line_number(val) -> int | None:
    """Coerce transcript Read offset/limit (may be int, str, or malformed list)."""
    if val is None:
        return None
    if isinstance(val, bool):
        return None
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        return int(val)
    if isinstance(val, str):
        try:
            return int(val.strip())
        except ValueError:
            return None
    if isinstance(val, list) and val:
        return _coerce_line_number(val[0])
    return None


def measure_read_result_chars(path: str, inp: dict) -> tuple[int, str]:
    """Estimate chars returned by a Read tool call (limit/offset are 1-based line numbers)."""
    p = Path(path).expanduser()
    if not p.is_file():
        return 0, "missing_file"

    try:
        text = p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return 0, "read_error"

    lines = text.splitlines()
    offset = _coerce_line_number(inp.get("offset"))
    limit = _coerce_line_number(inp.get("limit"))
    if offset is not None or limit is not None:
        start = max(0, (offset or 1) - 1)
        end = start + limit if limit is not None else len(lines)
        chunk = "\n".join(lines[start:end])
        return len(chunk), "measured_read_lines"

    return len(text), "measured_read_full"


def _transcript_mtime_on_dates(jsonl: Path, dates: set[str], tz) -> bool:
    """Fallback: jsonl mtime local date in dates (IDE agent transcripts often lack <timestamp> tags)."""
    try:
        mtime = datetime.fromtimestamp(jsonl.stat().st_mtime, tz=timezone.utc).astimezone(tz)
    except OSError:
        return False
    return mtime.date().isoformat() in dates


def transcript_active_on_dates(jsonl: Path, dates: set[str]) -> bool:
    """True if user <timestamp> tags or jsonl mtime indicate activity on one of the ISO dates."""
    if not dates:
        return True
    tz = local_tz()
    try:
        lines = jsonl.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return False
    for line in lines:
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("role") != "user":
            continue
        msg = obj.get("message") or obj
        content = msg.get("content", [])
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict) or item.get("type") != "text":
                continue
            ts = parse_user_timestamp(item.get("text", ""))
            if ts and ts.astimezone(tz).date().isoformat() in dates:
                return True
    return _transcript_mtime_on_dates(jsonl, dates, tz)


def transcript_activity_window(
    jsonl: Path,
    target: date | None = None,
) -> tuple[datetime | None, datetime | None]:
    """Activity window from user <timestamp> tags, else jsonl mtime (no tool I/O)."""
    tz = local_tz()
    timestamps: list[datetime] = []

    try:
        lines = jsonl.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return None, None

    for line in lines:
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("role") != "user":
            continue
        msg = obj.get("message") or obj
        content = msg.get("content", [])
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict) or item.get("type") != "text":
                continue
            ts = parse_user_timestamp(item.get("text", ""))
            if ts and (target is None or ts.date() == target):
                timestamps.append(ts)

    if timestamps:
        start = min(timestamps) - timedelta(minutes=5)
        end = max(timestamps) + timedelta(minutes=20)
        if start > end:
            start, end = end, start
        return start, end

    try:
        mtime = datetime.fromtimestamp(jsonl.stat().st_mtime, tz=timezone.utc).astimezone(tz)
        if target is None or mtime.date() == target:
            return mtime - timedelta(hours=2), mtime + timedelta(minutes=1)
    except OSError:
        pass
    return None, None


def _extract_tool_uses(content) -> list[tuple[str, dict]]:
    uses: list[tuple[str, dict]] = []
    if not isinstance(content, list):
        return uses
    for item in content:
        if not isinstance(item, dict):
            continue
        t = item.get("type", "")
        if t == "tool_use":
            name = item.get("name") or item.get("toolName") or ""
            inp = item.get("input") or item.get("arguments") or {}
            if name == "CallMcpTool" and isinstance(inp, dict):
                cg = inp.get("toolName") or ""
                if cg.startswith("codegraph_"):
                    uses.append((cg, inp))
                    continue
            uses.append((name, inp if isinstance(inp, dict) else {}))
        elif t in ("tool-result", "tool_result"):
            # Future / alternate transcript formats
            uses.append(("__tool_result__", item))
    return uses


def _tool_input_chars(inp: dict) -> int:
    if not inp:
        return 0
    return len(json.dumps(inp, ensure_ascii=False, default=str))


def _parse_tool_result_chars(item: dict) -> int:
    for key in ("result", "content", "output", "text"):
        val = item.get(key)
        if val is None:
            continue
        if isinstance(val, str):
            return len(val)
        return len(json.dumps(val, ensure_ascii=False, default=str))
    return 0


def find_transcript_path(session_id: str, project_slug: str | None = None) -> Path | None:
    """Locate agent-transcripts/<session_id>/<session_id>.jsonl for a Cursor session."""
    candidates: list[Path] = []
    if project_slug:
        candidates.append(
            cursor_projects_dir()
            / project_slug
            / "agent-transcripts"
            / session_id
            / f"{session_id}.jsonl"
        )
    projects = cursor_projects_dir()
    if projects.is_dir():
        candidates.extend(
            projects.glob(f"*/agent-transcripts/{session_id}/{session_id}.jsonl")
        )
    for path in candidates:
        if path.is_file():
            return path
    return None


def _path_from_tool_input(name: str, inp: dict) -> str | None:
    """Extract an absolute filesystem path from a file-edit tool call."""
    if not isinstance(inp, dict):
        return None
    for key in ("path", "target_file", "target_notebook", "file_path"):
        val = inp.get(key)
        if isinstance(val, str) and val.startswith("/"):
            return val
    if name == "MultiEdit":
        edits = inp.get("edits")
        if isinstance(edits, list):
            for edit in edits:
                if not isinstance(edit, dict):
                    continue
                for key in ("path", "target_file"):
                    val = edit.get(key)
                    if isinstance(val, str) and val.startswith("/"):
                        return val
    return None


def collect_edited_paths(jsonl: Path) -> list[str]:
    """Collect unique absolute paths edited in a Cursor agent transcript."""
    seen: dict[str, int] = {}
    try:
        lines = jsonl.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []

    for line in lines:
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue

        role = obj.get("role")
        msg = obj.get("message") or obj
        content = msg.get("content", [])
        if role != "assistant" or not isinstance(content, list):
            continue

        for name, inp in _extract_tool_uses(content):
            if name not in EDIT_TOOLS:
                continue
            path = _path_from_tool_input(name, inp)
            if path:
                seen[path] = seen.get(path, 0) + 1

    return sorted(seen.keys(), key=lambda p: (-seen[p], p))


def parse_transcript_io(session_id: str, project_slug: str, jsonl: Path, target: date | None = None) -> SessionIO:
    sess = SessionIO(session_id=session_id, project_slug=project_slug, jsonl_path=jsonl)
    pending: list[ToolCallRecord] = []
    tz = local_tz()

    for line_index, line in enumerate(jsonl.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue

        role = obj.get("role")
        msg = obj.get("message") or obj
        content = msg.get("content", [])

        if role == "user" and isinstance(content, list):
            for item in content:
                if not isinstance(item, dict):
                    continue
                if item.get("type") == "text":
                    ts = parse_user_timestamp(item.get("text", ""))
                    if ts:
                        if target is None or ts.date() == target:
                            sess.user_timestamps_on_date.append(ts)
                elif item.get("type") in ("tool-result", "tool_result"):
                    rc = _parse_tool_result_chars(item)
                    sess.tool_result_rows += 1
                    if pending:
                        rec = pending.pop(0)
                        rec.result_chars = rc
                        rec.result_source = "tool_result"
                        if rec.tool in CODEGRAPH_TOOLS:
                            sess.measured_cg_result_chars += rc
                        elif rec.tool == "Grep":
                            sess.measured_grep_result_chars += rc
                        elif rec.tool == "Read":
                            sess.measured_read_result_chars += rc

        if role != "assistant" or not isinstance(content, list):
            continue

        for name, inp in _extract_tool_uses(content):
            if name == "__tool_result__":
                continue
            rec = ToolCallRecord(tool=name, input_chars=_tool_input_chars(inp), line_index=line_index)
            if name in CODEGRAPH_TOOLS:
                sess.codegraph[name] += 1
                pending.append(rec)
            elif name == "Grep":
                sess.grep_calls += 1
                pending.append(rec)
            elif name == "Read":
                sess.read_calls += 1
                path = inp.get("path", "") if isinstance(inp, dict) else ""
                rc, src = measure_read_result_chars(path, inp if isinstance(inp, dict) else {})
                rec.result_chars = rc
                rec.result_source = src
                sess.measured_read_result_chars += rc
                pending.append(rec)
            else:
                pending.append(rec)
            sess.tool_calls.append(rec)

    if sess.user_timestamps_on_date:
        start = min(sess.user_timestamps_on_date) - timedelta(minutes=5)
        end = max(sess.user_timestamps_on_date) + timedelta(minutes=20)
        if start > end:
            start, end = end, start
        sess.activity_start = start
        sess.activity_end = end
    else:
        mtime = datetime.fromtimestamp(jsonl.stat().st_mtime, tz=timezone.utc).astimezone(tz)
        if target is None or mtime.date() == target:
            sess.activity_end = mtime + timedelta(minutes=1)
            sess.activity_start = mtime - timedelta(hours=2)

    return sess


def find_store_db(session_id: str) -> Path | None:
    chats = cursor_chats_dir()
    if not chats.is_dir():
        return None
    for store_db in chats.glob(f"*/{session_id}/store.db"):
        if store_db.is_file():
            return store_db
    return None


def load_store_db_tool_results(session_id: str) -> dict[str, int] | None:
    """Return {tool_name: total_result_chars} from store.db blobs when ~/.cursor/chats exists."""
    db_path = find_store_db(session_id)
    if db_path is None:
        return None

    try:
        from export_cursor_chats import count_tool_calls, read_session_messages  # noqa: E402
    except ImportError:
        return None

    conv = {"id": session_id, "db_path": str(db_path)}
    try:
        messages = read_session_messages(conv)
    except (sqlite3.Error, OSError):
        return None

    totals: dict[str, int] = defaultdict(int)
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if role == "tool":
            chars = len(json.dumps(content, ensure_ascii=False, default=str))
            totals["tool"] += chars
        elif role == "assistant" and isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "tool_use":
                    name = item.get("name", "unknown")
                    totals[f"use:{name}"] += 0
    tool_counts, _ = count_tool_calls(messages)
    return {"messages": len(messages), "tool_counts": dict(tool_counts)}


def _dt_to_ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def build_cli_message_anchors(
    jsonl: Path,
    session_id: str,
    target_date: date | None = None,
) -> list[MessageAnchor]:
    """Build per-message time anchors from agent-transcript jsonl."""
    tz = local_tz()
    anchors: list[MessageAnchor] = []

    try:
        lines = jsonl.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []

    last_user_ms: int | None = None
    assistant_idx = 0

    for line in lines:
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue

        role = obj.get("role", "")
        msg = obj.get("message") or obj
        content = msg.get("content", [])

        if role == "user":
            user_ts: datetime | None = None
            if isinstance(content, list):
                for item in content:
                    if not isinstance(item, dict) or item.get("type") != "text":
                        continue
                    ts = parse_user_timestamp(item.get("text", ""))
                    if ts and (target_date is None or ts.date() == target_date):
                        user_ts = ts
                        break
            if user_ts:
                last_user_ms = _dt_to_ms(user_ts)
                assistant_idx = 0
                anchors.append(MessageAnchor(session_id, last_user_ms, "user", "cli"))
        elif role == "assistant" and last_user_ms is not None:
            assistant_idx += 1
            ms = last_user_ms + assistant_idx * ANCHOR_ASSISTANT_OFFSET_SEC * 1000
            anchors.append(MessageAnchor(session_id, ms, "assistant", "cli"))

    if not anchors:
        try:
            mtime = datetime.fromtimestamp(jsonl.stat().st_mtime, tz=timezone.utc).astimezone(tz)
            if target_date is None or mtime.date() == target_date:
                anchors.append(MessageAnchor(session_id, _dt_to_ms(mtime), "user", "cli"))
        except OSError:
            pass
    return anchors


def assign_event_to_nearest_anchor(
    event_ms: int,
    anchors: list[MessageAnchor],
    target: date,
) -> str:
    """Assign a dashboard usage event to the session with the nearest message anchor."""
    dt = datetime.fromtimestamp(event_ms / 1000, tz=timezone.utc).astimezone(local_tz())
    if dt.date() != target:
        return "outside_day"

    day_anchors = [
        a
        for a in anchors
        if datetime.fromtimestamp(a.ms / 1000, tz=timezone.utc).astimezone(local_tz()).date() == target
    ]
    if not day_anchors:
        return "unassigned"

    best: tuple[tuple[float, int, str], str] | None = None
    for anchor in day_anchors:
        dist_sec = abs(event_ms - anchor.ms) / 1000.0
        if dist_sec > ANCHOR_MAX_DISTANCE_SEC:
            continue
        role_rank = 0 if anchor.role == "assistant" else 1
        key = (dist_sec, role_rank, anchor.session_id)
        if best is None or key < best[0]:
            best = (key, anchor.session_id)
    return best[1] if best else "unassigned"


def _session_window(sess: SessionIO | SessionWindow) -> SessionWindow:
    if isinstance(sess, SessionWindow):
        return sess
    return SessionWindow(
        session_id=sess.session_id,
        activity_start=sess.activity_start,
        activity_end=sess.activity_end,
        source="cli",
    )


def assign_event_to_session(
    event_ms: int,
    sessions: list[SessionIO | SessionWindow],
    target: date,
) -> str:
    dt = datetime.fromtimestamp(event_ms / 1000, tz=timezone.utc).astimezone(local_tz())
    if dt.date() != target:
        return "outside_day"

    windows = [_session_window(s) for s in sessions]
    candidates: list[tuple[float, str]] = []
    for win in windows:
        if win.activity_start is None or win.activity_end is None:
            continue
        if win.activity_start <= dt <= win.activity_end:
            mid = win.activity_start + (win.activity_end - win.activity_start) / 2
            candidates.append((abs((dt - mid).total_seconds()), win.session_id))
    if candidates:
        candidates.sort(key=lambda x: x[0])
        return candidates[0][1]

    best: tuple[float, str] | None = None
    for win in windows:
        if win.activity_end is None:
            continue
        dist = abs((dt - win.activity_end).total_seconds())
        if dist <= 1800 and (best is None or dist < best[0]):
            best = (dist, win.session_id)
    return best[1] if best else "unassigned"


def _new_usage_bucket() -> dict:
    return {
        "events": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "total_tokens": 0,
        "charged_usd": 0.0,
        "models": defaultdict(lambda: {"api_calls": 0, "charged_usd": 0.0, "model": ""}),
    }


def aggregate_api_by_session(
    events: list[dict],
    sessions: list[SessionIO | SessionWindow],
    target: date,
    anchors: list[MessageAnchor] | None = None,
) -> dict[str, dict]:
    """Attribute dashboard usage events to sessions (nearest message anchor, window fallback)."""
    buckets: dict[str, dict] = defaultdict(_new_usage_bucket)
    for ev in events:
        ts = ev.get("timestamp")
        if ts is None:
            continue
        event_ms = int(ts)
        if anchors:
            sid = assign_event_to_nearest_anchor(event_ms, anchors, target)
            if sid == "unassigned":
                sid = assign_event_to_session(event_ms, sessions, target)
        else:
            sid = assign_event_to_session(event_ms, sessions, target)
        tu = ev.get("tokenUsage") or {}
        b = buckets[sid]
        b["events"] += 1
        inp = int(tu.get("inputTokens", 0) or 0)
        out = int(tu.get("outputTokens", 0) or 0)
        cr = int(tu.get("cacheReadTokens", 0) or 0)
        cw = int(tu.get("cacheWriteTokens", 0) or 0)
        b["input_tokens"] += inp
        b["output_tokens"] += out
        b["cache_read_tokens"] += cr
        b["cache_write_tokens"] += cw
        b["total_tokens"] += inp + out + cr + cw
        usd = float(ev.get("chargedCents", 0) or 0) / 100
        b["charged_usd"] += usd
        model = ev.get("model", "unknown")
        mb = b["models"][model]
        mb["model"] = model
        mb["api_calls"] += 1
        mb["charged_usd"] = round(mb["charged_usd"] + usd, 4)

    out: dict[str, dict] = {}
    for sid, b in buckets.items():
        models = [
            {"model": m["model"], "api_calls": m["api_calls"], "cost": m["charged_usd"], "currency": "$"}
            for m in sorted(b["models"].values(), key=lambda x: x["model"])
            if m["api_calls"]
        ]
        out[sid] = {
            "events": b["events"],
            "input_tokens": b["input_tokens"],
            "output_tokens": b["output_tokens"],
            "cache_read_tokens": b["cache_read_tokens"],
            "cache_write_tokens": b["cache_write_tokens"],
            "total_tokens": b["total_tokens"],
            "charged_usd": round(b["charged_usd"], 4),
            "models": models,
        }
    return out
