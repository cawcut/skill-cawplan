"""Message text cleaning and command extraction patterns shared across agents."""

from __future__ import annotations

import re

# XML tag patterns in user messages (slash commands, local command output)
XML_TAG_RE = re.compile(
    r"<command-name>.*?</command-args>\s*"
    r"|<local-command-stdout>.*?</local-command-stdout>\s*"
    r"|<command-message>[^<]*</command-message>\s*",
    re.DOTALL,
)

# Code fence patterns
CODE_FENCE_RE = re.compile(r"```+.*?```+", re.DOTALL)

# Codex tool block pattern
TOOL_BLOCK_RE = re.compile(
    r"\[external_agent_tool_(?:call|result)(?::\s*\w+)?\].*?\[/external_agent_tool_(?:call|result)\]",
    re.DOTALL,
)

# User query extraction
USER_QUERY_RE = re.compile(r"<user_query>\s*(.+?)\s*</user_query>", re.DOTALL)


def clean_message(text: str) -> str:
    """Remove XML tags and code fences from a message, returning plain text."""
    text = str(text)
    text = XML_TAG_RE.sub("", text)
    text = CODE_FENCE_RE.sub("", text)
    return text.strip()


def extract_command_name(text: str) -> str | None:
    """Extract slash command name like /plan, /cr from <command-name> tag."""
    m = re.search(r"<command-name>(/\S+)</command-name>", text)
    return m.group(1) if m else None


COMMAND_ARGS_RE = re.compile(r"<command-args>\s*(.+?)\s*</command-args>", re.DOTALL)


def extract_user_message(text: str) -> str | None:
    """Extract the user's actual input, handling slash command XML wrappers.

    Priority: <command-args> content > XML-stripped text > command name.
    Returns None if there's no meaningful content (system-only message).
    """
    # Try <command-args> first — this is the user's real question
    m = COMMAND_ARGS_RE.search(text)
    if m:
        return m.group(1).strip()

    # Fallback: strip all XML tags, use remaining text
    cleaned = XML_TAG_RE.sub("", text).strip()
    if cleaned:
        return cleaned

    # Command name only (no args) — still meaningful
    cmd = extract_command_name(text)
    if cmd:
        return f"[slash command: {cmd}]"

    return None


def strip_tool_blocks(text: str) -> str:
    """Remove [external_agent_tool_call:...] and [external_agent_tool_result:...] blocks."""
    cleaned = TOOL_BLOCK_RE.sub("", text)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()
