"""Cursor IDE GUI sessions from globalStorage/state.vscdb (composerData / bubbleId)."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote

from ai_coding_reports.readers.cursor_api import _state_db_candidates
from ai_coding_reports.readers.cursor_transcript_io import local_tz
from ai_coding_reports.utils.timing import TimingLog

GUI_BUBBLE_FALLBACK_DAYS = 7

_SQL_VALID_COMPOSERS = """
FROM (
  SELECT value
  FROM cursorDiskKV
  WHERE key LIKE 'composerData:%'
    AND json_valid(value) = 1
) AS composer_valid
"""

_SQL_COMPOSER_HAS_CONVERSATION = """(
  json_type(json_extract(composer_valid.value, '$.fullConversationHeadersOnly')) = 'array'
  AND json_array_length(json_extract(composer_valid.value, '$.fullConversationHeadersOnly')) > 0
) OR (
  json_type(json_extract(composer_valid.value, '$.conversation')) = 'array'
  AND json_array_length(json_extract(composer_valid.value, '$.conversation')) > 0
)"""

_SQL_NEWEST_MS = """MAX(
  CAST(COALESCE(json_extract(composer_valid.value, '$.createdAt'), '0') AS INTEGER),
  CAST(
    COALESCE(
      NULLIF(json_extract(composer_valid.value, '$.lastUpdatedAt'), ''),
      json_extract(composer_valid.value, '$.createdAt'),
      '0'
    ) AS INTEGER
  )
)"""

_SQL_REF_MS = """CAST(
  COALESCE(
    NULLIF(json_extract(composer_valid.value, '$.lastUpdatedAt'), ''),
    json_extract(composer_valid.value, '$.createdAt'),
    '0'
  ) AS INTEGER
)"""

_SQL_COMPOSER_BASE_WHERE = f"""
WHERE {_SQL_COMPOSER_HAS_CONVERSATION}
  AND json_extract(composer_valid.value, '$.composerId') IS NOT NULL
  AND json_extract(composer_valid.value, '$.composerId') != ''
"""

_SQL_COMPOSER_SLIM_SELECT = f"""
SELECT
  json_extract(composer_valid.value, '$.composerId') AS cid,
  CAST(COALESCE(json_extract(composer_valid.value, '$.createdAt'), '0') AS INTEGER) AS created_ms,
  CAST(
    COALESCE(
      NULLIF(json_extract(composer_valid.value, '$.lastUpdatedAt'), ''),
      json_extract(composer_valid.value, '$.createdAt'),
      '0'
    ) AS INTEGER
  ) AS last_ms,
  trim(COALESCE(json_extract(composer_valid.value, '$.name'), '')) AS name,
  COALESCE(
    NULLIF(trim(json_extract(composer_valid.value, '$.modelConfig.modelName')), ''),
    NULLIF(trim(json_extract(composer_valid.value, '$.modelConfig.selectedModels[0].modelId')), ''),
    ''
  ) AS model,
  COALESCE(
    NULLIF(trim(json_extract(composer_valid.value, '$.unifiedMode')), ''),
    NULLIF(trim(json_extract(composer_valid.value, '$.forceMode')), ''),
    ''
  ) AS ui_mode,
  COALESCE(
    json_array_length(json_extract(composer_valid.value, '$.fullConversationHeadersOnly')),
    json_array_length(json_extract(composer_valid.value, '$.conversation')),
    0
  ) AS header_count
{_SQL_VALID_COMPOSERS}
{_SQL_COMPOSER_BASE_WHERE}
"""

_SQL_COMPOSER_DATED_SELECT = f"""
SELECT
  json_extract(composer_valid.value, '$.composerId') AS cid,
  CAST(COALESCE(json_extract(composer_valid.value, '$.createdAt'), '0') AS INTEGER) AS created_ms,
  CAST(
    COALESCE(
      NULLIF(json_extract(composer_valid.value, '$.lastUpdatedAt'), ''),
      json_extract(composer_valid.value, '$.createdAt'),
      '0'
    ) AS INTEGER
  ) AS last_ms,
  trim(COALESCE(json_extract(composer_valid.value, '$.name'), '')) AS name,
  COALESCE(
    NULLIF(trim(json_extract(composer_valid.value, '$.modelConfig.modelName')), ''),
    NULLIF(trim(json_extract(composer_valid.value, '$.modelConfig.selectedModels[0].modelId')), ''),
    ''
  ) AS model,
  COALESCE(
    NULLIF(trim(json_extract(composer_valid.value, '$.unifiedMode')), ''),
    NULLIF(trim(json_extract(composer_valid.value, '$.forceMode')), ''),
    ''
  ) AS ui_mode,
  COALESCE(
    json_array_length(json_extract(composer_valid.value, '$.fullConversationHeadersOnly')),
    json_array_length(json_extract(composer_valid.value, '$.conversation')),
    0
  ) AS header_count,
  CASE
    WHEN {_SQL_REF_MS} BETWEEN ? AND ? THEN 1
    ELSE 0
  END AS fast_accept
{_SQL_VALID_COMPOSERS}
{_SQL_COMPOSER_BASE_WHERE}
  AND {_SQL_NEWEST_MS} >= ?
"""


@dataclass
class GuiSession:
    id: str
    name: str
    created_at_ms: int
    last_updated_at_ms: int
    model: str
    header_count: int
    ui_mode: str = ""
    activity_start: datetime | None = None
    activity_end: datetime | None = None
    date_filter_source: str = ""


def _extract_gui_model_from_meta(meta: dict) -> tuple[str, str]:
    """Return (llm_model, ui_mode) from composerData JSON."""
    ui_mode = str(meta.get("unifiedMode") or meta.get("forceMode") or "")
    mc = meta.get("modelConfig") or {}
    model = str(mc.get("modelName") or "")
    if not model:
        selected = mc.get("selectedModels") or []
        if selected and isinstance(selected[0], dict):
            model = str(selected[0].get("modelId") or "")
    return model, ui_mode


@dataclass
class _GuiDateFilterResult:
    include: bool
    activity_start: datetime | None = None
    activity_end: datetime | None = None
    date_filter_source: str = ""


@dataclass(frozen=True)
class GuiMsBounds:
    cutoff_start_ms: int
    range_start_ms: int
    range_end_ms: int


def global_state_db() -> Path | None:
    for p in _state_db_candidates():
        if p.is_file():
            return p
    return None


def _open_ro(db_path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)


def _parse_composer(value: str) -> dict | None:
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


def _has_conversation(meta: dict) -> bool:
    if meta.get("fullConversationHeadersOnly"):
        return True
    return bool(meta.get("conversation"))


def _header_bubble_ids(meta: dict) -> list[str]:
    headers = meta.get("fullConversationHeadersOnly")
    if headers:
        return [h["bubbleId"] for h in headers if isinstance(h, dict) and h.get("bubbleId")]
    conv = meta.get("conversation") or []
    return [
        c["bubbleId"]
        for c in conv
        if isinstance(c, dict) and c.get("bubbleId")
    ]


def _ms_to_local_date(ms: int, tz) -> date | None:
    if not ms:
        return None
    try:
        return (
            datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
            .astimezone(tz)
            .date()
        )
    except (ValueError, OSError):
        return None


def _parse_bubble_created_at(ts, tz) -> datetime | None:
    if ts is None:
        return None
    try:
        if isinstance(ts, (int, float)):
            dt = datetime.fromtimestamp(ts / 1000 if ts > 1e12 else ts, tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return dt.astimezone(tz)
    except (ValueError, OSError):
        return None


def _composer_overlaps_range(
    created_ms: int,
    last_ms: int,
    start_d: date,
    end_d: date,
    tz,
) -> bool:
    """Fast accept: lastUpdatedAt (or createdAt) local date in [start_d, end_d]."""
    ref_ms = last_ms or created_ms
    ref_d = _ms_to_local_date(ref_ms, tz)
    if ref_d is None:
        return False
    return start_d <= ref_d <= end_d


def _composer_too_old(
    created_ms: int,
    last_ms: int,
    start_d: date,
    *,
    fallback_days: int = GUI_BUBBLE_FALLBACK_DAYS,
) -> bool:
    """Fast reject: newest meta timestamp before start_d - fallback_days."""
    newest_ms = max(created_ms or 0, last_ms or 0)
    if not newest_ms:
        return True
    cutoff = start_d - timedelta(days=fallback_days)
    try:
        newest_d = datetime.fromtimestamp(newest_ms / 1000, tz=timezone.utc).date()
    except (ValueError, OSError):
        return False
    return newest_d < cutoff


def _gui_date_ms_bounds(
    start_d: date,
    end_d: date,
    tz,
    *,
    fallback_days: int = GUI_BUBBLE_FALLBACK_DAYS,
) -> GuiMsBounds:
    """Millisecond bounds for SQL date filtering (matches _composer_too_old / fast accept)."""
    cutoff = start_d - timedelta(days=fallback_days)
    cutoff_start_ms = int(
        datetime(cutoff.year, cutoff.month, cutoff.day, 0, 0, 0, tzinfo=timezone.utc).timestamp()
        * 1000
    )
    range_start_ms = int(
        datetime(start_d.year, start_d.month, start_d.day, 0, 0, 0, tzinfo=tz).timestamp() * 1000
    )
    range_end_ms = int(
        datetime(
            end_d.year,
            end_d.month,
            end_d.day,
            23,
            59,
            59,
            999000,
            tzinfo=tz,
        ).timestamp()
        * 1000
    )
    return GuiMsBounds(cutoff_start_ms, range_start_ms, range_end_ms)


def _gui_session_name(cid: str, name: str) -> str:
    return (name or "").strip() or cid[:8]


def _meta_from_header_slices(headers_raw: str | None, conv_raw: str | None) -> dict:
    meta: dict = {}
    if headers_raw:
        try:
            meta["fullConversationHeadersOnly"] = json.loads(headers_raw)
        except json.JSONDecodeError:
            pass
    if conv_raw:
        try:
            meta["conversation"] = json.loads(conv_raw)
        except json.JSONDecodeError:
            pass
    return meta


def _fetch_composer_header_slices(
    con: sqlite3.Connection,
    composer_ids: list[str],
) -> dict[str, dict]:
    if not composer_ids:
        return {}
    out: dict[str, dict] = {}
    chunk_size = 200
    for i in range(0, len(composer_ids), chunk_size):
        chunk = composer_ids[i : i + chunk_size]
        placeholders = ",".join("?" for _ in chunk)
        keys = [f"composerData:{cid}" for cid in chunk]
        rows = con.execute(
            f"""
            SELECT
              json_extract(value, '$.composerId') AS cid,
              json_extract(value, '$.fullConversationHeadersOnly') AS headers,
              json_extract(value, '$.conversation') AS conversation
            FROM cursorDiskKV
            WHERE json_valid(value) = 1
              AND key IN ({placeholders})
            """,
            keys,
        ).fetchall()
        for cid, headers_raw, conv_raw in rows:
            if not cid:
                continue
            meta = _meta_from_header_slices(headers_raw, conv_raw)
            if meta:
                out[str(cid)] = meta
    return out


def _activity_from_meta_ms(created_ms: int, last_ms: int, tz) -> tuple[datetime | None, datetime | None]:
    ref_ms = last_ms or created_ms
    if not ref_ms:
        return None, None
    try:
        center = datetime.fromtimestamp(ref_ms / 1000, tz=timezone.utc).astimezone(tz)
        return center - timedelta(minutes=5), center + timedelta(minutes=20)
    except (ValueError, OSError):
        return None, None


def _bubble_times_from_headers(
    con: sqlite3.Connection,
    composer_id: str,
    meta: dict,
    date_set: set[str] | None,
    tz,
) -> tuple[bool, datetime | None, datetime | None]:
    """Fetch bubbles by exact keys from header list; check activity on date_set."""
    bubble_ids = _header_bubble_ids(meta)

    times: list[datetime] = []
    active = date_set is None

    for bubble_id in bubble_ids:
        row = con.execute(
            "SELECT value FROM cursorDiskKV WHERE key = ?",
            (f"bubbleId:{composer_id}:{bubble_id}",),
        ).fetchone()
        if not row or row[0] is None:
            continue
        raw = row[0]
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="replace")
        try:
            bubble = json.loads(raw)
        except json.JSONDecodeError:
            continue
        dt = _parse_bubble_created_at(bubble.get("createdAt"), tz)
        if dt is None:
            continue
        times.append(dt)
        if date_set and dt.date().isoformat() in date_set:
            active = True

    if not times:
        return False, None, None
    return active, min(times), max(times)


def _apply_gui_date_filter(
    con: sqlite3.Connection,
    meta: dict,
    composer_id: str,
    created_ms: int,
    last_ms: int,
    start_d: date,
    end_d: date,
    date_set: set[str],
    tz,
) -> _GuiDateFilterResult:
    if _composer_overlaps_range(created_ms, last_ms, start_d, end_d, tz):
        act_start, act_end = _activity_from_meta_ms(created_ms, last_ms, tz)
        return _GuiDateFilterResult(
            include=True,
            activity_start=act_start,
            activity_end=act_end,
            date_filter_source="last_updated",
        )

    if _composer_too_old(created_ms, last_ms, start_d):
        return _GuiDateFilterResult(include=False)

    active, t_min, t_max = _bubble_times_from_headers(
        con, composer_id, meta, date_set, tz
    )
    if not active:
        return _GuiDateFilterResult(include=False)

    act_start = act_end = None
    if t_min and t_max:
        act_start = t_min - timedelta(minutes=5)
        act_end = t_max + timedelta(minutes=20)
    return _GuiDateFilterResult(
        include=True,
        activity_start=act_start,
        activity_end=act_end,
        date_filter_source="bubble_verified",
    )


def collect_gui_sessions(
    filter_date: date | None = None,
    end_date: date | None = None,
    *,
    timing: TimingLog | None = None,
    db_path: Path | None = None,
) -> list[GuiSession]:
    """List non-empty GUI composer sessions, optionally filtered by date."""
    db_path = db_path or global_state_db()
    if db_path is None:
        return []

    tl = timing or TimingLog(enabled=False)
    out: list[GuiSession] = []
    tz = local_tz()
    date_set: set[str] | None = None
    start_d = end_d = None
    ms_bounds: GuiMsBounds | None = None
    if filter_date is not None:
        end_d = end_date or filter_date
        start_d = filter_date
        date_set = set()
        d = filter_date
        while d <= end_d:
            date_set.add(d.isoformat())
            d = date.fromordinal(d.toordinal() + 1)
        ms_bounds = _gui_date_ms_bounds(start_d, end_d, tz)

    try:
        con = _open_ro(db_path)
        try:
            with tl.span("cursor.gui.sql_scan"):
                if ms_bounds is not None:
                    rows = con.execute(
                        _SQL_COMPOSER_DATED_SELECT,
                        (
                            ms_bounds.range_start_ms,
                            ms_bounds.range_end_ms,
                            ms_bounds.cutoff_start_ms,
                        ),
                    ).fetchall()
                else:
                    rows = con.execute(_SQL_COMPOSER_SLIM_SELECT).fetchall()

            fallback_candidates: list[tuple] = []

            for row in rows:
                if ms_bounds is not None:
                    cid, created_ms, last_ms, name, model, ui_mode, header_count, fast_accept = row
                    created_ms = int(created_ms or 0)
                    last_ms = int(last_ms or 0)
                    header_count = int(header_count or 0)
                    fast_accept = int(fast_accept or 0)
                else:
                    cid, created_ms, last_ms, name, model, ui_mode, header_count = row
                    created_ms = int(created_ms or 0)
                    last_ms = int(last_ms or 0)
                    header_count = int(header_count or 0)
                    fast_accept = 0

                if not cid:
                    continue

                if ms_bounds is not None:
                    if fast_accept:
                        act_start, act_end = _activity_from_meta_ms(created_ms, last_ms, tz)
                        out.append(
                            GuiSession(
                                id=str(cid),
                                name=_gui_session_name(str(cid), str(name or "")),
                                created_at_ms=created_ms,
                                last_updated_at_ms=last_ms,
                                model=str(model or ""),
                                header_count=header_count,
                                ui_mode=str(ui_mode or ""),
                                activity_start=act_start,
                                activity_end=act_end,
                                date_filter_source="last_updated",
                            )
                        )
                    else:
                        fallback_candidates.append(
                            (str(cid), created_ms, last_ms, name, model, ui_mode, header_count)
                        )
                else:
                    out.append(
                        GuiSession(
                            id=str(cid),
                            name=_gui_session_name(str(cid), str(name or "")),
                            created_at_ms=created_ms,
                            last_updated_at_ms=last_ms,
                            model=str(model or ""),
                            header_count=header_count,
                            ui_mode=str(ui_mode or ""),
                        )
                    )

            if fallback_candidates and date_set is not None and start_d is not None and end_d is not None:
                fallback_ids = [item[0] for item in fallback_candidates]
                with tl.span("cursor.gui.fallback_headers"):
                    header_meta = _fetch_composer_header_slices(con, fallback_ids)

                with tl.span("cursor.gui.fallback_bubbles"):
                    for cid, created_ms, last_ms, name, model, ui_mode, header_count in fallback_candidates:
                        meta = header_meta.get(cid, {})
                        if not meta:
                            continue
                        if not model:
                            model, ui_mode = _extract_gui_model_from_meta(meta)
                        filter_result = _apply_gui_date_filter(
                            con,
                            meta,
                            cid,
                            created_ms,
                            last_ms,
                            start_d,
                            end_d,
                            date_set,
                            tz,
                        )
                        if not filter_result.include:
                            continue
                        out.append(
                            GuiSession(
                                id=cid,
                                name=_gui_session_name(cid, str(name or "")),
                                created_at_ms=created_ms,
                                last_updated_at_ms=last_ms,
                                model=str(model or ""),
                                header_count=header_count,
                                ui_mode=str(ui_mode or ""),
                                activity_start=filter_result.activity_start,
                                activity_end=filter_result.activity_end,
                                date_filter_source=filter_result.date_filter_source,
                            )
                        )
        finally:
            con.close()
    except sqlite3.Error:
        return []

    out.sort(key=lambda s: s.created_at_ms, reverse=True)
    return out

def gui_bubble_active_on_dates(
    composer_id: str,
    db_path: Path,
    dates: set[str],
) -> bool:
    """Legacy: True if any bubble has createdAt on one of the given ISO dates.

    Prefer collect_gui_sessions() date filtering for list/report paths.
    """
    if not dates:
        return True
    tz = local_tz()
    prefix = f"bubbleId:{composer_id}:"
    try:
        con = _open_ro(db_path)
        try:
            rows = con.execute(
                "SELECT value FROM cursorDiskKV WHERE key LIKE ?",
                (prefix + "%",),
            ).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return False

    for (raw,) in rows:
        if raw is None:
            continue
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="replace")
        try:
            d = json.loads(raw)
        except json.JSONDecodeError:
            continue
        dt = _parse_bubble_created_at(d.get("createdAt"), tz)
        if dt and dt.date().isoformat() in dates:
            return True
    return False


def gui_session_window(
    composer_id: str,
    db_path: Path | None = None,
) -> tuple[datetime | None, datetime | None]:
    """Legacy activity window from all bubbles (LIKE scan). Used by view paths."""
    db_path = db_path or global_state_db()
    if db_path is None:
        return None, None

    tz = local_tz()
    prefix = f"bubbleId:{composer_id}:"

    try:
        con = _open_ro(db_path)
        try:
            rows = con.execute(
                "SELECT value FROM cursorDiskKV WHERE key LIKE ?",
                (prefix + "%",),
            ).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return None, None

    times: list[datetime] = []
    for (raw,) in rows:
        if raw is None:
            continue
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="replace")
        try:
            d = json.loads(raw)
        except json.JSONDecodeError:
            continue
        dt = _parse_bubble_created_at(d.get("createdAt"), tz)
        if dt:
            times.append(dt)

    if not times:
        return None, None
    return min(times), max(times)


def build_gui_message_anchors(composer_id: str, db_path: Path | None = None) -> list:
    """Build per-bubble time anchors for nearest-neighbor usage attribution."""
    from ai_coding_reports.readers.cursor_transcript_io import MessageAnchor, _dt_to_ms

    db_path = db_path or global_state_db()
    if db_path is None:
        return []

    tz = local_tz()
    anchors: list = []

    try:
        con = _open_ro(db_path)
        try:
            row = con.execute(
                "SELECT value FROM cursorDiskKV WHERE key = ?",
                (f"composerData:{composer_id}",),
            ).fetchone()
            if not row:
                return []
            raw = row[0]
            if raw is None:
                return []
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8", errors="replace")
            meta = _parse_composer(raw)
            if not meta:
                return []

            headers = meta.get("fullConversationHeadersOnly")
            if headers:
                refs = [(h.get("bubbleId"), h.get("type")) for h in headers if h.get("bubbleId")]
            else:
                conv = meta.get("conversation") or []
                refs = [
                    (c.get("bubbleId"), c.get("type"))
                    for c in conv
                    if isinstance(c, dict) and c.get("bubbleId")
                ]

            for bubble_id, btype in refs:
                brow = con.execute(
                    "SELECT value FROM cursorDiskKV WHERE key = ?",
                    (f"bubbleId:{composer_id}:{bubble_id}",),
                ).fetchone()
                if not brow:
                    continue
                braw = brow[0]
                if braw is None:
                    continue
                if isinstance(braw, bytes):
                    braw = braw.decode("utf-8", errors="replace")
                bubble = json.loads(braw)
                role = "user" if btype == 1 else "assistant"
                dt = _parse_bubble_created_at(bubble.get("createdAt"), tz)
                if dt:
                    anchors.append(
                        MessageAnchor(composer_id, _dt_to_ms(dt), role, "gui")
                    )
            return anchors
        finally:
            con.close()
    except sqlite3.Error:
        return []


def read_gui_messages(composer_id: str, db_path: Path | None = None) -> list[dict]:
    """Ordered chat messages for a GUI session."""
    db_path = db_path or global_state_db()
    if db_path is None:
        return []

    try:
        con = _open_ro(db_path)
        try:
            row = con.execute(
                "SELECT value FROM cursorDiskKV WHERE key = ?",
                (f"composerData:{composer_id}",),
            ).fetchone()
            if not row:
                return []
            raw = row[0]
            if raw is None:
                return []
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8", errors="replace")
            meta = _parse_composer(raw)
            if not meta:
                return []

            headers = meta.get("fullConversationHeadersOnly")
            if headers:
                refs = [(h.get("bubbleId"), h.get("type")) for h in headers if h.get("bubbleId")]
            else:
                conv = meta.get("conversation") or []
                refs = [
                    (c.get("bubbleId"), c.get("type"))
                    for c in conv
                    if isinstance(c, dict) and c.get("bubbleId")
                ]

            messages: list[dict] = []
            for bubble_id, btype in refs:
                brow = con.execute(
                    "SELECT value FROM cursorDiskKV WHERE key = ?",
                    (f"bubbleId:{composer_id}:{bubble_id}",),
                ).fetchone()
                if not brow:
                    continue
                braw = brow[0]
                if braw is None:
                    continue
                if isinstance(braw, bytes):
                    braw = braw.decode("utf-8", errors="replace")
                bubble = json.loads(braw)
                role = "user" if btype == 1 else "assistant"
                text = (bubble.get("text") or "").strip()
                time_str = ""
                ts = bubble.get("createdAt")
                if ts:
                    dt = _parse_bubble_created_at(ts, local_tz())
                    if dt:
                        time_str = dt.strftime("%H:%M")
                if text or role == "user":
                    messages.append({"role": role, "time": time_str, "text": text})
            return messages
        finally:
            con.close()
    except sqlite3.Error:
        return []


def _cursor_user_data_dir() -> Path:
    for p in _state_db_candidates():
        if p.is_file():
            return p.parent.parent
    return Path.home() / "Library/Application Support/Cursor/User"


def build_composer_workspace_index(
    ws_root: Path | None = None,
) -> dict[str, str]:
    """Scan workspaceStorage once; map composerId -> workspace folder path."""
    app_user = _cursor_user_data_dir()
    root = ws_root or (app_user / "workspaceStorage")
    if not root.is_dir():
        return {}

    index: dict[str, str] = {}
    for ws_dir in root.iterdir():
        if not ws_dir.is_dir():
            continue
        db = ws_dir / "state.vscdb"
        wjson = ws_dir / "workspace.json"
        if not db.is_file() or not wjson.is_file():
            continue
        try:
            folder = ""
            wdata = json.loads(wjson.read_text(encoding="utf-8"))
            raw_folder = wdata.get("folder", "")
            if raw_folder.startswith("file://"):
                folder = unquote(raw_folder[7:])
            else:
                folder = raw_folder

            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            try:
                row = con.execute(
                    "SELECT value FROM ItemTable WHERE key = 'composer.composerData'"
                ).fetchone()
            finally:
                con.close()
            if not row:
                continue
            data = json.loads(row[0] if isinstance(row[0], str) else row[0].decode())
            ids = set(data.get("selectedComposerIds") or [])
            ids.update(data.get("lastFocusedComposerIds") or [])
            for cid in ids:
                if cid and cid not in index:
                    index[cid] = folder
        except (sqlite3.Error, json.JSONDecodeError, OSError):
            continue
    return index


def find_workspace_folder(composer_id: str) -> str:
    """Resolve workspace folder path for a single composer (linear scan)."""
    app_user = _cursor_user_data_dir()
    ws_root = app_user / "workspaceStorage"
    if not ws_root.is_dir():
        return ""

    for ws_dir in ws_root.iterdir():
        if not ws_dir.is_dir():
            continue
        db = ws_dir / "state.vscdb"
        wjson = ws_dir / "workspace.json"
        if not db.is_file() or not wjson.is_file():
            continue
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            try:
                row = con.execute(
                    "SELECT value FROM ItemTable WHERE key = 'composer.composerData'"
                ).fetchone()
            finally:
                con.close()
            if not row:
                continue
            data = json.loads(row[0] if isinstance(row[0], str) else row[0].decode())
            ids = set(data.get("selectedComposerIds") or [])
            ids.update(data.get("lastFocusedComposerIds") or [])
            if composer_id not in ids:
                continue
            wdata = json.loads(wjson.read_text(encoding="utf-8"))
            folder = wdata.get("folder", "")
            if folder.startswith("file://"):
                return unquote(folder[7:])
            return folder
        except (sqlite3.Error, json.JSONDecodeError, OSError):
            continue
    return ""
