"""Claude Code chat exporter — AI Chat Export Protocol format."""

from __future__ import annotations

import json
import os
from datetime import date, datetime, timezone
from urllib.parse import unquote

from ai_coding_reports.readers.claude_code import parse_chat_messages


def export_claude_session(session: dict, output_dir: str, filter_date: date | None = None) -> dict | None:
    """Export a Claude Code session to .md + .conv.md + .meta.json."""
    sid = session["id"]
    messages = parse_chat_messages(session["path"], filter_date=filter_date)
    if not messages:
        return None

    # Full archive .md
    md_blocks = []
    for msg in messages:
        role = msg.get("role", "")
        if role == "user":
            md_blocks.append(f"## User\n\n{msg['content']}")
        elif role == "assistant":
            parts = []
            if msg.get("text"):
                parts.append(msg["text"])
            if msg.get("tool_calls"):
                parts.append("\n".join(msg["tool_calls"]))
            md_blocks.append(f"## Assistant\n\n{'\n\n'.join(parts)}")
        elif role == "system":
            txt = msg.get("content", "")
            if len(txt) > 100:
                txt = txt[:100] + f"\n\n...(truncated {len(txt) - 100} chars)"
            md_blocks.append(f"## System\n\n{txt}")

    md_content = "\n\n---\n\n".join(md_blocks) + "\n"

    # Clean conversation .conv.md
    conv_blocks = []
    for msg in messages:
        role = msg.get("role", "")
        if role == "user":
            conv_blocks.append(f"## User\n\n{msg['content']}")
        elif role == "assistant":
            text = msg.get("text", "")
            if text:
                conv_blocks.append(f"## Assistant\n\n{text}")

    conv_content = ("\n\n---\n\n".join(conv_blocks) + "\n") if conv_blocks else ""

    # Timestamps
    first_ts = session.get("first_ts", "")
    if first_ts:
        try:
            dt = datetime.fromisoformat(first_ts.replace("Z", "+00:00"))
            created_at = dt.isoformat()
            date_str = dt.strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            created_at = first_ts
            date_str = first_ts[:10] if len(first_ts) >= 10 else "unknown"
    else:
        created_at = datetime.now(timezone.utc).isoformat()
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Write files
    os.makedirs(os.path.join(output_dir, date_str), exist_ok=True)

    md_path = os.path.join(output_dir, date_str, f"{sid}.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)

    conv_path = os.path.join(output_dir, date_str, f"{sid}.conv.md")
    with open(conv_path, "w", encoding="utf-8") as f:
        f.write(conv_content)

    # Meta
    role_counts = {}
    for msg in messages:
        r = msg.get("role", "other")
        role_counts[r] = role_counts.get(r, 0) + 1

    meta = {
        "version": "1.0",
        "agent": "claude-code",
        "session_id": sid,
        "session_name": session.get("title") or session.get("project", ""),
        "model": session.get("model", ""),
        "created_at": created_at,
        "stats": {
            "message_count": len(md_blocks),
            "user_messages": role_counts.get("user", 0),
            "assistant_messages": role_counts.get("assistant", 0),
            "system_messages": role_counts.get("system", 0),
            "output_messages": len(md_blocks),
            "conv_message_count": len(conv_blocks),
            "data_size_bytes": session.get("file_size", 0),
            "tokens_used": 0,
            "token_source": "none",
            "estimated_input_tokens": 0,
            "estimated_output_tokens": 0,
            "token_estimation_method": "none",
        },
    }

    meta_path = os.path.join(output_dir, date_str, f"{sid}.meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    return meta
