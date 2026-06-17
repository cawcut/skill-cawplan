"""Git helpers: user identification and remote URL resolution."""

from __future__ import annotations

import subprocess


def get_git_username(repo_root: str | None = None) -> str:
    """Get git user.name (human-readable display name)."""
    cwd = repo_root or "."
    try:
        name = subprocess.check_output(
            ["git", "config", "user.name"], cwd=cwd, text=True
        ).strip()
        if name:
            return name
    except Exception:
        pass
    return "unknown"


def get_git_email_username(repo_root: str | None = None) -> str:
    """Get git user.email prefix (part before '@'), used for filenames."""
    cwd = repo_root or "."
    try:
        email = subprocess.check_output(
            ["git", "config", "user.email"], cwd=cwd, text=True
        ).strip()
        if "@" in email:
            return email.split("@")[0]
    except Exception:
        pass
    return "unknown"


def get_git_email(repo_root: str | None = None) -> str:
    """Get full git user.email."""
    cwd = repo_root or "."
    try:
        email = subprocess.check_output(
            ["git", "config", "user.email"], cwd=cwd, text=True
        ).strip()
        if email:
            return email
    except Exception:
        pass
    return "unknown"


def get_git_remote(repo_path: str) -> str:
    """Get the GitHub remote URL as 'owner/repo' (no https://github.com/ prefix).

    Falls back to the repo directory name if no remote is configured.
    """
    import os

    try:
        url = subprocess.check_output(
            ["git", "-C", repo_path, "remote", "get-url", "origin"],
            text=True,
        ).strip()
    except Exception:
        return os.path.basename(repo_path)

    # Strip protocol and host: https://github.com/owner/repo.git -> owner/repo
    url = url.removesuffix(".git")
    if "github.com/" in url:
        return url.split("github.com/", 1)[1]
    if "github.com:" in url:
        return url.split("github.com:", 1)[1]
    # For other formats, strip schema and host
    if "://" in url:
        parts = url.split("/", 3)
        if len(parts) >= 4:
            return f"{parts[2]}/{parts[3]}"
    return url
