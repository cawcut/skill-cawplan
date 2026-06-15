/**
 * Shared local-date helpers for session collectors.
 * All collectors use the machine's local timezone for day boundaries.
 */

export function dayBoundsMs(date: string): { startMs: number; endMs: number } {
  const startMs = new Date(`${date}T00:00:00`).getTime();
  const endMs = new Date(`${date}T23:59:59.999`).getTime();
  return { startMs, endMs };
}

/** Format a Date as YYYY-MM-DD in local time. */
export function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isTimestampOnLocalDate(
  ts: number | string | Date,
  filterDate: string
): boolean {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return false;
  return localDateString(d) === filterDate;
}

export function formatLocalTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function getLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const TIMESTAMP_TAG_RE = /<timestamp>([\s\S]*?)<\/timestamp>/i;

/** Parse a Cursor agent-transcript <timestamp> tag into a Date. */
export function parseTimestampTag(text: string): Date | null {
  const match = TIMESTAMP_TAG_RE.exec(text);
  if (!match?.[1]) return null;
  const d = new Date(match[1].trim());
  return isNaN(d.getTime()) ? null : d;
}

/** True when [startMs, endMs] overlaps the local day window for filterDate. */
export function activityOverlapsLocalDate(
  startMs: number,
  endMs: number,
  filterDate: string
): boolean {
  const { startMs: dayStart, endMs: dayEnd } = dayBoundsMs(filterDate);
  return startMs <= dayEnd && endMs >= dayStart;
}
