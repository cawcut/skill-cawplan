"""Timezone helpers shared across all agents."""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


def get_display_timezone() -> tuple[ZoneInfo, str]:
    """Resolve display timezone: $TZ -> system local -> UTC."""
    tz_name = os.environ.get("TZ")
    if tz_name:
        try:
            return ZoneInfo(tz_name), tz_name
        except Exception:
            pass
    local = datetime.now().astimezone().tzinfo
    if local is not None:
        name = getattr(local, "key", None) or str(local)
        return local, name
    return timezone.utc, "UTC"


def format_tz_label(tzinfo: ZoneInfo) -> str:
    """Human-readable timezone label like 'Asia/Shanghai (UTC+08:00)'."""
    now = datetime.now(tzinfo)
    offset = now.strftime("%z")
    if len(offset) == 5:
        offset = f"UTC{offset[:3]}:{offset[3:]}"
    key = getattr(tzinfo, "key", None)
    if key:
        return f"{key} ({offset})"
    local_name = time.tzname[1 if time.daylight else 0]
    if local_name:
        return f"{local_name} ({offset})"
    return offset


def local_tz() -> ZoneInfo:
    """Best-effort local timezone from $TZ or system."""
    tz_name = os.environ.get("TZ")
    if tz_name:
        try:
            return ZoneInfo(tz_name)
        except Exception:
            pass
    return datetime.now().astimezone().tzinfo or timezone.utc


def ms_to_local(ms: int, tzinfo: ZoneInfo) -> datetime:
    """Convert UTC epoch ms to local datetime."""
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(tzinfo)


def utc_to_local(ts_str: str) -> str:
    """UTC ISO8601 timestamp -> local HH:MM string. Respects $TZ."""
    try:
        if ts_str.endswith("Z"):
            ts_str = ts_str[:-1] + "+00:00"
        dt = datetime.fromisoformat(ts_str)
        return dt.astimezone(local_tz()).strftime("%H:%M")
    except (ValueError, TypeError):
        return ts_str[11:16] if len(ts_str) >= 16 else "?"


def day_bounds_ms(d: datetime, tzinfo: ZoneInfo) -> tuple[int, int]:
    """Start-of-day and end-of-day as epoch ms in given timezone."""
    from datetime import time as dt_time

    start = datetime.combine(d, dt_time.min, tzinfo)
    end = datetime.combine(d, dt_time.max, tzinfo)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def parse_iso_date(ts_str: str) -> datetime | None:
    """Parse YYYY-MM-DD from ISO timestamp, returning a date or None."""
    if ts_str:
        try:
            from datetime import date
            return date.fromisoformat(ts_str[:10])
        except (ValueError, TypeError):
            pass
    return None
