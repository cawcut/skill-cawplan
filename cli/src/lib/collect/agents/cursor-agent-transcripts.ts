/**
 * Cursor IDE Agent session reader.
 *
 * Data source: ~/.cursor/projects/<encoded-path>/agent-transcripts/<session-id>/<session-id>.jsonl
 *   Each line is a JSON event. User turns may embed activity time in:
 *     <timestamp>Thursday, Jun 11, 2026, 7:14 PM (UTC+8)</timestamp>
 *   Assistant turns inherit the most recent user timestamp until the next tagged user turn.
 *
 * Subagent transcripts under .../subagents/*.jsonl are skipped (parent session covers the work).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { cursorProjectsDir } from "../paths.js";
import { HumanInput, SessionData } from "../types.js";
import {
  formatLocalTime,
  getLocalTimezone,
  isTimestampOnLocalDate,
  localDateString,
  parseTimestampTag,
} from "../date-utils.js";

const CHARS_PER_TOKEN = 4;

interface TranscriptEvent {
  role?: string;
  type?: string;
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

interface FileDelta {
  path: string;
  added: number;
  deleted: number;
}

interface ParsedTurn {
  role: "user" | "assistant";
  text: string;
  timestamp: Date | null;
  toolCallCount: number;
  cwd: string;
  fileDeltas: FileDelta[];
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

function countToolCalls(content: TranscriptEvent["message"]): number {
  if (!content?.content) return 0;
  return content.content.filter((block) => block.type === "tool_use").length;
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

function lineCount(value: unknown): number {
  if (typeof value !== "string" || value.length === 0) return 0;
  return value.split("\n").length;
}

function parsePatchFileDeltas(patch: string): FileDelta[] {
  const byPath = new Map<string, FileDelta>();
  let currentPath = "";

  for (const line of patch.split("\n")) {
    const fileMatch = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    if (fileMatch) {
      currentPath = fileMatch[1]?.trim() ?? "";
      if (currentPath && !byPath.has(currentPath)) {
        byPath.set(currentPath, { path: currentPath, added: 0, deleted: 0 });
      }
      continue;
    }

    if (!currentPath) continue;
    const delta = byPath.get(currentPath);
    if (!delta) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) delta.added += 1;
    if (line.startsWith("-") && !line.startsWith("---")) delta.deleted += 1;
  }

  return [...byPath.values()].filter((d) => d.added > 0 || d.deleted > 0);
}

function extractFileDeltasFromToolCall(call: ToolCall): FileDelta[] {
  const name = call.name.toLowerCase();
  const input = call.input;
  if (!input) return [];

  if (name === "applypatch" && typeof input === "string") {
    return parsePatchFileDeltas(input);
  }

  if (typeof input === "string") return [];

  if (name === "applypatch") {
    const patch = input["patch"] ?? input["input"];
    return typeof patch === "string" ? parsePatchFileDeltas(patch) : [];
  }

  const path =
    (input["path"] as string | undefined) ??
    (input["file_path"] as string | undefined) ??
    (input["target_file"] as string | undefined) ??
    (input["target_notebook"] as string | undefined);
  if (!path) return [];

  if (name === "write") {
    return [{ path, added: lineCount(input["contents"] ?? input["content"]), deleted: 0 }];
  }

  if (name === "edit" || name === "strreplace" || name === "multiedit" || name === "editnotebook") {
    return [{
      path,
      added: lineCount(input["new_string"]),
      deleted: lineCount(input["old_string"]),
    }];
  }

  return [];
}

function mergeFileDeltas(deltas: FileDelta[]): FileDelta[] {
  const byPath = new Map<string, FileDelta>();
  for (const delta of deltas) {
    if (!delta.path) continue;
    const existing = byPath.get(delta.path);
    if (!existing) {
      byPath.set(delta.path, { ...delta });
      continue;
    }
    existing.added += delta.added;
    existing.deleted += delta.deleted;
  }
  return [...byPath.values()];
}

function summarizeFileDeltas(deltas: FileDelta[]): { files: number; added: number; deleted: number } {
  const merged = mergeFileDeltas(deltas);
  return {
    files: merged.length,
    added: merged.reduce((sum, delta) => sum + delta.added, 0),
    deleted: merged.reduce((sum, delta) => sum + delta.deleted, 0),
  };
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
    for (let j = i + 1; j < turns.length; j++) {
      const next = turns[j];
      if (!next || next.role === "user") break;
      deltas.push(...next.fileDeltas);
    }
    const deltaSummary = summarizeFileDeltas(deltas);

    humanInputs.push({
      category,
      content: text,
      session_title: sessionTitle,
      session_agent: "cursor",
      files_changed: deltaSummary.files,
      lines_added: deltaSummary.added,
      lines_deleted: deltaSummary.deleted,
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

    const statsTurns = dayTurns.length ? allTurns : dayTurns;
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
    const sessionDeltaSummary = summarizeFileDeltas(dayTurns.flatMap((turn) => turn.fileDeltas));
    const agent = rawToolCallCount > 0 ? "cursor-gui" : "cursor-cli";
    const estimate = agent === "cursor-cli"
      ? estimateTokensFromTurns(statsTurns)
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
        start_local: startLocal,
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
        currency: "$",
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
