"""Chunk builder — splits session messages into AI-friendly text chunks."""

from __future__ import annotations

import re
from pathlib import Path

MSG_TRUNCATE = 100  # max chars per message in chunk
CHUNK_SIZE = 8000   # max chars per chunk file
MAX_CHUNKS_PER_SESSION = 2

_CHUNK_HEADER_RE = re.compile(r"^# chunk \d+/\d+  messages .+\n", re.MULTILINE)


def build_chunks(
    messages: list[dict],
    agent: str = "",
    session_id: str = "",
    *,
    truncate: int | None = MSG_TRUNCATE,
) -> list[str]:
    """Split messages into chunk text blocks.

    Each message is truncated to `truncate` chars when truncate is not None.
    Chunks split at CHUNK_SIZE character boundaries.
    Returns list of text block strings.
    """
    lines = []
    for m in messages:
        role = m.get("role", "?")
        time = m.get("time", "")
        text = m.get("text", "")
        if truncate is not None and len(text) > truncate:
            text = text[:truncate] + "..."
        time_part = f" {time}" if time else ""
        lines.append(f"[{role}{time_part}] {text}")

    if not lines:
        return []

    chunks = []
    current = []
    current_size = 0
    for line in lines:
        line_size = len(line) + 1  # +1 for newline
        if current_size + line_size > CHUNK_SIZE and current:
            chunks.append("\n".join(current))
            current = []
            current_size = 0
        current.append(line)
        current_size += line_size

    if current:
        chunks.append("\n".join(current))

    # Add chunk header to each
    total = len(chunks)
    result = []
    msg_start = 0
    for i, chunk_body in enumerate(chunks):
        msg_count = chunk_body.count("\n") + 1
        header = f"# chunk {i + 1}/{total}  messages {msg_start + 1}-{msg_start + msg_count}\n"
        result.append(header + chunk_body)
        msg_start += msg_count

    return result


def _count_message_lines(chunk_body: str) -> int:
    return sum(1 for line in chunk_body.split("\n") if line.startswith("["))


def take_last_chunks(
    chunks: list[str],
    max_chunks: int = MAX_CHUNKS_PER_SESSION,
) -> list[str]:
    """Keep the last N chunks; rewrite headers to chunk 1/N .. N/N."""
    if not chunks or len(chunks) <= max_chunks:
        return chunks

    selected = chunks[-max_chunks:]
    total = len(selected)
    result: list[str] = []
    for i, chunk in enumerate(selected):
        body = _CHUNK_HEADER_RE.sub("", chunk, count=1).lstrip("\n")
        msg_count = _count_message_lines(body) or max(1, body.count("\n") + 1 if body else 1)
        header = f"# chunk {i + 1}/{total}  messages {msg_count}\n"
        result.append(header + body)
    return result


def write_chunks(day_dir: Path, session_file: Path) -> list[Path]:
    """Read a session JSON, build chunks, write .txt files to {day_dir}/chunks/.

    Returns list of output file paths.
    """
    import json

    with open(session_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    agent = data.get("agent", "unknown")
    session_id = data.get("session_id", "")[:8]
    messages = data.get("messages", [])

    chunks = take_last_chunks(build_chunks(messages, agent, session_id))
    if not chunks:
        return []

    chunks_dir = day_dir / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)

    prefix = f"{agent}-{session_id}-chunk-"
    for old in chunks_dir.glob(f"{prefix}*.txt"):
        old.unlink()

    paths = []
    for i, chunk_text in enumerate(chunks):
        fname = f"{prefix}{i + 1}.txt"
        out = chunks_dir / fname
        out.write_text(chunk_text, encoding="utf-8")
        paths.append(out)

    return paths


def generate_fake_summary(session_file: Path) -> dict:
    """Generate a fake AI summary for template testing.

    Reads session JSON, produces a dummy summary with placeholder content.
    NOT for production use — only for testing the render pipeline.
    """
    import json

    with open(session_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    agent = data.get("agent", "unknown")
    session_name = data.get("session_name", "")
    project = data.get("project", "")
    mstats = data.get("message_stats", {})
    messages = data.get("messages", [])

    # Use first user message as title inspiration
    title = session_name if session_name else f"{agent} session"
    user_msgs = [m["text"] for m in messages if m.get("role") == "user"]
    if user_msgs:
        # Use first user message fragment as title
        first = user_msgs[0][:60]

    return {
        "session_title": title[:60] if title else f"{agent} session",
        "human_input": {
            "decisions": [f"[fake] {agent} session 中的关键技术决策"],
            "direction": [f"[fake] 用户引导 AI 在 {project} 上完成了工作"],
            "bugs": ["[fake] 发现并修复了若干问题"],
            "planning": [f"[fake] 讨论了 {project} 相关的方案"],
        },
        "summary": (
            f"[fake] 本 session 共有 {mstats.get('user', 0)} 条用户消息, "
            f"{mstats.get('assistant', 0)} 条助手消息, "
            f"主要涉及 {project or '未知项目'}。"
        ),
        "next_steps": [
            f"[fake] {agent} session 的待跟进事项示例",
        ],
    }


def write_fake_summaries(day_dir: Path) -> list[Path]:
    """Generate fake summaries for all sessions in day_dir, write to summaries/.

    Returns list of output file paths.
    """
    import json

    from ai_coding_reports.utils.report_paths import list_session_files

    session_files = list_session_files(day_dir)
    if not session_files:
        return []

    summaries_dir = day_dir / "summaries"
    summaries_dir.mkdir(parents=True, exist_ok=True)

    paths = []
    for sf in session_files:
        summary = generate_fake_summary(sf)
        with open(sf, "r", encoding="utf-8") as f:
            data = json.load(f)
        agent = data.get("agent", "unknown")
        sid = data.get("session_id", "")[:8]
        fname = f"{agent}-{sid}.json"
        out = summaries_dir / fname
        with open(out, "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        paths.append(out)

    return paths
