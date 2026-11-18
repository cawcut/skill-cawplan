/**
 * Opt-in gate for the Cursor Dashboard usage lookup.
 *
 * Exact Cursor GUI token/cost data is not stored locally: the only source is
 * cursor.com's private dashboard API, which needs the user's Cursor login.
 * Reading that login token (from the local Cursor `state.vscdb` or the
 * CURSOR_ACCESS_TOKEN / CURSOR_SESSION_TOKEN env vars) and calling cursor.com
 * therefore happen only after the user enables it, either per run
 * (`cawplan session collect --cursor-usage`) or persistently
 * (`cawplan config cursor-usage on`). Off by default.
 */
import {readUserConfigSync, type UserConfig} from "../user-config.js";

export const CURSOR_USAGE_ENABLE_HINT =
    "Enable it with `cawplan config cursor-usage on` (persistent) or `cawplan session collect --cursor-usage` (this run only).";

/**
 * Resolve whether the Cursor Dashboard usage lookup may run.
 * An explicit per-run choice wins; otherwise the persisted `cursor_usage`
 * config value is used. Anything else, including an unreadable config file,
 * means off.
 */
export function resolveCursorUsageOptIn(
    explicit: boolean | undefined,
    loadConfig: () => UserConfig | null = readUserConfigSync
): boolean {
    if (explicit !== undefined) return explicit;
    try {
        return loadConfig()?.cursor_usage === true;
    } catch {
        return false;
    }
}

/**
 * Mark Cursor GUI sessions that have no usage data because the opt-in is off,
 * so the report records why their tokens/cost are missing. Returns how many
 * sessions were marked.
 */
export function markCursorUsageNotEnabled(
    sessions: Array<{agent: string; usage_breakdown: unknown[]; token_source?: string}>
): number {
    let count = 0;
    for (const s of sessions) {
        if (s.agent !== "cursor-gui" || s.usage_breakdown.length > 0) continue;
        s.token_source = "unavailable (Cursor usage lookup is off)";
        count++;
    }
    return count;
}
