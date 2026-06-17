"""Character-based token estimation for sessions without API-level token data."""

from __future__ import annotations

import json

CHARS_PER_TOKEN = 4  # Rough: ~4 chars/token for mixed Chinese/English


def _message_char_length(msg: dict) -> tuple[int, int]:
    """Return (input_chars, output_chars) for a single message."""
    role = msg.get("role", "")
    content = msg.get("content", "")

    def text_len(s: str) -> int:
        return len(s) if s else 0

    if role == "user":
        if isinstance(content, str):
            return text_len(content), 0
        if isinstance(content, list):
            total = 0
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    total += text_len(item.get("text", ""))
            return total, 0
        return 0, 0

    if role == "assistant":
        out = 0
        if isinstance(content, str):
            return 0, text_len(content)
        if isinstance(content, list):
            for item in content:
                if not isinstance(item, dict):
                    continue
                t = item.get("type", "")
                if t == "text":
                    out += text_len(item.get("text", ""))
                elif t == "tool_use":
                    inp = item.get("input", item.get("arguments", {}))
                    if isinstance(inp, str):
                        out += text_len(inp)
                    else:
                        out += text_len(json.dumps(inp, ensure_ascii=False, default=str))
            return 0, out
        return 0, 0

    if role == "tool":
        if isinstance(content, str):
            return text_len(content), 0
        if isinstance(content, list):
            total = 0
            for item in content:
                if isinstance(item, dict):
                    if item.get("type") == "text":
                        total += text_len(item.get("text", ""))
                    elif item.get("type") == "tool-result":
                        total += text_len(
                            json.dumps(
                                item.get("result", item.get("content", "")),
                                ensure_ascii=False,
                                default=str,
                            )
                        )
            return total, 0
        return 0, 0

    # system / developer / unknown roles — count all text as input
    if isinstance(content, str):
        return text_len(content), 0
    if isinstance(content, list):
        total = 0
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                total += text_len(item.get("text", ""))
            elif isinstance(item, str):
                total += text_len(item)
        return total, 0
    return 0, 0


def estimate_tokens_from_messages(messages: list[dict]) -> dict:
    """Estimate input/output tokens from message character counts."""
    input_chars = output_chars = 0
    for msg in messages:
        inc, outc = _message_char_length(msg)
        input_chars += inc
        output_chars += outc

    input_tokens = input_chars // CHARS_PER_TOKEN
    output_tokens = output_chars // CHARS_PER_TOKEN

    return {
        "token_source": "estimated",
        "estimation_method": f"chars/{CHARS_PER_TOKEN} (user+tool->input, assistant->output)",
        "input_chars": input_chars,
        "output_chars": output_chars,
        "estimated_input_tokens": input_tokens,
        "estimated_output_tokens": output_tokens,
        "estimated_total_tokens": input_tokens + output_tokens,
    }
