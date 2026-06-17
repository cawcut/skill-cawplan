"""Message counting and timeline building across agents."""

from __future__ import annotations

from ai_coding_reports.utils.text import clean_message, extract_user_message
from ai_coding_reports.utils.timezone import utc_to_local


def count_messages_claude(events: list[dict]) -> dict:
    """Count messages by role from Claude Code events."""
    stats = {"user": 0, "assistant": 0, "tool_calls": 0}

    for evt in events:
        t = evt.get("type", "")
        if t == "user":
            msg = evt.get("message", {})
            content = msg.get("content", "")
            if isinstance(content, list):
                continue
            if isinstance(content, str) and content.strip():
                stats["user"] += 1
        elif t == "assistant":
            stats["assistant"] += 1
            msg = evt.get("message", {})
            content = msg.get("content", [])
            if isinstance(content, list):
                stats["tool_calls"] += sum(
                    1 for c in content
                    if isinstance(c, dict) and c.get("type") == "tool_use"
                )

    return stats


def count_messages_cursor(messages: list[dict]) -> dict:
    """Count messages by role from Cursor messages."""
    user = assistant = tool = 0
    for msg in messages:
        role = msg.get("role", "")
        if role == "user":
            user += 1
        elif role == "assistant":
            assistant += 1
            content = msg.get("content", [])
            if isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "tool_use":
                        tool += 1
        elif role == "tool":
            tool += 1
    return {"user": user, "assistant": assistant, "tool_calls": tool}


def build_timeline_claude(events: list[dict]) -> list[dict]:
    """Build user message timeline from Claude Code events."""
    timeline = []
    msg_index = 0

    for evt in events:
        if evt.get("type") != "user":
            continue
        msg = evt.get("message", {})
        content = msg.get("content", "")

        if isinstance(content, list):
            continue
        if not isinstance(content, str) or not content.strip():
            continue

        ts = evt.get("timestamp", "")
        time_str = utc_to_local(ts) if ts else ""

        text = extract_user_message(content)
        if not text:
            continue

        preview = text[:120] if len(text) > 120 else text

        msg_index += 1
        timeline.append({
            "index": msg_index,
            "time": time_str,
            "preview": preview,
        })

    return timeline


def build_timeline_cursor(messages: list[dict], session_id: str, session_name: str) -> list[dict]:
    """Build user message timeline from Cursor messages."""
    import re
    USER_QUERY_RE = re.compile(r"<user_query>\s*(.+?)\s*</user_query>", re.DOTALL)

    timeline = []
    for msg in messages:
        if msg.get("role") != "user":
            continue

        content = msg.get("content", "")
        text = _extract_user_text(content, USER_QUERY_RE)
        if not text:
            continue

        preview = clean_message(text)
        if len(preview) > 120:
            preview = preview[:120] + "..."

        timeline.append({
            "session_id": session_id,
            "session_name": session_name,
            "preview": preview,
        })

    return timeline


def _extract_user_text(content, user_query_re) -> str | None:
    """Extract user query text from Cursor message content."""
    if isinstance(content, str):
        m = user_query_re.search(content)
        if m:
            return m.group(1).strip()
        return content.strip() if content.strip() else None

    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                txt = item.get("text", "")
                m = user_query_re.search(txt)
                if m:
                    return m.group(1).strip()
        return None

    return None


def build_messages_claude(events: list[dict]) -> list[dict]:
    """Build user + assistant message list from Claude Code events.

    Only includes user input text and assistant text output (no tool_calls).
    Returns [{role, time, text}] sorted by timestamp.
    """
    messages = []

    for evt in events:
        t = evt.get("type", "")
        ts = evt.get("timestamp", "")
        time_str = utc_to_local(ts) if ts else ""

        if t == "user":
            msg = evt.get("message", {})
            content = msg.get("content", "")
            if isinstance(content, list):
                texts = [
                    c.get("text", "")
                    for c in content
                    if isinstance(c, dict) and c.get("type") == "text"
                ]
                if not texts:
                    continue
                text = "\n".join(texts)
            elif isinstance(content, str) and content.strip():
                text = extract_user_message(content)
                if not text:
                    continue
            else:
                continue
            messages.append({"role": "user", "time": time_str, "text": text})

        elif t == "assistant":
            msg = evt.get("message", {})
            content = msg.get("content", [])
            if not isinstance(content, list):
                continue

            texts = [
                c.get("text", "")
                for c in content
                if isinstance(c, dict) and c.get("type") == "text" and c.get("text")
            ]
            if texts:
                messages.append({
                    "role": "assistant",
                    "time": time_str,
                    "text": "\n\n".join(texts),
                })

    return messages
