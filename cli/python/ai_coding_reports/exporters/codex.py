"""Codex chat exporter — AI Chat Export Protocol format."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

from ai_coding_reports.readers.codex import parse_messages
from ai_coding_reports.utils.text import strip_tool_blocks


def export_codex_thread(thread: dict, output_dir: str) -> dict | None:
    """Export a Codex thread to .md + .conv.md + .meta.json."""
    tid = thread["id"]
    messages = parse_messages(thread["rollout_path"])
    if not messages:
        return None

    # Full archive .md
    md_blocks = []
    for msg in messages:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")

        if role == "user":
            md_blocks.append(f"## User\n\n{content}")
        elif role == "assistant":
            md_blocks.append(f"## Assistant\n\n{content}")
        elif role == "system":
            truncated = content[:100]
            if len(content) > 100:
                truncated += f"\n\n...(truncated {len(content) - 100} chars)"
            md_blocks.append(f"## System\n\n{truncated}")
        else:
            md_blocks.append(f"## {role.capitalize()}\n\n{content}")

    md_content = "\n\n---\n\n".join(md_blocks) + "\n"

    # Clean conversation .conv.md
    conv_blocks = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")

        if role == "user":
            conv_blocks.append(f"## User\n\n{content}")
        elif role == "assistant":
            cleaned = strip_tool_blocks(content)
            if cleaned:
                conv_blocks.append(f"## Assistant\n\n{cleaned}")

    conv_content = ("\n\n---\n\n".join(conv_blocks) + "\n") if conv_blocks else ""

    # Timestamps
    created_ts = thread["created_at"]
    if created_ts:
        dt = datetime.fromtimestamp(created_ts, tz=timezone.utc)
        created_at = dt.isoformat()
        date_str = dt.strftime("%Y-%m-%d")
    else:
        created_at = datetime.now(timezone.utc).isoformat()
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Write files
    os.makedirs(os.path.join(output_dir, date_str), exist_ok=True)

    md_path = os.path.join(output_dir, date_str, f"{tid}.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)

    conv_path = os.path.join(output_dir, date_str, f"{tid}.conv.md")
    with open(conv_path, "w", encoding="utf-8") as f:
        f.write(conv_content)

    # Meta
    role_counts = {}
    for msg in messages:
        r = msg.get("role", "other")
        role_counts[r] = role_counts.get(r, 0) + 1

    total_size = os.path.getsize(thread["rollout_path"])

    meta = {
        "version": "1.0",
        "agent": "codex",
        "session_id": tid,
        "session_name": thread["title"],
        "model": thread["model"],
        "created_at": created_at,
        "stats": {
            "message_count": len(md_blocks),
            "user_messages": role_counts.get("user", 0),
            "assistant_messages": role_counts.get("assistant", 0),
            "system_messages": role_counts.get("system", 0),
            "output_messages": len(md_blocks),
            "conv_message_count": len(conv_blocks),
            "data_size_bytes": total_size,
            "tokens_used": thread["tokens_used"],
            "token_source": "api",
            "estimated_input_tokens": 0,
            "estimated_output_tokens": 0,
            "token_estimation_method": "none",
        },
    }

    meta_path = os.path.join(output_dir, date_str, f"{tid}.meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    return meta
