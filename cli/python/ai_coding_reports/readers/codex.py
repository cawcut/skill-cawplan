"""Codex state DB and rollout JSONL reader."""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

from ai_coding_reports.readers.agent_paths import codex_sessions_dir, codex_state_db


def resolve_rollout_path(stored: str) -> Path | None:
    """Resolve rollout JSONL path, including bundled CODEX_HOME layouts."""
    if not stored:
        return None
    path = Path(stored)
    if path.is_file():
        return path

    normalized = stored.replace("\\", "/")
    if "/sessions/" in normalized:
        suffix = normalized.split("/sessions/", 1)[1]
        candidate = codex_sessions_dir() / suffix
        if candidate.is_file():
            return candidate

    candidate = codex_sessions_dir() / path.name
    if candidate.is_file():
        return candidate
    return None


def collect_threads() -> list[dict]:
    """Read all threads from the Codex state SQLite DB."""
    state_db = codex_state_db()
    if not state_db.is_file():
        print(f"Codex state DB not found: {state_db}", file=sys.stderr)
        return []

    db = sqlite3.connect(state_db)
    db.row_factory = sqlite3.Row
    rows = db.execute(
        """SELECT id, rollout_path, created_at, updated_at, model, model_provider,
                  tokens_used, title, first_user_message, cwd
           FROM threads ORDER BY created_at DESC"""
    ).fetchall()
    db.close()

    threads = []
    for row in rows:
        rp = row["rollout_path"]
        resolved = resolve_rollout_path(rp) if rp else None
        if resolved is None:
            continue
        threads.append({
            "id": row["id"],
            "rollout_path": str(resolved),
            "created_at": row["created_at"] or "",
            "model": row["model"] or row["model_provider"] or "",
            "tokens_used": row["tokens_used"] or 0,
            "title": row["title"] or "",
            "first_user_message": row["first_user_message"] or "",
            "cwd": row["cwd"] or "",
        })

    return threads


def collect_threads_full() -> list[dict]:
    """Read all threads with full metadata (for chat export)."""
    state_db = codex_state_db()
    if not state_db.is_file():
        print(f"Codex state DB not found: {state_db}", file=sys.stderr)
        return []

    db = sqlite3.connect(state_db)
    rows = db.execute(
        """SELECT id, rollout_path, created_at, updated_at, model, model_provider,
                  tokens_used, title, first_user_message, cwd, source,
                  approval_mode, git_sha, git_branch, git_origin_url
           FROM threads ORDER BY created_at DESC"""
    ).fetchall()
    db.close()

    threads = []
    for row in rows:
        (tid, rollout_path, created_at, updated_at, model, provider,
         tokens_used, title, first_msg, cwd, source, approval_mode,
         git_sha, git_branch, git_url) = row

        resolved = resolve_rollout_path(rollout_path) if rollout_path else None
        if resolved is None:
            continue

        threads.append({
            "id": tid,
            "rollout_path": str(resolved),
            "created_at": created_at,
            "updated_at": updated_at,
            "model": model or provider or "",
            "provider": provider or "",
            "tokens_used": tokens_used or 0,
            "title": title or "",
            "first_user_message": first_msg or "",
            "cwd": cwd or "",
            "source": source or "",
            "approval_mode": approval_mode or "",
            "git_sha": git_sha or "",
            "git_branch": git_branch or "",
            "git_url": git_url or "",
        })

    return threads


def parse_messages(rollout_path: str, filter_date=None) -> list[dict]:
    """Parse a Codex JSONL rollout file into message list."""
    messages = []
    path = resolve_rollout_path(rollout_path) or Path(rollout_path)
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    evt = json.loads(line)
                except json.JSONDecodeError:
                    continue

                etype = evt.get("type", "")
                payload = evt.get("payload", {})

                if etype == "session_meta":
                    base = payload.get("base_instructions", {})
                    sys_text = base.get("text", "")
                    if sys_text:
                        messages.append({"role": "system", "content": sys_text})

                elif etype == "response_item":
                    if payload.get("type") != "message":
                        continue
                    role = payload.get("role", "")
                    content = payload.get("content", [])
                    if not isinstance(content, list):
                        continue
                    texts = []
                    for c in content:
                        t = c.get("type", "")
                        txt = c.get("text", "")
                        if t in ("input_text", "output_text") and txt:
                            texts.append(txt)
                    if texts:
                        messages.append({
                            "role": role,
                            "content": "\n".join(texts),
                        })

    except (IOError, OSError) as e:
        print(f"Warning: {path}: {e}", file=sys.stderr)

    return messages
