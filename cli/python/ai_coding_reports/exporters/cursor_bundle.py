"""Pack local Cursor data sources into a portable archive for offline analysis."""

from __future__ import annotations

import json
import shutil
import tarfile
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path

from ai_coding_reports.readers.cursor_db import CHATS_DIR, PROJECTS_DIR, collect_sessions
from ai_coding_reports.readers.cursor_resolve import _find_store_db, _iter_transcripts
from ai_coding_reports.utils.timezone import local_tz

# Human-readable catalog of what the Cursor pipeline reads locally.
CURSOR_DATA_SOURCES = [
    {
        "id": "agent_transcripts",
        "path": "~/.cursor/projects/<project_slug>/agent-transcripts/<session_id>/<session_id>.jsonl",
        "used_by": [
            "repo detection (edit paths)",
            "codegraph_savings",
            "session resolution",
        ],
        "notes": "Primary source for tool calls, file paths, timestamps.",
    },
    {
        "id": "store_db",
        "path": "~/.cursor/chats/<hash>/<session_id>/store.db",
        "used_by": [
            "collect / export session",
            "message extraction",
            "token char estimates",
            "session metadata (name, model)",
        ],
        "notes": "SQLite protobuf blobs; may be absent for some sessions.",
    },
    {
        "id": "state_vscdb",
        "path": "~/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
        "used_by": ["Cursor dashboard usage API auth"],
        "notes": "Contains access token — NOT included in bundle (security).",
    },
    {
        "id": "git_repos",
        "path": "<workspace paths from transcript edit paths>",
        "used_by": ["repos_touched", "added/deleted line stats"],
        "notes": "Read-only git commands on disk; not copied into bundle.",
    },
    {
        "id": "generated_reports",
        "path": "Outputs/reports/<date>/cursor-*.json, daily.json",
        "used_by": ["daily aggregation", "render"],
        "notes": "Optional; include with --include-reports.",
    },
]


@dataclass
class BundleFile:
    source: str
    archive_path: str
    kind: str
    session_id: str = ""
    project_slug: str = ""


@dataclass
class CursorBundlePlan:
    filter_date: str | None
    files: list[BundleFile] = field(default_factory=list)
    session_ids: list[str] = field(default_factory=list)

    def to_manifest(self) -> dict:
        return {
            "schema": "cursor-bundle/1.0",
            "generated_at": datetime.now().isoformat(),
            "filter_date": self.filter_date,
            "session_count": len(self.session_ids),
            "session_ids": self.session_ids,
            "file_count": len(self.files),
            "data_sources": CURSOR_DATA_SOURCES,
            "files": [asdict(f) for f in self.files],
            "excluded": [
                "state.vscdb (auth token)",
                "git repositories (resolved at analysis time)",
            ],
        }


def _filter_cursor_sessions_by_date(sessions: list[dict], filter_date: date) -> list[dict]:
    from datetime import datetime, timezone

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


def _session_ids_for_date(filter_date: date | None) -> set[str]:
    ids: set[str] = set()

    if PROJECTS_DIR.is_dir():
        for project_dir in PROJECTS_DIR.iterdir():
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


def _collect_transcript_files(session_ids: set[str]) -> list[BundleFile]:
    files: list[BundleFile] = []
    if not PROJECTS_DIR.is_dir() or not session_ids:
        return files

    for project_dir in sorted(PROJECTS_DIR.iterdir()):
        if not project_dir.is_dir():
            continue
        slug = project_dir.name
        transcripts_dir = project_dir / "agent-transcripts"
        if not transcripts_dir.is_dir():
            continue
        for sid in session_ids:
            jsonl = transcripts_dir / sid / f"{sid}.jsonl"
            if not jsonl.is_file():
                continue
            files.append(
                BundleFile(
                    source=str(jsonl),
                    archive_path=f"transcripts/{slug}/{sid}.jsonl",
                    kind="agent_transcript",
                    session_id=sid,
                    project_slug=slug,
                )
            )
    return files


def _collect_store_db_files(session_ids: set[str]) -> list[BundleFile]:
    files: list[BundleFile] = []
    for sid in sorted(session_ids):
        store_db = _find_store_db(sid)
        if store_db is None:
            continue
        chat_hash = store_db.parent.parent.name
        files.append(
            BundleFile(
                source=str(store_db),
                archive_path=f"store-db/{chat_hash}/{sid}/store.db",
                kind="store_db",
                session_id=sid,
                project_slug=chat_hash,
            )
        )
    return files


def _collect_report_files(filter_date: date | None, reports_dir: Path) -> list[BundleFile]:
    if filter_date is None:
        return []
    day_dir = reports_dir / filter_date.isoformat()
    if not day_dir.is_dir():
        return []

    files: list[BundleFile] = []
    for pattern in ("cursor-*.json", "daily.json"):
        for path in sorted(day_dir.glob(pattern)):
            files.append(
                BundleFile(
                    source=str(path),
                    archive_path=f"reports/{path.name}",
                    kind="generated_report",
                )
            )
    return files


def plan_cursor_bundle(
    filter_date: date | None = None,
    *,
    include_reports: bool = False,
    reports_dir: Path | None = None,
) -> CursorBundlePlan:
    session_ids = _session_ids_for_date(filter_date)
    plan = CursorBundlePlan(
        filter_date=filter_date.isoformat() if filter_date else None,
        session_ids=sorted(session_ids),
    )

    transcript_files = _collect_transcript_files(session_ids)
    store_files = _collect_store_db_files(session_ids)
    plan.files.extend(transcript_files)
    plan.files.extend(store_files)

    seen_sources = {f.source for f in plan.files}
    for bf in store_files:
        seen_sources.add(bf.source)
    for bf in transcript_files:
        seen_sources.add(bf.source)

    if include_reports and filter_date is not None:
        if reports_dir is None:
            raise ValueError("reports_dir is required when include_reports=True")
        plan.files.extend(_collect_report_files(filter_date, reports_dir))

    # Dedupe by source path
    deduped: dict[str, BundleFile] = {}
    for bf in plan.files:
        deduped[bf.source] = bf
    plan.files = list(deduped.values())
    return plan


def pack_cursor_bundle(
    filter_date: date | None = None,
    *,
    output_dir: Path | None = None,
    include_reports: bool = False,
    reports_dir: Path | None = None,
) -> Path:
    """Create a .tar.gz under output_dir (default ~/Downloads)."""
    plan = plan_cursor_bundle(
        filter_date,
        include_reports=include_reports,
        reports_dir=reports_dir,
    )
    if not plan.files:
        raise SystemExit(
            "No Cursor files to pack."
            + (f" (date={filter_date.isoformat()})" if filter_date else "")
        )

    out_root = output_dir or (Path.home() / "Downloads")
    out_root.mkdir(parents=True, exist_ok=True)

    label = filter_date.isoformat() if filter_date else "all"
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    archive_name = f"cursor-bundle-{label}-{ts}.tar.gz"
    archive_path = out_root / archive_name

    staging = out_root / f".cursor-bundle-staging-{ts}"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    try:
        bundle_root = staging / f"cursor-bundle-{label}"
        bundle_root.mkdir()
        (bundle_root / "manifest.json").write_text(
            json.dumps(plan.to_manifest(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        copied = 0
        for bf in plan.files:
            src = Path(bf.source)
            if not src.is_file():
                continue
            dest = bundle_root / bf.archive_path
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
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
        "Cursor 本地数据源（ai-coding-reports 读取）:",
        "",
        "| 类型 | 路径 | 用途 |",
        "|------|------|------|",
    ]
    for src in CURSOR_DATA_SOURCES:
        path = src["path"].replace("|", "\\|")
        uses = ", ".join(src["used_by"])
        lines.append(f"| {src['id']} | `{path}` | {uses} |")
    lines.append("")
    lines.append("远程: cursor.com/api/dashboard/get-filtered-usage-events（需本机 state.vscdb 登录态，不打包）")
    return "\n".join(lines)
