"""Build unified Cursor session records (CLI + GUI) for usage list and collect export."""

from __future__ import annotations

import json
import os
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from time import perf_counter

from ai_coding_reports.readers.cursor_db import (
    collect_sessions,
    find_project_slug_for_session,
    read_session_messages,
)
from ai_coding_reports.readers.cursor_gui import (
    GuiSession,
    build_composer_workspace_index,
    collect_gui_sessions,
    find_workspace_folder,
    read_gui_messages,
)
from ai_coding_reports.readers.cursor_transcript_io import (
    MessageAnchor,
    SessionWindow,
    aggregate_api_by_session,
    build_cli_message_anchors,
    find_transcript_path,
)
from ai_coding_reports.utils.files import decode_cursor_slug
from ai_coding_reports.utils.timing import TimingLog

CURSOR_SOURCES_ALL = frozenset({"cli", "gui"})


def _date_set(start_d: date, end_d: date) -> set[str]:
    out: set[str] = set()
    d = start_d
    while d <= end_d:
        out.add(d.isoformat())
        d = date.fromordinal(d.toordinal() + 1)
    return out


def _filter_cli_sessions(sessions: list[dict], start_d: date, end_d: date) -> list[dict]:
    """Keep sessions with user activity on the date range (transcript timestamps), not store.db mtime."""
    from ai_coding_reports.readers.cursor_transcript_io import transcript_active_on_dates
    from ai_coding_reports.utils.timezone import local_tz

    tz = local_tz()
    dates = _date_set(start_d, end_d)
    out: list[dict] = []
    for s in sessions:
        sid = s["id"]
        slug = find_project_slug_for_session(sid) or ""
        jsonl = find_transcript_path(sid, slug)
        if jsonl:
            try:
                mtime_d = datetime.fromtimestamp(
                    jsonl.stat().st_mtime, tz=timezone.utc
                ).astimezone(tz).date()
                if mtime_d > end_d:
                    continue
                if mtime_d < start_d:
                    ms = s.get("created_at_ms") or 0
                    created_d = (
                        datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
                        .astimezone(tz)
                        .date()
                        if ms
                        else None
                    )
                    if created_d is not None and created_d < start_d:
                        continue
            except OSError:
                pass
            if transcript_active_on_dates(jsonl, dates):
                out.append(s)
            continue
        ms = s.get("created_at_ms") or 0
        if ms:
            d = datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(tz).date().isoformat()
            if d in dates:
                out.append(s)
    return out


def _window_from_cli(sess: dict, filter_date: date | None) -> SessionWindow | None:
    sid = sess["id"]
    slug = find_project_slug_for_session(sid) or ""
    jsonl = find_transcript_path(sid, slug)
    if jsonl:
        from ai_coding_reports.readers.cursor_transcript_io import transcript_activity_window

        start, end = transcript_activity_window(jsonl, filter_date)
        if start and end:
            return SessionWindow(sid, start, end, "cli")
    from ai_coding_reports.utils.timezone import local_tz

    tz = local_tz()
    ms = sess.get("created_at_ms") or 0
    if ms:
        start = datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(tz)
        return SessionWindow(sid, start, start + timedelta(hours=2), "cli")
    return None


def _window_from_gui(gs: GuiSession) -> SessionWindow | None:
    if gs.activity_start and gs.activity_end:
        return SessionWindow(gs.id, gs.activity_start, gs.activity_end, "gui")
    if gs.created_at_ms:
        from ai_coding_reports.utils.timezone import local_tz

        tz = local_tz()
        start = datetime.fromtimestamp(gs.created_at_ms / 1000, tz=timezone.utc).astimezone(tz)
        end_ms = gs.last_updated_at_ms or gs.created_at_ms
        end = datetime.fromtimestamp(end_ms / 1000, tz=timezone.utc).astimezone(tz)
        return SessionWindow(gs.id, start, end + timedelta(minutes=5), "gui")
    return None


def build_usage_message_anchors(
    cli_sessions: list[dict],
    gui_sessions: list[GuiSession],
    filter_date: date | None,
) -> list[MessageAnchor]:
    """Collect message time anchors from CLI transcripts and GUI bubbles."""
    from ai_coding_reports.readers.cursor_gui import build_gui_message_anchors

    anchors: list[MessageAnchor] = []
    for s in cli_sessions:
        sid = s["id"]
        slug = find_project_slug_for_session(sid) or ""
        jsonl = find_transcript_path(sid, slug)
        if jsonl:
            anchors.extend(build_cli_message_anchors(jsonl, sid, filter_date))
    for gs in gui_sessions:
        anchors.extend(build_gui_message_anchors(gs.id))
    return anchors


def fetch_cursor_usage_by_session(
    start_d: date,
    end_d: date,
    windows: list[SessionWindow],
    anchors: list[MessageAnchor] | None = None,
) -> dict[str, dict]:
    """Fetch dashboard API events and attribute to sessions (one day at a time)."""
    from ai_coding_reports.readers.cursor_api import (
        build_session_cookie,
        day_bounds_ms,
        fetch_usage_events,
    )
    from ai_coding_reports.utils.timezone import local_tz

    if not windows:
        return {}

    try:
        cookie, _meta = build_session_cookie()
    except SystemExit:
        return {}

    tz = local_tz()
    merged: dict[str, dict] = {}
    d = start_d
    while d <= end_d:
        start_ms, end_ms = day_bounds_ms(d, tz)
        try:
            events = fetch_usage_events(start_ms, end_ms, cookie)
        except SystemExit:
            return merged
        day_attr = aggregate_api_by_session(events, windows, d, anchors=anchors)
        for sid, bucket in day_attr.items():
            if sid in ("outside_day", "unassigned"):
                continue
            if sid not in merged:
                merged[sid] = {
                    "events": 0,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "cache_read_tokens": 0,
                    "cache_write_tokens": 0,
                    "total_tokens": 0,
                    "charged_usd": 0.0,
                    "models": {},
                }
            m = merged[sid]
            m["events"] += bucket["events"]
            m["input_tokens"] += bucket["input_tokens"]
            m["output_tokens"] += bucket["output_tokens"]
            m["cache_read_tokens"] += bucket["cache_read_tokens"]
            m["cache_write_tokens"] += bucket["cache_write_tokens"]
            m["total_tokens"] += bucket["total_tokens"]
            m["charged_usd"] = round(m["charged_usd"] + bucket["charged_usd"], 4)
            for model_row in bucket.get("models", []):
                name = model_row["model"]
                if name not in m["models"]:
                    m["models"][name] = {
                        "model": name,
                        "api_calls": 0,
                        "cost": 0.0,
                        "currency": "$",
                    }
                m["models"][name]["api_calls"] += model_row["api_calls"]
                m["models"][name]["cost"] = round(
                    m["models"][name]["cost"] + model_row["cost"], 4
                )
        d = date.fromordinal(d.toordinal() + 1)

    for sid in merged:
        merged[sid]["models"] = list(merged[sid]["models"].values())
    return merged


def _gui_messages_for_estimate(composer_id: str) -> list[dict]:
    """Convert GUI chat messages to blob-style dicts for char-based token estimate."""
    return [
        {"role": m.get("role", ""), "content": m.get("text", "")}
        for m in read_gui_messages(composer_id)
    ]


def _resolve_cursor_session_usage(
    source: str,
    sess: dict | GuiSession,
    sid: str,
    model: str,
    usage: dict,
) -> tuple[dict, dict, list[dict], int, str]:
    """Return tokens, cost, models, api_calls, usage_note for usage_sessions rows."""
    has_api = bool(
        usage.get("events")
        or usage.get("total_tokens")
        or usage.get("charged_usd")
    )
    if has_api:
        models = usage.get("models", [])
        if not models and model:
            models = [{"model": model, "api_calls": 0, "cost": 0.0, "currency": "$"}]
        cost: dict[str, float] = {}
        if usage.get("charged_usd"):
            cost["$"] = usage["charged_usd"]
        tokens = {
            "input": usage.get("input_tokens", 0),
            "output": usage.get("output_tokens", 0),
            "cache_read": usage.get("cache_read_tokens", 0),
            "cache_write": usage.get("cache_write_tokens", 0),
        }
        return tokens, cost, models, usage.get("events", 0), "dashboard API nearest-message attribution"

    from ai_coding_reports.utils.pricing import match_pricing
    from ai_coding_reports.utils.tokens import estimate_tokens_from_messages

    if source == "cli":
        msgs = read_session_messages(sess)
    else:
        msgs = _gui_messages_for_estimate(sid)
    token_est = estimate_tokens_from_messages(msgs)
    est_in = token_est.get("estimated_input_tokens", 0)
    est_out = token_est.get("estimated_output_tokens", 0)
    tokens = {
        "input": est_in,
        "output": est_out,
        "cache_read": 0,
        "cache_write": 0,
    }
    cost = {}
    models: list[dict] = []
    model_name = model or "unknown"
    p = match_pricing(model_name)
    if p and (est_in or est_out):
        amt = round((est_in * p["input"] + est_out * p["output"]) / 1_000_000, 2)
        cost[p["currency"]] = amt
        models = [{"model": model_name, "api_calls": 0, "cost": amt, "currency": p["currency"]}]
    elif model_name:
        models = [{"model": model_name, "api_calls": 0, "cost": "unknown", "currency": "?"}]
    return tokens, cost, models, 0, "char-based estimate (API unavailable or unassigned)"


def _format_time_range(start: datetime | None, end: datetime | None) -> str:
    if not start:
        return ""
    if end and end != start:
        return f"{start.strftime('%H:%M')} - {end.strftime('%H:%M')}"
    return start.strftime("%H:%M")


def _gui_files_from_cwd(cwd: str) -> list[dict]:
    """Git diff at GUI workspace folder (shared across sessions on same cwd)."""
    import subprocess

    from ai_coding_reports.utils.files import find_git_root
    from ai_coding_reports.utils.git import get_git_remote

    if not cwd or not os.path.isdir(cwd):
        return []
    repo_root = find_git_root(cwd)
    if not repo_root:
        return []
    repo = get_git_remote(repo_root) or ""
    seen: dict[str, dict] = {}
    for diff_args in (["diff", "HEAD", "--numstat"], ["diff", "--cached", "--numstat"]):
        try:
            out = subprocess.check_output(
                ["git", "-C", repo_root, *diff_args],
                text=True,
            ).strip()
            for line in out.split("\n"):
                parts = line.split("\t")
                if len(parts) != 3:
                    continue
                try:
                    added, deleted = int(parts[0] or 0), int(parts[1] or 0)
                except ValueError:
                    continue
                path = parts[2]
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
                        "source": "git-diff-gui",
                    }
        except Exception:
            pass
    return list(seen.values())


def _gui_files_from_commit_history(
    cwd: str,
    filter_date: date | None,
    session_window: SessionWindow | None,
    *,
    full_day: bool = False,
) -> list[dict]:
    """Detect files from committed changes in session time window (preferred for GUI)."""
    import subprocess

    from ai_coding_reports.utils.files import find_git_root
    from ai_coding_reports.utils.git import get_git_remote
    from ai_coding_reports.utils.timezone import local_tz

    if not cwd or not os.path.isdir(cwd):
        return []

    repo_root = find_git_root(cwd)
    if not repo_root:
        return []

    repo = get_git_remote(repo_root) or ""
    tz = local_tz()
    day_start = datetime.combine(filter_date, time.min, tzinfo=tz) if filter_date else None
    day_end = datetime.combine(filter_date, time.max, tzinfo=tz) if filter_date else None

    if session_window and session_window.activity_start and session_window.activity_end:
        start_dt = session_window.activity_start
        end_dt = session_window.activity_end
    elif day_start and day_end:
        start_dt = day_start
        end_dt = day_end
    else:
        return []

    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=tz)
    if end_dt.tzinfo is None:
        end_dt = end_dt.replace(tzinfo=tz)

    # Optional full-day mode for cross-day/session-window drift recovery.
    if full_day and day_start and day_end:
        start_dt, end_dt = day_start, day_end
    elif day_start and day_end:
        overlap_start = max(start_dt, day_start)
        overlap_end = min(end_dt, day_end)
        if overlap_start <= overlap_end:
            start_dt, end_dt = overlap_start, overlap_end

    try:
        out = subprocess.check_output(
            [
                "git",
                "-C",
                repo_root,
                "log",
                f"--since={start_dt.isoformat()}",
                f"--until={end_dt.isoformat()}",
                "--numstat",
                "--pretty=format:__COMMIT__",
            ],
            text=True,
        ).strip()
    except Exception:
        return []

    seen: dict[str, dict] = {}
    for line in out.split("\n"):
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        try:
            added = int(parts[0] or 0)
            deleted = int(parts[1] or 0)
        except ValueError:
            continue
        path = parts[2]
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
                "source": "git-commits-gui",
            }
    return list(seen.values())


def _merge_file_records(*groups: list[dict]) -> list[dict]:
    """Merge file records across detection sources by repo+path."""
    seen: dict[str, dict] = {}
    for files in groups:
        for f in files:
            repo = f.get("repo", "")
            path = f.get("path", "")
            key = f"{repo}:{path}"
            if key in seen:
                seen[key]["added"] = max(seen[key].get("added", 0), f.get("added", 0) or 0)
                seen[key]["deleted"] = max(seen[key].get("deleted", 0), f.get("deleted", 0) or 0)
                sources = set(str(seen[key].get("source", "")).split("+"))
                sources.update(str(f.get("source", "")).split("+"))
                seen[key]["source"] = "+".join(sorted(s for s in sources if s))
                continue
            seen[key] = dict(f)
    return list(seen.values())


def _file_record_key(item: dict) -> str:
    """Stable identity for a file record across sources."""
    repo = item.get("repo", "") if isinstance(item, dict) else ""
    path = item.get("path", "") if isinstance(item, dict) else ""
    return f"{repo}:{path}"


def _detect_files_for_session(
    session_id: str,
    source: str,
    cwd: str,
    project_slug: str | None,
    filter_date: date | None,
    session_window: SessionWindow | None,
    detect_files_fn,
    build_repos_fn,
) -> tuple[list[dict], list[dict]]:
    if source == "cli":
        files = detect_files_fn(session_id, project_slug, filter_date)
    else:
        files_from_commits = _gui_files_from_commit_history(
            cwd, filter_date, session_window, full_day=False
        )
        files_from_diff = _gui_files_from_cwd(cwd)

        files_from_transcript_raw = detect_files_fn(
            session_id,
            None,
            filter_date,
            fallback_cwd=cwd,
            use_git_fallback=False,
        )

        files_from_commits_day = _gui_files_from_commit_history(
            cwd, filter_date, session_window, full_day=True
        ) if filter_date else []

        evidence_keys = {
            _file_record_key(f)
            for f in [*files_from_commits, *files_from_diff, *files_from_commits_day]
            if isinstance(f, dict)
        }
        if evidence_keys:
            files_from_transcript = [
                f for f in files_from_transcript_raw
                if _file_record_key(f) in evidence_keys
            ]
        else:
            # When workspace evidence is unavailable (e.g. historical GUI sessions
            # without cwd), keep transcript-derived file edits as the best source.
            files_from_transcript = files_from_transcript_raw

        transcript_keys = {_file_record_key(f) for f in files_from_transcript}
        files_from_commits_day_matched = [
            f for f in files_from_commits_day if _file_record_key(f) in transcript_keys
        ]

        files = _merge_file_records(
            files_from_commits,
            files_from_commits_day_matched,
            files_from_transcript,
            files_from_diff,
        )
    repos = build_repos_fn(files)
    return files, repos


def _normalize_cursor_sources(sources: frozenset[str] | set[str] | None) -> frozenset[str]:
    if not sources:
        return CURSOR_SOURCES_ALL
    normalized = frozenset(sources)
    unknown = normalized - CURSOR_SOURCES_ALL
    if unknown:
        raise ValueError(f"invalid cursor source(s): {', '.join(sorted(unknown))}")
    return normalized


def build_cursor_session_rows(
    start_d: date,
    end_d: date,
    *,
    detect_files_fn,
    build_repos_fn,
    utc_to_local_fn,
    cursor_sources: frozenset[str] | set[str] | None = None,
    timing: TimingLog | None = None,
) -> list[dict]:
    """Return usage_sessions-style dicts for Cursor CLI and/or GUI sessions in range."""
    tl = timing or TimingLog(enabled=False)
    sources = _normalize_cursor_sources(
        frozenset(cursor_sources) if cursor_sources is not None else None
    )
    include_cli = "cli" in sources
    include_gui = "gui" in sources

    single_day = start_d == end_d
    filter_date = start_d if single_day else None

    cli_sessions: list[dict] = []
    if include_cli:
        with tl.span("cursor.cli.collect_sessions"):
            all_cli = collect_sessions()
        with tl.span("cursor.cli.filter_by_date"):
            cli_sessions = _filter_cli_sessions(all_cli, start_d, end_d)

    gui_sessions: list[GuiSession] = []
    if include_gui:
        with tl.span("cursor.gui.collect_sessions"):
            gui_sessions = collect_gui_sessions(
                start_d,
                end_d if not single_day else None,
                timing=tl,
            )

    windows: list[SessionWindow] = []
    entries: list[tuple[str, dict | GuiSession, str, str, SessionWindow | None]] = []

    if include_cli:
        with tl.span("cursor.cli.build_entries"):
            for s in cli_sessions:
                win = _window_from_cli(s, filter_date)
                if win:
                    windows.append(win)
                slug = find_project_slug_for_session(s["id"]) or ""
                cwd = decode_cursor_slug(slug) if slug else ""
                entries.append(("cli", s, slug, cwd, win))

    workspace_index: dict[str, str] = {}
    if include_gui:
        with tl.span("cursor.gui.workspace_index"):
            workspace_index = build_composer_workspace_index()
        with tl.span("cursor.gui.build_entries"):
            for gs in gui_sessions:
                win = _window_from_gui(gs)
                if win:
                    windows.append(win)
                cwd = workspace_index.get(gs.id, "")
                entries.append(("gui", gs, "", cwd, win))

    with tl.span("cursor.usage_api"):
        anchors = build_usage_message_anchors(cli_sessions, gui_sessions, filter_date)
        usage_map = fetch_cursor_usage_by_session(start_d, end_d, windows, anchors=anchors)

    results: list[dict] = []
    file_detect_s = 0.0
    for source, sess, slug, cwd, win in entries:
        if source == "cli":
            sid = sess["id"]
            title = sess.get("name", sid)
            model = sess.get("model", "")
            blobs = sess.get("total_blobs", 0)
        else:
            sid = sess.id
            title = sess.name
            model = sess.model
            blobs = sess.header_count

        time_range = _format_time_range(
            win.activity_start if win else None,
            win.activity_end if win else None,
        )

        usage = usage_map.get(sid, {})
        tokens, cost, models, api_calls, usage_note = _resolve_cursor_session_usage(
            source, sess, sid, model, usage
        )

        t0 = perf_counter() if tl.enabled else 0.0
        files, repos = _detect_files_for_session(
            sid,
            source,
            cwd,
            slug or None,
            filter_date,
            win,
            detect_files_fn,
            build_repos_fn,
        )
        if tl.enabled:
            file_detect_s += perf_counter() - t0
        fc_files = len(files)
        fc_added = sum(f.get("added", 0) for f in files)
        fc_deleted = sum(f.get("deleted", 0) for f in files)

        results.append({
            "agent": "cursor",
            "source": source,
            "id": sid,
            "title": title or "(untitled)",
            "cwd": cwd,
            "project": slug or (os.path.basename(cwd) if cwd else ""),
            "time_range": time_range,
            "git_branch": "",
            "repos": repos,
            "snapshot_only": False,
            "file_changes": {"files": fc_files, "added": fc_added, "deleted": fc_deleted},
            "models": models,
            "tokens": tokens,
            "api_calls": api_calls,
            "cost": cost,
            "blobs": blobs,
            "model": model,
            "_files_detail": files,
            "_usage_note": usage_note,
        })

    if tl.enabled and entries:
        tl.add("cursor.file_changes", file_detect_s)

    return results


def build_collect_session_json(
    sess: dict | GuiSession,
    source: str,
    filter_date: date,
    date_str: str,
    *,
    detect_files_fn,
    build_repos_fn,
    count_messages_fn,
    build_messages_fn,
    usage_map: dict[str, dict] | None = None,
) -> dict:
    """Build schema 2.0 session JSON for report:collect."""
    from ai_coding_reports.utils.timezone import get_display_timezone, format_tz_label

    sid = sess["id"] if source == "cli" else sess.id
    name = sess.get("name", sid) if source == "cli" else sess.name
    model = sess.get("model", "") if source == "cli" else sess.model

    if source == "cli":
        msgs = read_session_messages(sess)
        msg_stats = count_messages_fn(msgs)
        messages = build_messages_fn(msgs, sess.get("created_at_ms") or 0)
        slug = find_project_slug_for_session(sid) or ""
        cwd = decode_cursor_slug(slug) if slug else ""
    else:
        messages = read_gui_messages(sid)
        msg_stats = {
            "user_messages": sum(1 for m in messages if m.get("role") == "user"),
            "assistant_messages": sum(1 for m in messages if m.get("role") == "assistant"),
        }
        cwd = find_workspace_folder(sid)
        slug = ""

    if source == "cli":
        win = _window_from_cli(sess, filter_date)
    else:
        win = _window_from_gui(sess)
    tr_display = _format_time_range(
        win.activity_start if win else None,
        win.activity_end if win else None,
    )
    tzinfo, _ = get_display_timezone()
    tz_label = format_tz_label(tzinfo)

    usage = (usage_map or {}).get(sid, {})
    files, repos = _detect_files_for_session(
        sid,
        source,
        cwd,
        slug or None,
        filter_date,
        win,
        detect_files_fn,
        build_repos_fn,
    )

    model_usage: dict = {}
    if usage:
        per_model = usage.get("models") or []
        if len(per_model) > 1:
            for m in per_model:
                model_usage[m["model"]] = {
                    "api_calls": m["api_calls"],
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "cache_read_input_tokens": 0,
                    "cache_creation_input_tokens": 0,
                    "note": "per-model cost from dashboard API",
                    "cost": m["cost"],
                    "currency": m.get("currency", "$"),
                }
            first = per_model[0]["model"]
            model_usage[first].update({
                "input_tokens": usage.get("input_tokens", 0),
                "output_tokens": usage.get("output_tokens", 0),
                "cache_read_input_tokens": usage.get("cache_read_tokens", 0),
                "cache_creation_input_tokens": usage.get("cache_write_tokens", 0),
                "note": "dashboard API nearest-message attribution",
            })
        else:
            primary = per_model[0]["model"] if per_model else (model or "unknown")
            model_usage[primary] = {
                "api_calls": usage.get("events", 0),
                "input_tokens": usage.get("input_tokens", 0),
                "output_tokens": usage.get("output_tokens", 0),
                "cache_read_input_tokens": usage.get("cache_read_tokens", 0),
                "cache_creation_input_tokens": usage.get("cache_write_tokens", 0),
                "note": "dashboard API nearest-message attribution",
                "cost": usage.get("charged_usd", 0),
                "currency": "$",
            }
    else:
        from ai_coding_reports.utils.tokens import estimate_tokens_from_messages
        from ai_coding_reports.utils.pricing import match_pricing

        if source == "cli":
            token_est = estimate_tokens_from_messages(read_session_messages(sess))
        else:
            token_est = {"estimated_input_tokens": 0, "estimated_output_tokens": 0}
        est_in = token_est.get("estimated_input_tokens", 0)
        est_out = token_est.get("estimated_output_tokens", 0)
        p = match_pricing(model)
        cost_val = "unknown"
        currency = "?"
        if p:
            cost_val = round((est_in * p["input"] + est_out * p["output"]) / 1_000_000, 2)
            currency = p["currency"]
        model_usage[model or "unknown"] = {
            "api_calls": 0,
            "input_tokens": est_in,
            "output_tokens": est_out,
            "cache_read_input_tokens": 0,
            "cache_creation_input_tokens": 0,
            "note": "char-based estimate (API unavailable)",
            "cost": cost_val,
            "currency": currency,
        }

    created_ms = sess.get("created_at_ms", 0) if source == "cli" else sess.created_at_ms
    start_local = ""
    if created_ms:
        try:
            start_local = (
                datetime.fromtimestamp(created_ms / 1000, tz=timezone.utc)
                .astimezone(tzinfo)
                .isoformat()
            )
        except (ValueError, OSError):
            pass

    return {
        "schema": "2.0",
        "date": date_str,
        "agent": "cursor",
        "source": source,
        "session_id": sid,
        "session_name": name,
        "project": slug or "Cursor",
        "cwd": cwd,
        "time_range": {
            "display": tr_display or "?",
            "timezone": tz_label,
            "start_local": start_local,
        },
        "model_usage": model_usage,
        "files_changed": files,
        "repos_touched": repos,
        "message_stats": msg_stats,
        "messages": messages,
    }
