"""Cursor dashboard usage API reader — exact token/cost from cursor.com."""

from __future__ import annotations

import base64
import json
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import date, datetime, time, timezone
from pathlib import Path

API_URL = "https://cursor.com/api/dashboard/get-filtered-usage-events"
PAGE_SIZE = 500
ACCESS_TOKEN_KEY = "cursorAuth/accessToken"


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def _state_db_candidates() -> list[Path]:
    home = Path.home()
    return [
        home / "Library/Application Support/Cursor/User/globalStorage/state.vscdb",
        home / ".config/Cursor/User/globalStorage/state.vscdb",
        Path(os.environ.get("APPDATA", "")) / "Cursor/User/globalStorage/state.vscdb",
    ]


def read_access_token() -> str | None:
    """Read Cursor accessToken (plaintext JWT) from state.vscdb or env."""
    if os.environ.get("CURSOR_ACCESS_TOKEN"):
        return os.environ["CURSOR_ACCESS_TOKEN"]
    for db_path in _state_db_candidates():
        if not db_path.is_file():
            continue
        try:
            con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            try:
                row = con.execute(
                    "SELECT value FROM ItemTable WHERE key = ?", (ACCESS_TOKEN_KEY,)
                ).fetchone()
            finally:
                con.close()
            if row and row[0]:
                return row[0] if isinstance(row[0], str) else row[0].decode()
        except sqlite3.Error:
            continue
    return None


def _decode_jwt_payload(jwt: str) -> dict:
    try:
        seg = jwt.split(".")[1]
        seg = seg.replace("-", "+").replace("_", "/")
        seg += "=" * ((4 - len(seg) % 4) % 4)
        return json.loads(base64.b64decode(seg))
    except Exception:
        return {}


def build_session_cookie() -> tuple[str, dict]:
    """Return (cookie_value, meta). Cookie format: `userId::JWT`."""
    override = os.environ.get("CURSOR_SESSION_TOKEN")
    if override:
        return override, {"source": "env:CURSOR_SESSION_TOKEN"}

    jwt = read_access_token()
    if not jwt:
        raise SystemExit(
            "Cannot obtain Cursor access token.\n"
            "  - Ensure Cursor desktop is logged in, or\n"
            "  - Set CURSOR_SESSION_TOKEN=<userId::JWT>"
        )

    payload = _decode_jwt_payload(jwt)
    sub = payload.get("sub", "")
    m = re.search(r"user_[A-Za-z0-9]+", sub)
    if not m:
        raise SystemExit(f"Cannot parse user id from JWT sub: {sub!r}")
    user_id = m.group(0)
    exp = payload.get("exp")
    if isinstance(exp, (int, float)) and exp < datetime.now(timezone.utc).timestamp():
        print("Warning: access token expired. Re-login to Cursor.", file=sys.stderr)
    return f"{user_id}::{jwt}", {
        "source": "state.vscdb",
        "user_id": user_id,
        "email": payload.get("email"),
        "exp": exp,
    }


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


def fetch_usage_events(start_ms: int, end_ms: int, cookie: str) -> list[dict]:
    """Paginate and fetch all usage events in time range."""
    events: list[dict] = []
    page = 1
    while True:
        body = json.dumps({
            "startDate": str(start_ms),
            "endDate": str(end_ms),
            "page": page,
            "pageSize": PAGE_SIZE,
        }).encode()
        req = urllib.request.Request(
            API_URL,
            data=body,
            headers={
                "Content-Type": "application/json",
                "Origin": "https://cursor.com",
                "Cookie": f"WorkosCursorSessionToken={cookie}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            raise SystemExit(f"API request failed HTTP {e.code}: {e.read()[:300]!r}")
        except urllib.error.URLError as e:
            raise SystemExit(f"Network error: {e}")

        batch = payload.get("usageEventsDisplay", []) or []
        events.extend(batch)
        total = payload.get("totalUsageEventsCount", len(events))
        if len(batch) < PAGE_SIZE or len(events) >= total:
            break
        page += 1
    return events


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------


def _new_bucket() -> dict:
    return {
        "events": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "total_tokens": 0,
        "token_cents": 0.0,
        "cursor_fee_cents": 0.0,
        "charged_cents": 0.0,
    }


def _add_event(bucket: dict, ev: dict) -> None:
    tu = ev.get("tokenUsage") or {}
    inp = int(tu.get("inputTokens", 0) or 0)
    out = int(tu.get("outputTokens", 0) or 0)
    cr = int(tu.get("cacheReadTokens", 0) or 0)
    cw = int(tu.get("cacheWriteTokens", 0) or 0)
    bucket["events"] += 1
    bucket["input_tokens"] += inp
    bucket["output_tokens"] += out
    bucket["cache_read_tokens"] += cr
    bucket["cache_write_tokens"] += cw
    bucket["total_tokens"] += inp + out + cr + cw
    bucket["token_cents"] += float(tu.get("totalCents", 0) or 0)
    bucket["cursor_fee_cents"] += float(ev.get("cursorTokenFee", 0) or 0)
    bucket["charged_cents"] += float(ev.get("chargedCents", 0) or 0)


def _round_bucket(b: dict) -> dict:
    return {
        **{k: b[k] for k in (
            "events", "input_tokens", "output_tokens",
            "cache_read_tokens", "cache_write_tokens", "total_tokens",
        )},
        "token_cents": round(b["token_cents"], 2),
        "cursor_fee_cents": round(b["cursor_fee_cents"], 2),
        "charged_cents": round(b["charged_cents"], 2),
        "charged_usd": round(b["charged_cents"] / 100, 4),
    }


def aggregate_usage(events: list[dict], tzinfo) -> dict:
    """Aggregate usage events by day and model."""
    by_day: dict[str, dict] = defaultdict(_new_bucket)
    by_day_model: dict[str, dict] = defaultdict(_new_bucket)
    by_model: dict[str, dict] = defaultdict(_new_bucket)
    total = _new_bucket()

    for ev in events:
        ts = ev.get("timestamp")
        if ts is None:
            continue
        dt = datetime.fromtimestamp(int(ts) / 1000, tz=timezone.utc).astimezone(tzinfo)
        day = dt.date().isoformat()
        model = ev.get("model", "unknown")
        _add_event(by_day[day], ev)
        _add_event(by_day_model[f"{day}|{model}"], ev)
        _add_event(by_model[model], ev)
        _add_event(total, ev)

    daily = {}
    for day in sorted(by_day):
        models = {
            k.split("|", 1)[1]: _round_bucket(v)
            for k, v in by_day_model.items()
            if k.startswith(f"{day}|")
        }
        daily[day] = {
            "summary": _round_bucket(by_day[day]),
            "by_model": dict(sorted(models.items())),
        }

    return {
        "total": _round_bucket(total),
        "by_day": daily,
        "by_model": {m: _round_bucket(b) for m, b in sorted(by_model.items())},
    }


def day_bounds_ms(d: date, tzinfo) -> tuple[int, int]:
    """Start and end of day as epoch ms in given timezone."""
    start = datetime.combine(d, time.min, tzinfo)
    end = datetime.combine(d, time.max, tzinfo)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)
