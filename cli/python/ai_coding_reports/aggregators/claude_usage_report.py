"""Claude Code daily usage report — per-session and day totals from JSONL."""

from __future__ import annotations

from datetime import date

from ai_coding_reports.aggregators.tokens import (
    aggregate_usage_buckets,
    merge_buckets,
    sum_cost_by_currency,
)
from ai_coding_reports.readers.claude_code import find_sessions_by_date, parse_events
from ai_coding_reports.utils.files import format_number as fmt_num
from ai_coding_reports.utils.timezone import utc_to_local


def _session_metadata(events: list[dict]) -> tuple[str, str, str, dict]:
    """Return session_name, cwd, time_range display, time_range struct."""
    session_name = ""
    cwd = ""
    first_ts = ""
    last_ts = ""

    for evt in events:
        t = evt.get("type", "")
        ts = evt.get("timestamp", "")
        if ts:
            if not first_ts:
                first_ts = ts
            last_ts = ts
        if t == "ai-title":
            title = evt.get("aiTitle", "")
            if title:
                session_name = title
        elif t == "user" and not cwd:
            cwd = evt.get("cwd", "")

    display = ""
    tr_struct: dict = {}
    if first_ts and last_ts:
        start_local = utc_to_local(first_ts)
        end_local = utc_to_local(last_ts)
        display = f"{start_local} ~ {end_local}"
        tr_struct = {
            "display": display,
            "start_local": start_local,
            "end_local": end_local,
        }

    return session_name, cwd, display, tr_struct


def _breakdown_list(buckets: dict[str, dict]) -> list[dict]:
    rows = list(buckets.values())
    rows.sort(
        key=lambda r: (
            r.get("model", ""),
            r.get("speed", ""),
            r.get("service_tier", ""),
            r.get("effort", ""),
        )
    )
    return rows


def _session_totals(buckets: dict[str, dict]) -> dict:
    api_calls = sum(e.get("api_calls", 0) for e in buckets.values())
    return {
        "api_calls": api_calls,
        "cost": sum_cost_by_currency(buckets),
    }


def build_session_report(
    session_id: str,
    jsonl_path: str,
    project_name: str,
    filter_date: date,
    *,
    events: list[dict] | None = None,
    buckets: dict[str, dict] | None = None,
) -> tuple[dict | None, dict[str, dict]]:
    """Build session report. Returns (report_dict, buckets) or (None, {})."""
    if events is None:
        events = parse_events(jsonl_path, filter_date)
    if not events:
        return None, {}

    if buckets is None:
        buckets = aggregate_usage_buckets(events)
    if not buckets:
        return None, {}

    session_name, cwd, tr_display, tr_struct = _session_metadata(events)
    breakdown = _breakdown_list(buckets)

    report = {
        "session_id": session_id,
        "session_id_short": session_id[:8],
        "project": project_name,
        "session_name": session_name,
        "cwd": cwd,
        "time_range": tr_struct or {"display": tr_display},
        "breakdown": breakdown,
        "totals": _session_totals(buckets),
    }
    return report, buckets


def build_day_report(filter_date: date) -> dict:
    """Aggregate all Claude Code sessions active on filter_date."""
    sessions_raw = find_sessions_by_date(filter_date)
    sessions: list[dict] = []
    day_buckets: dict[str, dict] = {}

    for jsonl_path, project_name, ses_id in sessions_raw:
        events = parse_events(jsonl_path, filter_date)
        buckets = aggregate_usage_buckets(events)
        report, buckets = build_session_report(
            ses_id, jsonl_path, project_name, filter_date, events=events, buckets=buckets
        )
        if report:
            sessions.append(report)
            day_buckets = merge_buckets(day_buckets, buckets)

    sessions.sort(key=lambda s: s.get("time_range", {}).get("display", ""))

    day_api_calls = sum(s["totals"].get("api_calls", 0) for s in sessions)
    grand_cost = sum_cost_by_currency(day_buckets)

    return {
        "schema": "claude-usage-report/1.0",
        "date": filter_date.isoformat(),
        "token_source": "jsonl_api",
        "cost_basis": "list_price",
        "session_count": len(sessions),
        "sessions": sessions,
        "day_totals": {
            "by_dimension": _breakdown_list(day_buckets),
            "api_calls": day_api_calls,
            "cost": grand_cost,
        },
        "grand_total": {
            "api_calls": day_api_calls,
            "cost": grand_cost,
        },
    }


def _fmt_cost(cost_map: dict[str, float]) -> str:
    if not cost_map:
        return "—"
    parts = [f"{c}{v:.2f}" for c, v in sorted(cost_map.items())]
    return "  ".join(parts)


def format_day_report_text(report: dict) -> str:
    """Human-readable multi-session usage report."""
    lines: list[str] = []
    d = report.get("date", "?")
    lines.append(f"Claude Code Usage (jsonl_api, list_price)  date: {d}")
    lines.append(f"Sessions: {report.get('session_count', 0)}")
    lines.append("")

    col_header = (
        f"  {'Model':<22} {'Speed':<10} {'Tier':<10} "
        f"{'In':>10} {'Out':>10} {'CacheR':>10} {'Calls':>6}  {'Cost':>8}"
    )

    for sess in report.get("sessions", []):
        sid = sess.get("session_id_short", "?")
        name = (sess.get("session_name") or "(untitled)")[:36]
        proj = (sess.get("project") or "")[:28]
        tr = sess.get("time_range", {})
        tr_disp = tr.get("display", "") if isinstance(tr, dict) else str(tr)
        lines.append(f"── {sid}  {name}  {proj}  {tr_disp}")
        lines.append(col_header)

        for row in sess.get("breakdown", []):
            cost = row.get("cost", "?")
            cost_s = f"{row.get('currency', '')}{cost:.2f}" if isinstance(cost, (int, float)) else str(cost)
            lines.append(
                f"  {row.get('model', '')[:22]:<22} "
                f"{row.get('speed', '')[:10]:<10} "
                f"{row.get('service_tier', '')[:10]:<10} "
                f"{fmt_num(row.get('input_tokens', 0)):>10} "
                f"{fmt_num(row.get('output_tokens', 0)):>10} "
                f"{fmt_num(row.get('cache_read_input_tokens', 0)):>10} "
                f"{row.get('api_calls', 0):>6}  {cost_s:>8}"
            )

        sub = _fmt_cost(sess.get("totals", {}).get("cost", {}))
        lines.append(f"  Session subtotal{' ' * 62}{sub:>8}")
        lines.append("")

    lines.append("═" * 72)
    lines.append("Day total (by model × speed × tier)")
    lines.append(col_header)

    for row in report.get("day_totals", {}).get("by_dimension", []):
        cost = row.get("cost", "?")
        cost_s = f"{row.get('currency', '')}{cost:.2f}" if isinstance(cost, (int, float)) else str(cost)
        lines.append(
            f"  {row.get('model', '')[:22]:<22} "
            f"{row.get('speed', '')[:10]:<10} "
            f"{row.get('service_tier', '')[:10]:<10} "
            f"{fmt_num(row.get('input_tokens', 0)):>10} "
            f"{fmt_num(row.get('output_tokens', 0)):>10} "
            f"{fmt_num(row.get('cache_read_input_tokens', 0)):>10} "
            f"{row.get('api_calls', 0):>6}  {cost_s:>8}"
        )

    lines.append("")
    grand = _fmt_cost(report.get("grand_total", {}).get("cost", {}))
    lines.append(f"Grand total: {grand}")
    lines.append("Token source: jsonl_api  |  Cost basis: list_price (pricing table, not invoice)")
    return "\n".join(lines)
