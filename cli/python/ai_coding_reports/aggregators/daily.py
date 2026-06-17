"""Daily report data preparation — cross-agent normalization and aggregation."""

from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = os.path.normpath(
    os.environ.get(
        "AI_CODING_REPORTS_ROOT",
        os.path.join(str(SCRIPT_DIR), "..", "..", "..", ".."),
    )
)
REPORTS_DIR = os.path.join(REPO_ROOT, "Outputs", "reports")


def classify_human_input(content: str) -> str:
    """Classify user message into API category with lightweight heuristics."""
    text = (content or "").strip().lower()
    if not text:
        return "other"

    decision_keywords = (
        "决定", "決定", "定了", "採用", "采用", "改成", "改為", "用这个", "用這個", "最终", "最終",
        "结论", "結論", "就按", "agreed", "decide", "decision",
    )
    planning_keywords = (
        "计划", "計劃", "方案", "步驟", "步骤", "下一步", "roadmap", "plan", "planning", "拆分", "排期",
    )
    correction_keywords = (
        "修复", "修復", "修正", "改一下", "不对", "不對", "有问题", "有問題", "报错", "報錯", "错误",
        "錯誤", "bug", "fix", "broken", "failed",
    )
    requirement_keywords = (
        "需要", "必须", "必須", "要求", "请确保", "請確保", "should", "must", "requirement", "需求",
    )
    direction_keywords = (
        "帮我", "幫我", "请", "請", "分析", "看看", "解释", "解釋", "实现", "實現", "优化", "優化",
        "梳理", "how", "why", "what", "please",
    )

    def _contains_any(words: tuple[str, ...]) -> bool:
        return any(w in text for w in words)

    if _contains_any(decision_keywords):
        return "decision"
    if _contains_any(planning_keywords):
        return "planning"
    if _contains_any(correction_keywords):
        return "correction"
    if _contains_any(requirement_keywords):
        return "requirement"
    if _contains_any(direction_keywords):
        return "direction"
    return "other"


def _val(data: dict, *keys: str, default=None):
    """Get first matching key from dict (handles Chinese/English key migration)."""
    for k in keys:
        v = data.get(k)
        if v is not None:
            return v
    return default


def detect_agent(data: dict, filename: str) -> str:
    """Detect agent type from data or filename."""
    agent = _val(data, "agent", "Agent")
    if agent:
        return agent
    fname = filename.lower()
    if "cursor" in fname:
        return "cursor"
    if "codex" in fname:
        return "codex"
    return "claude-code"


def normalize_message_stats(data: dict) -> dict:
    """Normalize message stat keys across agents (Chinese/English -> English)."""
    stats = _val(data, "message_stats", "消息统计", default={})
    if not stats:
        return {"user": 0, "assistant": 0, "tool_calls": 0}

    return {
        # Keep a canonical shape across agent exporters.
        "user": _val(stats, "user", "user_messages", "用户", default=0),
        "assistant": _val(stats, "assistant", "assistant_messages", "助手", default=0),
        "tool_calls": _val(stats, "tool_calls", "tool_messages", "工具调用", default=0),
    }


def normalize_model_usage(data: dict) -> dict:
    """Normalize model usage, handling Cursor placeholder and embedded stats."""
    raw = _val(data, "model_usage", "模型用量", default={})
    if not raw or isinstance(raw, str):
        return {}

    result = {}
    for model, entry in raw.items():
        if not isinstance(entry, dict):
            continue
        norm = {
            "api_calls": entry.get("api_calls", 0),
            "input_tokens": entry.get("input_tokens", 0),
            "output_tokens": entry.get("output_tokens", 0),
            "cache_read_input_tokens": entry.get("cache_read_input_tokens", 0),
            "cache_creation_input_tokens": entry.get("cache_creation_input_tokens", 0),
            "cost": entry.get("cost", entry.get("费用")),
            "currency": _val(entry, "currency", "币种", default="?"),
        }
        if entry.get("note"):
            norm["note"] = entry["note"]
        result[model] = norm
    return result


def normalize_repos(data: dict) -> list:
    """Normalize repo list, handling placeholder strings."""
    raw = _val(data, "repos_touched", "涉及仓库", default=[])
    if isinstance(raw, str):
        return []
    if not isinstance(raw, list):
        return []
    return [
        {
            "repo": _val(r, "repo", "仓库", default=""),
            "files": _val(r, "files", "文件数", default=0),
            "added": _val(r, "added", "新增行", default=0),
            "deleted": _val(r, "deleted", "删除行", default=0),
        }
        for r in raw if isinstance(r, dict)
    ]


def normalize_files_changed(data: dict) -> list:
    """Normalize file changes, handling placeholder strings."""
    raw = _val(data, "files_changed", "修改文件", default=[])
    if isinstance(raw, str):
        return []
    if not isinstance(raw, list):
        return []
    return raw


def aggregate_daily(
    session_files: list[Path],
    target_date: date,
    git_username: str,
    cursor_api_usage: dict | None = None,
) -> dict:
    """Aggregate all session data for a single day into daily report JSON."""
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

        msg_stats = normalize_message_stats(data)
        model_usage = normalize_model_usage(data)
        repos = normalize_repos(data)
        files = normalize_files_changed(data)
        skills = _val(data, "skills_used", "使用技能", default=[])
        timeline = _val(data, "timeline", "用户消息时间线", default=[])

        session_entry = {
            "agent": agent,
            "session_id": _val(data, "session_id", "会话ID", default=""),
            "session_name": _val(data, "session_name", "会话名称", default=""),
            "time_range": _val(data, "time_range", "时间范围", default=""),
            "project": _val(data, "project", "项目", default=data.get("工作目录", "")),
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

    # Build output
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
        item.pop("agents", None)
        model_usage_list[model] = item

    skills_list = [
        {"skill": name, "count": s["count"], "agents": sorted(s["agents"])}
        for name, s in sorted(combined_skills.items(), key=lambda x: -x[1]["count"])
    ]

    total_cost_display = {}
    for currency, amount in total_cost_by_currency.items():
        total_cost_display[currency] = round(amount, 2)

    return {
        "report_type": "daily",
        "date": target_date.isoformat(),
        "author": git_username,
        "generated_at": datetime.now().astimezone().isoformat(),
        "totals": {
            "session_count": len(sessions),
            "agents": sorted(agents_seen),
            "total_messages": total_messages,
            "total_files_changed": total_files_changed,
            "total_cost": total_cost_display,
        },
        "cursor_api_usage": cursor_api_usage,
        "model_usage_combined": model_usage_list,
        "repos_combined": repos_list,
        "skills_combined": skills_list,
        "sessions": sessions,
    }


# ---------------------------------------------------------------------------
# v2.0 aggregate (simplified — all English keys, no skills, no timeline)
# ---------------------------------------------------------------------------


def aggregate_daily_v2(
    session_files: list[Path],
    target_date: date,
    git_username: str,
    cursor_api_usage: dict | None = None,
) -> dict:
    """Aggregate v2.0 session files into daily.json."""
    from ai_coding_reports.aggregators.tokens import (
        buckets_from_breakdown,
        fold_buckets_to_model,
        merge_priced_buckets,
        sum_cost_by_currency,
    )

    sessions = []
    agents_seen: set[str] = set()
    total_messages = {"user": 0, "assistant": 0, "tool_calls": 0}
    combined_model_usage: dict[str, dict] = defaultdict(lambda: {
        "api_calls": 0, "input_tokens": 0, "output_tokens": 0,
        "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0,
        "cost": 0.0, "currency": "?", "agents": set(),
    })
    combined_repos: dict[str, dict] = defaultdict(
        lambda: {"files": 0, "added": 0, "deleted": 0, "agents": set()}
    )
    total_files = 0
    cost_by_currency: dict[str, float] = defaultdict(float)
    day_claude_buckets: dict[str, dict] = {}
    human_inputs: list[dict] = []

    def _session_repo_entries(repos_touched, files_changed) -> list[dict]:
        entries: dict[str, dict] = {}
        if isinstance(repos_touched, list):
            for r in repos_touched:
                if not isinstance(r, dict):
                    continue
                name = r.get("repo") or r.get("仓库")
                if not isinstance(name, str) or not name:
                    continue
                item = entries.setdefault(name, {"repo": name, "files": 0, "added": 0, "deleted": 0})
                item["files"] += int(r.get("files", r.get("文件数", 0)) or 0)
                item["added"] += int(r.get("added", r.get("新增行", 0)) or 0)
                item["deleted"] += int(r.get("deleted", r.get("删除行", 0)) or 0)
        if isinstance(files_changed, list):
            for f in files_changed:
                if not isinstance(f, dict):
                    continue
                name = f.get("repo")
                if not isinstance(name, str) or not name:
                    continue
                item = entries.setdefault(name, {"repo": name, "files": 0, "added": 0, "deleted": 0})
                item["files"] += 1
                item["added"] += int(f.get("added", 0) or 0)
                item["deleted"] += int(f.get("deleted", 0) or 0)
        return sorted(entries.values(), key=lambda x: x["repo"])

    def _session_repo_names(repos_touched, files_changed) -> list[str]:
        names: set[str] = set()
        if isinstance(repos_touched, list):
            for r in repos_touched:
                if isinstance(r, dict):
                    name = r.get("repo") or r.get("仓库")
                    if isinstance(name, str) and name:
                        names.add(name)
        if isinstance(files_changed, list):
            for f in files_changed:
                if isinstance(f, dict):
                    name = f.get("repo")
                    if isinstance(name, str) and name:
                        names.add(name)
        return sorted(names)

    for fpath in session_files:
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, IOError):
            continue

        agent = data.get("agent", "unknown")
        source = data.get("source", "")
        agent_display = f"cursor-{source}" if agent == "cursor" and source else agent
        agents_seen.add(agent_display)

        mstats = normalize_message_stats(data)
        mu = data.get("model_usage", {})
        repos = data.get("repos_touched", [])
        files = data.get("files_changed", [])
        msgs = data.get("messages", [])

        files_added = sum(f.get("added", 0) for f in files) if isinstance(files, list) else 0
        files_deleted = sum(f.get("deleted", 0) for f in files) if isinstance(files, list) else 0
        session_cost = 0.0
        cost_basis = "unknown"
        token_source = ""
        for entry in mu.values():
            if not isinstance(entry, dict):
                continue
            note = str(entry.get("note", "") or "")
            if not token_source and note:
                token_source = note
            cost = entry.get("cost")
            if isinstance(cost, (int, float)):
                session_cost += cost
            if "estimate" in note.lower():
                if cost_basis != "api_exact":
                    cost_basis = "estimate"
            elif "dashboard API" in note or "nearest-message" in note:
                cost_basis = "api_exact"

        session_repo_entries = _session_repo_entries(repos, files)
        sessions.append({
            "agent": agent,
            "source": source,
            "agent_display": agent_display,
            "session_id": data.get("session_id", ""),
            "session_name": data.get("session_name", ""),
            "time_range": data.get("time_range", ""),
            "project": data.get("project", ""),
            "message_stats": mstats,
            "files_changed": len(files) if isinstance(files, list) else 0,
            "files_added": files_added,
            "files_deleted": files_deleted,
            "models": list(mu.keys()),
            "total_tokens": sum(
                e.get("input_tokens", 0) + e.get("output_tokens", 0) + e.get("cache_read_input_tokens", 0)
                for e in mu.values() if isinstance(e, dict)
            ),
            "session_cost": round(session_cost, 4) if session_cost else 0,
            "cost_basis": cost_basis,
            "token_source": token_source,
            "repos_touched": _session_repo_names(repos, files),
            "repos_touched_detail": session_repo_entries,
        })

        # Build day-level human input rows from user messages.
        # These rows feed ai-session-usage human_inputs when AI summaries are absent.
        model_names = [m for m in mu.keys() if isinstance(m, str) and m]
        session_model = model_names[0] if model_names else ""
        session_time = ""
        tr = data.get("time_range")
        if isinstance(tr, dict):
            session_time = str(tr.get("display", "") or "")
        elif isinstance(tr, str):
            session_time = tr
        session_title = data.get("session_name", "")
        project = data.get("project", "")
        for msg in (msgs if isinstance(msgs, list) else []):
            if not isinstance(msg, dict):
                continue
            if msg.get("role") != "user":
                continue
            content = str(msg.get("text", "") or "").strip()
            if not content:
                continue
            human_inputs.append({
                "session_title": session_title,
                "session_agent": agent_display,
                "session_time": session_time,
                "session_model": session_model,
                "project": project,
                "category": classify_human_input(content),
                "topic": "other",
                "content": content,
            })

        for k in ("user", "assistant", "tool_calls"):
            total_messages[k] += mstats.get(k, 0)

        if agent == "claude-code":
            breakdown_rows = data.get("usage_breakdown") or []
            if breakdown_rows:
                day_claude_buckets = merge_priced_buckets(
                    day_claude_buckets,
                    buckets_from_breakdown(breakdown_rows),
                )

        for model, entry in mu.items():
            if not isinstance(entry, dict):
                continue
            agg = combined_model_usage[model]
            agg["api_calls"] += entry.get("api_calls", 0)
            agg["input_tokens"] += entry.get("input_tokens", 0)
            agg["output_tokens"] += entry.get("output_tokens", 0)
            agg["cache_read_input_tokens"] += entry.get("cache_read_input_tokens", 0)
            agg["cache_creation_input_tokens"] += entry.get("cache_creation_input_tokens", 0)
            agg["currency"] = entry.get("currency", "?")
            cost = entry.get("cost")
            if isinstance(cost, (int, float)) and agent != "claude-code":
                agg["cost"] += cost
                cost_by_currency[entry.get("currency", "?")] += cost
            agg["agents"].add(agent_display)

        for repo in repos:
            name = repo.get("repo", "")
            if not name:
                continue
            cr = combined_repos[name]
            cr["files"] += repo.get("files", repo.get("文件数", 0))
            cr["added"] += repo.get("added", repo.get("新增行", 0))
            cr["deleted"] += repo.get("deleted", repo.get("删除行", 0))
            cr["agents"].add(agent_display)

        if isinstance(files, list):
            total_files += len(files)

    model_list = {}
    for m, e in sorted(combined_model_usage.items()):
        item = dict(e)
        item["agents"] = sorted(item.pop("agents"))
        if item["cost"]:
            item["cost"] = round(item["cost"], 2)
        model_list[m] = item

    usage_breakdown_daily: list[dict] = []
    if day_claude_buckets:
        usage_breakdown_daily = sorted(
            day_claude_buckets.values(),
            key=lambda e: (
                e.get("model", ""),
                e.get("speed", ""),
                e.get("service_tier", ""),
                e.get("effort", ""),
            ),
        )
        for cur, amt in sum_cost_by_currency(day_claude_buckets).items():
            cost_by_currency[cur] += amt

        for model, entry in fold_buckets_to_model(day_claude_buckets).items():
            cost = entry.get("cost")
            if model in model_list:
                if isinstance(cost, (int, float)):
                    model_list[model]["cost"] = round(cost, 2)
                else:
                    model_list[model]["cost"] = cost
                model_list[model]["currency"] = entry.get("currency", "?")
            else:
                item = dict(entry)
                item["agents"] = ["claude-code"]
                if isinstance(item.get("cost"), (int, float)):
                    item["cost"] = round(item["cost"], 2)
                model_list[model] = item

    # Override Cursor char-based estimates with dashboard API exact values
    if cursor_api_usage and cursor_api_usage.get("by_model"):
        cu = cursor_api_usage
        # Remove prior Cursor session estimates before applying API totals
        for model, entry in list(model_list.items()):
            if not any(a.startswith("cursor") for a in entry.get("agents", [])):
                continue
            cost = entry.get("cost", 0)
            currency = entry.get("currency", "?")
            if isinstance(cost, (int, float)):
                cost_by_currency[currency] = cost_by_currency.get(currency, 0) - cost

        for model, api_entry in cu["by_model"].items():
            api_sum = api_entry.get("summary", api_entry)
            cost = api_sum.get("charged_usd", 0)
            if model in model_list:
                model_list[model]["input_tokens"] = api_sum.get("input_tokens", 0)
                model_list[model]["output_tokens"] = api_sum.get("output_tokens", 0)
                model_list[model]["cache_read_input_tokens"] = api_sum.get("cache_read_tokens", 0)
                model_list[model]["cache_creation_input_tokens"] = api_sum.get("cache_write_tokens", 0)
                model_list[model]["cost"] = round(cost, 4) if cost else 0
                model_list[model]["currency"] = "$"
                model_list[model]["note"] = "api_exact"
                if "cursor" not in model_list[model].get("agents", []):
                    model_list[model]["agents"] = sorted(set(model_list[model].get("agents", []) + ["cursor"]))
            else:
                model_list[model] = {
                    "api_calls": 0,
                    "input_tokens": api_sum.get("input_tokens", 0),
                    "output_tokens": api_sum.get("output_tokens", 0),
                    "cache_read_input_tokens": api_sum.get("cache_read_tokens", 0),
                    "cache_creation_input_tokens": api_sum.get("cache_write_tokens", 0),
                    "cost": round(cost, 4) if cost else 0,
                    "currency": "$",
                    "agents": ["cursor"],
                    "note": "api_exact",
                }
            if isinstance(cost, (int, float)):
                cost_by_currency["$"] = cost_by_currency.get("$", 0) + cost

    cost_display = {c: round(a, 2) for c, a in cost_by_currency.items()}

    return {
        "schema": "2.0",
        "date": target_date.isoformat(),
        "generated_at": datetime.now().astimezone().isoformat(),
        "author": git_username,
        "totals": {
            "sessions": len(sessions),
            "agents": sorted(agents_seen),
            "messages": total_messages,
            "files_changed": total_files,
            "cost": cost_display,
        },
        "model_usage": model_list,
        "usage_breakdown": usage_breakdown_daily,
        "repos": [
            {
                "repo": name, "files": r["files"],
                "added": r["added"], "deleted": r["deleted"],
                "agents": sorted(r["agents"]),
            }
            for name, r in sorted(combined_repos.items())
        ],
        "sessions": sorted(sessions, key=lambda s: str(s.get("time_range", ""))),
        "human_inputs": human_inputs,
        "cursor_api_usage": cursor_api_usage,
    }
