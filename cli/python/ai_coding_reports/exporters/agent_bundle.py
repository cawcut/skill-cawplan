"""Pack Cursor / Claude Code / Codex native data trees for offline analysis."""

from __future__ import annotations

import json
import shutil
import sqlite3
import tarfile
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path

from ai_coding_reports.readers.agent_paths import (
    claude_file_history_dir,
    claude_projects_dir,
    codex_home,
    codex_sessions_dir,
    codex_state_db,
    cursor_chats_dir,
    cursor_home,
    cursor_projects_dir,
)
from ai_coding_reports.readers.claude_code import find_sessions_by_date
from ai_coding_reports.readers.cursor_db import collect_sessions
from ai_coding_reports.readers.cursor_resolve import _find_store_db, _iter_transcripts
from ai_coding_reports.readers.codex import collect_threads
from ai_coding_reports.utils.timezone import local_tz

AGENT_DATA_SOURCES = {
    "cursor": {
        "env": "CURSOR_HOME",
        "default": "~/.cursor",
        "layout": ["projects/<slug>/agent-transcripts/<sid>/<sid>.jsonl", "chats/<hash>/<sid>/store.db"],
    },
    "claude-code": {
        "env": "CLAUDE_HOME",
        "default": "~/.claude",
        "layout": ["projects/<encoded>/<sid>.jsonl", "file-history/<sid>/..."],
    },
    "codex": {
        "env": "CODEX_HOME",
        "default": "~/.codex",
        "layout": ["state_5.sqlite", "sessions/..."],
    },
}


@dataclass
class BundleFile:
    source: str
    archive_path: str
    kind: str
    agent: str
    session_id: str = ""


@dataclass
class AgentBundlePlan:
    filter_date: str | None
    files: list[BundleFile] = field(default_factory=list)
    sessions: dict[str, list[str]] = field(default_factory=dict)
    usage_api_payload: dict | None = None

    def to_manifest(self) -> dict:
        return {
            "schema": "agent-data/1.0",
            "generated_at": datetime.now().isoformat(),
            "filter_date": self.filter_date,
            "sessions": self.sessions,
            "file_count": len(self.files),
            "data_sources": AGENT_DATA_SOURCES,
            "usage": {
                "extract": "tar xzf agent-data-{date}.tar.gz -C ~/Downloads/",
                "env": {
                    "CURSOR_HOME": "~/Downloads/agent-data-{date}/cursor",
                    "CLAUDE_HOME": "~/Downloads/agent-data-{date}/claude",
                    "CODEX_HOME": "~/Downloads/agent-data-{date}/codex",
                },
                "collect": "python3 scripts/cli.py collect --date {date}",
            },
            "files": [asdict(f) for f in self.files],
            "excluded": ["state.vscdb (Cursor auth token)", "git repositories"],
        }


def _filter_cursor_sessions_by_date(sessions: list[dict], filter_date: date) -> list[dict]:
    tz = local_tz()
    out: list[dict] = []
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


def _cursor_session_ids(filter_date: date | None) -> set[str]:
    ids: set[str] = set()
    projects = cursor_projects_dir()
    if projects.is_dir():
        for project_dir in projects.iterdir():
            if not project_dir.is_dir():
                continue
            for jsonl, _mtime in _iter_transcripts(project_dir, filter_date):
                ids.add(jsonl.parent.name)
    if filter_date is not None:
        for sess in _filter_cursor_sessions_by_date(collect_sessions(), filter_date):
            ids.add(sess["id"])
    else:
        for sess in collect_sessions():
            ids.add(sess["id"])
    return ids


def _collect_cursor_files(session_ids: set[str], prefix: str = "cursor") -> list[BundleFile]:
    files: list[BundleFile] = []
    projects = cursor_projects_dir()
    if projects.is_dir() and session_ids:
        for project_dir in sorted(projects.iterdir()):
            if not project_dir.is_dir():
                continue
            slug = project_dir.name
            transcripts_dir = project_dir / "agent-transcripts"
            if not transcripts_dir.is_dir():
                continue
            for sid in session_ids:
                jsonl = transcripts_dir / sid / f"{sid}.jsonl"
                if jsonl.is_file():
                    files.append(
                        BundleFile(
                            source=str(jsonl),
                            archive_path=f"{prefix}/projects/{slug}/agent-transcripts/{sid}/{sid}.jsonl",
                            kind="agent_transcript",
                            agent="cursor",
                            session_id=sid,
                        )
                    )
    for sid in sorted(session_ids):
        store_db = _find_store_db(sid)
        if store_db is None:
            continue
        chat_hash = store_db.parent.parent.name
        files.append(
            BundleFile(
                source=str(store_db),
                archive_path=f"{prefix}/chats/{chat_hash}/{sid}/store.db",
                kind="store_db",
                agent="cursor",
                session_id=sid,
            )
        )
    return files


def _collect_claude_files(filter_date: date | None, prefix: str = "claude") -> list[BundleFile]:
    files: list[BundleFile] = []
    if filter_date is None:
        projects = claude_projects_dir()
        if not projects.is_dir():
            return files
        session_items = []
        for project_dir in sorted(projects.iterdir()):
            if not project_dir.is_dir():
                continue
            for jsonl_file in sorted(project_dir.glob("*.jsonl")):
                session_items.append((str(jsonl_file), jsonl_file.stem))
    else:
        session_items = [(p, sid) for p, _name, sid in find_sessions_by_date(filter_date)]

    session_ids: set[str] = set()
    for jsonl_path, sid in session_items:
        session_ids.add(sid)
        rel_project = Path(jsonl_path).parent.name
        files.append(
            BundleFile(
                source=jsonl_path,
                archive_path=f"{prefix}/projects/{rel_project}/{sid}.jsonl",
                kind="session_jsonl",
                agent="claude-code",
                session_id=sid,
            )
        )

    history_root = claude_file_history_dir()
    if history_root.is_dir():
        for sid in session_ids:
            hist_dir = history_root / sid
            if not hist_dir.is_dir():
                continue
            for path in hist_dir.rglob("*"):
                if path.is_file():
                    rel = path.relative_to(history_root)
                    files.append(
                        BundleFile(
                            source=str(path),
                            archive_path=f"{prefix}/file-history/{rel.as_posix()}",
                            kind="file_history",
                            agent="claude-code",
                            session_id=sid,
                        )
                    )
    return files


def _codex_threads_for_date(filter_date: date | None) -> list[dict]:
    threads = collect_threads()
    if filter_date is None:
        return threads
    out = []
    for t in threads:
        ca = t.get("created_at")
        if not ca:
            continue
        try:
            td = date.fromtimestamp(ca) if isinstance(ca, (int, float)) else date.fromisoformat(str(ca)[:10])
        except (ValueError, OSError):
            continue
        if td == filter_date:
            out.append(t)
    return out


def _collect_codex_files(filter_date: date | None, prefix: str = "codex") -> list[BundleFile]:
    files: list[BundleFile] = []
    state_db = codex_state_db()
    if state_db.is_file():
        files.append(
            BundleFile(
                source=str(state_db),
                archive_path=f"{prefix}/state_5.sqlite",
                kind="state_db",
                agent="codex",
            )
        )

    seen_rollouts: set[str] = set()
    for thread in _codex_threads_for_date(filter_date):
        rp = thread.get("rollout_path", "")
        if not rp or rp in seen_rollouts:
            continue
        path = Path(rp)
        if not path.is_file():
            continue
        seen_rollouts.add(rp)
        try:
            rel = path.relative_to(codex_home())
            archive_rel = rel.as_posix()
        except ValueError:
            archive_rel = f"sessions/{path.name}"
        files.append(
            BundleFile(
                source=str(path),
                archive_path=f"{prefix}/{archive_rel}",
                kind="rollout_jsonl",
                agent="codex",
                session_id=thread.get("id", ""),
            )
        )
    return files


def _fetch_cursor_usage_api(filter_date: date) -> dict | None:
    try:
        from ai_coding_reports.readers.cursor_api import (
            aggregate_usage,
            build_session_cookie,
            day_bounds_ms,
            fetch_usage_events,
        )

        tzinfo = local_tz()
        start_ms, _ = day_bounds_ms(filter_date, tzinfo)
        _, end_ms = day_bounds_ms(filter_date, tzinfo)
        cookie, meta = build_session_cookie()
        events = fetch_usage_events(start_ms, end_ms, cookie)
        agg = aggregate_usage(events, tzinfo)
        day = agg["by_day"].get(filter_date.isoformat(), {})
        return {
            "token_source": "api_exact",
            "source": "cursor.com/api/dashboard/get-filtered-usage-events",
            "auth": {k: v for k, v in meta.items() if k != "exp"},
            "event_count": len(events),
            "summary": day.get("summary"),
            "by_model": day.get("by_model", {}),
        }
    except Exception:
        return None


def plan_agent_bundle(
    filter_date: date | None = None,
    *,
    with_usage_api: bool = True,
) -> AgentBundlePlan:
    cursor_ids = _cursor_session_ids(filter_date)
    plan = AgentBundlePlan(
        filter_date=filter_date.isoformat() if filter_date else None,
        sessions={
            "cursor": sorted(cursor_ids),
            "claude-code": [],
            "codex": [],
        },
    )

    plan.files.extend(_collect_cursor_files(cursor_ids))
    claude_files = _collect_claude_files(filter_date)
    plan.files.extend(claude_files)
    plan.sessions["claude-code"] = sorted({f.session_id for f in claude_files if f.session_id})

    codex_files = _collect_codex_files(filter_date)
    plan.files.extend(codex_files)
    plan.sessions["codex"] = sorted({f.session_id for f in codex_files if f.session_id})

    if with_usage_api and filter_date is not None:
        usage = _fetch_cursor_usage_api(filter_date)
        if usage:
            plan.files.append(
                BundleFile(
                    source="__inline__",
                    archive_path=f"cursor/usage-api-{filter_date.isoformat()}.json",
                    kind="usage_api",
                    agent="cursor",
                )
            )
            plan.usage_api_payload = usage

    deduped: dict[str, BundleFile] = {}
    for bf in plan.files:
        key = bf.archive_path if bf.source == "__inline__" else bf.source
        deduped[key] = bf
    plan.files = list(deduped.values())
    return plan


def pack_agent_bundle(
    filter_date: date | None = None,
    *,
    output_dir: Path | None = None,
    with_usage_api: bool = True,
) -> Path:
    plan = plan_agent_bundle(filter_date, with_usage_api=with_usage_api)
    real_files = [f for f in plan.files if f.source != "__inline__"]
    if not real_files and not plan.usage_api_payload:
        raise SystemExit(
            "No agent data to pack."
            + (f" (date={filter_date.isoformat()})" if filter_date else "")
        )

    out_root = output_dir or (Path.home() / "Downloads")
    out_root.mkdir(parents=True, exist_ok=True)

    label = filter_date.isoformat() if filter_date else "all"
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    archive_name = f"agent-data-{label}-{ts}.tar.gz"
    archive_path = out_root / archive_name

    staging = out_root / f".agent-bundle-staging-{ts}"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    try:
        bundle_root = staging / f"agent-data-{label}"
        bundle_root.mkdir()

        usage_payload = plan.usage_api_payload
        manifest = plan.to_manifest()
        if usage_payload:
            manifest["cursor_usage_api"] = "cursor/usage-api-{label}.json".format(label=label)
        (bundle_root / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        copied = 0
        for bf in real_files:
            src = Path(bf.source)
            if not src.is_file():
                continue
            dest = bundle_root / bf.archive_path
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
            copied += 1

        if usage_payload:
            usage_path = bundle_root / f"cursor/usage-api-{label}.json"
            usage_path.parent.mkdir(parents=True, exist_ok=True)
            usage_path.write_text(
                json.dumps(usage_payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            copied += 1

        if copied == 0:
            raise SystemExit("No readable files found on disk.")

        with tarfile.open(archive_path, "w:gz") as tar:
            tar.add(bundle_root, arcname=bundle_root.name)

    finally:
        shutil.rmtree(staging, ignore_errors=True)

    return archive_path


def format_sources_table() -> str:
    lines = [
        "Agent 本地数据源（可通过 *_HOME 环境变量覆盖）:",
        "",
        "| Agent | 环境变量 | 默认 | 关键路径 |",
        "|-------|----------|------|----------|",
    ]
    for agent, info in AGENT_DATA_SOURCES.items():
        layout = ", ".join(f"`{p}`" for p in info["layout"][:2])
        lines.append(f"| {agent} | `{info['env']}` | `{info['default']}` | {layout} |")
    lines.append("")
    lines.append("远程: Cursor dashboard API（需本机 state.vscdb，打包时可选写入 usage-api JSON）")
    return "\n".join(lines)
