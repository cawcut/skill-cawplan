"""File change aggregation from session events and git."""

from __future__ import annotations

import os
from collections import defaultdict

from ai_coding_reports.utils.files import diff_files, find_git_root
from ai_coding_reports.utils.git import get_git_remote

from ai_coding_reports.readers.agent_paths import claude_file_history_dir


def get_file_changes_claude(
    session_id: str, events: list[dict], filter_date=None
) -> list[dict]:
    """Collect changed files from Claude Code file-history-snapshot events."""
    file_backups: dict[str, list[dict]] = {}

    for evt in events:
        if evt.get("type") != "file-history-snapshot":
            continue
        snap = evt.get("snapshot", {})
        for fpath, info in snap.get("trackedFileBackups", {}).items():
            if not isinstance(info, dict):
                continue
            if fpath not in file_backups:
                file_backups[fpath] = []
            file_backups[fpath].append({
                "backup_file": info.get("backupFileName", ""),
                "version": info.get("version", 0),
                "time": info.get("backupTime", ""),
            })

    if not file_backups:
        return []

    history_dir = os.path.join(str(claude_file_history_dir()), session_id)
    results = []

    for fpath, backups in file_backups.items():
        valid = [b for b in backups if b.get("backup_file")]
        if not valid:
            continue
        earliest = min(valid, key=lambda b: b["version"])

        backup_path = os.path.join(history_dir, earliest["backup_file"])
        current_path = os.path.join(
            os.environ.get("CLAUDE_CODE_PROJECT_CWD", ""), fpath
        )

        if not os.path.exists(current_path):
            for evt in events:
                if evt.get("cwd"):
                    current_path = os.path.join(evt["cwd"], fpath)
                    break

        if not os.path.exists(backup_path) or not os.path.exists(current_path):
            continue

        is_new_file = False
        try:
            with open(backup_path, "rb") as fa, open(current_path, "rb") as fb:
                is_new_file = (fa.read() == fb.read())
        except (IOError, OSError):
            pass

        if is_new_file:
            try:
                added = sum(1 for _ in open(current_path, "r", encoding="utf-8", errors="ignore"))
            except Exception:
                added = 0
            deleted = 0
            change_type = "new"
        else:
            added, deleted = diff_files(backup_path, current_path)
            change_type = "modified"

        repo_root = find_git_root(current_path)
        repo_name = get_git_remote(repo_root) if repo_root else ""
        results.append({
            "path": fpath,
            "added": added,
            "deleted": deleted,
            "change_type": change_type,
            "repo": repo_name,
        })

    return results


def build_repos_touched(files_changed: list[dict]) -> list[dict]:
    """Group file changes by git repository."""
    repo_groups: dict[str, dict] = defaultdict(
        lambda: {"files": 0, "added": 0, "deleted": 0}
    )
    for f in files_changed:
        name = f.get("repo", "")
        if name:
            g = repo_groups[name]
            g["files"] += 1
            g["added"] += f.get("added", 0)
            g["deleted"] += f.get("deleted", 0)

    return [
        {
            "repo": name,
            "files": stats["files"],
            "added": stats["added"],
            "deleted": stats["deleted"],
        }
        for name, stats in repo_groups.items()
    ]
