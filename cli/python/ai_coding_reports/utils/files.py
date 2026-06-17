"""File system helpers: git root, diff, size formatting."""

from __future__ import annotations

import os
import re
import subprocess


def find_git_root(file_path: str) -> str | None:
    """Walk upward from file_path to find the nearest .git directory root."""
    path = os.path.abspath(file_path)
    if os.path.isdir(os.path.join(path, ".git")):
        return path
    for _ in range(20):
        parent = os.path.dirname(path)
        if parent == path:
            break
        if os.path.isdir(os.path.join(parent, ".git")):
            return parent
        path = parent
    return None


def diff_files(old_path: str, new_path: str) -> tuple[int, int]:
    """Run `diff old new` and return (added, deleted) line counts."""
    try:
        result = subprocess.run(
            ["diff", old_path, new_path],
            capture_output=True, text=True,
        )
        added = deleted = 0
        for line in result.stdout.split("\n"):
            if line.startswith("> ") and not line.startswith("> ---"):
                added += 1
            elif line.startswith("< ") and not line.startswith("< ---"):
                deleted += 1
        return added, deleted
    except Exception:
        return 0, 0


def decode_cursor_slug(slug: str) -> str | None:
    """Reverse Cursor workspace slug encoding back to filesystem path.

    Cursor encodes project paths like /Users/frank.fan@ui.com/workspace/foo
    into slugs like Users-frank-fan-ui-com-workspace-foo by joining sanitized
    path components with '-'.  Characters like '@' and '.' are replaced with
    '-' too, so "frank.fan@ui.com" becomes "frank-fan-ui-com" — a lossy
    encoding.  We recover the real path by testing consecutive slug-parts
    against actual directory entries.
    """
    parts = slug.split("-")
    if not parts:
        return None

    current = ""
    i = 0
    while i < len(parts):
        if i == 0:
            # First part is the root dir under /
            candidate = "/" + parts[i]
            if not os.path.isdir(candidate):
                # Not a valid root — fallback
                return None
            current = candidate
            i += 1
            continue

        matched = False
        # Try longest match first (up to 5 parts) to handle multi-segment
        # directory names like "00-products"
        for n in range(5, 0, -1):
            if i + n > len(parts):
                continue
            candidate_slug = "-".join(parts[i : i + n])
            try:
                for entry in sorted(os.listdir(current)):
                    entry_path = os.path.join(current, entry)
                    if not os.path.isdir(entry_path):
                        continue
                    safe = os.path.basename(entry_path)
                    safe = re.sub(r"[^a-zA-Z0-9]+", "-", safe).strip("-")
                    if safe == candidate_slug:
                        current = entry_path
                        i += n
                        matched = True
                        break
            except (PermissionError, OSError):
                return None
            if matched:
                break
        if not matched:
            break

    return current if current else None


def format_size(size_bytes: int) -> str:
    """Format byte count to human-readable string."""
    if size_bytes < 1024:
        return f"{size_bytes}B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f}KB"
    else:
        return f"{size_bytes / 1024 / 1024:.1f}MB"


def format_number(n: int) -> str:
    """Format a number with K/M suffixes."""
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    elif n >= 1_000:
        return f"{n / 1_000:.0f}K"
    return str(n)
