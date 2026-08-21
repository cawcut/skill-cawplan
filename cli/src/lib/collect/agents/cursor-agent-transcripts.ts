/**
 * Cursor IDE Agent session reader.
 *
 * Data source: ~/.cursor/projects/<encoded-path>/agent-transcripts/<session-id>/<session-id>.jsonl
 *   Each line is a JSON event. User turns may embed activity time in:
 *     <timestamp>Thursday, Jun 11, 2026, 7:14 PM (UTC+8)</timestamp>
 *   Assistant turns inherit the most recent user timestamp until the next tagged user turn.
 *
 * Subagent transcripts under .../subagents/*.jsonl are merged into the parent session: file
 * deltas and tool call counts are included; sub-agent user turns (agent-generated prompts) are
 * excluded from human_inputs.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { cursorProjectsDir } from "../paths.js";
import { joinAssistantMessages } from "../aggregators/human-assistant.js";
import { HumanInput, SessionData } from "../types.js";
import {
  formatLocalTime,
  getLocalTimezone,
  isTimestampOnLocalDate,
  localDateString,
  parseTimestampTag,
} from "../date-utils.js";
import { FileDelta, estimateToolDeltas, summarizeFileDeltas } from "../aggregators/tool-utils.js";
import { COST_CURRENCY } from "../pricing.js";

const CHARS_PER_TOKEN = 4;

interface TranscriptEvent {
  role?: string;
  type?: string;
  isSidechain?: boolean;
  sidechain?: boolean;
  message?: {
    content?: Array<{
      type?: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
}

interface ToolCall {
  name: string;
  input: Record<string, unknown> | string | undefined;
}

interface ParsedTurn {
  role: "user" | "assistant";
  text: string;
  timestamp: Date | null;
  toolCallCount: number;
  cwd: string;
  fileDeltas: FileDelta[];
  isSidechain: boolean;
}

function estimateTokensFromTurns(turns: ParsedTurn[]): { inputTokens: number; outputTokens: number } {
  let inputChars = 0;
  let outputChars = 0;
  for (const turn of turns) {
    if (turn.role === "user") inputChars += turn.text.length;
    else outputChars += turn.text.length;
  }
  return {
    inputTokens: Math.floor(inputChars / CHARS_PER_TOKEN),
    outputTokens: Math.floor(outputChars / CHARS_PER_TOKEN),
  };
}

function decodeCursorProjectPath(encoded: string): string {
  const homePrefix = homedir().replace(/\//g, "-").replace(/^-/, "");
  if (encoded.startsWith(homePrefix)) {
    const rest = encoded.slice(homePrefix.length).replace(/^-/, "");
    if (rest) return join(homedir(), rest.replace(/-/g, "/"));
  }
  return encoded;
}

function extractText(content: TranscriptEvent["message"]): string {
  if (!content?.content) return "";
  return content.content
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
}

function extractToolCalls(content: TranscriptEvent["message"]): ToolCall[] {
  if (!content?.content) return [];
  return content.content
    .filter((block) => block.type === "tool_use")
    .map((block) => ({ name: block.name ?? "", input: block.input }));
}

function extractCwd(content: TranscriptEvent["message"]): string {
  for (const call of extractToolCalls(content)) {
    if (!call.input || typeof call.input === "string") continue;
    const cwd = call.input["working_directory"];
    if (typeof cwd === "string" && cwd) return cwd;
  }
  return "";
}

function extractFileDeltasFromToolCall(call: ToolCall): FileDelta[] {
  return estimateToolDeltas(call.name, (call.input ?? {}) as Record<string, unknown>);
}

function deriveSessionTitle(projectPath: string, sessionId: string): string {
  const projectName = basename(projectPath) || "cursor";
  return `${projectName}/${sessionId.slice(0, 8)}`;
}

function normalizeUserText(text: string): string {
  return text
    .replace(/<timestamp>[\s\S]*?<\/timestamp>/gi, "")
    .replace(/<user_query>\s*/gi, "")
    .replace(/<\/user_query>/gi, "")
    .trim();
}

function extractHumanInputs(turns: ParsedTurn[], sessionTitle: string): HumanInput[] {
  const humanInputs: HumanInput[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (!turn) continue;
    if (turn.isSidechain) continue;
    if (turn.role !== "user") continue;
    const text = normalizeUserText(turn.text);
    if (!text || text.length < 10) continue;

    const key = text.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);

    const lower = text.toLowerCase();
    const contains = (words: string[]) => words.some((w) => lower.includes(w));
    let category: HumanInput["category"] = "direction";
    if (contains(["决定","決定","采用","採用","最终","最終","agreed","decide","decision"])) {
      category = "decision";
    } else if (contains(["计划","計劃","方案","步骤","步驟","roadmap","plan","planning"])) {
      category = "planning";
    } else if (contains(["修复","修復","修正","不对","不對","有问题","有問題","报错","報錯","bug","fix","broken","failed"])) {
      category = "correction";
    }

    const deltas: FileDelta[] = [];
    const assistantTexts: string[] = [];
    for (let j = i + 1; j < turns.length; j++) {
      const next = turns[j];
      if (!next || next.role === "user") break;
      if (next.isSidechain) continue;
      if (next.role === "assistant" && next.text) {
        assistantTexts.push(next.text);
      }
      deltas.push(...next.fileDeltas);
    }
    const deltaSummary = summarizeFileDeltas(deltas);

    humanInputs.push({
      category,
      content: text,
      assistant_message: joinAssistantMessages(assistantTexts),
      session_title: sessionTitle,
      session_agent: "cursor",
      time_precision: "exact",
      files_changed: deltaSummary.files,
      lines_added: deltaSummary.added,
      lines_deleted: deltaSummary.deleted,
      file_changes: deltaSummary.file_changes.length > 0 ? deltaSummary.file_changes : undefined,
    });
  }

  return humanInputs;
}

function parseTranscriptFile(jsonlPath: string): ParsedTurn[] {
  const turns: ParsedTurn[] = [];
  let currentTimestamp: Date | null = null;

  let content: string;
  try {
    content = readFileSync(jsonlPath, "utf-8");
  } catch {
    return turns;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: TranscriptEvent;
    try {
      event = JSON.parse(trimmed) as TranscriptEvent;
    } catch {
      continue;
    }

    if (event.type === "turn_ended") continue;

    const role = event.role;
    if (role !== "user" && role !== "assistant") continue;

    const text = extractText(event.message);
    if (role === "user") {
      const tagged = parseTimestampTag(text);
      if (tagged) currentTimestamp = tagged;
    }

    const toolCalls = extractToolCalls(event.message);
    turns.push({
      role,
      text,
      timestamp: currentTimestamp,
      toolCallCount: toolCalls.length,
      cwd: extractCwd(event.message),
      fileDeltas: toolCalls.flatMap(extractFileDeltasFromToolCall),
      isSidechain: event["isSidechain"] === true || event["sidechain"] === true,
    });
  }

  return turns;
}

function turnsOnDate(turns: ParsedTurn[], filterDate: string): ParsedTurn[] {
  return turns.filter((turn) => {
    if (turn.timestamp) return isTimestampOnLocalDate(turn.timestamp, filterDate);
    return false;
  });
}

function findTranscriptFiles(): Array<{
  jsonlPath: string;
  sessionId: string;
  projectEncoded: string;
}> {
  const projectsDir = cursorProjectsDir();
  if (!existsSync(projectsDir)) return [];

  const results: Array<{
    jsonlPath: string;
    sessionId: string;
    projectEncoded: string;
  }> = [];

  let projectDirs: string[] = [];
  try {
    projectDirs = readdirSync(projectsDir);
  } catch {
    return results;
  }

  for (const projectEncoded of projectDirs) {
    const transcriptsDir = join(projectsDir, projectEncoded, "agent-transcripts");
    if (!existsSync(transcriptsDir)) continue;

    let sessionDirs: string[] = [];
    try {
      sessionDirs = readdirSync(transcriptsDir);
    } catch {
      continue;
    }

    for (const sessionId of sessionDirs) {
      const sessionDir = join(transcriptsDir, sessionId);
      try {
        if (!statSync(sessionDir).isDirectory()) continue;
      } catch {
        continue;
      }

      const jsonlPath = join(sessionDir, `${sessionId}.jsonl`);
      if (!existsSync(jsonlPath)) continue;

      results.push({ jsonlPath, sessionId, projectEncoded });
    }
  }

  return results;
}

/** Collect Cursor IDE Agent sessions from project agent-transcripts directories. */
export function collectCursorAgentTranscripts(filterDate: string): SessionData[] {
  const sessions: SessionData[] = [];

  for (const { jsonlPath, sessionId, projectEncoded } of findTranscriptFiles()) {
    const allTurns = parseTranscriptFile(jsonlPath);
    if (!allTurns.length) continue;

    let dayTurns = turnsOnDate(allTurns, filterDate);

    // Fallback: if no tagged timestamps, use file mtime when it falls on the target date.
    if (!dayTurns.length) {
      try {
        const mtime = statSync(jsonlPath).mtime;
        if (localDateString(mtime) !== filterDate) continue;
        dayTurns = allTurns;
      } catch {
        continue;
      }
    }

    const statsTurns = dayTurns;
    let userCount = 0;
    let assistantCount = 0;
    let rawToolCallCount = 0;
    let cwd = "";

    for (const turn of statsTurns) {
      if (turn.role === "user") userCount++;
      else assistantCount++;
      rawToolCallCount += turn.toolCallCount;
      if (!cwd && turn.cwd) cwd = turn.cwd;
    }

    if (userCount === 0 && assistantCount === 0) continue;

    const projectPath = decodeCursorProjectPath(projectEncoded);
    if (!cwd) cwd = projectPath;

    // Merge sub-agent sessions (stored at <sessionDir>/subagents/*.jsonl).
    // Sub-agent user turns are agent-generated prompts — merge file deltas and
    // tool call counts only; exclude from human_inputs.
    const subagentsDir = join(dirname(jsonlPath), "subagents");
    const subAgentTurns: ParsedTurn[] = [];
    let subAgentFiles: string[] = [];
    try {
      subAgentFiles = readdirSync(subagentsDir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      // No subagents directory
    }
    for (const subFile of subAgentFiles) {
      const parsed = parseTranscriptFile(join(subagentsDir, subFile));
      rawToolCallCount += parsed.reduce((s, t) => s + t.toolCallCount, 0);
      subAgentTurns.push(...parsed);
    }

    const timestamps = dayTurns
      .map((t) => t.timestamp)
      .filter((t): t is Date => t !== null);
    const firstTs = timestamps.length
      ? new Date(Math.min(...timestamps.map((t) => t.getTime())))
      : null;
    const lastTs = timestamps.length
      ? new Date(Math.max(...timestamps.map((t) => t.getTime())))
      : null;

    let timeDisplay = "unknown";
    let startLocal: string | undefined;
    if (firstTs) {
      timeDisplay = lastTs && lastTs.getTime() !== firstTs.getTime()
        ? `${formatLocalTime(firstTs)} - ${formatLocalTime(lastTs)}`
        : formatLocalTime(firstTs);
      startLocal = firstTs.toISOString();
    }

    const sessionTitle = deriveSessionTitle(projectPath, sessionId);
    const humanInputs = extractHumanInputs(dayTurns, sessionTitle);
    const sessionDeltaSummary = summarizeFileDeltas(
      [...dayTurns, ...subAgentTurns].flatMap((turn) => turn.fileDeltas)
    );
    const agent = rawToolCallCount > 0 ? "cursor-gui" : "cursor-cli";
    const estimate = agent === "cursor-cli"
      ? estimateTokensFromTurns([...statsTurns, ...subAgentTurns])
      : { inputTokens: 0, outputTokens: 0 };

    sessions.push({
      schema: "2.0",
      date: filterDate,
      agent,
      session_id: sessionId,
      session_name: sessionTitle,
      project: basename(projectPath) || projectEncoded.slice(0, 24),
      cwd,
      time_range: {
        display: timeDisplay,
        timezone: getLocalTimezone(),
        start: startLocal,
      },
      model_usage: {},
      usage_breakdown: agent === "cursor-cli" ? [{
        model: "unknown",
        speed: "standard",
        service_tier: "standard",
        effort: "default",
        api_calls: 0,
        input_tokens: estimate.inputTokens,
        output_tokens: estimate.outputTokens,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cost: 0,
        currency: COST_CURRENCY,
        token_source: "char-based estimate (API unavailable)",
        note: `chars/${CHARS_PER_TOKEN} estimate (user->input, assistant->output)`,
      }] : [],
      files_changed: sessionDeltaSummary.files,
      files_added: sessionDeltaSummary.added,
      files_deleted: sessionDeltaSummary.deleted,
      repos_touched: cwd ? [{
        repo: cwd,
        files: sessionDeltaSummary.files,
        added: sessionDeltaSummary.added,
        deleted: sessionDeltaSummary.deleted,
      }] : [],
      message_stats: {
        user: userCount,
        assistant: assistantCount,
        tool_calls: agent === "cursor-gui" ? 0 : rawToolCallCount,
      },
      human_inputs: humanInputs.length > 0 ? humanInputs : undefined,
    });
  }

  return sessions;
}

/**
 * Fast check: any agent-transcript file modified on or after the target local day.
 */
export function cursorAgentTranscriptsActiveOnDate(filterDate: string): boolean {
  const dayStart = new Date(`${filterDate}T00:00:00`).getTime();
  for (const { jsonlPath } of findTranscriptFiles()) {
    try {
      if (statSync(jsonlPath).mtime.getTime() >= dayStart) return true;
    } catch {
      // ignore
    }
  }
  return false;
}
