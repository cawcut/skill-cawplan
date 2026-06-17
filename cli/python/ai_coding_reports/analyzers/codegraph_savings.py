#!/usr/bin/env python3
"""
Estimate CodeGraph token / cost savings from Cursor agent-transcripts.

Data sources (best → fallback):
  1. tool-result rows in jsonl (when Cursor stores MCP results)
  2. Measured Read payloads (source files + agent-tools/*.txt, honouring limit/offset)
  3. store.db blobs (~/.cursor/chats/<hash>/<uuid>/store.db) when present
  4. Per-tool heuristics for CodeGraph MCP responses

Session billing split:
  - Cursor usage API events are assigned to sessions by user <timestamp> activity
    windows on the target date (not whole multi-day chat span).

Usage:
    python3 scripts/estimate_codegraph_savings.py --date 2026-06-01
    python3 scripts/estimate_codegraph_savings.py --date 2026-06-01 --json
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from ai_coding_reports.readers.cursor_transcript_io import (
    CHARS_PER_TOKEN,
    SessionIO,
    aggregate_api_by_session,
    local_tz,
    parse_transcript_io,
)

from ai_coding_reports.readers.agent_paths import cursor_projects_dir

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = Path(__file__).resolve().parents[5]

# Fallback CodeGraph response sizes when MCP tool-result is not persisted.
CG_OUTPUT_TOKENS: dict[str, int] = {
    "codegraph_search": 800,
    "codegraph_callers": 1_500,
    "codegraph_callees": 1_500,
    "codegraph_context": 4_000,
    "codegraph_explore": 8_000,
    "codegraph_node": 2_000,
    "codegraph_trace": 5_000,
    "codegraph_impact": 3_000,
    "codegraph_files": 500,
    "codegraph_status": 300,
}

ALT_REPLACEMENTS: dict[str, tuple[int, int]] = {
    "codegraph_search": (3, 2),
    "codegraph_callers": (5, 3),
    "codegraph_callees": (5, 3),
    "codegraph_context": (8, 5),
    "codegraph_explore": (2, 12),
    "codegraph_node": (1, 4),
    "codegraph_trace": (6, 5),
    "codegraph_impact": (6, 4),
    "codegraph_files": (2, 1),
    "codegraph_status": (0, 0),
}

SCENARIO_SCALE = {"conservative": 0.6, "moderate": 1.0, "heavy": 1.5}
CACHE_EFFICIENCY = {"conservative": 0.12, "moderate": 0.22, "heavy": 0.35}
FALLBACK_GREP_TOKENS = 750
FALLBACK_READ_TOKENS = 4_000

# Wall-clock seconds per tool call (MCP round-trip + local I/O; excludes LLM thinking).
CG_TIME_SECONDS: dict[str, float] = {
    "codegraph_search": 0.55,
    "codegraph_callers": 0.70,
    "codegraph_callees": 0.70,
    "codegraph_context": 1.20,
    "codegraph_explore": 2.00,
    "codegraph_node": 0.60,
    "codegraph_trace": 1.40,
    "codegraph_impact": 1.00,
    "codegraph_files": 0.45,
    "codegraph_status": 0.35,
}
FALLBACK_GREP_SECONDS = 0.40
FALLBACK_READ_SECONDS = 0.65
READ_BASE_SECONDS = 0.25
READ_CHARS_PER_SECOND = 60_000  # ~60 KB/s read + parse into context


def _iter_transcripts_for_date(target: date) -> list[tuple[str, str, Path]]:
    from datetime import datetime, timezone

    tz = local_tz()
    found: list[tuple[str, str, Path]] = []
    projects = cursor_projects_dir()
    if not projects.is_dir():
        return found
    for project_dir in sorted(projects.iterdir()):
        if not project_dir.is_dir():
            continue
        transcripts_dir = project_dir / "agent-transcripts"
        if not transcripts_dir.is_dir():
            continue
        for session_dir in transcripts_dir.iterdir():
            if not session_dir.is_dir() or session_dir.name == "subagents":
                continue
            jsonl = session_dir / f"{session_dir.name}.jsonl"
            if not jsonl.is_file():
                continue
            mtime = datetime.fromtimestamp(jsonl.stat().st_mtime, tz=timezone.utc).astimezone(tz)
            if mtime.date() == target:
                found.append((session_dir.name, project_dir.name, jsonl))
    return found


@dataclass
class MethodEstimate:
    method: str
    scenario: str
    direct_saved_tokens: int
    cache_saved_tokens: int
    total_saved_tokens: int
    saved_usd: float
    pct_of_day_usd: float


@dataclass
class SessionBilling:
    session_id: str
    codegraph_calls: int
    charged_usd: float
    total_tokens: int
    activity_window: str
    estimated_saved_usd: float = 0.0


@dataclass
class TimeEstimate:
    scenario: str
    codegraph_calls: int
    cg_tool_seconds: float
    counterfactual_seconds: float
    saved_seconds: float
    speedup_ratio: float
    actual_grep_read_seconds: float


def _format_duration(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.0f}s"
    minutes = seconds / 60
    if minutes < 60:
        return f"{minutes:.1f}m"
    return f"{minutes / 60:.1f}h"


def _avg_read_seconds(sessions: list[SessionIO]) -> float:
    chars = 0
    count = 0
    for sess in sessions:
        for rec in sess.tool_calls:
            if rec.tool == "Read" and rec.result_chars > 0:
                chars += rec.result_chars
                count += 1
    if count == 0:
        return FALLBACK_READ_SECONDS
    avg_chars = chars / count
    return READ_BASE_SECONDS + min(avg_chars / READ_CHARS_PER_SECOND, 3.0)


def _read_seconds_from_chars(chars: int) -> float:
    return READ_BASE_SECONDS + min(chars / READ_CHARS_PER_SECOND, 3.0)


def estimate_time_savings(sessions: list[SessionIO], scenario: str) -> TimeEstimate:
    """Estimate tool-layer wall time: CodeGraph vs grep+Read counterfactual."""
    scale = SCENARIO_SCALE[scenario]
    avg_read = _avg_read_seconds(sessions)
    grep_s = FALLBACK_GREP_SECONDS

    cg_counts: Counter = Counter()
    for sess in sessions:
        cg_counts.update(sess.codegraph)

    cg_seconds = 0.0
    alt_seconds = 0.0
    for tool, count in cg_counts.items():
        cg_seconds += count * CG_TIME_SECONDS.get(tool, 0.8)
        grep_n = max(0, round(ALT_REPLACEMENTS.get(tool, (3, 2))[0] * scale))
        read_n = max(0, round(ALT_REPLACEMENTS.get(tool, (3, 2))[1] * scale))
        alt_seconds += count * (grep_n * grep_s + read_n * avg_read)

    actual_gr_seconds = 0.0
    for sess in sessions:
        for rec in sess.tool_calls:
            if rec.tool == "Grep":
                actual_gr_seconds += grep_s
            elif rec.tool == "Read":
                rc = rec.result_chars or int(avg_read * READ_CHARS_PER_SECOND)
                actual_gr_seconds += _read_seconds_from_chars(rc)

    saved = max(0.0, alt_seconds - cg_seconds)
    speedup = alt_seconds / cg_seconds if cg_seconds > 0 else 0.0

    return TimeEstimate(
        scenario=scenario,
        codegraph_calls=sum(cg_counts.values()),
        cg_tool_seconds=cg_seconds,
        counterfactual_seconds=alt_seconds,
        saved_seconds=saved,
        speedup_ratio=speedup,
        actual_grep_read_seconds=actual_gr_seconds,
    )


def _global_avg_tokens(sessions: list[SessionIO], tool: str) -> int:
    chars = 0
    count = 0
    for sess in sessions:
        for rec in sess.tool_calls:
            if rec.tool == tool and rec.result_chars > 0:
                chars += rec.result_chars
                count += 1
    if count == 0:
        return FALLBACK_READ_TOKENS if tool == "Read" else FALLBACK_GREP_TOKENS
    return chars // CHARS_PER_TOKEN // count


def _cg_actual_tokens_per_call(sess: SessionIO, tool: str) -> int:
    calls = [t for t in sess.tool_calls if t.tool == tool]
    if not calls:
        return AVG_CG_INPUT_TOKENS + CG_OUTPUT_TOKENS.get(tool, 1_000)
    total = 0
    for rec in calls:
        out = rec.result_chars // CHARS_PER_TOKEN if rec.result_chars else CG_OUTPUT_TOKENS.get(tool, 1_000)
        total += rec.input_chars // CHARS_PER_TOKEN + out
    return total // len(calls)


AVG_CG_INPUT_TOKENS = 40


def estimate_savings(
    sessions: list[SessionIO],
    scenario: str,
    method: str,
    api_summary: dict | None,
) -> MethodEstimate:
    scale = SCENARIO_SCALE[scenario]
    cache_eff = CACHE_EFFICIENCY[scenario]
    avg_grep = _global_avg_tokens(sessions, "Grep")
    avg_read = _global_avg_tokens(sessions, "Read")

    actual_cg = 0
    alt_cg = 0
    cg_counts: Counter = Counter()
    for sess in sessions:
        cg_counts.update(sess.codegraph)

    for tool, count in cg_counts.items():
        grep_n = max(0, round(ALT_REPLACEMENTS.get(tool, (3, 2))[0] * scale))
        read_n = max(0, round(ALT_REPLACEMENTS.get(tool, (3, 2))[1] * scale))

        if method == "measured":
            per_call_actual = _cg_actual_tokens_per_call(
                next(s for s in sessions if tool in s.codegraph), tool
            ) if any(tool in s.codegraph for s in sessions) else (
                AVG_CG_INPUT_TOKENS + CG_OUTPUT_TOKENS.get(tool, 1_000)
            )
            # Weighted average across sessions that used this tool
            weighted = 0
            wcount = 0
            for sess in sessions:
                n = sess.codegraph.get(tool, 0)
                if n:
                    weighted += _cg_actual_tokens_per_call(sess, tool) * n
                    wcount += n
            per_call_actual = weighted // wcount if wcount else per_call_actual
            per_call_alt = grep_n * avg_grep + read_n * avg_read
        else:
            per_call_actual = AVG_CG_INPUT_TOKENS + CG_OUTPUT_TOKENS.get(tool, 1_000)
            per_call_alt = grep_n * FALLBACK_GREP_TOKENS + read_n * FALLBACK_READ_TOKENS

        actual_cg += per_call_actual * count
        alt_cg += per_call_alt * count

    direct_saved = max(0, alt_cg - actual_cg)
    cache_saved = 0
    actual_usd = 0.0
    actual_tokens = 0
    if api_summary:
        inp = api_summary.get("input_tokens", 0)
        out = api_summary.get("output_tokens", 0)
        cache_read = api_summary.get("cache_read_tokens", 0)
        actual_usd = api_summary.get("charged_usd", 0.0)
        actual_tokens = api_summary.get("total_tokens", 0)
        if inp + out > 0:
            cache_saved = int(direct_saved * (cache_read / (inp + out)) * cache_eff)

    total_saved = direct_saved + cache_saved
    usd_per_mtok = (actual_usd / actual_tokens * 1_000_000) if actual_tokens else 1.15
    saved_usd = total_saved / 1_000_000 * usd_per_mtok
    pct = (saved_usd / actual_usd * 100) if actual_usd else 0.0

    return MethodEstimate(
        method=method,
        scenario=scenario,
        direct_saved_tokens=direct_saved,
        cache_saved_tokens=cache_saved,
        total_saved_tokens=total_saved,
        saved_usd=saved_usd,
        pct_of_day_usd=pct,
    )


def load_api_events(target: date) -> tuple[list[dict], dict | None]:
    """Return (raw usage events, summary dict). Always fetches events when API auth works."""
    summary: dict | None = None
    daily_json = REPO_ROOT / "Outputs" / "reports" / f"{target.isoformat()}-daily-data.json"
    if daily_json.is_file():
        data = json.loads(daily_json.read_text(encoding="utf-8"))
        usage = data.get("cursor_api_usage")
        if usage and usage.get("summary"):
            summary = usage

    try:
        from ai_coding_reports.readers import cursor_api as cua  # noqa: E402
        from ai_coding_reports.utils.timezone import local_tz as _local_tz

        tzinfo = _local_tz()
        start_ms, _ = cua.day_bounds_ms(target, tzinfo)
        end_ms = start_ms + 86_400_000
        cookie, _ = cua.build_session_cookie()
        events = cua.fetch_usage_events(start_ms, end_ms, cookie)
        if summary is None:
            agg = cua.aggregate_usage(events, tzinfo)
            day = agg["by_day"].get(target.isoformat(), {})
            summary = {
                "summary": day.get("summary", agg["total"]),
                "by_model": day.get("by_model", {}),
            }
        return events, {"summary": summary.get("summary", summary)}
    except Exception as exc:
        import sys as _sys
        print(f"Warning: could not load Cursor API usage ({exc})", file=_sys.stderr)
        if summary:
            return [], {"summary": summary.get("summary", summary)}
        return [], None


def per_session_saved_usd(
    sess: SessionIO,
    session_charged: float,
    day_saved_usd: float,
    total_cg_calls: int,
) -> float:
    if sess.codegraph_total == 0 or total_cg_calls == 0:
        return 0.0
    share = sess.codegraph_total / total_cg_calls
    return day_saved_usd * share


def format_report(
    target: date,
    sessions: list[SessionIO],
    estimates: list[MethodEstimate],
    api_usage: dict | None,
    session_billing: list[SessionBilling],
    data_sources: dict,
    time_estimates: list[TimeEstimate],
) -> str:
    cg_total: Counter = Counter()
    for s in sessions:
        cg_total.update(s.codegraph)

    lines = [
        f"# CodeGraph Savings Estimate — {target.isoformat()}",
        "",
    ]

    measured_mod = next(
        (e for e in estimates if e.method == "measured" and e.scenario == "moderate"), None
    )
    time_mod = next((t for t in time_estimates if t.scenario == "moderate"), None)

    if measured_mod and api_usage and api_usage.get("summary"):
        day_usd = api_usage["summary"].get("charged_usd", 0.0)
        lines.extend([
            "## Summary",
            "",
            f"| | |",
            f"|---|---|",
            f"| **Estimated saved (today)** | **${measured_mod.saved_usd:.2f}** |",
            f"| Day spend (API) | ${day_usd:.2f} |",
            f"| Share of day | {measured_mod.pct_of_day_usd:.1f}% |",
            f"| CodeGraph calls | {sum(cg_total.values())} |",
        ])
        if time_mod:
            lines.append(
                f"| Tool time saved (structural lookups) | {_format_duration(time_mod.saved_seconds)} "
                f"({time_mod.speedup_ratio:.1f}× vs grep+Read) |"
            )
        lines.extend([
            "",
            "> **Best estimate**: measured Read payloads + moderate counterfactual + cache model.",
            "> Excludes LLM re-turns that grep loops would trigger (real savings often higher).",
            "",
        ])

    lines.extend([
        "> Detail sections below (multi-scenario tables for sensitivity).",
        "",
        "## Data sources",
        "",
        f"| Source | Status |",
        f"|--------|--------|",
        f"| jsonl tool-result rows | {data_sources['tool_result_rows']} rows |",
        f"| Measured Read result chars | {data_sources['measured_read_chars']:,} chars |",
        f"| store.db (~/.cursor/chats) | {data_sources['store_db']} |",
        f"| Cursor usage API | {'yes' if api_usage else 'no'} |",
        "",
        "## Tool usage",
        "",
        f"| Metric | Value |",
        f"|--------|-------|",
        f"| Sessions | {len(sessions)} |",
        f"| CodeGraph calls | {sum(cg_total.values())} |",
        f"| Grep calls | {sum(s.grep_calls for s in sessions)} |",
        f"| Read calls | {sum(s.read_calls for s in sessions)} |",
        f"| Avg measured Read result | {_global_avg_tokens(sessions, 'Read'):,} tok |",
        f"| Avg measured Grep result | {_global_avg_tokens(sessions, 'Grep'):,} tok "
        f"(0 = no tool-result rows, uses fallback) |",
        "",
        "### CodeGraph by tool",
        "",
        "| Tool | Calls |",
        "|------|-------|",
    ])
    for tool, n in cg_total.most_common():
        lines.append(f"| `{tool}` | {n} |")

    if api_usage and api_usage.get("summary"):
        s = api_usage["summary"]
        lines.extend([
            "",
            "## Day billing (API)",
            "",
            f"- Total: **{s.get('total_tokens', 0):,}** tokens, **${s.get('charged_usd', 0):.2f}**",
            f"- cacheRead: {s.get('cache_read_tokens', 0):,}",
        ])

    lines.extend([
        "",
        "## Session billing split (by activity timestamps on this day)",
        "",
        "| Session | CG | Activity window | API $ | API tokens | Est. CG saved $ |",
        "|---------|-----|-----------------|-------|------------|-----------------|",
    ])
    for sb in sorted(session_billing, key=lambda x: -x.charged_usd):
        lines.append(
            f"| `{sb.session_id}` | {sb.codegraph_calls} | {sb.activity_window} "
            f"| ${sb.charged_usd:.2f} | {sb.total_tokens:,} | ${sb.estimated_saved_usd:.2f} |"
        )

    cg_usd = sum(sb.charged_usd for sb in session_billing if sb.codegraph_calls > 0)
    non_cg_usd = sum(sb.charged_usd for sb in session_billing if sb.codegraph_calls == 0)
    lines.extend([
        "",
        f"- CodeGraph sessions API total: **${cg_usd:.2f}**",
        f"- Non-CodeGraph sessions API total: **${non_cg_usd:.2f}**",
        "",
        "## Savings estimates",
        "",
        "| Method | Scenario | Direct | Cache | Total | $ saved | % day |",
        "|--------|----------|--------|-------|-------|---------|-------|",
    ])
    for e in estimates:
        lines.append(
            f"| {e.method} | {e.scenario} | {e.direct_saved_tokens:,} | {e.cache_saved_tokens:,} "
            f"| {e.total_saved_tokens:,} | ${e.saved_usd:.2f} | {e.pct_of_day_usd:.1f}% |"
        )

    measured_mod = next(
        (e for e in estimates if e.method == "measured" and e.scenario == "moderate"), None
    )
    time_mod = next((t for t in time_estimates if t.scenario == "moderate"), None)
    if time_mod:
        lines.extend([
            "",
            "## Speed estimate (tool execution only, excludes LLM thinking)",
            "",
            "| Scenario | CG tool time | Without CG (grep+Read) | Saved | Speedup |",
            "|----------|-------------|------------------------|-------|---------|",
        ])
        for t in time_estimates:
            lines.append(
                f"| {t.scenario} | {_format_duration(t.cg_tool_seconds)} "
                f"| {_format_duration(t.counterfactual_seconds)} "
                f"| {_format_duration(t.saved_seconds)} | {t.speedup_ratio:.1f}× |"
            )
        lines.extend([
            "",
            f"- Actual grep+Read tool time today (still ran alongside CG): "
            f"**{_format_duration(time_mod.actual_grep_read_seconds)}**",
            f"- Moderate scenario: **{_format_duration(time_mod.saved_seconds)}** saved on "
            f"**{time_mod.codegraph_calls}** structural lookups (~**{time_mod.speedup_ratio:.1f}×** "
            f"faster than equivalent grep+Read loops).",
            "",
            "> Index lookup inside CodeGraph is sub-ms; dominant cost is MCP round-trip (~0.4–2s).",
            "> Without CG, agents typically chain more grep+Read **and** extra LLM turns — not modeled here.",
        ])

    if measured_mod:
        lines.extend([
            "",
            "## Method notes",
            "",
            f"- Token/cost headline uses **measured + moderate**: ${measured_mod.saved_usd:.2f}.",
            "- CodeGraph MCP response sizes are not in jsonl; CG side still partly heuristic.",
            "- Read/agent-tools payload sizes are measured from file paths.",
        ])
    return "\n".join(lines) + "\n"


def run_codegraph_savings(target_date: date | None = None, json_output: bool = False) -> str | dict:
    """Entry point for CLI. Returns report string or JSON dict."""
    import sys as _sys

    target = target_date or date.today()
    transcripts = _iter_transcripts_for_date(target)
    if not transcripts:
        msg = f"No agent-transcripts for {target.isoformat()}"
        return {"error": msg} if json_output else msg

    sessions = [
        parse_transcript_io(sid, slug, jsonl, target=target)
        for sid, slug, jsonl in transcripts
    ]

    from ai_coding_reports.readers.cursor_transcript_io import find_store_db  # noqa: E402

    store_db_any = any(find_store_db(s.session_id) for s in sessions)
    data_sources = {
        "tool_result_rows": sum(s.tool_result_rows for s in sessions),
        "measured_read_chars": sum(s.measured_read_result_chars for s in sessions),
        "store_db": "available" if store_db_any else "not found (~/.cursor/chats missing)",
    }

    events, api_usage = load_api_events(target)
    api_summary = api_usage.get("summary") if api_usage else None

    session_api: dict[str, dict] = {}
    if events and sessions:
        session_api = aggregate_api_by_session(events, sessions, target)

    scenarios = ["conservative", "moderate", "heavy"]
    estimates: list[MethodEstimate] = []
    for method in ("heuristic", "measured"):
        for sc in scenarios:
            estimates.append(estimate_savings(sessions, sc, method, api_summary))

    mod_measured = next((e for e in estimates if e.method == "measured" and e.scenario == "moderate"), None)
    day_saved = mod_measured.saved_usd if mod_measured else 0.0
    total_cg = sum(s.codegraph_total for s in sessions)
    time_estimates = [estimate_time_savings(sessions, sc) for sc in scenarios]

    session_billing: list[SessionBilling] = []
    for sess in sessions:
        sid = sess.session_id[:8]
        bucket = session_api.get(sid, {})
        window = "?"
        if sess.activity_start and sess.activity_end:
            same_day = sess.activity_start.date() == sess.activity_end.date()
            if same_day:
                window = (
                    f"{sess.activity_start.strftime('%H:%M')}–"
                    f"{sess.activity_end.strftime('%H:%M')}"
                )
            else:
                window = (
                    f"{sess.activity_start.strftime('%m-%d %H:%M')}–"
                    f"{sess.activity_end.strftime('%m-%d %H:%M')}"
                )
        session_billing.append(
            SessionBilling(
                session_id=sid,
                codegraph_calls=sess.codegraph_total,
                charged_usd=bucket.get("charged_usd", 0.0),
                total_tokens=bucket.get("total_tokens", 0),
                activity_window=window,
                estimated_saved_usd=per_session_saved_usd(
                    sess, bucket.get("charged_usd", 0.0), day_saved, total_cg
                ),
            )
        )

    if json_output:
        return {
            "date": target.isoformat(),
            "data_sources": data_sources,
            "sessions": [
                {
                    "session_id": s.session_id,
                    "codegraph": dict(s.codegraph),
                    "grep": s.grep_calls,
                    "read": s.read_calls,
                    "measured_read_chars": s.measured_read_result_chars,
                    "tool_result_rows": s.tool_result_rows,
                    "activity_start": s.activity_start.isoformat() if s.activity_start else None,
                    "activity_end": s.activity_end.isoformat() if s.activity_end else None,
                    "avg_read_result_tokens": s.avg_read_result_tokens(),
                }
                for s in sessions
            ],
            "session_billing": [sb.__dict__ for sb in session_billing],
            "api_usage": api_usage,
            "estimates": [e.__dict__ for e in estimates],
            "time_estimates": [t.__dict__ for t in time_estimates],
        }

    return format_report(
        target, sessions, estimates, api_usage, session_billing, data_sources, time_estimates
    )


if __name__ == "__main__":
    import sys as _sys

    result = run_codegraph_savings()
    if isinstance(result, dict):
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(result)
