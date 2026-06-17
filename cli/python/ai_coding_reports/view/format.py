"""Format and filter session messages for `view session` (Claude Code)."""

from __future__ import annotations

from dataclasses import dataclass

from ai_coding_reports.aggregators.chunks import build_chunks
from ai_coding_reports.utils.text import extract_user_message


@dataclass
class ViewOptions:
    include_assistant: bool = True
    include_tools: bool = False
    truncate: int = 0
    chunk: bool = False
    as_json: bool = False


def view_filters_active(opts: ViewOptions) -> bool:
    """True when any non-default view filter is enabled."""
    return (
        not opts.include_assistant
        or opts.include_tools
        or opts.truncate > 0
        or opts.chunk
        or opts.as_json
    )


def _truncate_text(text: str, limit: int) -> str:
    if limit <= 0 or not text:
        return text
    if len(text) <= limit:
        return text
    return text[:limit] + "..."


def _user_text(msg: dict) -> str:
    content = msg.get("text") or msg.get("content", "")
    if isinstance(content, list):
        parts = [
            c.get("text", "")
            for c in content
            if isinstance(c, dict) and c.get("type") == "text"
        ]
        return "\n".join(p for p in parts if p).strip()
    if isinstance(content, str):
        stripped = content.strip()
        if stripped.startswith("[{'type': 'tool_result'"):
            return ""
        return extract_user_message(content) or stripped
    return ""


def apply_view_filters(messages: list[dict], opts: ViewOptions) -> list[dict]:
    """Filter raw parse_chat_messages output according to view options."""
    out: list[dict] = []
    for msg in messages:
        role = msg.get("role", "")
        if role == "system":
            continue
        if role == "user":
            out.append(msg)
            continue
        if role != "assistant":
            continue
        if not opts.include_assistant:
            continue
        text = (msg.get("text") or "").strip()
        tool_calls = list(msg.get("tool_calls") or [])
        if not opts.include_tools:
            if not text:
                continue
            out.append({**msg, "tool_calls": []})
        else:
            if not text and not tool_calls:
                continue
            out.append(msg)
    return out


def normalize_claude_messages(messages: list[dict]) -> list[dict]:
    """Convert parse_chat_messages rows to {role, time, text, tool_calls?}."""
    normalized: list[dict] = []
    for msg in messages:
        role = msg.get("role", "")
        if role == "user":
            text = _user_text(msg)
            if not text:
                continue
            normalized.append({
                "role": "user",
                "time": msg.get("time", ""),
                "text": text,
            })
        elif role == "assistant":
            entry: dict = {
                "role": "assistant",
                "time": msg.get("time", ""),
                "text": (msg.get("text") or "").strip(),
            }
            tools = msg.get("tool_calls") or []
            if tools:
                entry["tool_calls"] = list(tools)
            normalized.append(entry)
    return normalized


def _apply_truncate(messages: list[dict], limit: int) -> list[dict]:
    if limit <= 0:
        return messages
    out: list[dict] = []
    for msg in messages:
        row = dict(msg)
        row["text"] = _truncate_text(row.get("text", ""), limit)
        if row.get("tool_calls"):
            row["tool_calls"] = [
                _truncate_text(str(t), limit) for t in row["tool_calls"]
            ]
        out.append(row)
    return out


def _messages_for_chunks(messages: list[dict], opts: ViewOptions) -> list[dict]:
    """Flatten tool_calls into text lines for chunk builder."""
    rows: list[dict] = []
    for msg in messages:
        text = msg.get("text", "")
        parts = [text] if text else []
        if opts.include_tools and msg.get("tool_calls"):
            parts.extend(msg["tool_calls"])
        combined = "\n".join(p for p in parts if p)
        if not combined:
            continue
        rows.append({
            "role": msg.get("role", "?"),
            "time": msg.get("time", ""),
            "text": combined,
        })
    return rows


def render_session_json(
    messages: list[dict],
    opts: ViewOptions,
    meta: dict,
) -> dict:
    """Build JSON payload for --json output."""
    filtered = apply_view_filters(messages, opts)
    normalized = normalize_claude_messages(filtered)
    display = _apply_truncate(normalized, opts.truncate)

    payload: dict = {
        "session_id": meta.get("session_id", ""),
        "agent": meta.get("agent", "claude-code"),
        "options": {
            "include_assistant": opts.include_assistant,
            "include_tools": opts.include_tools,
            "truncate": opts.truncate,
            "chunk": opts.chunk,
        },
        "message_count": len(display),
        "messages": display,
    }
    if opts.chunk:
        chunk_msgs = _messages_for_chunks(display, opts)
        truncate_arg = opts.truncate if opts.truncate > 0 else None
        payload["chunks"] = build_chunks(
            chunk_msgs,
            agent=payload["agent"],
            session_id=str(meta.get("session_id", ""))[:8],
            truncate=truncate_arg,
        )
    return payload


def render_session_text(
    messages: list[dict],
    opts: ViewOptions,
    meta: dict,
) -> str:
    """Build plain or ANSI terminal output for Claude sessions."""
    filtered = apply_view_filters(messages, opts)
    normalized = normalize_claude_messages(filtered)
    display = _apply_truncate(normalized, opts.truncate)

    if opts.chunk:
        chunk_msgs = _messages_for_chunks(display, opts)
        truncate_arg = opts.truncate if opts.truncate > 0 else None
        chunks = build_chunks(
            chunk_msgs,
            agent=meta.get("agent", "claude-code"),
            session_id=str(meta.get("session_id", ""))[:8],
            truncate=truncate_arg,
        )
        return "\n\n".join(chunks)

    user_c = "\033[36m"
    asst_c = "\033[33m"
    reset = "\033[0m"
    dim = "\033[2m"
    lines: list[str] = []
    sid = meta.get("session_id", "")
    lines.append(f"\nSession: {sid}\n")

    msg_idx = 0
    for msg in display:
        role = msg.get("role", "")
        if role == "user":
            msg_idx += 1
            lines.append(dim + "─" * 78 + reset)
            label = f"[{msg_idx}] User"
            time_s = msg.get("time", "")
            if time_s:
                label += f" ({time_s})"
            lines.append(f"{user_c}{label}:{reset}")
            lines.append(msg.get("text", ""))
        elif role == "assistant":
            msg_idx += 1
            lines.append(dim + "─" * 78 + reset)
            lines.append(f"{asst_c}[{msg_idx}] Assistant:{reset}")
            text = msg.get("text", "")
            if text:
                lines.append(text)
            if opts.include_tools and msg.get("tool_calls"):
                for tc in msg["tool_calls"]:
                    lines.append(dim + tc + reset)

    lines.append(dim + "─" * 78 + reset)
    lines.append(f"\n{len(display)} messages | session {sid}")
    return "\n".join(lines)


def render_claude_session(
    messages: list[dict],
    opts: ViewOptions,
    meta: dict,
) -> str:
    """Render Claude session to stdout string (JSON or text)."""
    import json

    if opts.as_json:
        return json.dumps(render_session_json(messages, opts, meta), ensure_ascii=False, indent=2)
    return render_session_text(messages, opts, meta)


def options_from_flags(
    include_assistant: bool,
    include_tools: bool,
    truncate: int,
    chunk: bool,
    json_flag: bool,
) -> ViewOptions:
    return ViewOptions(
        include_assistant=include_assistant,
        include_tools=include_tools,
        truncate=truncate,
        chunk=chunk,
        as_json=json_flag,
    )
