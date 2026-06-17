"""Cursor session resolver — locate store.db from agent-transcripts."""

from __future__ import annotations

import json
import os
import re
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

from ai_coding_reports.utils.timezone import local_tz

from ai_coding_reports.readers.agent_paths import cursor_chats_dir, cursor_projects_dir


@dataclass
class CursorSessionRef:
    session_id: str
    transcript_path: Path
    project_slug: str
    store_db_path: Path | None = None
    session_name: str | None = None
    mtime: float = 0.0


def encode_workspace_slug(cwd: Path) -> str:
    """Encode absolute path to approximate Cursor projects dir name."""
    resolved = cwd.resolve()
    parts = list(resolved.parts)
    if not parts:
        return ""
    encoded: list[str] = []
    for part in parts:
        if part == "/":
            continue
        safe = re.sub(r"[^a-zA-Z0-9]+", "-", part).strip("-")
        if safe:
            encoded.append(safe)
    return "-".join(encoded)


def _find_store_db(session_id: str) -> Path | None:
    chats = cursor_chats_dir()
    if not chats.is_dir():
        return None
    for store_db in chats.glob(f"*/{session_id}/store.db"):
        if store_db.is_file():
            return store_db
    return None


def _iter_transcripts(
    project_dir: Path, filter_date: date | None
) -> list[tuple[Path, float]]:
    transcripts_dir = project_dir / "agent-transcripts"
    if not transcripts_dir.is_dir():
        return []

    found: list[tuple[Path, float]] = []
    for session_dir in transcripts_dir.iterdir():
        if not session_dir.is_dir():
            continue
        if session_dir.name == "subagents":
            continue
        jsonl = session_dir / f"{session_dir.name}.jsonl"
        if not jsonl.is_file():
            continue
        try:
            mtime = jsonl.stat().st_mtime
        except OSError:
            continue
        if filter_date is not None:
            tz = local_tz()
            mtime_date = datetime.fromtimestamp(mtime, tz=timezone.utc).astimezone(tz).date()
            if mtime_date != filter_date:
                continue
        found.append((jsonl, mtime))
    return found


def _score_project_slug(slug: str, cwd: Path) -> int:
    """Higher = better match for current workspace."""
    encoded = encode_workspace_slug(cwd)
    if not encoded:
        return 0
    if slug == encoded:
        return 100
    if encoded in slug or slug in encoded:
        return 80
    cwd_parts = {p.lower() for p in cwd.resolve().parts if len(p) > 2}
    slug_parts = {p.lower() for p in slug.split("-") if len(p) > 2}
    overlap = len(cwd_parts & slug_parts)
    return overlap * 10


def _load_session_name_from_store(store_db: Path | None) -> str | None:
    if store_db is None or not store_db.is_file():
        return None
    try:
        db = sqlite3.connect(str(store_db))
        row = db.execute("SELECT value FROM meta WHERE key='0'").fetchone()
        db.close()
        if not row:
            return None
        meta = json.loads(bytes.fromhex(row[0]).decode("utf-8"))
        return meta.get("name")
    except Exception:
        return None


def resolve_cursor_session(
    cwd: str | Path | None = None,
    *,
    filter_date: date | None = None,
    session_id: str | None = None,
    transcript_path: str | Path | None = None,
) -> CursorSessionRef | None:
    """Resolve a Cursor session by workspace matching or explicit ref."""

    # Explicit transcript path
    if transcript_path is not None:
        tp = Path(transcript_path).expanduser().resolve()
        sid = session_id or tp.stem
        slug = tp.parent.parent.name if tp.parent.parent else ""
        store = _find_store_db(sid)
        return CursorSessionRef(
            session_id=sid,
            transcript_path=tp,
            project_slug=slug,
            store_db_path=store,
            session_name=_load_session_name_from_store(store),
            mtime=tp.stat().st_mtime if tp.is_file() else 0.0,
        )

    # Explicit session ID
    if session_id:
        hint = session_id
        projects = cursor_projects_dir()
        if projects.is_dir():
            for project_dir in projects.iterdir():
                transcripts_dir = project_dir / "agent-transcripts"
                if not transcripts_dir.is_dir():
                    continue
                for session_dir in transcripts_dir.iterdir():
                    if not session_dir.is_dir() or session_dir.name == "subagents":
                        continue
                    if hint not in session_dir.name:
                        continue
                    jsonl = session_dir / f"{session_dir.name}.jsonl"
                    if not jsonl.is_file():
                        continue
                    sid = session_dir.name
                    store = _find_store_db(sid)
                    return CursorSessionRef(
                        session_id=sid,
                        transcript_path=jsonl,
                        project_slug=project_dir.name,
                        store_db_path=store,
                        session_name=_load_session_name_from_store(store),
                        mtime=jsonl.stat().st_mtime,
                    )
        # Fallback: find by store.db
        store = _find_store_db(hint)
        if store is not None:
            sid = store.parent.name
            return CursorSessionRef(
                session_id=sid,
                transcript_path=Path(""),
                project_slug="",
                store_db_path=store,
                session_name=_load_session_name_from_store(store),
            )
        return None

    # Workspace-based resolution
    base = Path(cwd or ".").resolve()
    projects = cursor_projects_dir()
    if not projects.is_dir():
        return None

    candidates: list[tuple[CursorSessionRef, int]] = []
    for project_dir in projects.iterdir():
        if not project_dir.is_dir():
            continue
        slug = project_dir.name
        slug_score = _score_project_slug(slug, base)
        for jsonl, mtime in _iter_transcripts(project_dir, filter_date):
            sid = jsonl.parent.name
            store = _find_store_db(sid)
            ref = CursorSessionRef(
                session_id=sid,
                transcript_path=jsonl,
                project_slug=slug,
                store_db_path=store,
                session_name=_load_session_name_from_store(store),
                mtime=mtime,
            )
            candidates.append((ref, slug_score))

    if not candidates:
        return None

    candidates.sort(key=lambda x: (x[1], x[0].mtime), reverse=True)
    return candidates[0][0]


def resolve_to_collect_session(ref: CursorSessionRef) -> dict | None:
    """Convert CursorSessionRef to collect_sessions() entry format."""
    if ref.store_db_path is None or not ref.store_db_path.is_file():
        return None

    db_path = ref.store_db_path
    try:
        db = sqlite3.connect(str(db_path))
        meta_row = db.execute("SELECT value FROM meta WHERE key='0'").fetchone()
        blob_count = db.execute("SELECT COUNT(*) FROM blobs").fetchone()[0]
        total_size = db.execute(
            "SELECT COALESCE(SUM(length(data)), 0) FROM blobs"
        ).fetchone()[0]
        db.close()
    except Exception:
        return None

    meta = {}
    created_at_ms = 0
    if meta_row:
        try:
            meta = json.loads(bytes.fromhex(meta_row[0]).decode("utf-8"))
            created_at_ms = meta.get("createdAt", 0)
        except Exception:
            pass

    return {
        "id": ref.session_id,
        "name": ref.session_name or meta.get("name", ref.session_id),
        "model": meta.get("lastUsedModel", ""),
        "created_at_ms": created_at_ms,
        "db_path": str(db_path),
        "total_blobs": blob_count,
        "total_size": total_size,
    }
