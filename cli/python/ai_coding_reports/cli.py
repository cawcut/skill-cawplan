"""Click CLI — unified entry point for all ai-coding-reports commands."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import click

SCRIPT_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = os.path.normpath(
    os.environ.get(
        "AI_CODING_REPORTS_ROOT",
        os.path.join(str(SCRIPT_DIR), "..", "..", "..", ".."),
    )
)
REPORTS_DIR = os.path.join(REPO_ROOT, "Outputs", "reports")
EXPORTS_DIR = os.path.join(REPO_ROOT, "Outputs", "exports")


@click.group()
@click.version_option(version="2.0.0")
def main():
    """AI Coding Reports — export AI coding agent sessions and generate reports."""
    pass


# ---------------------------------------------------------------------------
# detect
# ---------------------------------------------------------------------------


@main.command()
@click.option("--prefer", type=click.Choice(["cursor", "claude-code", "codex"]))
@click.option("--json", "json_flag", is_flag=True, help="Output JSON")
def detect(prefer: str | None, json_flag: bool):
    """Detect which AI coding agent is active."""
    from ai_coding_reports.readers.detect import detect as do_detect, detect_signals, EXPORT_SCRIPTS

    agent = do_detect(prefer)
    if agent is None:
        click.echo(
            "Cannot auto-detect agent. Set env vars or use --prefer cursor|claude-code|codex.",
            err=True,
        )
        sys.exit(1)

    payload = {
        "agent": agent,
        "export_script": EXPORT_SCRIPTS[agent],
        "cwd": os.getcwd(),
        "signals": detect_signals(),
    }

    if json_flag:
        click.echo(json.dumps(payload, ensure_ascii=False))
    else:
        click.echo(agent)


# ---------------------------------------------------------------------------
# export chats
# ---------------------------------------------------------------------------


@main.group()
def export():
    """Export AI coding sessions in AI Chat Export Protocol format."""
    pass


@export.command("chats")
@click.option("--agent", "-a", required=True, type=click.Choice(["cursor", "claude-code", "codex"]))
@click.option("--session", "-s", help="Session ID (partial match)")
@click.option("--list", "-l", "list_flag", is_flag=True, help="List sessions")
@click.option("--date", "-d", "filter_date", help="Date YYYY-MM-DD")
@click.option("--today", is_flag=True, help="Export only today's messages")
@click.option("--output", "-o", "output_dir", help="Output directory")
def export_chats(
    agent: str,
    session: str | None,
    list_flag: bool,
    filter_date: str | None,
    today: bool,
    output_dir: str | None,
):
    """Export AI chat sessions to markdown protocol format."""
    from ai_coding_reports.readers.cursor_db import collect_sessions
    from ai_coding_reports.readers.claude_code import collect_chat_sessions
    from ai_coding_reports.readers.codex import collect_threads_full

    out = output_dir or os.path.join(EXPORTS_DIR, agent)

    if agent == "cursor":
        from ai_coding_reports.exporters.cursor import export_cursor_session

        sessions = collect_sessions()
        if not sessions:
            click.echo("No Cursor chat sessions found.")
            return

        if list_flag:
            _list_cursor_chats(sessions)
            return

        selected = _match_sessions(sessions, session)
        exported = 0
        for s in selected:
            meta = export_cursor_session(s, out)
            if meta:
                exported += 1
                dt_str = _ms_to_date(s.get("created_at_ms", 0))
                click.echo(
                    f"  [{exported}] {s['name'][:40]} ({dt_str}) -> "
                    f"{meta['stats']['message_count']} msgs, {_fmt_size(s['total_size'])}"
                )

    elif agent == "claude-code":
        from ai_coding_reports.exporters.claude_code import export_claude_session

        sessions = collect_chat_sessions()
        if not sessions:
            click.echo("No Claude Code sessions found.")
            return

        if list_flag:
            _list_claude_chats(sessions)
            return

        f_date = _resolve_filter_date(today, filter_date)
        selected = _match_sessions(sessions, session)
        exported = 0
        for s in selected:
            meta = export_claude_session(s, out, filter_date=f_date)
            if meta:
                exported += 1
                dt_str = s.get("first_ts", "?")[:10]
                click.echo(
                    f"  [{exported}] {s.get('title', '?')[:40]} ({dt_str}) -> "
                    f"{meta['stats']['conv_message_count']} msgs, model={s['model']}"
                )

    elif agent == "codex":
        from ai_coding_reports.exporters.codex import export_codex_thread

        sessions = collect_threads_full()
        if not sessions:
            click.echo("No Codex threads found.")
            return

        if list_flag:
            _list_codex_chats(sessions)
            return

        selected = _match_sessions(sessions, session)
        exported = 0
        total_tokens = 0
        for t in selected:
            meta = export_codex_thread(t, out)
            if meta:
                exported += 1
                total_tokens += meta["stats"]["tokens_used"]
                dt_str = _timestamp_to_date(t["created_at"])
                click.echo(
                    f"  [{exported}] {t['title'][:40]} ({dt_str}) -> "
                    f"{meta['stats']['conv_message_count']} msgs, {_fmt_number(meta['stats']['tokens_used'])} tokens"
                )

    click.echo(f"\nExported {exported} sessions to {os.path.normpath(out)}/")


# ---------------------------------------------------------------------------
# export session
# ---------------------------------------------------------------------------


@export.command("session")
@click.option("--agent", "-a", required=True, type=click.Choice(["cursor", "claude-code", "codex"]))
@click.option("--date", "-d", "target_date", help="Date YYYY-MM-DD (default today)")
@click.option("--all", "all_flag", is_flag=True, help="Export entire session")
@click.option("--session-id", "-s", help="Session ID")
@click.option("--today", is_flag=True, default=True, help="Export today (default)")
@click.option("--output", "-o", "output_dir", help="Output directory")
@click.option("--cwd", help="Working directory")
def export_session(
    agent: str,
    target_date: str | None,
    all_flag: bool,
    session_id: str | None,
    today: bool,
    output_dir: str | None,
    cwd: str | None,
):
    """Export AI coding session data (metrics JSON)."""
    workspace = cwd or os.getcwd()

    if all_flag:
        filter_date = None
        date_label = "all"
    elif target_date:
        filter_date = date.fromisoformat(target_date)
        date_label = target_date
    else:
        filter_date = date.today()
        date_label = filter_date.isoformat()

    out_dir = Path(output_dir) if output_dir else Path(REPORTS_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)

    if agent == "cursor":
        _export_cursor_session(filter_date, date_label, session_id, all_flag, out_dir, workspace)
    elif agent == "claude-code":
        _export_claude_session(filter_date, date_label, session_id, all_flag, out_dir)
    elif agent == "codex":
        _export_codex_session(filter_date, date_label, all_flag, out_dir)


@export.command("debug")
@click.option("--date", "-d", "target_date", help="Date YYYY-MM-DD (default today)")
@click.option("--output", "-o", "out_dir", help="Output directory (default: /tmp/ai-coding-reports-debug/)")
def export_debug(target_date: str | None, out_dir: str | None):
    """Export all report data into a self-contained debug directory.

    Copies per-day report data (JSON, chunks, summaries) to a portable directory
    that can be transferred to another machine for debugging.
    """
    import shutil

    filter_date = date.fromisoformat(target_date) if target_date else date.today()
    date_str = filter_date.isoformat()

    day_dir = Path(REPORTS_DIR) / date_str
    if not day_dir.is_dir():
        click.echo(f"No data for {date_str}. Run 'collect' first.", err=True)
        sys.exit(1)

    debug_root = Path(out_dir) if out_dir else Path("/tmp/ai-coding-reports-debug")
    dest = debug_root / date_str
    dest.mkdir(parents=True, exist_ok=True)

    # Copy all JSON files (session data + daily.json)
    for f in day_dir.glob("*.json"):
        shutil.copy2(f, dest / f.name)
        click.echo(f"  copy {f.name}")

    # Copy chunks (if generated)
    chunks_src = day_dir / "chunks"
    if chunks_src.is_dir():
        chunks_dst = dest / "chunks"
        shutil.copytree(chunks_src, chunks_dst, dirs_exist_ok=True)
        chunk_count = len(list(chunks_dst.glob("*.txt")))
        click.echo(f"  copy chunks/ ({chunk_count} files)")

    # Copy summaries (if AI summaries exist)
    summaries_src = day_dir / "summaries"
    if summaries_src.is_dir():
        summaries_dst = dest / "summaries"
        shutil.copytree(summaries_src, summaries_dst, dirs_exist_ok=True)
        summary_count = len(list(summaries_dst.glob("*.json")))
        click.echo(f"  copy summaries/ ({summary_count} files)")

    # Auto-generate chunks if not yet done
    if not chunks_src.is_dir():
        from ai_coding_reports.aggregators.chunks import write_chunks
        session_files = sorted(f for f in day_dir.glob("*.json") if f.name != "daily.json")
        for sf in session_files:
            paths = write_chunks(dest, sf)
            for p in paths:
                click.echo(f"  gen {p.name}")
            # Also write to source day_dir so it's available there too
            write_chunks(day_dir, sf)

    click.echo(f"\nDebug data exported to: {dest}")
    click.echo(f"Copy to another machine and use: python3 scripts/cli.py render --date {date_str}")
    click.echo(f"(Point REPORTS_DIR to {debug_root} with env var or symlink)")


@export.command("cursor-bundle")
@click.option("--date", "-d", "target_date", help="Date YYYY-MM-DD (default: today)")
@click.option("--all", "all_flag", is_flag=True, help="Pack all Cursor sessions (ignore date filter)")
@click.option("--output", "-o", "out_dir", help="Output directory (default: ~/Downloads)")
@click.option("--include-reports", is_flag=True, help="Include Outputs/reports/<date>/cursor-*.json and daily.json")
@click.option("--list", "list_flag", is_flag=True, help="List files that would be packed (no archive)")
def export_cursor_bundle(
    target_date: str | None,
    all_flag: bool,
    out_dir: str | None,
    include_reports: bool,
    list_flag: bool,
):
    """Pack local Cursor data (transcripts + store.db) into ~/Downloads for offline analysis.

    Includes agent-transcripts jsonl and matching store.db files.
    Excludes state.vscdb (auth token). Git repos are not copied.
    """
    from ai_coding_reports.exporters.cursor_bundle import (
        format_sources_table,
        pack_cursor_bundle,
        plan_cursor_bundle,
    )

    filter_date = None if all_flag else (
        date.fromisoformat(target_date) if target_date else date.today()
    )
    output_path = Path(out_dir).expanduser() if out_dir else Path.home() / "Downloads"
    reports_path = Path(REPORTS_DIR)

    if list_flag:
        click.echo(format_sources_table())
        click.echo()
        plan = plan_cursor_bundle(
            filter_date,
            include_reports=include_reports,
            reports_dir=reports_path,
        )
        click.echo(
            f"Would pack {len(plan.files)} file(s) for "
            f"{len(plan.session_ids)} session(s)"
            + (f" on {filter_date.isoformat()}" if filter_date else " (all dates)")
        )
        for bf in plan.files:
            click.echo(f"  [{bf.kind}] {bf.archive_path}")
            click.echo(f"           <- {bf.source}")
        return

    archive = pack_cursor_bundle(
        filter_date,
        output_dir=output_path,
        include_reports=include_reports,
        reports_dir=reports_path,
    )
    click.echo(f"Cursor bundle -> {archive}")
    click.echo("Contents: transcripts/, store-db/, manifest.json"
               + (" , reports/" if include_reports else ""))
    click.echo("Excluded: state.vscdb (auth), git repos on disk")


@export.command("agent-bundle")
@click.option("--date", "-d", "target_date", help="Date YYYY-MM-DD (default: today)")
@click.option("--all", "all_flag", is_flag=True, help="Pack all sessions (ignore date filter)")
@click.option("--output", "-o", "out_dir", help="Output directory (default: ~/Downloads)")
@click.option("--no-usage-api", is_flag=True, help="Skip Cursor dashboard API usage fetch")
@click.option("--list", "list_flag", is_flag=True, help="List files that would be packed (no archive)")
def export_agent_bundle(
    target_date: str | None,
    all_flag: bool,
    out_dir: str | None,
    no_usage_api: bool,
    list_flag: bool,
):
    """Pack Cursor + Claude Code + Codex native data trees for offline analysis.

    Extract on another machine, set CURSOR_HOME / CLAUDE_HOME / CODEX_HOME, then collect.
    """
    from ai_coding_reports.exporters.agent_bundle import (
        format_sources_table,
        pack_agent_bundle,
        plan_agent_bundle,
    )

    filter_date = None if all_flag else (
        date.fromisoformat(target_date) if target_date else date.today()
    )
    output_path = Path(out_dir).expanduser() if out_dir else Path.home() / "Downloads"

    if list_flag:
        click.echo(format_sources_table())
        click.echo()
        plan = plan_agent_bundle(filter_date, with_usage_api=not no_usage_api)
        total_sessions = sum(len(v) for v in plan.sessions.values())
        click.echo(
            f"Would pack {len(plan.files)} file(s) for {total_sessions} session(s)"
            + (f" on {filter_date.isoformat()}" if filter_date else " (all dates)")
        )
        for agent, sids in plan.sessions.items():
            if sids:
                click.echo(f"  {agent}: {len(sids)} session(s)")
        for bf in plan.files:
            click.echo(f"  [{bf.agent}/{bf.kind}] {bf.archive_path}")
            if bf.source != "__inline__":
                click.echo(f"           <- {bf.source}")
        return

    archive = pack_agent_bundle(
        filter_date,
        output_dir=output_path,
        with_usage_api=not no_usage_api,
    )
    click.echo(f"Agent bundle -> {archive}")
    click.echo("Extract and set env before collect:")
    label = filter_date.isoformat() if filter_date else "all"
    click.echo(f"  export CURSOR_HOME=~/Downloads/agent-data-{label}/cursor")
    click.echo(f"  export CLAUDE_HOME=~/Downloads/agent-data-{label}/claude")
    click.echo(f"  export CODEX_HOME=~/Downloads/agent-data-{label}/codex")


# ---------------------------------------------------------------------------
# usage
# ---------------------------------------------------------------------------


@main.group(invoke_without_command=True)
@click.pass_context
@click.option("--date", "-d", "target_date", help="(cursor default) Single date YYYY-MM-DD")
@click.option("--start", "start_date", help="(cursor) Start date YYYY-MM-DD")
@click.option("--end", "end_date", help="(cursor) End date YYYY-MM-DD")
@click.option("--json", "json_flag", is_flag=True, help="Output JSON only")
@click.option("--out", "out_file", help="Write JSON to file")
def usage(
    ctx: click.Context,
    target_date: str | None,
    start_date: str | None,
    end_date: str | None,
    json_flag: bool,
    out_file: str | None,
):
    """Token/cost usage: `usage cursor` (API) or `usage claude-code` (JSONL)."""
    if ctx.invoked_subcommand is None:
        ctx.invoke(
            usage_cursor,
            target_date=target_date,
            start_date=start_date,
            end_date=end_date,
            json_flag=json_flag,
            out_file=out_file,
        )


@usage.command("cursor")
@click.option("--date", "-d", "target_date", help="Single date YYYY-MM-DD (default today)")
@click.option("--start", "start_date", help="Start date YYYY-MM-DD")
@click.option("--end", "end_date", help="End date YYYY-MM-DD")
@click.option("--json", "json_flag", is_flag=True, help="Output JSON only")
@click.option("--out", "out_file", help="Write JSON to file")
def usage_cursor(
    target_date: str | None,
    start_date: str | None,
    end_date: str | None,
    json_flag: bool,
    out_file: str | None,
):
    """Cursor exact token/cost stats from dashboard API."""
    from ai_coding_reports.readers.cursor_api import (
        aggregate_usage,
        build_session_cookie,
        day_bounds_ms,
        fetch_usage_events,
    )
    from ai_coding_reports.utils.timezone import local_tz
    from ai_coding_reports.utils.files import format_number as fmt_tok

    tzinfo = local_tz()

    if start_date or end_date:
        start_d = date.fromisoformat(start_date) if start_date else date.today()
        end_d = date.fromisoformat(end_date) if end_date else date.today()
    else:
        start_d = end_d = date.fromisoformat(target_date) if target_date else date.today()

    start_ms, _ = day_bounds_ms(start_d, tzinfo)
    _, end_ms = day_bounds_ms(end_d, tzinfo)

    cookie, meta = build_session_cookie()
    events = fetch_usage_events(start_ms, end_ms, cookie)
    agg = aggregate_usage(events, tzinfo)

    result = {
        "source": "cursor.com/api/dashboard/get-filtered-usage-events",
        "token_source": "api_exact",
        "auth": {k: v for k, v in meta.items() if k != "exp"},
        "range": {"start": start_d.isoformat(), "end": end_d.isoformat()},
        "event_count": len(events),
        **agg,
    }

    if out_file:
        Path(out_file).parent.mkdir(parents=True, exist_ok=True)
        Path(out_file).write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    if json_flag:
        click.echo(json.dumps(result, ensure_ascii=False, indent=2))
        return

    rng = start_d.isoformat() if start_d == end_d else f"{start_d} ~ {end_d}"
    click.echo(f"Cursor Usage (exact, API)  range: {rng}")
    if meta.get("email"):
        click.echo(f"Account: {meta['email']}")
    click.echo(f"Events: {len(events)}")
    click.echo()
    for day, d in agg["by_day"].items():
        s = d["summary"]
        click.echo(
            f"  {day}  in {fmt_tok(s['input_tokens'])} / out {fmt_tok(s['output_tokens'])} "
            f"/ cacheR {fmt_tok(s['cache_read_tokens'])} / cacheW {fmt_tok(s['cache_write_tokens'])} "
            f"= {fmt_tok(s['total_tokens'])}  ${s['charged_usd']:.2f}"
        )
        for model, mb in d["by_model"].items():
            click.echo(f"      - {model}: {fmt_tok(mb['total_tokens'])} tok, ${mb['charged_usd']:.2f}")
    t = agg["total"]
    click.echo()
    click.echo(
        f"Total: {fmt_tok(t['total_tokens'])} tokens "
        f"(in {fmt_tok(t['input_tokens'])}, out {fmt_tok(t['output_tokens'])}, "
        f"cacheR {fmt_tok(t['cache_read_tokens'])}, cacheW {fmt_tok(t['cache_write_tokens'])})  "
        f"cost ${t['charged_usd']:.2f}"
    )
    if out_file:
        click.echo(f"\nJSON -> {out_file}")


@usage.command("claude-code")
@click.option("--date", "-d", "target_date", help="Date YYYY-MM-DD (default today)")
@click.option("--json", "json_flag", is_flag=True, help="Output JSON only")
@click.option("--out", "out_file", help="Write JSON to file")
def usage_claude_code(target_date: str | None, json_flag: bool, out_file: str | None):
    """Claude Code token/cost from session JSONL (per session + day totals)."""
    from ai_coding_reports.aggregators.claude_usage_report import (
        build_day_report,
        format_day_report_text,
    )

    filter_date = date.fromisoformat(target_date) if target_date else date.today()
    report = build_day_report(filter_date)

    if out_file:
        Path(out_file).parent.mkdir(parents=True, exist_ok=True)
        Path(out_file).write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    if json_flag:
        click.echo(json.dumps(report, ensure_ascii=False, indent=2))
        return

    if report.get("session_count", 0) == 0:
        click.echo(f"No Claude Code sessions with usage for {filter_date.isoformat()}")
        return

    click.echo(format_day_report_text(report))
    if out_file:
        click.echo(f"\nJSON -> {out_file}")


@usage.command("report")
@click.option("--date", "-d", "target_date", help="Date YYYY-MM-DD (default today)")
@click.option("--start", "start_date", help="Start date YYYY-MM-DD")
@click.option("--end", "end_date", help="End date YYYY-MM-DD")
@click.option("--month", "-m", "month_str", help="Month YYYY-MM (shorthand for full month range)")
@click.option("--agent", "-a", "agents", multiple=True, type=click.Choice(["cursor", "claude-code"]), help="Which agent(s) to include (repeatable, default: all)")
@click.option("--json", "json_flag", is_flag=True, help="Output JSON")
@click.option("--claude-home", "claude_home", help="Path to .claude directory (default ~/.claude)")
def usage_report(
    target_date: str | None,
    start_date: str | None,
    end_date: str | None,
    month_str: str | None,
    agents: list[str] | None,
    json_flag: bool,
    claude_home: str | None,
):
    """Unified usage report across all coding agents."""
    if claude_home:
        os.environ["CLAUDE_HOME"] = claude_home

    # Resolve date range
    if start_date or end_date:
        start_d = date.fromisoformat(start_date) if start_date else date.today()
        end_d = date.fromisoformat(end_date) if end_date else date.today()
    elif month_str:
        y, m = map(int, month_str.split("-"))
        start_d = date(y, m, 1)
        if m == 12:
            end_d = date(y, m, 31)
        else:
            end_d = date(y, m + 1, 1) - timedelta(days=1)
    else:
        start_d = end_d = date.fromisoformat(target_date) if target_date else date.today()

    include_cursor = not agents or "cursor" in agents
    include_claude = not agents or "claude-code" in agents
    date_str = start_d.isoformat() if start_d == end_d else f"{start_d} ~ {end_d}"

    # ── Cursor ──────────────────────────────────────────────────────────
    cursor_data = None
    cursor_error = None
    if include_cursor:
        try:
            from ai_coding_reports.readers.cursor_api import (
                aggregate_usage,
                build_session_cookie,
                day_bounds_ms,
                fetch_usage_events,
            )
            from ai_coding_reports.utils.timezone import local_tz

            tzinfo = local_tz()
            start_ms, _ = day_bounds_ms(start_d, tzinfo)
            _, end_ms = day_bounds_ms(end_d, tzinfo)

            cookie, _meta = build_session_cookie()
            events = fetch_usage_events(start_ms, end_ms, cookie)
            agg = aggregate_usage(events, tzinfo)

            # Merge all days' model data
            models_merged: dict[str, dict] = {}
            total_cost = 0.0
            for day_str, day_data in (agg.get("by_day") or {}).items():
                for model, mb in (day_data.get("by_model") or {}).items():
                    s = mb.get("summary", mb)
                    cost = s.get("charged_usd", 0)
                    total_cost += cost
                    if model in models_merged:
                        m = models_merged[model]
                        m["api_calls"] += mb.get("events", 0)
                        m["input_tokens"] += s.get("input_tokens", 0)
                        m["output_tokens"] += s.get("output_tokens", 0)
                        m["cache_read"] += s.get("cache_read_tokens", 0)
                        m["cache_write"] += s.get("cache_write_tokens", 0)
                        m["cost"] = round(m["cost"] + cost, 4)
                    else:
                        models_merged[model] = {
                            "model": model,
                            "api_calls": mb.get("events", 0),
                            "input_tokens": s.get("input_tokens", 0),
                            "output_tokens": s.get("output_tokens", 0),
                            "cache_read": s.get("cache_read_tokens", 0),
                            "cache_write": s.get("cache_write_tokens", 0),
                            "cost": round(cost, 4),
                            "currency": "$",
                        }
            cursor_data = {
                "source": "cursor.com/dashboard/api/get-filtered-usage-events",
                "method": "API exact (chargedCents) | 精确",
                "event_count": len(events),
                "models": sorted(models_merged.values(), key=lambda m: m["model"]),
                "total_cost": {"$": round(total_cost, 4)},
            }
        except (Exception, SystemExit) as e:
            cursor_error = str(e)

    # ── Claude Code ─────────────────────────────────────────────────────
    claude_data = None
    claude_error = None
    if include_claude:
        try:
            from ai_coding_reports.readers.claude_code import find_sessions_by_date, parse_events
            from ai_coding_reports.readers.agent_paths import claude_home as get_claude_home
            from ai_coding_reports.aggregators.tokens import aggregate_usage_buckets, merge_buckets, sum_cost_by_currency

            sessions = find_sessions_by_date(start_d, end_d if end_d != start_d else None)
            all_buckets: dict[str, dict] = {}
            for jsonl_path, _project, _sid in sessions:
                events = parse_events(jsonl_path, start_d, end_d if end_d != start_d else None)
                if not events:
                    continue
                buckets = aggregate_usage_buckets(events)
                all_buckets = merge_buckets(all_buckets, buckets)

            claude_data = {
                "source": "session jsonl (message.usage)",
                "claude_home": str(get_claude_home()),
                "method": "jsonl_api (估算, ~80% 覆盖率), dedup by message.id, bucketed by model×speed×tier×effort, list_price",
                "session_count": len(sessions),
                "models": [],
                "total_cost": {},
            }
            for bkey, entry in sorted(all_buckets.items()):
                claude_data["models"].append({
                    "model": entry.get("model", ""),
                    "speed": entry.get("speed", ""),
                    "effort": entry.get("effort", ""),
                    "api_calls": entry.get("api_calls", 0),
                    "input_tokens": entry.get("input_tokens", 0),
                    "output_tokens": entry.get("output_tokens", 0),
                    "cache_read": entry.get("cache_read_input_tokens", 0),
                    "cache_write": entry.get("cache_creation_input_tokens", 0),
                    "cost": entry.get("cost"),
                    "currency": entry.get("currency", "?"),
                })
            claude_data["total_cost"] = sum_cost_by_currency(all_buckets)
        except Exception as e:
            claude_error = str(e)

    # ── Output ──────────────────────────────────────────────────────────
    if json_flag:
        result: dict = {"range": {"start": start_d.isoformat(), "end": end_d.isoformat()}, "agents": {}}
        if cursor_data:
            result["agents"]["cursor"] = cursor_data
        elif cursor_error:
            result["agents"]["cursor"] = {"error": cursor_error}
        if claude_data:
            result["agents"]["claude-code"] = claude_data
        elif claude_error:
            result["agents"]["claude-code"] = {"error": claude_error}
        # Merge total, convert to USD
        CNY_USD_RATE = 6.7720
        total: dict[str, float] = {}
        total_usd = 0.0
        for agent_data in (cursor_data, claude_data):
            if agent_data:
                for cur, amt in agent_data.get("total_cost", {}).items():
                    total[cur] = round(total.get(cur, 0) + amt, 4)
                    if cur == "$":
                        total_usd += amt
                    elif cur == "¥":
                        total_usd += amt / CNY_USD_RATE
        result["total_cost"] = total
        result["total_cost_usd"] = round(total_usd, 2)
        result["cny_usd_rate"] = CNY_USD_RATE
        click.echo(json.dumps(result, ensure_ascii=False, indent=2))
        return

    # Text output
    click.echo(f"Range: {date_str}")
    click.echo()

    if include_cursor:
        _print_usage_section(
            "Cursor",
            cursor_data,
            cursor_error,
            "cursor.com dashboard API (精确)",
            "API 返回每次调用的 tokenUsage (input/output/cacheRead/cacheWrite) + chargedCents (实际扣费) | 精确",
            show_effort=False,
        )
    if include_cursor and include_claude:
        click.echo()
    if include_claude:
        claude_path = (claude_data or {}).get("claude_home", "~/.claude")
        _print_usage_section(
            "Claude Code",
            claude_data,
            claude_error,
            f"session jsonl @ {claude_path} (估算, ~80% 覆盖率)",
            "解析 assistant 事件的 message.usage，按 message.id 去重，model × speed × tier × effort 分桶，套定价表计算。\n定价基准: platform.claude.com/docs/en/about-claude/pricing (list price)\n注意: Claude Code 部分后台调用 (title 生成等) 不写入 session jsonl，实际费用约为估算的 1.15-1.25 倍。",
            show_effort=True,
        )

    # CNY→USD exchange rate (PBOC reference, June 2026)
    CNY_USD_RATE = 6.7720

    # Grand total
    if cursor_data or claude_data:
        click.echo()
        click.echo("=== 总计 ===")
        total_usd = 0.0
        total_cny = 0.0
        for agent_data in (cursor_data, claude_data):
            if agent_data:
                for cur, amt in agent_data.get("total_cost", {}).items():
                    if cur == "$":
                        total_usd += amt
                    elif cur == "¥":
                        total_cny += amt
        total_usd += total_cny / CNY_USD_RATE

        parts = []
        if total_cny > 0:
            parts.append(f"¥{total_cny:,.2f} (≈ ${total_cny / CNY_USD_RATE:,.2f})")
        if total_usd > total_cny / CNY_USD_RATE:  # avoid double-counting when only USD
            parts.append(f"${total_usd - total_cny / CNY_USD_RATE:,.2f} (Cursor)")
        parts.append(f"合计 ≈ ${total_usd:,.2f}")
        click.echo("  " + " | ".join(parts))
        click.echo(f"  (CNY→USD @ {CNY_USD_RATE})")
        click.echo()
        click.echo(
            "注: Cursor 费用 = 精确 (dashboard API chargedCents)。"
            "Claude Code 费用 = 估算 (jsonl usage + list price, 约 80% 覆盖率，"
            "实际费用通常比估算高 15-25%，部分后台调用不写 jsonl)。"
        )


@usage.command("sessions")
@click.option("--date", "-d", "target_date", help="Date YYYY-MM-DD (default today)")
@click.option("--start", "start_date", help="Start date YYYY-MM-DD")
@click.option("--end", "end_date", help="End date YYYY-MM-DD")
@click.option("--month", "-m", "month_str", help="Month YYYY-MM (shorthand for full month range)")
@click.option("--agent", "-a", "agents", multiple=True, type=click.Choice(["cursor", "claude-code"]), help="Which agent(s) to include (repeatable, default: both)")
@click.option(
    "--cursor-source",
    "cursor_sources",
    multiple=True,
    type=click.Choice(["cli", "gui"]),
    help="Cursor session source: cli (store.db/transcripts) and/or gui (IDE composer). Default: both when --agent cursor",
)
@click.option("--claude-home", "claude_home", help="Path to .claude directory (default ~/.claude)")
@click.option("--json", "json_flag", is_flag=True, help="Output JSON")
@click.option("--timing-logs", is_flag=True, help="Print phase timing to stderr")
def usage_sessions(
    target_date: str | None,
    start_date: str | None,
    end_date: str | None,
    month_str: str | None,
    agents: list[str] | None,
    cursor_sources: tuple[str, ...],
    claude_home: str | None,
    json_flag: bool,
    timing_logs: bool,
):
    """List coding agent sessions with token usage, cost, and file changes."""
    if claude_home:
        os.environ["CLAUDE_HOME"] = claude_home

    # Resolve date range (same logic as usage_report)
    if start_date or end_date:
        start_d = date.fromisoformat(start_date) if start_date else date.today()
        end_d = date.fromisoformat(end_date) if end_date else date.today()
    elif month_str:
        y, m = map(int, month_str.split("-"))
        start_d = date(y, m, 1)
        if m == 12:
            end_d = date(y, m, 31)
        else:
            end_d = date(y, m + 1, 1) - timedelta(days=1)
    else:
        start_d = end_d = date.fromisoformat(target_date) if target_date else date.today()

    include_cursor = not agents or "cursor" in agents
    include_claude = not agents or "claude-code" in agents

    from ai_coding_reports.utils.timing import TimingLog

    timing = TimingLog(enabled=timing_logs)
    cursor_source_set: frozenset[str] | None = None
    if cursor_sources:
        if not include_cursor:
            click.echo(
                "Warning: --cursor-source ignored without --agent cursor",
                err=True,
            )
        else:
            cursor_source_set = frozenset(cursor_sources)

    from ai_coding_reports.readers.agent_paths import claude_home as get_claude_home
    date_str = start_d.isoformat() if start_d == end_d else f"{start_d} ~ {end_d}"
    results: list[dict] = []
    grand_files = 0
    grand_added = 0
    grand_deleted = 0
    grand_cost: dict[str, float] = {}

    # ── Claude Code ─────────────────────────────────────────────────────
    if include_claude:
        from ai_coding_reports.readers.claude_code import find_sessions_by_date, parse_events
        from ai_coding_reports.utils.timezone import utc_to_local as _utc_to_local
        from ai_coding_reports.aggregators.tokens import aggregate_usage_buckets, sum_cost_by_currency
        from ai_coding_reports.aggregators.files import get_file_changes_claude, build_repos_touched

        with timing.span("claude.find_sessions"):
            sessions = find_sessions_by_date(start_d, end_d if end_d != start_d else None)

        claude_process_s = 0.0
        if timing.enabled:
            from time import perf_counter as _pc

        for jsonl_path, project_name, session_id in sessions:
            _t0 = _pc() if timing.enabled else 0.0
            events = parse_events(jsonl_path, start_d, end_d if end_d != start_d else None)
            if not events:
                continue

            # Extract title, cwd, git branch, time range from events
            title = ""
            cwd = ""
            git_branch = ""
            first_ts = ""
            last_ts = ""
            first_user_msg = ""
            for evt in events:
                ts = evt.get("timestamp", "")
                if ts:
                    if not first_ts:
                        first_ts = ts
                    last_ts = ts
                t = evt.get("type", "")
                if t == "user":
                    if not cwd:
                        cwd = evt.get("cwd", "")
                        git_branch = evt.get("gitBranch", "")
                    msg = evt.get("message", {})
                    content = msg.get("content", "")
                    if isinstance(content, str) and content.strip():
                        if not first_user_msg and not content.startswith("<"):
                            first_user_msg = content.strip()[:80]
                elif t == "ai-title":
                    ai_title = evt.get("aiTitle", "")
                    if ai_title:
                        title = ai_title
            if not title:
                title = first_user_msg
            time_range = ""
            if first_ts and last_ts:
                time_range = f"{_utc_to_local(first_ts)} - {_utc_to_local(last_ts)}"

            # Token usage & cost
            buckets = aggregate_usage_buckets(events)
            cost = sum_cost_by_currency(buckets)
            tokens_in = 0; tokens_out = 0; tokens_cr = 0; tokens_cw = 0; calls = 0
            models: list[dict] = []
            for entry in sorted(buckets.values(), key=lambda e: e.get("model", "")):
                tokens_in += entry.get("input_tokens", 0)
                tokens_out += entry.get("output_tokens", 0)
                tokens_cr += entry.get("cache_read_input_tokens", 0)
                tokens_cw += entry.get("cache_creation_input_tokens", 0)
                calls += entry.get("api_calls", 0)
                models.append({
                    "model": entry.get("model", ""), "speed": entry.get("speed", ""),
                    "api_calls": entry.get("api_calls", 0),
                    "cost": entry.get("cost"), "currency": entry.get("currency", "?"),
                })

            # File changes
            file_changes = get_file_changes_claude(session_id, events)
            if not file_changes:
                snap_files: set[str] = set()
                for evt in events:
                    if evt.get("type") == "file-history-snapshot":
                        for fpath in evt.get("snapshot", {}).get("trackedFileBackups", {}):
                            snap_files.add(fpath)
                if snap_files:
                    file_changes = [
                        {"path": f, "added": 0, "deleted": 0, "change_type": "snapshot", "repo": ""}
                        for f in sorted(snap_files)
                    ]
            repos = build_repos_touched(file_changes)
            fc_files = len(file_changes)
            fc_added = sum(f.get("added", 0) for f in file_changes)
            fc_deleted = sum(f.get("deleted", 0) for f in file_changes)
            snapshot_only = bool(file_changes and file_changes[0].get("change_type") == "snapshot")
            grand_files += fc_files; grand_added += fc_added; grand_deleted += fc_deleted
            for cur, amt in cost.items():
                grand_cost[cur] = round(grand_cost.get(cur, 0) + amt, 4)

            results.append({
                "agent": "claude-code",
                "id": session_id,
                "title": title or "(untitled)",
                "cwd": cwd,
                "project": project_name,
                "time_range": time_range,
                "git_branch": git_branch,
                "repos": repos,
                "snapshot_only": snapshot_only,
                "file_changes": {"files": fc_files, "added": fc_added, "deleted": fc_deleted},
                "models": models,
                "tokens": {"input": tokens_in, "output": tokens_out, "cache_read": tokens_cr, "cache_write": tokens_cw},
                "api_calls": calls,
                "cost": cost,
            })
            if timing.enabled:
                claude_process_s += _pc() - _t0

        if timing.enabled and sessions:
            timing.add("claude.process_sessions", claude_process_s)

    # ── Cursor (CLI + GUI) ───────────────────────────────────────────────
    if include_cursor:
        from ai_coding_reports.aggregators.cursor_sessions import build_cursor_session_rows
        from ai_coding_reports.utils.timezone import utc_to_local as _utc_to_local

        cursor_rows = build_cursor_session_rows(
            start_d,
            end_d,
            detect_files_fn=_detect_cursor_files,
            build_repos_fn=_build_repos,
            utc_to_local_fn=_utc_to_local,
            cursor_sources=cursor_source_set,
            timing=timing,
        )
        for r in cursor_rows:
            fc = r["file_changes"]
            grand_files += fc["files"]
            grand_added += fc["added"]
            grand_deleted += fc["deleted"]
            for cur, amt in r.get("cost", {}).items():
                grand_cost[cur] = round(grand_cost.get(cur, 0) + amt, 4)
            results.append(r)

    timing.emit(header="report:sessions timing")

    # ── Output ──────────────────────────────────────────────────────────
    if json_flag:
        result = {
            "range": {"start": start_d.isoformat(), "end": end_d.isoformat()},
            "claude_home": str(get_claude_home()),
            "session_count": len(results),
            "sessions": results,
            "total": {
                "sessions": len(results),
                "cost": grand_cost,
                "api_calls": sum(r["api_calls"] for r in results),
                "file_changes": {"files": grand_files, "added": grand_added, "deleted": grand_deleted},
            },
        }
        click.echo(json.dumps(result, ensure_ascii=False, indent=2))
        return

    # Text output
    cursor_count = sum(1 for r in results if r.get("agent") == "cursor")
    claude_count = sum(1 for r in results if r.get("agent") == "claude-code")
    agent_label = []
    if include_claude:
        agent_label.append(f"Claude: {claude_count}")
    if include_cursor:
        agent_label.append(f"Cursor: {cursor_count}")
    click.echo(f"=== Sessions: {date_str} ===  (共 {len(results)} 个, {', '.join(agent_label)})")
    click.echo(f"Claude home: {get_claude_home()}")
    click.echo()

    for i, r in enumerate(results, 1):
        sid = r["id"][:8]
        time_range = r.get("time_range", "")
        click.echo("─" * 78)
        agent_label = _session_agent_label(r)
        header = f"[{i}] {sid}  {r['title'][:48]}"
        if time_range:
            header += f"  ({time_range})"
        click.echo(header)
        click.echo(f"    Agent: {agent_label}")
        if r.get("cwd"):
            click.echo(f"    Dir:   {r['cwd']}")
        elif r.get("agent") == "cursor":
            click.echo(f"    Dir:   —")
        # Git repos
        if r["repos"]:
            for repo in r["repos"]:
                click.echo(f"    Repo:  {repo['repo']} ({repo['files']} files, +{repo['added']}/-{repo['deleted']})")
        elif r.get("snapshot_only"):
            pass
        elif r["file_changes"]["files"] > 0:
            click.echo(f"    Repos: (no git remote)")
        else:
            click.echo(f"    Repos: —")
        # File changes
        fc = r["file_changes"]
        repo_files = sum(repo["files"] for repo in r["repos"])
        is_snapshot_only = r.get("snapshot_only", False)
        if fc["files"] > 0:
            if is_snapshot_only:
                line = f"    Files: {fc['files']} 文件 (snapshot only, workspace not available)"
            else:
                line = f"    Files: {fc['files']} 文件, +{fc['added']}/-{fc['deleted']} 行"
                if repo_files and repo_files < fc["files"]:
                    line += f"  ({fc['files'] - repo_files} outside git repos)"
            click.echo(line)
        else:
            click.echo(f"    Files: —")
        # Tokens + cost summary (aligned with daily report Sessions table)
        tk = r["tokens"]
        total_tok = _session_total_tokens(r)
        tok_summary = _session_tokens_fmt(r)
        cost_summary = _session_cost_fmt(r)
        click.echo(
            f"    Usage: {tok_summary} tokens | {cost_summary}"
            f"  ({r['api_calls']} API calls)"
        )
        if total_tok > 0:
            est_tag = " (est)" if "estimate" in str(r.get("_usage_note", "")).lower() else ""
            click.echo(
                f"    Tokens: {_fmt_tok(tk['input'])} in / {_fmt_tok(tk['output'])} out"
                f" / {_fmt_tok(tk['cache_read'])} cacheR / {_fmt_tok(tk['cache_write'])} cacheW{est_tag}"
            )
        if r.get("agent") == "claude-code":
            model_list = ", ".join(f"{m['model']} {m.get('speed', '')}" for m in r["models"])
        else:
            model_list = ", ".join(f"{m['model']}" for m in r["models"])
        if model_list:
            click.echo(f"    Models: {model_list}")
        if r.get("_usage_note"):
            click.echo(f"    Note:  {r['_usage_note']}")

    # Summary table
    if results:
        click.echo("─" * 78)
        click.echo("Summary")
        click.echo("| # | Time | Agent | Session | Tokens | Cost | Files |")
        click.echo("|---|------|-------|---------|--------|------|-------|")
        for i, r in enumerate(results, 1):
            tr = (r.get("time_range") or "")[:17]
            title = (r.get("title") or "")[:36]
            fc = r.get("file_changes") or {}
            if fc.get("files"):
                files_str = f"{fc['files']} (+{fc.get('added', 0)}/-{fc.get('deleted', 0)})"
            else:
                files_str = "—"
            click.echo(
                f"| {i} | {tr} | {_session_agent_label(r)} | {title}"
                f" | {_session_tokens_fmt(r)} | {_session_cost_fmt(r)} | {files_str} |"
            )

    # Grand total
    click.echo("─" * 78)
    cost_parts = [f"{cur}{amt:,.2f}" for cur, amt in sorted(grand_cost.items())]
    grand_tokens = sum(_session_total_tokens(r) for r in results)
    file_part = ""
    if grand_files > 0:
        file_part = f", {grand_files} files (+{grand_added}/-{grand_deleted})"
    cost_str = " / ".join(cost_parts) if cost_parts else "—"
    click.echo(
        f"合计: {len(results)} sessions, {_fmt_tok(grand_tokens)} tokens, {cost_str}{file_part}"
    )



def _print_usage_section(
    label: str,
    data: dict | None,
    error: str | None,
    source: str,
    method: str,
    *,
    show_effort: bool,
):
    click.echo(f"=== {label} ===")
    if error:
        click.echo(f"  获取失败: {error}")
        return
    if not data or not data.get("models"):
        click.echo(f"  无数据  (source: {source})")
        if label == "Claude Code":
            click.echo(f"  检查 claude home 目录是否正确，可通过 --claude-home 指定")
        return
    click.echo(f"数据来源: {source}")
    click.echo(f"计算方式: {method}")
    click.echo()

    models = data["models"]

    # Auto-size model column: longest model name capped at 35
    model_w = min(max(len(m["model"]) for m in models), 35)
    model_w = max(model_w, 10)

    speed_w = 8 if not show_effort else 10
    effort_w = 8 if show_effort else 0

    def _speed_display(m: dict) -> str:
        s = m.get("speed", "")
        return s if s else "—"

    def _effort_display(m: dict) -> str:
        e = m.get("effort", "")
        return e if e else "—"

    # Build rows with calculated widths
    lines: list[str] = []

    # Header
    hdr = f"{'Model':<{model_w}}  {_pad('Speed', speed_w)}  "
    if show_effort:
        hdr += f"{_pad('Effort', effort_w)}  "
    hdr += f"{'Calls':>6}  {'Input':>10}  {'Output':>10}  {'CacheR':>10}  {'CacheW':>10}  {'Cost':>10}"
    lines.append(hdr)
    lines.append("─" * len(hdr))

    for m in models:
        model_disp = m["model"][:model_w]
        speed_disp = _speed_display(m)
        row = f"{model_disp:<{model_w}}  {_pad(speed_disp, speed_w)}  "
        if show_effort:
            effort_disp = _effort_display(m)
            row += f"{_pad(effort_disp, effort_w)}  "
        row += (
            f"{m['api_calls']:>6}  "
            f"{_fmt_tok(m['input_tokens']):>10}  "
            f"{_fmt_tok(m['output_tokens']):>10}  "
            f"{_fmt_tok(m['cache_read']):>10}  "
            f"{_fmt_tok(m['cache_write']):>10}  "
        )
        cost = m["cost"]
        if isinstance(cost, (int, float)):
            row += f"  {m['currency']}{cost:>8,.2f}"
        else:
            row += f"  {str(cost):>9}"
        lines.append(row)

    lines.append("─" * len(hdr))
    total_parts = []
    for cur, amt in sorted(data.get("total_cost", {}).items()):
        total_parts.append(f"{cur}{amt:,.2f}")
    lines.append(f"{label} 合计  {' / '.join(total_parts)}")

    for line in lines:
        click.echo(line)


def _pad(s: str, width: int) -> str:
    """Center-pad a string within given width."""
    return f"{s:^{width}}"


def _fmt_tok(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.0f}K"
    return str(n)


def _session_agent_label(row: dict) -> str:
    agent = row.get("agent", "")
    if agent == "cursor" and row.get("source"):
        return f"cursor-{row['source']}"
    return agent


def _session_total_tokens(row: dict) -> int:
    tk = row.get("tokens") or {}
    return (
        tk.get("input", 0)
        + tk.get("output", 0)
        + tk.get("cache_read", 0)
        + tk.get("cache_write", 0)
    )


def _session_tokens_fmt(row: dict) -> str:
    total = _session_total_tokens(row)
    if total <= 0:
        return "—"
    label = _fmt_tok(total)
    note = str(row.get("_usage_note", "") or "")
    if "estimate" in note.lower():
        label += " (est)"
    return label


def _session_cost_fmt(row: dict) -> str:
    parts = []
    for cur, amt in sorted((row.get("cost") or {}).items()):
        if isinstance(amt, (int, float)) and amt > 0:
            sym = "$" if cur == "$" else cur
            parts.append(f"{sym}{amt:.2f}")
    if not parts:
        return "—"
    label = " / ".join(parts)
    note = str(row.get("_usage_note", "") or "")
    if "estimate" in note.lower():
        return f"~{label} (est)"
    return label


# ---------------------------------------------------------------------------
# analyze
# ---------------------------------------------------------------------------


@main.group()
def analyze():
    """Analysis tools."""
    pass


@analyze.command("codegraph-savings")
@click.option("--date", "-d", "target_date", help="Date YYYY-MM-DD (default today)")
@click.option("--json", "json_flag", is_flag=True, help="Output JSON")
def analyze_codegraph_savings(target_date: str | None, json_flag: bool):
    """Estimate CodeGraph token/cost/time savings from Cursor transcripts."""
    from ai_coding_reports.analyzers.codegraph_savings import run_codegraph_savings

    filter_date = date.fromisoformat(target_date) if target_date else date.today()
    result = run_codegraph_savings(filter_date, json_output=json_flag)
    if isinstance(result, dict):
        click.echo(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        click.echo(result)


# ---------------------------------------------------------------------------
# collect (export all agents + aggregate)
# ---------------------------------------------------------------------------


@main.command()
@click.option("--date", "-d", "target_date", help="Date YYYY-MM-DD (default today)")
@click.option(
    "--agent", "-a", "agents",
    multiple=True,
    type=click.Choice(["claude-code", "cursor", "codex"]),
    help="Export only these agent(s). Default: all three.",
)
@click.option(
    "--clean/--no-clean",
    "clean",
    default=None,
    help="Remove Outputs/reports/{date}/ before export. "
         "Default: on when --agent is set, off when exporting all agents.",
)
def collect(target_date: str | None, agents: tuple[str, ...], clean: bool | None):
    """Export session data and aggregate into daily JSON.

    Combines: export session for each agent + aggregation into one step.
    Agents without data are silently skipped.

    With --agent, cleans Outputs/reports/{date}/ first (unless --no-clean).
    Does not remove Reports/{date}/ markdown files.
    """
    from ai_coding_reports.utils.report_paths import (
        clean_report_day_dir,
        resolve_export_agents,
    )

    filter_date = date.fromisoformat(target_date) if target_date else date.today()
    date_str = filter_date.isoformat()

    if clean is None:
        clean = bool(agents)

    if clean:
        clean_report_day_dir(REPO_ROOT, date_str)
        click.echo(f"Cleaned Outputs/reports/{date_str}/")

    day_dir = Path(REPORTS_DIR) / date_str
    day_dir.mkdir(parents=True, exist_ok=True)

    export_agents = resolve_export_agents(agents)
    exported = []

    for agent in export_agents:
        click.echo(f"-- {agent} --")
        try:
            if agent == "claude-code":
                _export_claude_for_date(filter_date, date_str, day_dir)
            elif agent == "cursor":
                _export_cursor_for_date(filter_date, date_str, day_dir)
            elif agent == "codex":
                _export_codex_for_date(filter_date, date_str, day_dir)
            exported.append(agent)
            click.echo()
        except SystemExit as e:
            if e.code != 0:
                click.echo(f"  skipped (no data or unavailable)", err=True)
            else:
                exported.append(agent)
        except Exception as e:
            click.echo(f"  skipped: {e}", err=True)

    if not exported:
        click.echo("No agent data exported. Nothing to aggregate.")
        return

    click.echo(f"Exported: {', '.join(exported)}")
    click.echo(f"-- aggregate --")
    _run_aggregate(filter_date, date_str, day_dir)


def _export_claude_for_date(filter_date: date, date_str: str, day_dir: Path) -> None:
    from ai_coding_reports.readers.claude_code import find_sessions_by_date, parse_events
    from ai_coding_reports.aggregators.tokens import (
        aggregate_tokens,
        aggregate_usage_buckets,
        fold_buckets_to_model,
    )
    from ai_coding_reports.aggregators.messages import count_messages_claude, build_messages_claude
    from ai_coding_reports.aggregators.files import get_file_changes_claude, build_repos_touched

    sessions = find_sessions_by_date(filter_date)
    if not sessions:
        raise SystemExit(1)

    count = 0
    for jsonl_path, project_name, ses_id in sessions:
        events = parse_events(jsonl_path, filter_date)
        if not events:
            continue
        session_name, cwd, time_range = _extract_claude_metadata(events)
        files = get_file_changes_claude(ses_id, events, filter_date)
        buckets = aggregate_usage_buckets(events)
        single = {
            "schema": "2.0",
            "date": date_str,
            "agent": "claude-code",
            "token_source": "jsonl_api",
            "cost_basis": "list_price",
            "session_id": ses_id,
            "session_name": session_name,
            "project": project_name,
            "cwd": cwd,
            "time_range": time_range,
            "usage_breakdown": list(buckets.values()),
            "model_usage": fold_buckets_to_model(buckets) if buckets else aggregate_tokens(events),
            "files_changed": files,
            "repos_touched": build_repos_touched(files),
            "message_stats": count_messages_claude(events),
            "messages": build_messages_claude(events),
        }
        short_id = ses_id[:8]
        out_path = day_dir / f"claude-code-{short_id}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(single, f, ensure_ascii=False, indent=2)
        count += 1
    click.echo(f"  {count} session(s)")


def _export_cursor_for_date(filter_date: date, date_str: str, day_dir: Path) -> None:
    from ai_coding_reports.aggregators.cursor_sessions import (
        build_collect_session_json,
        build_usage_message_anchors,
        fetch_cursor_usage_by_session,
        _filter_cli_sessions,
        _window_from_cli,
        _window_from_gui,
    )
    from ai_coding_reports.aggregators.messages import count_messages_cursor
    from ai_coding_reports.readers.cursor_db import collect_sessions
    from ai_coding_reports.readers.cursor_gui import collect_gui_sessions

    cli_filtered = _filter_cli_sessions(collect_sessions(), filter_date, filter_date)
    gui_filtered = collect_gui_sessions(filter_date, None)

    windows = []
    for s in cli_filtered:
        w = _window_from_cli(s, filter_date)
        if w:
            windows.append(w)
    for gs in gui_filtered:
        w = _window_from_gui(gs)
        if w:
            windows.append(w)

    anchors = build_usage_message_anchors(cli_filtered, gui_filtered, filter_date)
    usage_map = fetch_cursor_usage_by_session(
        filter_date, filter_date, windows, anchors=anchors
    )

    if not cli_filtered and not gui_filtered:
        raise SystemExit(1)

    count = 0
    for sess in cli_filtered:
        data = build_collect_session_json(
            sess,
            "cli",
            filter_date,
            date_str,
            detect_files_fn=_detect_cursor_files,
            build_repos_fn=_build_repos,
            count_messages_fn=count_messages_cursor,
            build_messages_fn=_build_cursor_messages,
            usage_map=usage_map,
        )
        sid = sess["id"][:8]
        out_path = day_dir / f"cursor-{sid}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        count += 1

    for gs in gui_filtered:
        data = build_collect_session_json(
            gs,
            "gui",
            filter_date,
            date_str,
            detect_files_fn=_detect_cursor_files,
            build_repos_fn=_build_repos,
            count_messages_fn=count_messages_cursor,
            build_messages_fn=_build_cursor_messages,
            usage_map=usage_map,
        )
        sid = gs.id[:8]
        out_path = day_dir / f"cursor-gui-{sid}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        count += 1

    click.echo(f"  {count} session(s)")


def _export_codex_for_date(filter_date: date, date_str: str, day_dir: Path) -> None:
    from ai_coding_reports.readers.codex import collect_threads, parse_messages
    from ai_coding_reports.utils.text import extract_user_message

    threads = collect_threads()
    if not threads:
        raise SystemExit(1)

    filtered = []
    for t in threads:
        ca = t["created_at"]
        if not ca:
            continue
        try:
            td = date.fromtimestamp(ca) if isinstance(ca, (int, float)) else date.fromisoformat(str(ca)[:10])
        except (ValueError, OSError):
            continue
        if filter_date and td != filter_date:
            continue
        filtered.append(t)

    if not filtered:
        raise SystemExit(1)

    count = 0
    for t in filtered:
        msgs = parse_messages(t["rollout_path"])
        if not msgs:
            continue
        model = t["model"] or "unknown"
        messages = []
        total_user = total_assistant = 0
        for m in msgs:
            role = m["role"]
            content = m.get("content", "")
            if role == "user":
                total_user += 1
                text = extract_user_message(content)
                if not text:
                    continue
                messages.append({"role": "user", "time": "", "text": text})
            elif role == "assistant":
                total_assistant += 1
                if content:
                    messages.append({"role": "assistant", "time": "", "text": content})

        data = {
            "schema": "2.0",
            "date": date_str,
            "agent": "codex",
            "session_id": t["id"],
            "session_name": t["title"] or t["first_user_message"] or "",
            "project": t["cwd"] or "",
            "time_range": {"display": "?", "timezone": "UTC"},
            "model_usage": {
                model: {
                    "api_calls": len([m for m in msgs if m["role"] == "assistant"]),
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "cache_read_input_tokens": 0,
                    "cache_creation_input_tokens": 0,
                    "tokens_used": t["tokens_used"] or 0,
                    "cost": "unknown",
                    "currency": "?",
                }
            },
            "files_changed": [],
            "repos_touched": [],
            "message_stats": {"user": total_user, "assistant": total_assistant, "tool_calls": 0},
            "messages": messages,
        }
        short_id = t["id"][:8]
        out_path = day_dir / f"codex-{short_id}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        count += 1
    click.echo(f"  {count} thread(s)")


def _run_aggregate(filter_date: date, date_str: str, day_dir: Path) -> None:
    from ai_coding_reports.aggregators.daily import aggregate_daily_v2
    from ai_coding_reports.utils.git import get_git_username
    from ai_coding_reports.utils.report_paths import list_session_files

    session_files = list_session_files(day_dir)
    if not session_files:
        click.echo("No session files found after export.")
        return

    username = get_git_username(REPO_ROOT)

    cursor_api_usage = None
    try:
        from ai_coding_reports.readers.agent_paths import cursor_usage_api_file

        usage_file = cursor_usage_api_file(filter_date)
        if usage_file.is_file():
            with open(usage_file, encoding="utf-8") as f:
                cursor_api_usage = json.load(f)
            click.echo(f"  cursor usage: {usage_file.name} (bundled/offline)")
        else:
            from ai_coding_reports.readers.cursor_api import aggregate_usage, build_session_cookie, day_bounds_ms, fetch_usage_events
            from ai_coding_reports.utils.timezone import local_tz
            tzinfo = local_tz()
            start_ms, _ = day_bounds_ms(filter_date, tzinfo)
            _, end_ms = day_bounds_ms(filter_date, tzinfo)
            cookie, _meta = build_session_cookie()
            events = fetch_usage_events(start_ms, end_ms, cookie)
            agg = aggregate_usage(events, tzinfo)
            day = agg["by_day"].get(filter_date.isoformat(), {})
            cursor_api_usage = {
                "token_source": "api_exact",
                "source": "cursor.com/api/dashboard/get-filtered-usage-events",
                "event_count": len(events),
                "summary": day.get("summary"),
                "by_model": day.get("by_model", {}),
            }
    except (Exception, SystemExit) as e:
        click.echo(f"  note: Cursor API usage skipped ({e})", err=True)

    output = aggregate_daily_v2(session_files, filter_date, username, cursor_api_usage)

    # CodeGraph savings (best-effort, requires Cursor transcripts)
    try:
        from ai_coding_reports.analyzers.codegraph_savings import run_codegraph_savings
        cg_result = run_codegraph_savings(filter_date, json_output=True)
        if isinstance(cg_result, dict) and "error" not in cg_result:
            output["codegraph_savings"] = {
                "estimates": cg_result.get("estimates", []),
                "time_estimates": cg_result.get("time_estimates", []),
                "sessions": cg_result.get("sessions", []),
            }
            click.echo(f"  codegraph: {sum(e.get('total_saved_tokens', 0) for e in cg_result.get('estimates', [])):,} tokens saved")
    except (Exception, SystemExit) as e:
        click.echo(f"  codegraph: skipped ({e})", err=True)

    out_path = day_dir / "daily.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    totals = output["totals"]
    click.echo(f"  sessions: {totals['sessions']} ({', '.join(totals['agents'])})")
    click.echo(f"  messages: user {totals['messages']['user']} / assistant {totals['messages']['assistant']} / tools {totals['messages']['tool_calls']}")
    click.echo(f"  cost: {totals['cost']}")
    click.echo(f"  -> {out_path}")


# ---------------------------------------------------------------------------
# prepare
# ---------------------------------------------------------------------------


@main.group()
def prepare():
    """Prepare chunk files for AI summarization."""
    pass


@prepare.command("chunks")
@click.option("--date", "-d", "target_date", help="Date YYYY-MM-DD (default today)")
@click.option(
    "--agent", "-a", "agents",
    multiple=True,
    type=click.Choice(["claude-code", "cursor", "codex"]),
    help="Chunk only sessions for these agent(s). Default: all in day dir.",
)
def prepare_chunks(target_date: str | None, agents: tuple[str, ...]):
    """Generate chunk .txt files for AI summarization (max 2 per session, last segments)."""
    from ai_coding_reports.aggregators.chunks import MAX_CHUNKS_PER_SESSION, write_chunks
    from ai_coding_reports.utils.report_paths import list_session_files

    filter_date = date.fromisoformat(target_date) if target_date else date.today()
    date_str = filter_date.isoformat()

    day_dir = Path(REPORTS_DIR) / date_str
    if not day_dir.is_dir():
        click.echo(f"No data directory for {date_str}. Run 'collect' first.", err=True)
        sys.exit(1)

    agent_list = list(agents) if agents else None
    session_files = list_session_files(day_dir, agent_list)
    if not session_files:
        click.echo(f"No session files in {day_dir}. Run 'collect' first.", err=True)
        return

    total_chunks = 0
    for sf in session_files:
        paths = write_chunks(day_dir, sf)
        if paths:
            click.echo(f"  {sf.stem}: {len(paths)} chunk(s)")
            total_chunks += len(paths)

    if agent_list:
        click.echo(
            f"Agents: {', '.join(agent_list)} "
            f"(max {MAX_CHUNKS_PER_SESSION} chunks/session, last segments only)"
        )
    click.echo(f"\nTotal: {total_chunks} chunk file(s) -> {day_dir / 'chunks'}/")


@prepare.command("fake-summaries")
@click.option("--date", "-d", "target_date", help="Date YYYY-MM-DD (default today)")
def prepare_fake_summaries(target_date: str | None):
    """Generate fake AI summaries for template testing only."""
    from ai_coding_reports.aggregators.chunks import write_fake_summaries

    filter_date = date.fromisoformat(target_date) if target_date else date.today()
    date_str = filter_date.isoformat()

    day_dir = Path(REPORTS_DIR) / date_str
    if not day_dir.is_dir():
        click.echo(f"No data directory for {date_str}. Run 'collect' first.", err=True)
        sys.exit(1)

    paths = write_fake_summaries(day_dir)
    for p in paths:
        click.echo(f"  {p.name}")
    click.echo(f"\nFake summaries: {len(paths)} file(s) -> {day_dir / 'summaries'}/")
    click.echo(f"Now run: python3 scripts/cli.py render --date {date_str}")


# ---------------------------------------------------------------------------
# render
# ---------------------------------------------------------------------------


@main.command()
@click.option("--date", "-d", "target_date", help="Date YYYY-MM-DD (default today)")
@click.option("--output", "-o", "out_path", help="Output path")
@click.option("--format", "-f", "fmt", type=click.Choice(["md", "json"]), default="md",
              help="Output format (default: md)")
def render(target_date: str | None, out_path: str | None, fmt: str):
    """Render daily report from daily.json + AI summaries (md or json)."""
    from ai_coding_reports.reporters.render import render_to_file
    from ai_coding_reports.utils.git import get_git_email_username, get_git_username, get_git_email

    filter_date = date.fromisoformat(target_date) if target_date else date.today()
    date_str = filter_date.isoformat()

    day_dir = Path(REPORTS_DIR) / date_str
    daily_path = day_dir / "daily.json"
    if not daily_path.is_file():
        click.echo(f"No daily.json for {date_str}. Run 'collect' first.", err=True)
        sys.exit(1)

    email_user = get_git_email_username(REPO_ROOT)
    git_user = get_git_username(REPO_ROOT)
    git_email = get_git_email(REPO_ROOT)

    if out_path:
        output_path = Path(out_path)
    else:
        ext = "json" if fmt == "json" else "md"
        out_dir = Path(REPO_ROOT) / "Reports" / date_str
        output_path = out_dir / f"{email_user}.{ext}"

    render_to_file(daily_path, output_path, fmt=fmt, git_user=git_user, git_email=git_email)
    click.echo(f"Report -> {output_path}")




# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _resolve_filter_date(today_flag: bool, filter_date: str | None) -> date | None:
    if today_flag:
        return date.today()
    if filter_date:
        return date.fromisoformat(filter_date)
    return None


def _match_sessions(sessions: list[dict], hint: str | None) -> list[dict]:
    if not hint:
        return sessions
    matched = [s for s in sessions if hint in s.get("id", "")]
    if not matched and hasattr(sessions[0] if sessions else {}, "get"):
        matched = [s for s in sessions if hint.lower() in s.get("title", s.get("name", "")).lower()]
    return matched[:5]


def _ms_to_date(ms: int) -> str:
    try:
        return datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d")
    except Exception:
        return "?"


def _timestamp_to_date(ts) -> str:
    try:
        if isinstance(ts, (int, float)):
            return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
        return str(ts)[:10]
    except Exception:
        return "?"


def _fmt_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes}B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f}KB"
    else:
        return f"{size_bytes / 1024 / 1024:.1f}MB"


def _fmt_number(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    elif n >= 1_000:
        return f"{n / 1_000:.0f}K"
    return str(n)


def _list_cursor_chats(sessions: list[dict]):
    click.echo(f"{'Session':<38s} {'Date':<12s} {'Model':<30s} {'Blobs':>6s} {'Size':>8s}")
    click.echo("-" * 100)
    for s in sessions:
        dt = _ms_to_date(s.get("created_at_ms", 0))
        click.echo(
            f"  {s['name']:<36s}  {dt:<10s}  {s['model']:<28s}  "
            f"{s['total_blobs']:>5d}  {_fmt_size(s['total_size']):>6s}"
        )
    click.echo(f"\n{len(sessions)} sessions total.")


def _list_claude_chats(sessions: list[dict]):
    click.echo(f"{'Session':<40s} {'Date':<12s} {'Model':<20s} {'Project':<40s}")
    click.echo("-" * 115)
    for s in sessions:
        dt = s.get("first_ts", "?")[:10]
        click.echo(f"  {s.get('title','?')[:38]:<38s}  {dt:<10s}  {s['model']:<18s}  {s['project'][:38]:<38s}")
    click.echo(f"\n{len(sessions)} sessions total.")


def _list_codex_chats(sessions: list[dict]):
    from ai_coding_reports.utils.files import format_number
    click.echo(f"{'Thread':<36s} {'Date':<12s} {'Model':<16s} {'Tokens':>10s} {'Source':<8s}")
    click.echo("-" * 90)
    for t in sessions:
        dt = _timestamp_to_date(t.get("created_at", ""))
        click.echo(f"  {t['title']:<34s}  {dt:<10s}  {t['model']:<14s}  {format_number(t['tokens_used']):>8s}  {t.get('source',''):<6s}")
    click.echo(f"\n{len(sessions)} threads total.")


# ---------------------------------------------------------------------------
# Per-agent session export implementations
# ---------------------------------------------------------------------------


def _export_cursor_session(filter_date, date_label, session_id, all_flag, out_dir, cwd):
    from ai_coding_reports.readers.cursor_db import collect_sessions, read_session_messages
    from ai_coding_reports.readers.cursor_resolve import resolve_cursor_session, resolve_to_collect_session
    from ai_coding_reports.utils.timezone import local_tz
    from ai_coding_reports.aggregators.skills import count_tool_calls_cursor
    from ai_coding_reports.aggregators.messages import count_messages_cursor, build_timeline_cursor
    from ai_coding_reports.utils.tokens import estimate_tokens_from_messages
    from ai_coding_reports.utils.timezone import ms_to_local, format_tz_label, get_display_timezone
    import re
    from datetime import datetime, timezone

    # Per-day bulk export (no session hint)
    has_session_spec = any([all_flag, session_id])
    if filter_date is not None and not has_session_spec:
        sessions = collect_sessions()
        filtered = _filter_cursor_by_date(sessions, filter_date)
        if not filtered:
            click.echo(f"No Cursor sessions for {date_label}", err=True)
            sys.exit(1)

        for sess in filtered:
            messages = read_session_messages(sess)
            tool_counts, skill_counts = count_tool_calls_cursor(messages)
            msg_stats = count_messages_cursor(messages)
            timeline = build_timeline_cursor(messages, sess["id"], sess.get("name", sess["id"]))

            tzinfo, _ = get_display_timezone()
            time_range = {
                "display": "?",
                "timezone": format_tz_label(tzinfo),
            }
            token_est = estimate_tokens_from_messages(messages)
            model = sess.get("model") or "unknown"

            data = _build_cursor_session_data(
                date_label, sess, model, time_range, token_est,
                msg_stats, tool_counts, skill_counts, timeline, cwd,
            )
            sid = sess["id"][:8]
            output_path = out_dir / f"{date_label}-cursor-{sid}-data.json"
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

            click.echo(f"Session: {sess.get('name', '?')[:50]} ({sid}...)")
            click.echo(f"  Messages: user {msg_stats['user']} / assistant {msg_stats['assistant']} / tool {msg_stats['tool_calls']}")
            click.echo(f"  Data -> {output_path}")

        click.echo(f"\nDate: {date_label}")
        click.echo(f"Exported {len(filtered)} sessions")
        return

    # Single session resolution
    hint = session_id
    ref = resolve_cursor_session(cwd, session_id=hint, filter_date=filter_date)
    if ref is None and hint:
        sessions = collect_sessions()
        filtered = _filter_cursor_by_date(sessions, filter_date)
        picked = _match_sessions(filtered, hint)
        if picked:
            sess = picked[0]
        else:
            click.echo(f"Session not found: {hint}", err=True)
            sys.exit(1)
    elif ref is not None:
        sess = resolve_to_collect_session(ref)
        if sess is None:
            click.echo(f"No store.db: {ref.session_id}", err=True)
            sys.exit(1)
    else:
        click.echo(f"Cannot resolve Cursor session in {cwd}", err=True)
        sys.exit(1)

    messages = read_session_messages(sess)
    tool_counts, skill_counts = count_tool_calls_cursor(messages)
    msg_stats = count_messages_cursor(messages)
    timeline = build_timeline_cursor(messages, sess["id"], sess.get("name", sess["id"]))

    tzinfo, _ = get_display_timezone()
    time_range = {
        "display": "?",
        "timezone": format_tz_label(tzinfo),
    }
    token_est = estimate_tokens_from_messages(messages)
    model = sess.get("model") or "unknown"

    data = _build_cursor_session_data(
        date_label, sess, model, time_range, token_est,
        msg_stats, tool_counts, skill_counts, timeline, cwd,
    )
    sid = sess["id"][:8]
    output_path = out_dir / f"{date_label}-cursor-{sid}-data.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    click.echo(f"Date: {date_label}")
    click.echo(f"Agent: cursor")
    click.echo(f"Session: {sess.get('name','?')[:50]} ({sid}...)")
    click.echo(
        f"Messages: user {msg_stats['user']} / assistant {msg_stats['assistant']} / tool {msg_stats['tool_calls']}"
    )
    click.echo(
        f"Tokens (est): input ~{token_est['estimated_input_tokens']:,} / output ~{token_est['estimated_output_tokens']:,}"
    )
    click.echo(f"Data -> {output_path}")


def _export_claude_session(filter_date, date_label, session_id, all_flag, out_dir):
    from ai_coding_reports.readers.claude_code import (
        find_session_jsonl,
        find_sessions_by_date,
        parse_events,
    )
    from ai_coding_reports.aggregators.tokens import aggregate_tokens
    from ai_coding_reports.aggregators.messages import count_messages_claude, build_timeline_claude, build_messages_claude
    from ai_coding_reports.aggregators.files import get_file_changes_claude, build_repos_touched
    from ai_coding_reports.aggregators.skills import collect_skills_claude

    has_session_id = session_id or os.environ.get("CLAUDE_CODE_SESSION_ID", "")

    if filter_date and not has_session_id and not all_flag:
        sessions = find_sessions_by_date(filter_date)
        if not sessions:
            click.echo(f"No Claude Code sessions for {date_label}", err=True)
            sys.exit(1)

        for jsonl_path, project_name, ses_id in sessions:
            events = parse_events(jsonl_path, filter_date)
            if not events:
                continue

            session_name, cwd, time_range = _extract_claude_metadata(events)
            model_usage = aggregate_tokens(events)
            files_changed = get_file_changes_claude(ses_id, events, filter_date)
            skills_used = collect_skills_claude(events)
            message_stats = count_messages_claude(events)
            timeline = build_timeline_claude(events)
            messages = build_messages_claude(events)
            repos_touched = build_repos_touched(files_changed)

            short_id = ses_id[:8]
            single = {
                "date": date_label,
                "agent": "claude-code",
                "session_id": ses_id,
                "session_name": session_name,
                "project": project_name,
                "cwd": cwd,
                "time_range": time_range,
                "model_usage": model_usage,
                "files_changed": files_changed,
                "repos_touched": repos_touched,
                "skills_used": skills_used,
                "message_stats": message_stats,
                "timeline": timeline,
                "messages": messages,
            }

            output_path = out_dir / f"{date_label}-{short_id}-data.json"
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(single, f, ensure_ascii=False, indent=2)
            click.echo(f"Session: {session_name[:50]} ({project_name})")
            click.echo(f"  Models: {', '.join(model_usage.keys()) or 'none'}")
            click.echo(f"  Messages: user {message_stats.get('user', 0)} / assistant {message_stats.get('assistant', 0)}")
            click.echo(f"  Data -> {output_path}")

        click.echo(f"\nDate: {date_label}")
        click.echo(f"Exported {len(sessions)} sessions")
        return

    # Single session
    jsonl_path, project_name = find_session_jsonl(session_id or None)
    ses_id = os.path.basename(jsonl_path).replace(".jsonl", "")

    events = parse_events(jsonl_path, filter_date)
    if not events:
        click.echo(f"No data for {date_label}", err=True)
        sys.exit(1)

    session_name, cwd, time_range = _extract_claude_metadata(events)
    model_usage = aggregate_tokens(events)
    files_changed = get_file_changes_claude(ses_id, events, filter_date)
    skills_used = collect_skills_claude(events)
    message_stats = count_messages_claude(events)
    timeline = build_timeline_claude(events)
    messages = build_messages_claude(events)
    repos_touched = build_repos_touched(files_changed)

    data = {
        "date": date_label,
        "agent": "claude-code",
        "time_range": time_range,
        "session_id": ses_id,
        "session_name": session_name,
        "project": project_name,
        "cwd": cwd,
        "model_usage": model_usage,
        "files_changed": files_changed,
        "repos_touched": repos_touched,
        "skills_used": skills_used,
        "message_stats": message_stats,
        "timeline": timeline,
        "messages": messages,
    }

    short_id = ses_id[:8]
    output_path = out_dir / f"{date_label}-{short_id}-data.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    total_input = sum(m.get("input_tokens", 0) + m.get("cache_read_input_tokens", 0) for m in model_usage.values())
    total_output = sum(m.get("output_tokens", 0) for m in model_usage.values())

    click.echo(f"Date: {date_label} ({time_range})")
    click.echo(f"Session: {session_name[:50]} ({project_name})")
    click.echo(f"Models: {', '.join(model_usage.keys()) or 'none'}")
    click.echo(f"Tokens: input {total_input:,} / output {total_output:,}")
    click.echo(f"Files changed: {len(files_changed)}, repos: {len(repos_touched)}")
    click.echo(f"User messages: {message_stats.get('user', 0)}")
    click.echo(f"Data -> {output_path}")


def _export_codex_session(filter_date, date_label, all_flag, out_dir):
    from ai_coding_reports.readers.codex import collect_threads, parse_messages
    from ai_coding_reports.utils.text import clean_message, extract_command_name

    threads = collect_threads()
    if not threads:
        click.echo("No Codex threads found")
        sys.exit(1)

    filtered = []
    for t in threads:
        ca = t["created_at"]
        if not ca:
            continue
        try:
            td = date.fromtimestamp(ca) if isinstance(ca, (int, float)) else date.fromisoformat(str(ca)[:10])
        except (ValueError, OSError):
            continue
        if filter_date and td != filter_date:
            continue
        filtered.append(t)

    if not filtered:
        click.echo(f"No Codex data for {date_label}")
        sys.exit(1)

    all_model_usage = {}
    total_user = 0
    total_assistant = 0
    all_timelines = []

    for t in filtered:
        msgs = parse_messages(t["rollout_path"])
        if not msgs:
            continue

        model = t["model"] or "unknown"
        tokens = t["tokens_used"] or 0
        all_model_usage[model] = {
            "api_calls": len([m for m in msgs if m["role"] == "assistant"]),
            "tokens_used": tokens,
        }

        for m in msgs:
            if m["role"] == "user":
                total_user += 1
            elif m["role"] == "assistant":
                total_assistant += 1

        title = t["title"] or t["first_user_message"] or ""
        for m in msgs:
            if m["role"] == "user":
                cleaned = clean_message(m["content"])
                if cleaned:
                    preview = cleaned[:120]
                else:
                    cmd = extract_command_name(m["content"])
                    preview = f"[slash command: {cmd}]" if cmd else "[system message]"
                all_timelines.append({
                    "session": title[:40],
                    "preview": preview,
                })

    data = {
        "date": date_label,
        "thread_count": len(filtered),
        "model_usage": all_model_usage,
        "message_stats": {"user": total_user, "assistant": total_assistant},
        "timeline": all_timelines,
    }

    output_path = out_dir / f"{date_label}-codex-data.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    total_tokens = sum(m.get("tokens_used", 0) for m in all_model_usage.values())
    click.echo(f"Date: {date_label}")
    click.echo(f"Codex threads: {len(filtered)}")
    click.echo(f"Tokens: {total_tokens:,}")
    click.echo(f"Messages: user {total_user} / assistant {total_assistant}")
    click.echo(f"Data -> {output_path}")


# ---------------------------------------------------------------------------
# Shared helpers for session export
# ---------------------------------------------------------------------------


def _filter_cursor_by_date(sessions, filter_date):
    from datetime import datetime, timezone
    from ai_coding_reports.utils.timezone import local_tz

    if filter_date is None:
        return sessions
    out = []
    tz = local_tz()
    for s in sessions:
        ms = s.get("created_at_ms") or 0
        if ms:
            d = datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(tz).date()
            if d == filter_date:
                out.append(s)
                continue
        try:
            mtime = Path(s["db_path"]).stat().st_mtime
            if datetime.fromtimestamp(mtime, tz=timezone.utc).astimezone(tz).date() == filter_date:
                out.append(s)
        except OSError:
            pass
    return out


def _build_cursor_session_data(date_label, sess, model, time_range, token_est,
                                msg_stats, tool_counts, skill_counts, timeline, cwd):
    est_input = token_est.get("estimated_input_tokens", 0)
    est_output = token_est.get("estimated_output_tokens", 0)

    from ai_coding_reports.utils.pricing import match_pricing

    p = match_pricing(model)
    cost_info = {"cost": "unknown", "currency": "?"}
    if p:
        cost = (est_input * p["input"] + est_output * p["output"]) / 1_000_000
        cost_info = {"cost": round(cost, 2), "currency": p["currency"]}

    return {
        "date": date_label,
        "agent": "cursor",
        "session_id": sess["id"],
        "session_name": sess.get("name", sess["id"]),
        "project": "Cursor",
        "cwd": cwd,
        "time_range": time_range,
        "token_estimation": token_est,
        "model_usage": {
            model: {
                "api_calls": 0,
                "input_tokens": est_input,
                "output_tokens": est_output,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
                "note": "Cursor has no API token count; char-based estimate",
                "cost": cost_info["cost"],
                "currency": cost_info["currency"],
                **msg_stats,
            }
        },
        "files_changed": "[Cursor has no file-history backup]",
        "repos_touched": "[Cursor has no file-history backup]",
        "skills_used": list(skill_counts.keys()) if skill_counts else [],
        "message_stats": msg_stats,
        "tool_stats": tool_counts,
        "timeline": timeline,
    }


def _build_cursor_messages(messages: list[dict], created_at_ms: int = 0) -> list[dict]:
    """Build user+assistant message list from Cursor messages (no tool calls).

    User messages may include <timestamp> tags; assistant rows inherit the
    preceding user time when available, else session created_at_ms.
    """
    import re
    from datetime import datetime, timezone
    from ai_coding_reports.readers.cursor_transcript_io import parse_user_timestamp
    from ai_coding_reports.utils.timezone import local_tz

    fallback_time = ""
    if created_at_ms:
        try:
            dt = datetime.fromtimestamp(created_at_ms / 1000, tz=timezone.utc)
            fallback_time = dt.astimezone(local_tz()).strftime("%H:%M")
        except Exception:
            pass

    USER_QUERY_RE = re.compile(r"<user_query>\s*(.+?)\s*</user_query>", re.DOTALL)

    result = []
    last_time = fallback_time
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if role == "user":
            text = _cursor_extract_user(content, USER_QUERY_RE)
            if not text:
                continue
            time_str = last_time
            if isinstance(content, str):
                ts = parse_user_timestamp(content)
                if ts:
                    time_str = ts.strftime("%H:%M")
            elif isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "text":
                        ts = parse_user_timestamp(item.get("text", ""))
                        if ts:
                            time_str = ts.strftime("%H:%M")
                            break
            last_time = time_str or fallback_time
            result.append({"role": "user", "time": last_time, "text": text})
        elif role == "assistant":
            text = _cursor_extract_assistant(content)
            if text:
                result.append({"role": "assistant", "time": last_time or fallback_time, "text": text})
    return result


def _cursor_extract_user(content, user_query_re) -> str | None:
    if isinstance(content, str):
        m = user_query_re.search(content)
        if m:
            return m.group(1).strip()[:100]
        return content.strip()[:100]
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                txt = item.get("text", "")
                m = user_query_re.search(txt)
                if m:
                    return m.group(1).strip()[:100]
    return None


def _cursor_extract_assistant(content) -> str | None:
    if not isinstance(content, list):
        return None
    texts = []
    for item in content:
        if isinstance(item, dict) and item.get("type") == "text":
            txt = item.get("text", "").strip()
            if txt:
                texts.append(txt)
    return "\n\n".join(texts) if texts else None


def _detect_cursor_files(
    session_id: str | None = None,
    project_slug: str | None = None,
    filter_date: date | None = None,
    *,
    fallback_cwd: str | None = None,
    use_git_fallback: bool = True,
) -> list[dict]:
    """Detect files modified by Cursor from transcript edit paths.

    Resolves each edited file to its own git repo (handles nested repos).
    Falls back to workspace-root git diff when no transcript edits are found.
    """
    from ai_coding_reports.readers.cursor_transcript_io import (
        collect_edited_paths,
        find_transcript_path,
    )

    if session_id:
        jsonl = find_transcript_path(session_id, project_slug)
        if jsonl:
            paths = collect_edited_paths(jsonl)
            if paths:
                return _files_from_edited_paths(paths, filter_date)

    if not use_git_fallback:
        return []
    return _detect_cursor_files_git_diff(project_slug, fallback_cwd=fallback_cwd)


def _parse_numstat_output(out: str) -> tuple[int, int]:
    added = deleted = 0
    for line in out.split("\n"):
        parts = line.split("\t")
        if len(parts) >= 3:
            try:
                added += int(parts[0] or 0)
                deleted += int(parts[1] or 0)
            except ValueError:
                pass
    return added, deleted


def _file_line_stats(
    repo_root: str,
    relpath: str,
    filter_date: date | None,
) -> tuple[int, int]:
    """Line stats for a file: today's commits (from first touch) + uncommitted diff."""
    import subprocess
    from datetime import datetime, time

    from ai_coding_reports.utils.timezone import local_tz

    if filter_date:
        tzinfo = local_tz()
        start = datetime.combine(filter_date, time.min, tzinfo=tzinfo).isoformat()
        end = datetime.combine(filter_date, time.max, tzinfo=tzinfo).isoformat()
        try:
            first_sha = subprocess.check_output(
                [
                    "git", "-C", repo_root, "log",
                    f"--since={start}", f"--until={end}",
                    "--reverse", "--format=%H", "--", relpath,
                ],
                text=True,
            ).strip().split("\n")[0]
            if first_sha:
                out = subprocess.check_output(
                    ["git", "-C", repo_root, "diff", f"{first_sha}^", "--numstat", "--", relpath],
                    text=True,
                ).strip()
                if out:
                    return _parse_numstat_output(out)
        except Exception:
            pass

    try:
        out = subprocess.check_output(
            ["git", "-C", repo_root, "diff", "HEAD", "--numstat", "--", relpath],
            text=True,
        ).strip()
        if out:
            return _parse_numstat_output(out)
    except Exception:
        pass
    return 0, 0


def _files_from_edited_paths(
    paths: list[str],
    filter_date: date | None = None,
) -> list[dict]:
    """Build files_changed entries from transcript edit paths."""
    from ai_coding_reports.utils.files import find_git_root
    from ai_coding_reports.utils.git import get_git_remote

    seen: dict[str, dict] = {}
    for abs_path in paths:
        repo_root = find_git_root(abs_path)
        repo = get_git_remote(repo_root) if repo_root else ""
        relpath = abs_path
        if repo_root and abs_path.startswith(repo_root + os.sep):
            relpath = abs_path[len(repo_root) + 1 :]

        key = f"{repo}:{relpath}"
        if key in seen:
            continue

        added = deleted = 0
        change_type = "modified"
        if not os.path.exists(abs_path):
            change_type = "deleted"
        elif repo_root and os.path.isfile(abs_path):
            added, deleted = _file_line_stats(repo_root, relpath, filter_date)

        seen[key] = {
            "path": relpath,
            "added": added,
            "deleted": deleted,
            "change_type": change_type,
            "repo": repo,
            "source": "transcript",
        }

    return list(seen.values())


def _detect_cursor_files_git_diff(
    project_slug: str | None = None,
    *,
    fallback_cwd: str | None = None,
) -> list[dict]:
    """Fallback: detect uncommitted changes via git diff at workspace root."""
    import subprocess

    from ai_coding_reports.utils.files import decode_cursor_slug, find_git_root
    from ai_coding_reports.utils.git import get_git_remote

    if project_slug:
        decoded = decode_cursor_slug(project_slug)
        repo_root = find_git_root(decoded) if decoded else find_git_root(os.getcwd())
    elif fallback_cwd:
        repo_root = find_git_root(fallback_cwd)
    else:
        repo_root = find_git_root(os.getcwd())
    repo = get_git_remote(repo_root) if repo_root else ""
    seen: dict[str, dict] = {}

    def _add(path: str, added: int, deleted: int, source: str):
        if not path:
            return
        if path in seen:
            seen[path]["added"] += added
            seen[path]["deleted"] += deleted
        else:
            seen[path] = {
                "path": path,
                "added": added,
                "deleted": deleted,
                "change_type": "modified",
                "repo": repo,
                "source": source,
            }

    for diff_args in (["diff", "HEAD", "--numstat"], ["diff", "--cached", "--numstat"]):
        try:
            out = subprocess.check_output(
                ["git", "-C", repo_root or ".", *diff_args],
                text=True,
            ).strip()
            for line in out.split("\n"):
                parts = line.split("\t")
                if len(parts) == 3:
                    try:
                        source = "git-diff" if diff_args[1] == "HEAD" else "git-staged"
                        _add(parts[2], int(parts[0] or 0), int(parts[1] or 0), source)
                    except ValueError:
                        pass
        except Exception:
            pass

    return list(seen.values())


def _build_repos(files: list[dict]) -> list[dict]:
    """Group cursor files by repo."""
    from collections import defaultdict
    groups: dict[str, dict] = defaultdict(lambda: {"files": 0, "added": 0, "deleted": 0})
    for f in files:
        r = f.get("repo", "")
        if r:
            groups[r]["files"] += 1
            groups[r]["added"] += f.get("added", 0) or 0
            groups[r]["deleted"] += f.get("deleted", 0) or 0
    return [{"repo": r, "files": g["files"], "added": g["added"], "deleted": g["deleted"]}
            for r, g in groups.items()]


def _ms_to_iso(ms: int) -> str | None:
    """Convert epoch ms to ISO datetime string."""
    if not ms:
        return None
    from datetime import datetime, timezone
    try:
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()
    except Exception:
        return None


def _extract_claude_metadata(events):
    from ai_coding_reports.utils.timezone import utc_to_local

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

    time_range = ""
    if first_ts and last_ts:
        time_range = f"{utc_to_local(first_ts)} ~ {utc_to_local(last_ts)}"

    return session_name, cwd, time_range


# ---------------------------------------------------------------------------
# view — session content viewer
# ---------------------------------------------------------------------------


@main.group()
def view():
    """View AI coding session content."""
    pass


@view.command("session")
@click.option("--agent", "-a", "agent", type=click.Choice(["claude-code", "cursor"]), default="claude-code")
@click.option("--id", "-i", "session_id", help="Session UUID")
@click.option("--date", "-d", "target_date", help="Filter sessions by date YYYY-MM-DD")
@click.option("--claude-home", "claude_home", help="Path to .claude directory (default ~/.claude)")
@click.option("--include-assistant/--no-assistant", default=True, help="Include assistant messages (Claude only)")
@click.option("--include-tools", is_flag=True, default=False, help="Include tool call records (Claude only)")
@click.option("--truncate", type=int, default=0, show_default=True, help="Max chars per message (0 = no truncate)")
@click.option("--chunk", is_flag=True, default=False, help="Split output into chunks on stdout (Claude only)")
@click.option("--json", "json_flag", is_flag=True, default=False, help="Output JSON (Claude only)")
def view_session(
    agent: str,
    session_id: str | None,
    target_date: str | None,
    claude_home: str | None,
    include_assistant: bool,
    include_tools: bool,
    truncate: int,
    chunk: bool,
    json_flag: bool,
):
    """View session chat history (Claude Code or Cursor CLI/GUI)."""
    from ai_coding_reports.view.format import (
        options_from_flags,
        render_claude_session,
        view_filters_active,
    )

    view_opts = options_from_flags(
        include_assistant, include_tools, truncate, chunk, json_flag
    )

    if claude_home:
        os.environ["CLAUDE_HOME"] = claude_home

    filter_d = date.fromisoformat(target_date) if target_date else None

    if agent == "cursor":
        if view_filters_active(view_opts):
            click.echo(
                "Warning: view filters (--include-tools, --chunk, --json, etc.) "
                "are not supported for cursor yet; using legacy output.",
                err=True,
            )
        from ai_coding_reports.readers.cursor_db import collect_sessions, read_session_messages
        from ai_coding_reports.readers.cursor_gui import collect_gui_sessions, read_gui_messages

        picker: list[tuple[str, str, str]] = []
        for s in collect_sessions():
            picker.append(("cli", s.get("name", s["id"])[:60], s["id"]))
        end_d = filter_d
        for gs in collect_gui_sessions(filter_d, end_d):
            picker.append(("gui", gs.name[:60], gs.id))

        if not picker:
            click.echo("No Cursor sessions found.")
            return

        source = "cli"
        if not session_id:
            if len(picker) == 1:
                source, _title, session_id = picker[0]
            else:
                fzf_input = [
                    f"{src:<4} {title:<58} {sid}" for src, title, sid in picker
                ]
                try:
                    result = subprocess.run(
                        ["fzf", "--height=40%", "--reverse", "--ansi"],
                        input="\n".join(fzf_input),
                        capture_output=True,
                        text=True,
                    )
                except FileNotFoundError:
                    click.echo("Error: fzf not found. Install fzf or use --id=<uuid>.", err=True)
                    sys.exit(1)
                selected = result.stdout.strip()
                if not selected:
                    click.echo("No session selected.")
                    return
                parts = selected.split()
                source = parts[0]
                session_id = parts[-1]
        else:
            for src, _t, sid in picker:
                if sid == session_id or session_id in sid:
                    source = src
                    session_id = sid
                    break

        if source == "gui":
            messages = read_gui_messages(session_id)
        else:
            from ai_coding_reports.readers.cursor_db import collect_sessions as _cs

            sess = next((s for s in _cs() if s["id"] == session_id or session_id in s["id"]), None)
            if not sess:
                click.echo(f"Cursor CLI session {session_id} not found.")
                return
            raw = read_session_messages(sess)
            messages = _build_cursor_messages(raw, sess.get("created_at_ms") or 0)

        if not messages:
            click.echo("No chat messages found.")
            return

        _render_cursor_session_view(messages, session_id)
        return

    from ai_coding_reports.readers.claude_code import (
        collect_chat_sessions,
        find_session_jsonl,
        parse_chat_messages,
    )

    if not session_id:
        sessions = collect_chat_sessions()
        if not sessions:
            click.echo("No Claude Code sessions found.")
            return

        if target_date:
            sessions = [s for s in sessions if s.get("first_ts", "")[:10] == target_date]

        if not sessions:
            click.echo(f"No sessions found for {target_date or 'any date'}.")
            return

        if len(sessions) == 1:
            session_id = sessions[0]["id"]
        else:
            fzf_input = []
            for s in sessions:
                title = s.get("title", "?")[:60]
                dt = s.get("first_ts", "?")[:10]
                proj = s.get("project", "")[:35]
                fzf_input.append(f"{title:<62} {dt:<12} {proj:<35} {s['id']}")

            try:
                result = subprocess.run(
                    ["fzf", "--height=40%", "--reverse", "--ansi"],
                    input="\n".join(fzf_input),
                    capture_output=True,
                    text=True,
                )
            except FileNotFoundError:
                click.echo("Error: fzf not found. Install fzf or use --id=<uuid>.", err=True)
                sys.exit(1)

            selected = result.stdout.strip()
            if not selected:
                click.echo("No session selected.")
                return
            session_id = selected.split()[-1]

    jsonl_path, _project = find_session_jsonl(session_id)
    messages = parse_chat_messages(jsonl_path)
    if not messages:
        click.echo("No chat messages found.")
        return

    output = render_claude_session(
        messages,
        view_opts,
        {"session_id": session_id, "agent": "claude-code"},
    )
    click.echo(output)


def _render_cursor_session_view(messages: list[dict], session_id: str) -> None:
    """Legacy terminal renderer for Cursor sessions (no view filters)."""
    user_c = "\033[36m"
    asst_c = "\033[33m"
    reset = "\033[0m"
    dim = "\033[2m"

    click.echo(f"\nSession: {session_id}\n")

    i = 0
    msg_idx = 0
    while i < len(messages):
        msg = messages[i]
        role = msg["role"]

        if role == "user":
            msg_idx += 1
            click.echo(dim + "─" * 78 + reset)
            content = msg.get("text") or msg.get("content", "")
            if isinstance(content, list):
                texts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
                content = "\n".join(texts)
            time_s = msg.get("time", "")
            label = f"[{msg_idx}] User"
            if time_s:
                label += f" ({time_s})"
            click.echo(user_c + label + ":" + reset)
            click.echo(str(content)[:2000])
            i += 1

        elif role == "assistant":
            text = msg.get("text", "")
            tool_calls = msg.get("tool_calls", [])
            if text:
                msg_idx += 1
                click.echo(dim + "─" * 78 + reset)
                click.echo(asst_c + f"[{msg_idx}] Assistant:" + reset)
                click.echo(text[:2000])
                if tool_calls:
                    click.echo(dim + f"  ({len(tool_calls)} tool calls)" + reset)
                i += 1
            else:
                tc_count = len(tool_calls)
                j = i + 1
                while j < len(messages):
                    nxt = messages[j]
                    if nxt["role"] == "assistant" and not nxt.get("text"):
                        tc_count += len(nxt.get("tool_calls", []))
                        j += 1
                    else:
                        break
                msg_idx += 1
                click.echo(dim + "─" * 78 + reset)
                click.echo(asst_c + f"[{msg_idx}] Assistant: " + reset + dim + f"{tc_count} Tool calls" + reset)
                i = j

    click.echo(dim + "─" * 78 + reset)
    click.echo(f"\n{len(messages)} raw messages | session {session_id}")
