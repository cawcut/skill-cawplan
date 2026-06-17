"""Report renderer — reads daily.json + AI summaries → .md or .json report."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

CNY_USD_RATE = 6.7720

_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates"


def _rfc3339_with_tz(value: str) -> str:
    """Normalize timestamp to RFC3339 with explicit timezone."""
    if not value:
        return datetime.now().astimezone().isoformat()
    raw = value.strip()
    if raw.endswith("Z"):
        raw = f"{raw[:-1]}+00:00"
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return datetime.now().astimezone().isoformat()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.now().astimezone().tzinfo)
    return dt.isoformat()


def _load_ai_summaries(summaries_dir: Path) -> dict[str, dict]:
    """Load all AI summary JSONs from summaries dir."""
    ai: dict[str, dict] = {}
    if summaries_dir.is_dir():
        for sf in sorted(summaries_dir.glob("*.json")):
            try:
                with open(sf, "r", encoding="utf-8") as f:
                    ai[sf.stem] = json.load(f)
            except (json.JSONDecodeError, IOError):
                pass
    return ai


def _load_overall_summary(summaries_dir: Path) -> str:
    """Load AI-generated global summary from _overall.json."""
    overall_file = summaries_dir / "_overall.json"
    if overall_file.is_file():
        try:
            with open(overall_file, "r", encoding="utf-8") as f:
                return json.load(f).get("summary", "")
        except (json.JSONDecodeError, IOError):
            pass
    return ""


def _summaries_key(session: dict) -> str:
    agent = session.get("agent", "")
    sid = session.get("session_id", "")[:8]
    return f"{agent}-{sid}"


def _fmt_tok(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.0f}K"
    return str(n)


# ---------------------------------------------------------------------------
# Context builders — prepare structured data for the Jinja2 template
# ---------------------------------------------------------------------------


def _cost_to_usd(cost: float, currency: str) -> float:
    if currency == "¥":
        return cost / CNY_USD_RATE
    if currency == "$":
        return cost
    return 0.0


def _format_cost_str(entry: dict) -> str:
    cost = entry.get("cost")
    if isinstance(cost, (int, float)):
        return f"{entry.get('currency', '')}{cost:.2f}"
    return ""


def _row_tokens(entry: dict) -> tuple[int, int]:
    total_tok = (
        entry.get("input_tokens", 0) + entry.get("output_tokens", 0)
        + entry.get("cache_read_input_tokens", 0)
        + entry.get("cache_creation_input_tokens", 0)
    )
    return total_tok, (
        entry.get("input_tokens", 0) + entry.get("output_tokens", 0)
        + entry.get("cache_read_input_tokens", 0)
    )


def _build_billing_context(daily_json: dict, usage_items: list[dict]) -> dict:
    """Compute billing totals from daily totals + usage rows."""
    agents = daily_json.get("totals", {}).get("agents", [])
    has_claude = "claude-code" in agents
    has_cursor = "cursor" in agents

    total_cost_usd = 0.0
    for cur, amt in (daily_json.get("totals", {}).get("cost") or {}).items():
        total_cost_usd += _cost_to_usd(amt, cur)

    total_tokens = sum(item.get("total_tokens", 0) for item in usage_items)

    return {
        "total_tokens": total_tokens,
        "total_cost_usd": total_cost_usd,
        "has_claude": has_claude,
        "has_cursor": has_cursor,
    }


def _build_usage_breakdown_items(daily_json: dict) -> list[dict]:
    """Build dimension usage rows (Claude breakdown + Cursor API)."""
    items: list[dict] = []

    for row in daily_json.get("usage_breakdown") or []:
        total_tok, subtotal_tok = _row_tokens(row)
        items.append({
            "model": row.get("model", ""),
            "speed": row.get("speed", ""),
            "service_tier": row.get("service_tier", ""),
            "effort": row.get("effort", ""),
            "agents": ["claude-code"],
            "input_tokens": row.get("input_tokens", 0),
            "output_tokens": row.get("output_tokens", 0),
            "cache_read_tokens": row.get("cache_read_input_tokens", 0),
            "api_calls": row.get("api_calls", 0),
            "total_tokens": total_tok,
            "cost": row.get("cost", 0),
            "currency": row.get("currency", "?"),
            "cost_str": _format_cost_str(row),
            "note": "",
        })

    cu = daily_json.get("cursor_api_usage") or {}
    for model, api_entry in (cu.get("by_model") or {}).items():
        api_sum = api_entry.get("summary", api_entry)
        row = {
            "model": model,
            "speed": "—",
            "service_tier": "—",
            "effort": "—",
            "agents": ["cursor"],
            "input_tokens": api_sum.get("input_tokens", 0),
            "output_tokens": api_sum.get("output_tokens", 0),
            "cache_read_tokens": api_sum.get("cache_read_tokens", 0),
            "api_calls": api_entry.get("events", 0),
            "cost": api_sum.get("charged_usd", 0),
            "currency": "$",
            "note": "api_exact",
        }
        total_tok, _ = _row_tokens({
            "input_tokens": row["input_tokens"],
            "output_tokens": row["output_tokens"],
            "cache_read_input_tokens": row["cache_read_tokens"],
            "cache_creation_input_tokens": api_sum.get("cache_write_tokens", 0),
        })
        row["total_tokens"] = total_tok
        row["cost_str"] = _format_cost_str(row)
        items.append(row)

    return items


def _build_model_usage_items(model_usage: dict) -> list[dict]:
    """Legacy per-model rows when usage_breakdown is unavailable."""
    items = []
    for model, entry in model_usage.items():
        total_tok, _ = _row_tokens(entry)
        items.append({
            "model": model,
            "speed": "—",
            "service_tier": "—",
            "effort": "—",
            "agents": entry.get("agents", []),
            "input_tokens": entry.get("input_tokens", 0),
            "output_tokens": entry.get("output_tokens", 0),
            "cache_read_tokens": entry.get("cache_read_input_tokens", 0),
            "api_calls": entry.get("api_calls", 0),
            "total_tokens": total_tok,
            "cost": entry.get("cost", 0),
            "currency": entry.get("currency", "?"),
            "cost_str": _format_cost_str(entry),
            "note": entry.get("note", ""),
        })
    return items


def _build_token_usage_items(daily_json: dict) -> tuple[list[dict], bool]:
    """Prefer dimension breakdown; fallback to legacy model_usage."""
    items = _build_usage_breakdown_items(daily_json)
    if items:
        return items, False
    return _build_model_usage_items(daily_json.get("model_usage", {})), True


def _format_session_cost(s: dict) -> str:
    cost = s.get("session_cost", 0)
    if not isinstance(cost, (int, float)) or cost <= 0:
        return "—"
    basis = s.get("cost_basis", "")
    if basis == "estimate":
        return f"~${cost:.2f} (est)"
    return f"${cost:.2f}"


def _format_session_files(s: dict) -> str:
    count = s.get("files_changed", 0)
    added = s.get("files_added", 0)
    deleted = s.get("files_deleted", 0)
    if not count and not added and not deleted:
        return "—"
    if added or deleted:
        return f"{count} (+{added}/-{deleted})"
    return str(count)


def _build_session_contexts(sessions: list[dict], ai: dict[str, dict]) -> list[dict]:
    """Build enriched session data for the template."""
    result = []
    all_next: list[str] = []
    for s in sessions:
        summary = ai.get(_summaries_key(s), {})
        tr = s.get("time_range", "")
        if isinstance(tr, dict):
            tr = tr.get("display", "")

        agent = s.get("agent_display") or s.get("agent", "")
        total_tok = s.get("total_tokens", 0)
        if total_tok > 0:
            tokens_fmt = _fmt_tok(total_tok)
            token_source = str(s.get("token_source", "") or "")
            if "estimate" in token_source.lower():
                tokens_fmt = f"{tokens_fmt} (est)"
        else:
            tokens_fmt = "—"

        hi = summary.get("human_input", {})
        repos_touched = s.get("repos_touched") if isinstance(s.get("repos_touched"), list) else []
        result.append({
            "agent": agent,
            "time_range": tr,
            "title": summary.get("session_title", s.get("session_name", "")),
            "human_input": {
                "decisions": hi.get("decisions", []),
                "direction": hi.get("direction", []),
                "bugs": hi.get("bugs", []),
                "planning": hi.get("planning", []),
            },
            "summary": summary.get("summary", ""),
            "models": ", ".join(s.get("models", [])),
            "tokens_fmt": tokens_fmt,
            "cost_fmt": _format_session_cost(s),
            "files_fmt": _format_session_files(s),
            "repos_fmt": ", ".join(repos_touched) if repos_touched else "—",
            "_next_steps": summary.get("next_steps", []),
        })
        all_next.extend(summary.get("next_steps", []))
    return result, all_next


# ---------------------------------------------------------------------------
# Markdown render (Jinja2)
# ---------------------------------------------------------------------------


def render_markdown(daily_json: dict, summaries_dir: Path,
                    git_user: str = "", git_email: str = "") -> str:
    """Render the daily markdown report using Jinja2 template."""
    date_str = daily_json["date"]
    repos = daily_json.get("repos", [])
    sessions = daily_json.get("sessions", [])
    ai = _load_ai_summaries(summaries_dir)

    display_name = git_user or daily_json.get("author", "")
    email_user = git_email.split("@")[0] if "@" in git_email else git_email

    overall_summary = _load_overall_summary(summaries_dir)
    if not overall_summary:
        parts = []
        for s in sessions:
            summary = ai.get(_summaries_key(s), {})
            if summary.get("summary"):
                parts.append(summary["summary"])
        overall_summary = " ".join(parts) if parts else f"AI daily report for {len(sessions)} session(s)."

    usage_items, legacy_usage = _build_token_usage_items(daily_json)
    billing = _build_billing_context(daily_json, usage_items)
    session_ctxs, next_steps = _build_session_contexts(sessions, ai)

    try:
        import jinja2
    except ModuleNotFoundError:
        raise ModuleNotFoundError(
            "jinja2 is required for report rendering.\n"
            "Install: python3 -m pip install jinja2"
        )

    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(str(_TEMPLATE_DIR)),
        autoescape=False,
        keep_trailing_newline=True,
    )
    env.filters["fmttok"] = _fmt_tok

    template = env.get_template("report.md.j2")
    return template.render(
        date=date_str,
        display_name=display_name,
        email=git_email or "unknown",
        overall_summary=overall_summary,
        repos=repos,
        usage_items=usage_items,
        legacy_usage=legacy_usage,
        has_claude=billing["has_claude"],
        has_cursor=billing["has_cursor"],
        total_tokens=billing["total_tokens"],
        total_cost_usd=billing["total_cost_usd"],
        sessions=session_ctxs,
        next_steps=next_steps,
    )


# ---------------------------------------------------------------------------
# JSON render
# ---------------------------------------------------------------------------


def render_json(daily_json: dict, summaries_dir: Path,
                git_user: str = "", git_email: str = "") -> dict:
    """Render structured JSON report from daily.json + AI summaries."""
    date_str = daily_json["date"]
    repos = daily_json.get("repos", [])
    sessions = daily_json.get("sessions", [])
    ai = _load_ai_summaries(summaries_dir)

    usage_items, legacy_usage = _build_token_usage_items(daily_json)
    token_usage = []
    for item in usage_items:
        cost_raw = item.get("cost", 0)
        token_usage.append({
            "model": item.get("model", ""),
            "speed": item.get("speed", ""),
            "service_tier": item.get("service_tier", ""),
            "effort": item.get("effort", ""),
            "agents": item.get("agents", []),
            "input_tokens": item.get("input_tokens", 0),
            "output_tokens": item.get("output_tokens", 0),
            "cache_read_tokens": item.get("cache_read_tokens", 0),
            "api_calls": item.get("api_calls", 0),
            "total_tokens": item.get("total_tokens", 0),
            "cost": cost_raw if isinstance(cost_raw, (int, float)) else 0,
            "currency": item.get("currency", "?"),
            "note": item.get("note", ""),
            "legacy_aggregate": legacy_usage,
        })

    session_list = []
    all_next_steps = []

    def _pick_session_project(session: dict) -> str:
        repo_detail = session.get("repos_touched_detail")
        if isinstance(repo_detail, list) and repo_detail:
            valid = [r for r in repo_detail if isinstance(r, dict) and r.get("repo")]
            if valid:
                # Prefer the repo with most file changes in this session.
                top = max(
                    valid,
                    key=lambda r: (
                        int(r.get("files", 0) or 0),
                        int(r.get("added", 0) or 0) + int(r.get("deleted", 0) or 0),
                        str(r.get("repo", "")),
                    ),
                )
                return str(top.get("repo", ""))

        repo_names = session.get("repos_touched")
        if isinstance(repo_names, list) and repo_names:
            first = repo_names[0]
            if isinstance(first, str) and first.strip():
                return first

        return str(session.get("project", "") or "")

    for s in sessions:
        key = _summaries_key(s)
        summary = ai.get(key, {})
        session_list.append({
            "agent": s.get("agent", ""),
            "session_id": s.get("session_id", ""),
            "session_name": s.get("session_name", ""),
            "title": summary.get("session_title", s.get("session_name", "")),
            "time_range": s.get("time_range", ""),
            "project": _pick_session_project(s),
            "message_stats": s.get("message_stats", {}),
            "files_changed": s.get("files_changed", 0),
            "files_added": s.get("files_added", 0),
            "files_deleted": s.get("files_deleted", 0),
            "models": s.get("models", []),
            "human_input": summary.get("human_input", {}),
            "summary": summary.get("summary", ""),
        })
        all_next_steps.extend(summary.get("next_steps", []))

    overall_summary = _load_overall_summary(summaries_dir)
    if not overall_summary:
        parts = [s.get("summary", "") for s in session_list if s.get("summary")]
        overall_summary = " ".join(parts) if parts else ""

    return {
        "schema": "2.0",
        "report_type": "daily",
        "date": date_str,
        "author": git_user or daily_json.get("author", ""),
        "email": git_email,
        "generated_at": _rfc3339_with_tz(daily_json.get("generated_at", "")),
        "summary": overall_summary,
        "repos": repos,
        "token_usage": token_usage,
        "sessions": session_list,
        "human_inputs": daily_json.get("human_inputs", []),
        "next_steps": all_next_steps,
    }


# ---------------------------------------------------------------------------
# File I/O
# ---------------------------------------------------------------------------


def render_to_file(daily_path: Path, output_path: Path, fmt: str = "md",
                   git_user: str = "", git_email: str = "") -> None:
    """Read daily.json, render, write to output_path."""
    with open(daily_path, "r", encoding="utf-8") as f:
        daily = json.load(f)

    summaries_dir = daily_path.parent / "summaries"

    if fmt == "json":
        result = render_json(daily, summaries_dir, git_user=git_user, git_email=git_email)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
    else:
        md = render_markdown(daily, summaries_dir, git_user=git_user, git_email=git_email)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(md)
