/**
 * Cursor GUI (Composer) session reader.
 *
 * Data source: ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb (SQLite, 3+ GB)
 *   Table: cursorDiskKV — key-value store for all Cursor state.
 *   Session rows use keys like "composerData:<composerId>"; the JSON value contains:
 *     composerId, name, createdAt (ms), lastUpdatedAt (ms), selectedModelId, headerCount
 *
 * What we extract:
 *   - Session list: composerData rows whose createdAt or lastUpdatedAt falls in the target date window
 *   - Time range: createdAt / lastUpdatedAt from the composerData blob
 *     Per-bubble timestamps (keys "bubbleId:<composerId>:*") are intentionally NOT queried —
 *     scanning 1000+ LIKE patterns on a 3+ GB database causes multi-minute hangs.
 *   - Model: selectedModelId field
 *   - Cost / tokens: NOT available locally; fetched separately by cursor-api.ts
 *     only when CURSOR_ACCESS_TOKEN or CURSOR_SESSION_TOKEN is set.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import type { Database as DatabaseType } from "better-sqlite3";
import { activityOverlapsLocalDate, dayBoundsMs } from "../date-utils.js";
import { cursorStateDbCandidates } from "../paths.js";

const require = createRequire(import.meta.url);

export interface GuiSession {
  id: string;
  name: string;
  created_at_ms: number;
  last_updated_at_ms: number;
  model: string;
  header_count: number;
  activity_start: Date | null;
  activity_end: Date | null;
}

/**
 * Get the bubble timestamps for a Cursor composer session.
 * Queries cursorDiskKV for bubble entries keyed as bubbleId:{composerId}:*
 */
export function getGuiSessionBubbleTimestamps(
  db: DatabaseType,
  composerId: string
): { start: Date | null; end: Date | null } {
  try {
    const rows = db
      .prepare("SELECT value FROM cursorDiskKV WHERE key LIKE ?")
      .all(`bubbleId:${composerId}:%`) as Array<{ value: string }>;

    let start: Date | null = null;
    let end: Date | null = null;

    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.value) as Record<string, unknown>;
        const createdAt = parsed["createdAt"] as number | string | undefined;
        if (!createdAt) continue;

        const d = new Date(typeof createdAt === "number" ? createdAt : createdAt);
        if (isNaN(d.getTime())) continue;

        if (!start || d < start) start = d;
        if (!end || d > end) end = d;
      } catch {
        // ignore parse errors
      }
    }

    return { start, end };
  } catch {
    return { start: null, end: null };
  }
}

/**
 * Collect Cursor GUI (Composer) sessions from the state.vscdb for a given date.
 * A session is included when its [createdAt, lastUpdatedAt] range overlaps the target local day.
 */
export function collectGuiSessions(filterDate: string): GuiSession[] {
  const candidates = cursorStateDbCandidates();
  let dbPath: string | null = null;

  for (const p of candidates) {
    if (existsSync(p)) {
      dbPath = p;
      break;
    }
  }

  if (!dbPath) {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const db = new Database(dbPath, { readonly: true });

  try {
    const { startMs, endMs } = dayBoundsMs(filterDate);

    let rows: Array<{ key: string; value: string }> = [];
    try {
      rows = db
        .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
        .all() as Array<{ key: string; value: string }>;
    } catch {
      // Table might not exist in older versions
      return [];
    }

    const sessions: GuiSession[] = [];

    for (const row of rows) {
      try {
        const data = JSON.parse(row.value) as Record<string, unknown>;
        const composerId = (data["composerId"] ?? row.key.replace("composerData:", "")) as string;
        const name = (data["name"] ?? data["title"] ?? "") as string;
        const createdAtMs = (data["createdAt"] ?? data["created_at"] ?? 0) as number;
        const lastUpdatedAtMs = (data["lastUpdatedAt"] ?? data["last_updated_at"] ?? createdAtMs) as number;
        const model = (data["selectedModelId"] ?? data["model"] ?? "") as string;
        const headerCount = (data["headerCount"] ?? 0) as number;

        if (!createdAtMs) continue;
        if (!activityOverlapsLocalDate(createdAtMs, lastUpdatedAtMs || createdAtMs, filterDate)) {
          continue;
        }

        // Use created_at/last_updated_at as activity bounds (skipping per-bubble queries on large DBs).
        // Clamp activity_end to end-of-day so multi-day sessions don't show a future timestamp.
        const activityStartMs = Math.max(createdAtMs, startMs);
        const clampedEndMs = lastUpdatedAtMs
          ? Math.min(Math.max(lastUpdatedAtMs, activityStartMs), endMs)
          : Math.min(createdAtMs, endMs);
        sessions.push({
          id: composerId,
          name,
          created_at_ms: createdAtMs,
          last_updated_at_ms: lastUpdatedAtMs,
          model,
          header_count: headerCount,
          activity_start: new Date(activityStartMs),
          activity_end: new Date(clampedEndMs),
        });
      } catch {
        // skip malformed entries
      }
    }

    return sessions;
  } finally {
    db.close();
  }
}
