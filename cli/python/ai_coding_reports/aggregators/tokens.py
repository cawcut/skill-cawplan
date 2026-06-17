"""Token usage aggregation with deduplication and model/speed/tier buckets."""

from __future__ import annotations

import json
from collections import defaultdict

from ai_coding_reports.utils.pricing import (
    calculate_cost_for_model,
    get_currency_for_model,
)

_SKIP_MODELS = frozenset({"<synthetic>", ""})

_TOKEN_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
)


def _has_billable_tokens(usage: dict) -> bool:
    return any(usage.get(k, 0) for k in _TOKEN_FIELDS)


def _dedup_key(evt: dict, msg: dict, usage: dict) -> tuple:
    mid = msg.get("id")
    if mid:
        return ("id", mid)
    return ("fp", evt.get("timestamp", ""), json.dumps(usage, sort_keys=True))


def usage_dimensions(msg: dict, usage: dict) -> dict[str, str]:
    """Extract billing dimensions from an assistant message."""
    return {
        "model": msg.get("model", "unknown"),
        "speed": usage.get("speed") or "standard",
        "service_tier": usage.get("service_tier") or "standard",
        "effort": usage.get("effort") or msg.get("effort") or "default",
    }


def bucket_key(dims: dict[str, str]) -> str:
    return (
        f"{dims['model']}|speed={dims['speed']}|tier={dims['service_tier']}"
        f"|effort={dims['effort']}"
    )


def _empty_bucket() -> dict:
    return {
        "api_calls": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0,
    }


def aggregate_usage_buckets(events: list[dict]) -> dict[str, dict]:
    """Aggregate assistant usage by model × speed × tier × effort.

    Returns {bucket_key: {model, speed, service_tier, effort, tokens, cost, ...}}.
    """
    buckets: dict[str, dict] = defaultdict(_empty_bucket)
    dims_by_key: dict[str, dict[str, str]] = {}
    seen: set[tuple] = set()

    for evt in events:
        if evt.get("type") != "assistant":
            continue
        msg = evt.get("message", {})
        if isinstance(msg, str):
            continue

        dims = usage_dimensions(msg, msg.get("usage") or {})
        if dims["model"] in _SKIP_MODELS:
            continue

        usage = msg.get("usage", {})
        if not usage or not _has_billable_tokens(usage):
            continue

        key = _dedup_key(evt, msg, usage)
        if key in seen:
            continue
        seen.add(key)

        bkey = bucket_key(dims)
        dims_by_key[bkey] = dims
        entry = buckets[bkey]
        entry["api_calls"] += 1
        entry["input_tokens"] += usage.get("input_tokens", 0)
        entry["output_tokens"] += usage.get("output_tokens", 0)
        entry["cache_read_input_tokens"] += usage.get("cache_read_input_tokens", 0)
        entry["cache_creation_input_tokens"] += usage.get(
            "cache_creation_input_tokens", 0
        )

    result: dict[str, dict] = {}
    for bkey, entry in dict(buckets).items():
        dims = dims_by_key[bkey]
        model = dims["model"]
        speed = dims["speed"]
        cost = calculate_cost_for_model(model, entry, speed=speed)
        currency = get_currency_for_model(model, speed=speed)
        result[bkey] = {
            **dims,
            **entry,
            "cost": cost if cost is not None else "unknown",
            "currency": currency,
        }

    return result


def buckets_from_breakdown(rows: list[dict]) -> dict[str, dict]:
    """Convert session usage_breakdown list to keyed bucket dict."""
    out: dict[str, dict] = {}
    for row in rows:
        dims = {
            "model": row.get("model", "unknown"),
            "speed": row.get("speed", "standard"),
            "service_tier": row.get("service_tier", "standard"),
            "effort": row.get("effort", "default"),
        }
        out[bucket_key(dims)] = row
    return out


def fold_buckets_to_model(buckets: dict[str, dict]) -> dict[str, dict]:
    """Merge dimension buckets into per-model totals (for daily.json compat).

    Token counts are summed per model. Cost is the sum of each dimension
    bucket's pre-calculated cost (preserves speed/tier/effort pricing).
    """
    by_model: dict[str, dict] = defaultdict(_empty_bucket)
    cost_by_model_currency: dict[tuple[str, str], float] = defaultdict(float)
    currencies: dict[str, str] = {}

    for entry in buckets.values():
        model = entry.get("model", "unknown")
        m = by_model[model]
        m["api_calls"] += entry.get("api_calls", 0)
        m["input_tokens"] += entry.get("input_tokens", 0)
        m["output_tokens"] += entry.get("output_tokens", 0)
        m["cache_read_input_tokens"] += entry.get("cache_read_input_tokens", 0)
        m["cache_creation_input_tokens"] += entry.get(
            "cache_creation_input_tokens", 0
        )
        currency = entry.get("currency", "?")
        currencies[model] = currency
        cost = entry.get("cost")
        if isinstance(cost, (int, float)):
            cost_by_model_currency[(model, currency)] += cost

    result: dict[str, dict] = {}
    for model, entry in dict(by_model).items():
        currency = currencies.get(model, "?")
        model_cost = cost_by_model_currency.get((model, currency), 0.0)
        has_bucket_cost = any(
            isinstance(entry.get("cost"), (int, float))
            for entry in buckets.values()
            if entry.get("model") == model
        )
        if has_bucket_cost:
            cost: float | str = round(model_cost, 2)
        else:
            cost = "unknown"
        result[model] = {
            **entry,
            "cost": cost,
            "currency": currency,
        }
    return result


def aggregate_tokens(events: list[dict]) -> dict[str, dict]:
    """Backward-compatible alias: per-model totals (folded from dimension buckets)."""
    return fold_buckets_to_model(aggregate_usage_buckets(events))


def merge_priced_buckets(a: dict[str, dict], b: dict[str, dict]) -> dict[str, dict]:
    """Merge bucket dicts by summing tokens and pre-calculated costs (no repricing).

    Use when merging session ``usage_breakdown`` rows that already have
    speed/tier/effort-aware costs.
    """
    merged: dict[str, dict] = {k: dict(v) for k, v in a.items()}
    for bkey, eb in b.items():
        if bkey not in merged:
            merged[bkey] = dict(eb)
            continue
        ea = merged[bkey]
        for field in _TOKEN_FIELDS:
            ea[field] = ea.get(field, 0) + eb.get(field, 0)
        ea["api_calls"] = ea.get("api_calls", 0) + eb.get("api_calls", 0)
        cost_a, cost_b = ea.get("cost"), eb.get("cost")
        if isinstance(cost_a, (int, float)) and isinstance(cost_b, (int, float)):
            ea["cost"] = round(cost_a + cost_b, 4)
        elif isinstance(cost_b, (int, float)):
            ea["cost"] = cost_b
        elif isinstance(cost_a, (int, float)):
            ea["cost"] = cost_a
    return merged


def merge_buckets(a: dict[str, dict], b: dict[str, dict]) -> dict[str, dict]:
    """Merge two bucket dicts (sum tokens; recompute cost per bucket)."""
    merged: dict[str, dict] = {}
    all_keys = set(a) | set(b)

    for bkey in all_keys:
        ea, eb = a.get(bkey), b.get(bkey)
        if ea and eb:
            base = {k: ea.get(k, 0) + eb.get(k, 0) for k in _TOKEN_FIELDS}
            base["api_calls"] = ea.get("api_calls", 0) + eb.get("api_calls", 0)
            dims = {k: ea.get(k) for k in ("model", "speed", "service_tier", "effort")}
        elif ea:
            base = {k: ea.get(k, 0) for k in (*_TOKEN_FIELDS, "api_calls")}
            dims = {k: ea.get(k) for k in ("model", "speed", "service_tier", "effort")}
        else:
            base = {k: eb.get(k, 0) for k in (*_TOKEN_FIELDS, "api_calls")}
            dims = {k: eb.get(k) for k in ("model", "speed", "service_tier", "effort")}

        model = dims.get("model", "unknown")
        speed = dims.get("speed", "standard")
        cost = calculate_cost_for_model(model, base, speed=speed)
        currency = get_currency_for_model(model, speed=speed)
        merged[bkey] = {
            **dims,
            **base,
            "cost": cost if cost is not None else "unknown",
            "currency": currency,
        }

    return merged


def sum_cost_by_currency(buckets: dict[str, dict]) -> dict[str, float]:
    """Sum numeric costs grouped by currency symbol."""
    totals: dict[str, float] = defaultdict(float)
    for entry in buckets.values():
        cost = entry.get("cost")
        if not isinstance(cost, (int, float)):
            continue
        currency = entry.get("currency", "?")
        totals[currency] += cost
    return {c: round(v, 4) for c, v in totals.items()}


def sum_tokens(model_usage: dict) -> dict[str, int]:
    """Sum input/output tokens across all models or buckets."""
    totals = {"input_tokens": 0, "output_tokens": 0, "cache_read": 0, "cache_write": 0}
    for entry in model_usage.values():
        totals["input_tokens"] += entry.get("input_tokens", 0)
        totals["output_tokens"] += entry.get("output_tokens", 0)
        totals["cache_read"] += entry.get("cache_read_input_tokens", 0)
        totals["cache_write"] += entry.get("cache_creation_input_tokens", 0)
    return totals
