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

/**
 * The language the operator's machine is configured for, as a BCP-47 tag.
 *
 * The server otherwise has to guess a report's language from the turn text, and that guess is
 * wrong often enough to matter: Chinese sessions quoting file paths, identifiers and pasted logs
 * read as English by character count, so their localized copy is never pre-generated and every
 * request pays a live translation. The machine already knows the answer, so send it.
 *
 * POSIX env vars win over Intl because they are what the user actually set; Intl reflects the
 * runtime's view, which is a reasonable second choice. Returns "" when neither is meaningful, and
 * the server falls back to inferring.
 */
export function getLocalLanguageTag(): string {
  for (const name of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
    const tag = normalizePosixLocale(process.env[name]);
    if (tag) return tag;
  }
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().locale;
    return resolved && resolved !== "und" ? resolved : "";
  } catch {
    return "";
  }
}

/** "zh_CN.UTF-8" -> "zh-CN". "C" and "POSIX" carry no language and return "". */
function normalizePosixLocale(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw || raw === "C" || raw === "POSIX") return "";
  const base = raw.split(".")[0]?.split("@")[0]?.trim() ?? "";
  if (!base) return "";
  return base.replace(/_/g, "-");
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
