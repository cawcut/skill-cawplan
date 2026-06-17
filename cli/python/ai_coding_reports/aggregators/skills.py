"""Skill and tool call extraction from session events."""

from __future__ import annotations


def collect_skills_claude(events: list[dict]) -> list[str]:
    """Extract Skill invocations from Claude Code assistant events."""
    skills = set()

    for evt in events:
        if evt.get("type") != "assistant":
            continue
        msg = evt.get("message", {})
        content = msg.get("content", [])
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_use":
                name = block.get("name", "")
                if name == "Skill":
                    inp = block.get("input", {})
                    skill_name = inp.get("skill", "")
                    if skill_name:
                        skills.add(skill_name)

    return sorted(skills)


def count_tool_calls_cursor(messages: list[dict]) -> tuple[dict[str, int], dict[str, int]]:
    """Count tool calls and skill references from Cursor messages.

    Returns (tool_counts, skill_counts).
    """
    import re

    tool_counts: dict[str, int] = {}

    for msg in messages:
        content = msg.get("content", [])
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict):
                continue
            t = item.get("type", "")
            if t == "tool-call":
                fn = item.get("function", {}).get("name", item.get("toolName", ""))
                if fn:
                    tool_counts[fn] = tool_counts.get(fn, 0) + 1
            elif t == "tool-result":
                tool_counts["_tool_results"] = tool_counts.get("_tool_results", 0) + 1

    skill_counts: dict[str, int] = {}
    skill_pattern = re.compile(r'<agent_skill[^>]*fullPath="[^"]*/([^/"]+)/SKILL\.md"')

    for msg in messages:
        if msg.get("role") != "user":
            continue
        content = msg.get("content", "")
        text = content if isinstance(content, str) else _extract_text_content(content)
        if not text:
            continue

        for m in skill_pattern.finditer(text):
            name = m.group(1)
            skill_counts[name] = skill_counts.get(name, 0) + 1

        uq_start = text.find("<user_query>")
        uq_end = text.find("</user_query>")
        if uq_start >= 0 and uq_end > uq_start:
            user_query = text[uq_start:uq_end]
            for m in re.finditer(r'/([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+)', user_query):
                name = m.group(1)
                if "-" in name:
                    skill_counts[name] = skill_counts.get(name, 0) + 1

    return tool_counts, skill_counts


def _extract_text_content(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                txt = item.get("text", "")
                if txt:
                    texts.append(txt)
        return "\n".join(texts)
    return ""
