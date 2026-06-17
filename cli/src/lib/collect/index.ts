import { existsSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { CollectOptions, DailyApiJson } from "./types.js";
import { gitAuthor } from "./git.js";
import { collectClaudeCodeSession, findSessionsByDate } from "./agents/claude-code.js";
import { collectGuiSessions } from "./agents/cursor-gui.js";
import { collectCursorCliSessions } from "./agents/cursor-cli.js";
import {
  collectCursorAgentTranscripts,
  cursorAgentTranscriptsActiveOnDate,
} from "./agents/cursor-agent-transcripts.js";
import { collectCodexSessions } from "./agents/codex.js";
import {
  buildSessionCookie,
  fetchUsageEvents,
  aggregateCursorUsage,
  readCursorAccessToken,
} from "./agents/cursor-api.js";
import { cursorChatsDir, cursorStateDbCandidates } from "./paths.js";
import { dayBoundsMs, formatLocalTime, getLocalTimezone } from "./date-utils.js";
import { buildDailyApiJson } from "./aggregators/daily.js";
import { SessionData } from "./types.js";

function cursorStateDbActiveOnDate(date: string): boolean {
  const dayStart = new Date(`${date}T00:00:00`).getTime();
  return cursorStateDbCandidates().some((p) => {
    try {
      return statSync(p).mtime.getTime() >= dayStart;
    } catch {
      return false;
    }
  });
}

function cursorLocalDataAvailable(date: string): boolean {
  return (
    cursorStateDbActiveOnDate(date) ||
    cursorAgentTranscriptsActiveOnDate(date) ||
    existsSync(cursorChatsDir())
  );
}

function hasCursorAccessToken(): boolean {
  return !!(
    process.env.CURSOR_ACCESS_TOKEN ||
    process.env.CURSOR_SESSION_TOKEN ||
    readCursorAccessToken()
  );
}

function guiSessionToSessionData(gs: import("./agents/cursor-gui.js").GuiSession, date: string): SessionData {
  const actStart = gs.activity_start;
  const actEnd = gs.activity_end ?? gs.activity_start;

  let timeDisplay = "unknown";
  let startLocal: string | undefined;
  if (actStart) {
    timeDisplay = actEnd
      ? `${formatLocalTime(actStart)} - ${formatLocalTime(actEnd)}`
      : formatLocalTime(actStart);
    startLocal = actStart.toISOString();
  }

  return {
    schema: "2.0",
    date,
    agent: "cursor-gui",
    session_id: gs.id,
    session_name: gs.name || gs.id.slice(0, 8),
    project: gs.id.slice(0, 8),
    cwd: "",
    time_range: {
      display: timeDisplay,
      timezone: getLocalTimezone(),
      start_local: startLocal,
    },
    model_usage: {},
    usage_breakdown: [],
    files_changed: 0,
    repos_touched: [],
    message_stats: { user: 0, assistant: 0, tool_calls: 0 },
  };
}

/**
 * Collect all AI coding session data for a given date and return a DailyApiJson.
 */
export async function collect(opts: CollectOptions): Promise<DailyApiJson> {
  const date = opts.date;
  const author = gitAuthor();
  const sessions: SessionData[] = [];

  const includeCursorAgents = cursorLocalDataAvailable(date);
  const defaultAgents: CollectOptions["agents"] = includeCursorAgents
    ? ["claude-code", "cursor", "cursor-gui", "codex"]
    : ["claude-code", "codex"];
  const targetAgents = opts.agents ?? defaultAgents;

  // Collect Claude Code sessions
  if (targetAgents.includes("claude-code")) {
    const claudeSessions = findSessionsByDate(date);
    for (const { jsonlPath, projectName, sessionId } of claudeSessions) {
      try {
        const s = collectClaudeCodeSession(jsonlPath, projectName, sessionId, date);
        if (s.message_stats.user === 0 && s.message_stats.assistant === 0) continue;
        sessions.push(s);
      } catch (e) {
        console.warn(`Warning: claude-code session ${sessionId}: ${(e as Error).message}`);
      }
    }
  }

  // Collect Cursor IDE Agent sessions from ~/.cursor/projects/*/agent-transcripts/
  if (targetAgents.includes("cursor") || targetAgents.includes("cursor-gui")) {
    try {
      sessions.push(...collectCursorAgentTranscripts(date));
    } catch (e) {
      console.warn(`Warning: cursor agent-transcripts: ${(e as Error).message}`);
    }
  }

  // Collect Cursor GUI (Composer) sessions — expensive DB scan, only when state.vscdb was active
  if (
    cursorStateDbActiveOnDate(date) &&
    (targetAgents.includes("cursor-gui") || targetAgents.includes("cursor"))
  ) {
    try {
      const guiSessions = collectGuiSessions(date);
      const agentSessionIds = new Set(
        sessions.filter((s) => s.agent === "cursor").map((s) => s.session_id)
      );
      for (const gs of guiSessions) {
        // Prefer richer agent-transcript sessions when IDs happen to match.
        if (agentSessionIds.has(gs.id)) continue;
        sessions.push(guiSessionToSessionData(gs, date));
      }
    } catch (e) {
      console.warn(`Warning: cursor-gui: ${(e as Error).message}`);
    }
  }

  // Collect legacy Cursor CLI sessions from ~/.cursor/chats/
  if (targetAgents.includes("cursor") || targetAgents.includes("cursor-gui")) {
    try {
      const cursorCliSessions = collectCursorCliSessions(date);
      const fullCursorCliIds = new Set(cursorCliSessions.map((s) => s.session_id));
      for (let i = sessions.length - 1; i >= 0; i--) {
        const s = sessions[i];
        if (s.agent === "cursor-cli" && fullCursorCliIds.has(s.session_id)) {
          sessions.splice(i, 1);
        }
      }
      sessions.push(...cursorCliSessions);
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

  // Fetch Cursor API exact usage data — token required; non-fatal when missing
  let cursorApiUsage:
    | { byModel: Record<string, import("./types.js").ModelUsageEntry>; totalCost: number; currency: string }
    | undefined;

  if (
    hasCursorAccessToken() &&
    (targetAgents.includes("cursor") || targetAgents.includes("cursor-gui"))
  ) {
    try {
      const { cookie } = buildSessionCookie();
      const { startMs, endMs } = dayBoundsMs(date);
      const events = await fetchUsageEvents(startMs, endMs, cookie);
      cursorApiUsage = aggregateCursorUsage(events, date);
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
