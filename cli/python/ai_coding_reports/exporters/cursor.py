"""Cursor chat exporter — AI Chat Export Protocol format."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone

from ai_coding_reports.readers.cursor_db import (
    extract_content_items,
    extract_text_content,
    read_session_messages,
)

SYSTEM_TRUNCATE_LEN = 100
_USER_QUERY_RE = re.compile(r"<user_query>\s*(.+?)\s*</user_query>", re.DOTALL)


def export_cursor_session(session: dict, output_dir: str) -> dict | None:
    """Export a Cursor session to .md + .conv.md + .meta.json."""
    session_id = session["id"]
    messages = read_session_messages(session)

    from ai_coding_reports.aggregators.skills import count_tool_calls_cursor

    tool_counts, skill_counts = count_tool_calls_cursor(messages)

    # Full archive .md
    md_blocks = []
    raw_counts = {"user": 0, "assistant": 0, "tool": 0, "system": 0, "output": 0}

    # Clean conversation .conv.md
    conv_blocks = []

    for msg in messages:
        role = msg.get("role", "other")
        if role in raw_counts:
            raw_counts[role] += 1

        block = _format_message(msg)
        if block:
            md_blocks.append(block)
            raw_counts["output"] += 1

        conv = _format_conv_message(msg)
        if conv:
            header, text = conv
            conv_blocks.append(f"{header}\n\n{text}")

    if not md_blocks:
        return None

    md_content = "\n\n---\n\n".join(md_blocks) + "\n"
    conv_content = ("\n\n---\n\n".join(conv_blocks) + "\n") if conv_blocks else ""

    # Build timestamp
    created_ts = session["created_at_ms"]
    if created_ts:
        dt = datetime.fromtimestamp(created_ts / 1000, tz=timezone.utc)
        created_at = dt.isoformat()
        date_str = dt.strftime("%Y-%m-%d")
    else:
        created_at = datetime.now(timezone.utc).isoformat()
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Write .md
    os.makedirs(os.path.join(output_dir, date_str), exist_ok=True)
    md_path = os.path.join(output_dir, date_str, f"{session_id}.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)

    # Write .conv.md
    conv_path = os.path.join(output_dir, date_str, f"{session_id}.conv.md")
    with open(conv_path, "w", encoding="utf-8") as f:
        f.write(conv_content)

    # Meta
    tool_breakdown = (
        dict(sorted(tool_counts.items(), key=lambda x: x[1], reverse=True))
        if tool_counts else None
    )
    skill_breakdown = (
        dict(sorted(skill_counts.items(), key=lambda x: x[1], reverse=True))
        if skill_counts else None
    )

    meta = {
        "version": "1.0",
        "agent": "cursor",
        "session_id": session_id,
        "session_name": session["name"],
        "model": session["model"],
        "created_at": created_at,
        "stats": {
            "message_count": len(md_blocks),
            "user_messages": raw_counts.get("user", 0),
            "assistant_messages": raw_counts.get("assistant", 0),
            "tool_messages": raw_counts.get("tool", 0),
            "output_messages": raw_counts.get("output", 0),
            "conv_message_count": len(conv_blocks),
            "data_size_bytes": session["total_size"],
            "estimated_input_tokens": 0,
            "estimated_output_tokens": 0,
            "token_estimation_method": "none",
            "tool_breakdown": tool_breakdown,
            "skill_breakdown": skill_breakdown,
        },
    }

    meta_path = os.path.join(output_dir, date_str, f"{session_id}.meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    return meta


def _format_message(msg: dict) -> str | None:
    role = msg.get("role", "unknown")
    content = msg.get("content", "")

    if role in ("user", "human"):
        text = extract_text_content(content)
        if not text:
            return None
        return f"## User\n\n{text}"

    elif role in ("assistant", "ai"):
        text = extract_text_content(content)
        if not text:
            return None
        return f"## Assistant\n\n{text}"

    elif role == "system":
        text = extract_text_content(content)
        if not text:
            return None
        if len(text) > SYSTEM_TRUNCATE_LEN:
            text = text[:SYSTEM_TRUNCATE_LEN] + f"\n\n...(truncated {len(text) - SYSTEM_TRUNCATE_LEN} chars)"
        return f"## System\n\n{text}"

    elif role == "tool":
        items = extract_content_items(content)
        parts = []
        for item in items:
            t = item.get("type", "")
            if t == "tool-call":
                fn = item.get("function", {}).get("name", item.get("toolName", "?"))
                args = item.get("function", {}).get("arguments", "")
                if args:
                    parts.append(f"## Tool Call: {fn}\n\n```\n{args[:500]}\n```")
                else:
                    parts.append(f"## Tool Call: {fn}")
        return "\n\n".join(parts) if parts else None

    else:
        text = extract_text_content(content)
        if not text:
            return None
        return f"## {role.capitalize()}\n\n{text}"


def _format_conv_message(msg: dict) -> tuple[str, str] | None:
    role = msg.get("role", "")

    if role == "user":
        query = _extract_user_query(msg)
        if query:
            return ("## User", query)
        return None

    if role == "assistant":
        text = _extract_assistant_text(msg)
        if text:
            return ("## Assistant", text)
        return None

    return None


def _extract_user_query(msg: dict) -> str | None:
    content = msg.get("content", "")

    if isinstance(content, str):
        m = _USER_QUERY_RE.search(content)
        if m:
            return m.group(1).strip()
        return None

    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                txt = item.get("text", "")
                m = _USER_QUERY_RE.search(txt)
                if m:
                    return m.group(1).strip()
        return None

    return None


def _extract_assistant_text(msg: dict) -> str | None:
    content = msg.get("content", "")
    if not isinstance(content, list):
        return None

    texts = []
    for item in content:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "text":
            t = item.get("text", "").strip()
            if t:
                texts.append(t)
    return "\n\n".join(texts) if texts else None
