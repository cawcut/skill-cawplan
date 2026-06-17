"""Model pricing tables and cost calculation.

Pricing is per-1M-tokens. DeepSeek: ¥/MTok | Claude & Cursor: $/MTok.
"""

from __future__ import annotations

# Model pricing table (per 1M tokens).
# cache_write = input × 1.25 for Claude models (5-min cache write tier).
# Ref: https://platform.claude.com/docs/en/about-claude/pricing
PRICING: dict[str, dict] = {
    # DeepSeek (¥/MTok)
    "deepseek-v4-pro":   {"input": 3, "output": 6, "cache_read": 0.025, "cache_write": 3, "currency": "¥"},
    "deepseek-v4-flash": {"input": 1, "output": 2, "cache_read": 0.02,  "cache_write": 1, "currency": "¥"},
    # Claude Opus ($/MTok)
    "claude-opus-4-8":      {"input": 5, "output": 25, "cache_read": 0.50, "cache_write": 6.25, "currency": "$"},
    "claude-opus-4-8-fast": {"input": 10, "output": 50, "cache_read": 1,    "cache_write": 12.5, "currency": "$"},
    "claude-opus-4-7":      {"input": 5, "output": 25, "cache_read": 0.50, "cache_write": 6.25, "currency": "$"},
    "claude-opus-4-7-fast": {"input": 30, "output": 150, "cache_read": 3,   "cache_write": 37.5, "currency": "$"},
    "claude-opus-4-6":      {"input": 5, "output": 25, "cache_read": 0.50, "cache_write": 6.25, "currency": "$"},
    "claude-opus-4-6-fast": {"input": 30, "output": 150, "cache_read": 3,   "cache_write": 37.5, "currency": "$"},
    "claude-opus-4-5":      {"input": 5, "output": 25, "cache_read": 0.50, "cache_write": 6.25, "currency": "$"},
    "claude-opus-4-1":      {"input": 15, "output": 75, "cache_read": 1.50, "cache_write": 18.75, "currency": "$"},
    # Claude Sonnet ($/MTok)
    "claude-sonnet-4-7": {"input": 3, "output": 15, "cache_read": 0.30, "cache_write": 3.75, "currency": "$"},
    "claude-sonnet-4-6": {"input": 3, "output": 15, "cache_read": 0.30, "cache_write": 3.75, "currency": "$"},
    "claude-sonnet-4-5": {"input": 3, "output": 15, "cache_read": 0.30, "cache_write": 3.75, "currency": "$"},
    # Claude Haiku ($/MTok)
    "claude-haiku-4-5":  {"input": 1,    "output": 5,  "cache_read": 0.10, "cache_write": 1.25, "currency": "$"},
    "claude-haiku-3-5":  {"input": 0.80, "output": 4,  "cache_read": 0.08, "cache_write": 1,    "currency": "$"},
    # Cursor Composer ($/MTok)
    "composer-2.5":      {"input": 0.50, "output": 2.50, "cache_read": 0, "cache_write": 0, "currency": "$"},
    "composer-2.5-fast": {"input": 3.00, "output": 15.00, "cache_read": 0, "cache_write": 0, "currency": "$"},
    "composer-2.0":      {"input": 0.50, "output": 2.50, "cache_read": 0, "cache_write": 0, "currency": "$"},
}


def match_pricing(model: str) -> dict | None:
    """Fuzzy-match model name to pricing table entry."""
    if model in PRICING:
        return PRICING[model]
    model_lower = model.lower()
    for name, price in PRICING.items():
        if name in model_lower or model_lower in name:
            return price
    return None


def resolve_pricing_model(model: str, *, speed: str | None = None) -> dict | None:
    """Resolve pricing row. For speed=fast, try model-fast alias first
    (Opus 4.6/4.7/4.8 fast mode). Falls back to base model pricing if no
    fast entry exists (Sonnet, Haiku, etc. — speed does not change price)."""
    if speed and speed.lower() == "fast":
        fast_name = f"{model}-fast" if not model.endswith("-fast") else model
        p = match_pricing(fast_name)
        if p:
            return p
    return match_pricing(model)


def calculate_cost(model: str, usage: dict) -> float | None:
    """Calculate cost in currency units based on token usage."""
    p = match_pricing(model)
    if not p:
        return None
    input_tok = usage.get("input_tokens", 0)
    output_tok = usage.get("output_tokens", 0)
    cache_read = usage.get("cache_read_input_tokens", 0)
    cache_create = usage.get("cache_creation_input_tokens", 0)

    cost = (
        input_tok * p["input"]
        + output_tok * p["output"]
        + cache_read * p["cache_read"]
        + cache_create * p["cache_write"]
    ) / 1_000_000
    return round(cost, 2)


def calculate_cost_for_model(
    model: str,
    usage: dict,
    *,
    speed: str | None = None,
) -> float | None:
    """Calculate cost with optional speed-aware pricing lookup."""
    p = resolve_pricing_model(model, speed=speed)
    if not p:
        return None
    input_tok = usage.get("input_tokens", 0)
    output_tok = usage.get("output_tokens", 0)
    cache_read = usage.get("cache_read_input_tokens", 0)
    cache_create = usage.get("cache_creation_input_tokens", 0)

    cost = (
        input_tok * p["input"]
        + output_tok * p["output"]
        + cache_read * p["cache_read"]
        + cache_create * p["cache_write"]
    ) / 1_000_000
    return round(cost, 2)


def get_currency(model: str) -> str:
    """Return the currency symbol for a model."""
    p = match_pricing(model)
    return p["currency"] if p else "?"


def get_currency_for_model(model: str, *, speed: str | None = None) -> str:
    p = resolve_pricing_model(model, speed=speed)
    return p["currency"] if p else "?"
