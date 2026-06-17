"""Report generator — reads exported sessions and produces structured report JSON."""

from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

from ai_coding_reports.utils.files import format_size


def find_exported_sessions(base_dir: str, agent_filter: str | None = None) -> list[tuple]:
    """Find all session files in the export directory tree.

    Returns list of (agent, date_str, session_id, meta_path, md_path).
    """
    sessions = []
    if not os.path.isdir(base_dir):
        return sessions

    for agent_dir in sorted(Path(base_dir).iterdir()):
        if not agent_dir.is_dir():
            continue
        agent = agent_dir.name
        if agent_filter and agent not in agent_filter.split(","):
            continue

        for date_dir in sorted(agent_dir.iterdir()):
            if not date_dir.is_dir():
                continue
            date_str = date_dir.name

            for meta_file in sorted(date_dir.glob("*.meta.json")):
                session_id = meta_file.name[:-len(".meta.json")]
                md_file = date_dir / f"{session_id}.md"
                if md_file.exists():
                    sessions.append((agent, date_str, session_id, str(meta_file), str(md_file)))

    return sessions


def load_meta(meta_path: str) -> dict:
    """Load a meta.json file."""
    with open(meta_path, "r", encoding="utf-8") as f:
        return json.load(f)


def extract_first_user_query(md_path: str) -> str:
    """Extract the first user query from a markdown file."""
    try:
        with open(md_path, "r", encoding="utf-8") as f:
            content = f.read()
    except (IOError, UnicodeDecodeError):
        return ""

    user_match = re.search(r'## User\n\n(.+?)(?:\n---\n|\n## )', content, re.DOTALL)
    if not user_match:
        return ""

    text = user_match.group(1).strip()

    query_match = re.search(r'<user_query>\s*(.+?)\s*</user_query>', text, re.DOTALL)
    if query_match:
        text = query_match.group(1).strip()
    else:
        paragraphs = text.split("\n\n")
        if paragraphs:
            text = paragraphs[-1].strip()

    lines = text.split("\n")
    return lines[0][:200] if lines else text[:200]


def generate_report(
    sessions: list[tuple],
    output_path: str,
    date_label: str = "all",
) -> dict:
    """Generate a structured report JSON from session data."""
    session_data = []
    daily_aggregates = defaultdict(lambda: {
        "date": "",
        "session_count": 0,
        "total_messages": 0,
        "total_user_messages": 0,
        "total_assistant_messages": 0,
        "total_tool_messages": 0,
        "total_data_size_bytes": 0,
        "total_tool_calls": 0,
        "models_used": [],
        "agents_used": [],
    })

    all_models = set()
    all_agents = set()
    total_stats = {
        "session_count": 0,
        "total_messages": 0,
        "total_user_messages": 0,
        "total_assistant_messages": 0,
        "total_tool_messages": 0,
        "total_data_size_bytes": 0,
    }
    global_tool_counts: dict[str, int] = {}
    global_skill_counts: dict[str, int] = {}

    for agent, date_str, session_id, meta_path, md_path in sessions:
        try:
            meta = load_meta(meta_path)
        except (json.JSONDecodeError, IOError):
            continue

        stats = meta.get("stats", {})
        first_query = extract_first_user_query(md_path)

        session_entry = {
            "session_id": session_id,
            "session_name": meta.get("session_name", ""),
            "agent": meta.get("agent", agent),
            "model": meta.get("model", ""),
            "created_at": meta.get("created_at", ""),
            "date": date_str,
            "topic_hint": first_query,
            "stats": {
                "message_count": stats.get("message_count", 0),
                "user_messages": stats.get("user_messages", 0),
                "assistant_messages": stats.get("assistant_messages", 0),
                "tool_messages": stats.get("tool_messages", 0),
                "data_size_bytes": stats.get("data_size_bytes", 0),
                "tool_breakdown": stats.get("tool_breakdown"),
                "skill_breakdown": stats.get("skill_breakdown"),
            },
        }

        session_data.append(session_entry)

        daily = daily_aggregates[date_str]
        daily["date"] = date_str
        daily["session_count"] += 1
        daily["total_messages"] += stats.get("message_count", 0)
        daily["total_user_messages"] += stats.get("user_messages", 0)
        daily["total_assistant_messages"] += stats.get("assistant_messages", 0)
        daily["total_tool_messages"] += stats.get("tool_messages", 0)
        daily["total_data_size_bytes"] += stats.get("data_size_bytes", 0)

        for tool, count in (stats.get("tool_breakdown") or {}).items():
            if tool != "_tool_results":
                daily["total_tool_calls"] += count
        if meta.get("model") and meta["model"] not in daily["models_used"]:
            daily["models_used"].append(meta["model"])
        if meta.get("agent") and meta["agent"] not in daily["agents_used"]:
            daily["agents_used"].append(meta["agent"])

        total_stats["session_count"] += 1
        total_stats["total_messages"] += stats.get("message_count", 0)
        total_stats["total_user_messages"] += stats.get("user_messages", 0)
        total_stats["total_assistant_messages"] += stats.get("assistant_messages", 0)
        total_stats["total_tool_messages"] += stats.get("tool_messages", 0)
        total_stats["total_data_size_bytes"] += stats.get("data_size_bytes", 0)

        if meta.get("model"):
            all_models.add(meta["model"])
        if meta.get("agent"):
            all_agents.add(meta["agent"])

        for tool, count in (stats.get("tool_breakdown") or {}).items():
            global_tool_counts[tool] = global_tool_counts.get(tool, 0) + count
        for skill, count in (stats.get("skill_breakdown") or {}).items():
            global_skill_counts[skill] = global_skill_counts.get(skill, 0) + count

    daily_list = sorted(daily_aggregates.values(), key=lambda d: d["date"])

    report = {
        "report_meta": {
            "generated_at": datetime.now().isoformat(),
            "date_range": date_label,
            "protocol_version": "1.0",
        },
        "totals": {
            **total_stats,
            "models_used": sorted(all_models),
            "agents_used": sorted(all_agents),
            "total_data_size_formatted": format_size(total_stats["total_data_size_bytes"]),
            "top_tools": dict(
                sorted(global_tool_counts.items(), key=lambda x: x[1], reverse=True)[:20]
            ),
            "top_skills": dict(
                sorted(global_skill_counts.items(), key=lambda x: x[1], reverse=True)[:20]
            ),
        },
        "daily_breakdown": daily_list,
        "sessions": session_data,
    }

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    return report


def print_summary(report: dict) -> None:
    """Print a human-readable summary of the report."""
    t = report["totals"]
    print(f"\n{'=' * 60}")
    print(f"AI Usage Report — {report['report_meta']['date_range']}")
    print(f"{'=' * 60}")
    print(f"  Sessions:        {t['session_count']}")
    print(f"  Total Messages:  {t['total_messages']}")
    print(f"    User:          {t['total_user_messages']}")
    print(f"    Assistant:     {t['total_assistant_messages']}")
    print(f"    Tool:          {t['total_tool_messages']}")
    print(f"  Data Size:       {t['total_data_size_formatted']}")
    print(f"  Models:          {', '.join(t['models_used'])}")
    print(f"  Agents:          {', '.join(t['agents_used'])}")

    if t.get("top_tools"):
        print(f"\n  Top Tools:")
        for tool, count in list(t["top_tools"].items())[:8]:
            print(f"    {tool:<25s} {count:>4d}")

    if t.get("top_skills"):
        print(f"\n  Top Skills:")
        for skill, count in list(t["top_skills"].items())[:8]:
            print(f"    {skill:<25s} {count:>4d}")

    print(f"\n  Daily Breakdown:")
    for day in report["daily_breakdown"]:
        d = day["date"]
        print(
            f"    {d}: {day['session_count']} sessions, {day['total_messages']} msgs, "
            f"{day['total_tool_calls']} tools, "
            f"{format_size(day['total_data_size_bytes'])}"
        )
