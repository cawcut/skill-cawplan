import { writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { CollectOptions, DailyApiJson } from "./types.js";
import { gitAuthor } from "./git.js";
import { collectClaudeCodeSession, findSessionsByDate } from "./agents/claude-code.js";
import { collectGuiSessions } from "./agents/cursor-gui.js";
import { collectCursorCliSessions } from "./agents/cursor-cli.js";
import { collectCodexSessions } from "./agents/codex.js";
import {
  buildSessionCookie,
  fetchUsageEvents,
  aggregateCursorUsage,
  aggregateCursorUsageBySession,
  buildCursorSessionWindows,
} from "./agents/cursor-api.js";
import { cursorStateDbCandidates } from "./paths.js";
import { buildDailyApiJson } from "./aggregators/daily.js";
import { SessionData } from "./types.js";

/**
 * Get the start and end of a date in local time as Unix milliseconds.
 */
function dayBoundsMs(date: string): { startMs: number; endMs: number } {
  const startMs = new Date(date + "T00:00:00").getTime();
  const endMs = new Date(date + "T23:59:59.999").getTime();
  return { startMs, endMs };
}

/**
 * Collect all AI coding session data for a given date and return a DailyApiJson.
 */
export async function collect(opts: CollectOptions): Promise<DailyApiJson> {
  const date = opts.date;
  const author = gitAuthor();
  const sessions: SessionData[] = [];

  // Decide whether to include cursor agents in the default set.
  // Use state.vscdb mtime as a lightweight activity hint; do not require API token.
  const cursorDbActiveOnDate = cursorStateDbCandidates().some((p) => {
    try {
      return statSync(p).mtime.getTime() >= new Date(date + "T00:00:00").getTime();
    } catch { return false; }
  });
  const defaultAgents: CollectOptions["agents"] = cursorDbActiveOnDate
    ? ["claude-code", "cursor", "cursor-gui", "codex"]
    : ["claude-code", "codex"];
  const targetAgents = opts.agents ?? defaultAgents;

  // Collect Claude Code sessions
  if (targetAgents.includes("claude-code")) {
    const claudeSessions = findSessionsByDate(date);
    for (const { jsonlPath, projectName, sessionId } of claudeSessions) {
      try {
        const s = collectClaudeCodeSession(jsonlPath, projectName, sessionId, date);
        // Skip sessions with no activity on this date (multi-day sessions overlap detected
        // by file date range, but the session may have zero events on the target date)
        if (s.message_stats.user === 0 && s.message_stats.assistant === 0) continue;
        sessions.push(s);
      } catch (e) {
        console.warn(`Warning: claude-code session ${sessionId}: ${(e as Error).message}`);
      }
    }
  }

  // Collect Cursor GUI sessions
  if (targetAgents.includes("cursor-gui") || targetAgents.includes("cursor")) {
    try {
      const guiSessions = collectGuiSessions(date);
      // Convert GuiSession to SessionData — skip sessions with no activity.
      for (const gs of guiSessions) {
        if (
          gs.header_count === 0 &&
          gs.message_stats.user === 0 &&
          gs.message_stats.assistant === 0 &&
          gs.files_changed.length === 0
        ) continue;
        const actStart = gs.activity_start;
        const actEnd = gs.activity_end ?? gs.activity_start;

        let timeDisplay = "unknown";
        let startLocal: string | undefined;
        if (actStart) {
          const formatT = (d: Date) =>
            `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
          timeDisplay = actEnd
            ? `${formatT(actStart)} - ${formatT(actEnd)}`
            : formatT(actStart);
          startLocal = actStart.toISOString();
        }

        sessions.push({
          schema: "2.0",
          date,
          agent: "cursor-gui",
          session_id: gs.id,
          session_name: gs.name || gs.id.slice(0, 8),
          project: gs.id.slice(0, 8),
          cwd: gs.cwd ?? "",
          time_range: {
            display: timeDisplay,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            start_local: startLocal,
          },
          model_usage: {},
          usage_breakdown: [],
          files_changed: gs.files_changed.length,
          files_added: gs.files_changed.reduce((sum, f) => sum + (f.added ?? 0), 0),
          files_deleted: gs.files_changed.reduce((sum, f) => sum + (f.deleted ?? 0), 0),
          repos_touched: gs.repos_touched,
          message_stats: gs.message_stats,
          human_inputs: gs.human_inputs?.map((h) => ({
            ...h,
            session_title: h.session_title ?? (gs.name || gs.id.slice(0, 8)),
            session_agent: h.session_agent ?? "cursor-gui",
          })),
        });
      }
    } catch (e) {
      console.warn(`Warning: cursor-gui: ${(e as Error).message}`);
    }
  }

  // Collect Cursor CLI sessions
  if (targetAgents.includes("cursor") || targetAgents.includes("cursor-gui")) {
    try {
      sessions.push(...collectCursorCliSessions(date));
    } catch (e) {
      console.warn(`Warning: cursor-cli: ${(e as Error).message}`);
    }
  }

  // Collect Codex sessions
  if (targetAgents.includes("codex")) {
    try {
      sessions.push(...collectCodexSessions(date));
    } catch (e) {
      console.warn(`Warning: codex: ${(e as Error).message}`);
    }
  }

  // Fetch Cursor API exact usage data
  let cursorApiUsage:
    | { byModel: Record<string, import("./types.js").ModelUsageEntry>; totalCost: number; currency: string }
    | undefined;

  if (targetAgents.includes("cursor") || targetAgents.includes("cursor-gui")) {
    try {
      const { cookie } = buildSessionCookie();
      const { startMs, endMs } = dayBoundsMs(date);
      const events = await fetchUsageEvents(startMs, endMs, cookie);

      // First try session-level attribution (uid-team style)
      const cursorSessions = sessions.filter((s) => s.agent === "cursor-gui" || s.agent === "cursor-cli");
      const windows = buildCursorSessionWindows(cursorSessions);
      const bySession = aggregateCursorUsageBySession(events, date, windows);
      let attributedSessions = 0;
      for (const s of sessions) {
        const assigned = bySession[s.session_id];
        if (!assigned) continue;
        s.model_usage = assigned.modelUsage;
        s.usage_breakdown = assigned.usageBreakdown;
        attributedSessions++;
      }

      // Fallback: if no session got attribution, keep global model rollup behavior.
      if (attributedSessions === 0) {
        cursorApiUsage = aggregateCursorUsage(events, date);
      }
    } catch (e) {
      console.warn(`Warning: cursor API: ${(e as Error).message}`);
    }
  }

  const daily = buildDailyApiJson(sessions, date, author, cursorApiUsage);

  if (opts.outputPath) {
    mkdirSync(dirname(opts.outputPath), { recursive: true });
    writeFileSync(opts.outputPath, JSON.stringify(daily, null, 2), "utf-8");
  }

  return daily;
}
