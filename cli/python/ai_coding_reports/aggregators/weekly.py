"""Weekly report data preparation — cross-agent normalization and aggregation."""

from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

from ai_coding_reports.aggregators.daily import (
    detect_agent,
    normalize_files_changed,
    normalize_message_stats,
    normalize_model_usage,
    normalize_repos,
)


def _v(data: dict, *keys: str, default=None):
    for k in keys:
        v = data.get(k)
        if v is not None:
            return v
    return default

SCRIPT_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = os.path.normpath(
    os.environ.get(
        "AI_CODING_REPORTS_ROOT",
        os.path.join(str(SCRIPT_DIR), "..", "..", "..", ".."),
    )
)
REPORTS_DIR = os.path.join(REPO_ROOT, "Outputs", "reports")


def aggregate_weekly(
    session_files: list[Path],
    from_date: date,
    to_date: date,
    week_label: str,
    git_username: str,
) -> dict:
    """Aggregate all session data for a week into weekly report JSON."""
    sessions = []
    total_messages = {"user": 0, "assistant": 0, "tool_calls": 0}
    combined_model_usage = defaultdict(lambda: {
        "api_calls": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0,
        "sessions": 0,
        "cost": 0.0,
        "currency": "?",
        "cost_unknown": 0,
    })
    combined_repos = defaultdict(lambda: {"files": 0, "added": 0, "deleted": 0, "agents": set()})
    combined_skills = defaultdict(lambda: {"count": 0, "agents": set()})
    agents_seen = set()
    dates_with_sessions = set()
    total_files_changed = 0
    total_cost_by_currency = defaultdict(float)

    for fpath in session_files:
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            print(f"Warning: skip {fpath.name}: {e}", file=sys.stderr)
            continue

        agent = detect_agent(data, fpath.name)
        agents_seen.add(agent)

        session_date = _v(data, "date", "日期", default=fpath.name[:10])
        dates_with_sessions.add(session_date)

        msg_stats = normalize_message_stats(data)
        model_usage = normalize_model_usage(data)
        repos = normalize_repos(data)
        files = normalize_files_changed(data)
        skills = _v(data, "skills_used", "使用技能", default=[])
        timeline = _v(data, "timeline", "用户消息时间线", default=[])

        session_entry = {
            "date": session_date,
            "agent": agent,
            "session_id": _v(data, "session_id", "会话ID", default=""),
            "session_name": _v(data, "session_name", "会话名称", default=""),
            "time_range": _v(data, "time_range", "时间范围", default=""),
            "project": _v(data, "project", "项目", default=data.get("工作目录", "")),
            "model_usage": model_usage,
            "repos": repos,
            "files_changed_count": len(files) if isinstance(files, list) else 0,
            "skills": skills if isinstance(skills, list) else [],
            "message_stats": msg_stats,
            "timeline_count": len(timeline) if isinstance(timeline, list) else 0,
        }
        sessions.append(session_entry)

        for k in ("user", "assistant", "tool_calls"):
            total_messages[k] += msg_stats.get(k, 0)

        for model, entry in model_usage.items():
            agg = combined_model_usage[model]
            agg["api_calls"] += entry.get("api_calls", 0)
            agg["input_tokens"] += entry.get("input_tokens", 0)
            agg["output_tokens"] += entry.get("output_tokens", 0)
            agg["cache_read_input_tokens"] += entry.get("cache_read_input_tokens", 0)
            agg["cache_creation_input_tokens"] += entry.get("cache_creation_input_tokens", 0)
            agg["sessions"] += 1
            currency = entry.get("currency", "?")
            agg["currency"] = currency
            cost = entry.get("cost")
            if isinstance(cost, (int, float)):
                agg["cost"] += cost
                total_cost_by_currency[currency] += cost
            else:
                agg["cost_unknown"] += 1

        for repo in repos:
            name = repo.get("repo", "")
            if not name:
                continue
            cr = combined_repos[name]
            cr["files"] += repo.get("files", 0)
            cr["added"] += repo.get("added", 0)
            cr["deleted"] += repo.get("deleted", 0)
            cr["agents"].add(agent)

        if isinstance(files, list):
            total_files_changed += len(files)

        for skill in (skills if isinstance(skills, list) else []):
            combined_skills[skill]["count"] += 1
            combined_skills[skill]["agents"].add(agent)

    repos_list = [
        {"repo": name, "files": r["files"], "added": r["added"],
         "deleted": r["deleted"], "agents": sorted(r["agents"])}
        for name, r in sorted(combined_repos.items())
    ]

    model_usage_list = {}
    for model, entry in sorted(combined_model_usage.items()):
        item = dict(entry)
        item["agents"] = sorted(set(
            s["agent"] for s in sessions
            if model in s.get("model_usage", {})
        ))
        item["cost"] = round(item["cost"], 2) if item["cost"] else item["cost"]
        del item["agents"]
        model_usage_list[model] = item

    skills_list = [
        {"skill": name, "count": s["count"], "agents": sorted(s["agents"])}
        for name, s in sorted(combined_skills.items(), key=lambda x: -x[1]["count"])
    ]

    total_cost_display = {}
    for currency, amount in total_cost_by_currency.items():
        total_cost_display[currency] = round(amount, 2)

    sessions_by_date = defaultdict(list)
    for s in sessions:
        sessions_by_date[s["date"]].append(s)

    return {
        "report_type": "weekly",
        "week": week_label,
        "date_range": f"{from_date.isoformat()}..{to_date.isoformat()}",
        "year": from_date.year,
        "author": git_username,
        "generated_at": datetime.now().isoformat(),
        "totals": {
            "session_count": len(sessions),
            "day_count": len(dates_with_sessions),
            "agents": sorted(agents_seen),
            "total_messages": total_messages,
            "total_files_changed": total_files_changed,
            "total_cost": total_cost_display,
        },
        "model_usage_combined": model_usage_list,
        "repos_combined": repos_list,
        "skills_combined": skills_list,
        "daily_breakdown": {
            day: {
                "session_count": len(day_sessions),
                "agents": sorted(set(s["agent"] for s in day_sessions)),
                "message_stats": {
                    "user": sum(s["message_stats"]["user"] for s in day_sessions),
                    "assistant": sum(s["message_stats"]["assistant"] for s in day_sessions),
                    "tool_calls": sum(s["message_stats"]["tool_calls"] for s in day_sessions),
                },
                "models": sorted(set(
                    m for s in day_sessions for m in s.get("model_usage", {}).keys()
                )),
            }
            for day, day_sessions in sorted(sessions_by_date.items())
        },
        "sessions": sorted(sessions, key=lambda x: (x["date"], x.get("time_range", ""))),
    }
