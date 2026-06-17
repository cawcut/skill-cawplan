"""Cursor store.db reader — session collection and message extraction."""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

from ai_coding_reports.readers.agent_paths import cursor_chats_dir, cursor_projects_dir

CHATS_DIR = cursor_chats_dir()  # legacy; prefer cursor_chats_dir()
PROJECTS_DIR = cursor_projects_dir()

SYSTEM_TRUNCATE_LEN = 100


# ---------------------------------------------------------------------------
# Protobuf blob parsing
# ---------------------------------------------------------------------------


def extract_json_from_blob(data: bytes) -> dict | None:
    """Extract role-bearing JSON from protobuf blob data."""
    if len(data) < 100 or b'"role"' not in data:
        return None

    pattern = rb'{"role"'
    for m in re.finditer(pattern, data):
        pos = m.start()
        depth = 0
        in_string = False
        escape = False
        for j in range(pos, min(pos + 500000, len(data))):
            b = data[j]
            if escape:
                escape = False
                continue
            if b == 0x5C:
                escape = True
                continue
            if b == 0x22:
                in_string = not in_string
                continue
            if in_string:
                continue
            if b == 0x7B:
                depth += 1
            elif b == 0x7D:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(data[pos : j + 1].decode("utf-8"))
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        pass
                    break
    return None


# ---------------------------------------------------------------------------
# Session collection
# ---------------------------------------------------------------------------


def collect_sessions(chats_dir: Path | None = None) -> list[dict]:
    """Collect all Cursor chat sessions with metadata."""
    base = Path(chats_dir) if chats_dir else cursor_chats_dir()
    sessions: list[dict] = []

    if not base.is_dir():
        return sessions

    for session_dir in sorted(base.iterdir()):
        if not session_dir.is_dir():
            continue
        for conv_dir in sorted(session_dir.iterdir()):
            if not conv_dir.is_dir():
                continue
            db_path = conv_dir / "store.db"
            if not db_path.exists():
                continue

            db = sqlite3.connect(str(db_path))
            try:
                meta_row = db.execute("SELECT value FROM meta WHERE key='0'").fetchone()
                if not meta_row:
                    continue
                meta = json.loads(bytes.fromhex(meta_row[0]).decode("utf-8"))

                blob_count = db.execute("SELECT COUNT(*) FROM blobs").fetchone()[0]
                total_size = db.execute(
                    "SELECT COALESCE(SUM(length(data)), 0) FROM blobs"
                ).fetchone()[0]

                sessions.append({
                    "id": conv_dir.name,
                    "name": meta.get("name", conv_dir.name),
                    "model": meta.get("lastUsedModel", ""),
                    "created_at_ms": meta.get("createdAt", 0),
                    "db_path": str(db_path),
                    "total_blobs": blob_count,
                    "total_size": total_size,
                })
            except Exception:
                pass
            finally:
                db.close()

    sessions.sort(key=lambda s: s.get("created_at_ms", 0), reverse=True)
    return sessions


def find_project_slug_for_session(session_id: str) -> str | None:
    """Map a Cursor session ID to its project slug.

    Scans ~/.cursor/projects/ for a directory containing
    agent-transcripts/<session_id>/.
    """
    if not cursor_projects_dir().is_dir():
        return None
    for project_dir in cursor_projects_dir().iterdir():
        if not project_dir.is_dir():
            continue
        if (project_dir / "agent-transcripts" / session_id).is_dir():
            return project_dir.name
    return None


# ---------------------------------------------------------------------------
# Message reading
# ---------------------------------------------------------------------------


def read_session_messages(session: dict) -> list[dict]:
    """Read all messages from a Cursor session's store.db, deduplicated."""
    db = sqlite3.connect(session["db_path"])
    rows = db.execute(
        "SELECT id, data FROM blobs WHERE length(data) > 100 ORDER BY rowid"
    ).fetchall()
    db.close()

    messages: list[dict] = []
    seen_hashes: set[int] = set()

    for _blob_id, data in rows:
        if b'"role"' not in data:
            continue
        msg = extract_json_from_blob(data)
        if not msg or "role" not in msg:
            continue

        content_hash = hash(json.dumps(msg.get("content", ""), sort_keys=True, default=str))
        if content_hash in seen_hashes:
            continue
        seen_hashes.add(content_hash)
        messages.append(msg)

    return messages


# ---------------------------------------------------------------------------
# Content extraction helpers
# ---------------------------------------------------------------------------


def extract_text_content(content) -> str:
    """Extract plain text from content (string or list)."""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        texts = []
        for item in content:
            if isinstance(item, dict):
                t = item.get("type", "")
                if t == "text":
                    txt = item.get("text", "")
                    if txt:
                        texts.append(txt)
        return "\n".join(texts).strip() if texts else ""
    return str(content).strip() if content else ""


def extract_content_items(content) -> list[dict]:
    """Extract content items as a list of dicts."""
    if isinstance(content, list):
        return content
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    return []
