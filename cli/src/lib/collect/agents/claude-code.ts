/**
 * Claude Code session reader.
 *
 * Data source: ~/.claude/projects/<encoded-path>/<session-id>.jsonl
 *   Project directories are named with the workspace path URL-encoded (slashes → dashes).
 *   Each session is one JSONL file; every line is a structured event object.
 *
 * Key event types:
 *   "user"      — human turn; carries cwd and message content
 *   "assistant" — model turn; carries message.usage (input/output/cache tokens) and
 *                 message.content (array of text + tool_use blocks)
 *   "ai-title"  — session title set by the model; carries aiTitle (camelCase field)
 *
 * What we extract:
 *   - Cost / tokens: message.usage on each assistant event, summed across the session
 *   - Session name: aiTitle from the first ai-title event
 *   - Time range: ISO timestamp present on every event (ai-title has no timestamp — skip filter)
 *   - CWD / repo: cwd from first user event → resolved to git remote via gitRemoteRepo()
 *   - Files changed: file_path / path from tool_use input blocks (Edit, Write, Bash, etc.)
 */
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { claudeProjectsDir } from "../paths.js";
import { SessionData, FileChange, RepoTouched, HumanInput, UsageBucket, MessageStats } from "../types.js";
import { aggregateUsageBuckets, bucketKey, foldBucketsToModel, mergeUsageBuckets } from "../aggregators/tokens.js";
import { gitRemoteRepo } from "../git.js";
import { ChunkMessage } from "../aggregators/chunks.js";
import {isTimestampOnLocalDate, localDateString, formatLocalTime, getLocalTimezone} from "../date-utils.js";
import {appendAssistantMessage, extractAssistantTextFromBlocks} from "../aggregators/human-assistant.js";
import {classifyHumanInput} from "../aggregators/human-category.js";
import {countLines, extractPathFromInput, appendFileDelta, mergeFileDeltas, type FileDelta} from "../aggregators/tool-utils.js";

interface ClaudeCollectOptions {
  log?: (message: string) => void;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function logClaude(opts: ClaudeCollectOptions | undefined, message: string): void {
  opts?.log?.(`[claude-code] ${message}`);
}

function timed<T>(opts: ClaudeCollectOptions | undefined, label: string, run: () => T): T {
  logClaude(opts, `${label}...`);
  const startedAt = Date.now();
  try {
    const result = run();
    logClaude(opts, `${label} done in ${formatDuration(Date.now() - startedAt)}.`);
    return result;
  } catch (e) {
    logClaude(opts, `${label} failed after ${formatDuration(Date.now() - startedAt)}: ${(e as Error).message}`);
    throw e;
  }
}

/**
 * Decode a Claude project directory name (URL-encoded path with dashes).
 * The encoded name replaces "/" with "-" and URL-encodes special chars.
 * We reconstruct a human-readable project name from the last few path parts.
 */
export function decodeProjectName(encoded: string): string {
  try {
    // URL-decode the string
    const decoded = decodeURIComponent(encoded.replace(/-/g, "%2F").replace(/%252F/g, "-"));
    const parts = decoded.split("/").filter(Boolean);
    // Keep last 3 path parts for a readable name
    return parts.slice(-3).join("/");
  } catch {
    // Fallback: just use last segments split by dash-encoded home
    const home = homedir();
    const homeEncoded = home.replace(/\//g, "-").replace(/^-/, "");
    const withoutHome = encoded.replace(homeEncoded, "").replace(/^-/, "");
    const parts = withoutHome.split("-").filter(Boolean);
    return parts.slice(-3).join("/") || encoded;
  }
}

interface SessionRef {
  jsonlPath: string;
  projectName: string;
  sessionId: string;
}

/**
 * Read the first line and the last chunk of a JSONL file to get date bounds.
 * Reads only the first 4KB (for firstDate) and last 4KB (for lastDate) to avoid
 * loading the full file — large sessions can be 15MB+.
 */
function getFileDateBounds(filePath: string): { firstDate: string | null; lastDate: string | null } {
  let fd: number | null = null;
  try {
    const fileSize = statSync(filePath).size;
    if (fileSize === 0) return { firstDate: null, lastDate: null };

    fd = openSync(filePath, "r");
    const CHUNK = 4096;

    const extractFirstDate = (buf: Buffer): string | null => {
      for (const line of buf.toString("utf-8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed) as Record<string, unknown>;
          const ts = obj["timestamp"] as string | undefined;
          if (ts) {
            const d = new Date(ts);
            if (!Number.isNaN(d.getTime())) return localDateString(d);
          }
        } catch { /* partial line at buffer edge */ }
      }
      return null;
    };

    // Read first CHUNK bytes for firstDate
    const headBuf = Buffer.allocUnsafe(Math.min(CHUNK, fileSize));
    readSync(fd, headBuf, 0, headBuf.length, 0);
    const firstDate = extractFirstDate(headBuf);

    // Read last CHUNK bytes for lastDate (scan backward)
    const tailOffset = Math.max(0, fileSize - CHUNK);
    const tailBuf = Buffer.allocUnsafe(fileSize - tailOffset);
    readSync(fd, tailBuf, 0, tailBuf.length, tailOffset);
    const tailLines = tailBuf.toString("utf-8").split("\n");

    let lastDate: string | null = null;
    for (let i = tailLines.length - 1; i >= 0; i--) {
      const trimmed = tailLines[i].trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        const ts = obj["timestamp"] as string | undefined;
        if (ts) {
          const d = new Date(ts);
          if (!Number.isNaN(d.getTime())) { lastDate = localDateString(d); break; }
        }
      } catch { /* partial first line in tail buffer */ }
    }

    return { firstDate, lastDate };
  } catch {
    return { firstDate: null, lastDate: null };
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * Find all Claude Code sessions that have activity on targetDate.
 */
export function findSessionsByDate(targetDate: string, endDate?: string, opts?: ClaudeCollectOptions): SessionRef[] {
  const projectsDir = claudeProjectsDir();
  logClaude(opts, `Projects directory: ${projectsDir}`);
  const results: SessionRef[] = [];

  let projectDirs: string[] = [];
  try {
    projectDirs = timed(opts, "Read Claude project directories", () => readdirSync(projectsDir));
  } catch {
    logClaude(opts, "Claude projects directory is not readable; no sessions collected.");
    return results;
  }
  logClaude(opts, `Found ${projectDirs.length} Claude project directorie(s).`);

  for (const projectEncoded of projectDirs) {
    const projectPath = join(projectsDir, projectEncoded);
    try {
      const stat = statSync(projectPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    let sessionFiles: string[] = [];
    try {
      sessionFiles = readdirSync(projectPath).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    if (sessionFiles.length > 0) {
      logClaude(opts, `Project ${projectEncoded}: ${sessionFiles.length} session file(s).`);
    }

    for (const sessionFile of sessionFiles) {
      const jsonlPath = join(projectPath, sessionFile);
      const sessionId = basename(sessionFile, ".jsonl");
      const projectName = decodeProjectName(projectEncoded);

      const { firstDate, lastDate } = timed(opts, `Read date bounds for Claude session ${sessionId}`, () =>
        getFileDateBounds(jsonlPath)
      );
      if (!firstDate && !lastDate) continue;

      const start = firstDate ?? lastDate!;
      const end = lastDate ?? firstDate!;
      const checkEnd = endDate ?? targetDate;

      // Overlap check: [start, end] overlaps [targetDate, checkEnd]
      if (end >= targetDate && start <= checkEnd) {
        results.push({ jsonlPath, projectName, sessionId });
        logClaude(opts, `Matched Claude session ${sessionId}: ${start} - ${end}.`);
      }
    }
  }

  logClaude(opts, `Matched ${results.length} Claude session(s) for ${targetDate}${endDate ? `..${endDate}` : ""}.`);
  return results;
}

/**
 * Parse events from a JSONL file, optionally filtering to a specific date.
 */
export function parseEvents(jsonlPath: string, filterDate?: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  try {
    const content = readFileSync(jsonlPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        if (filterDate) {
          const ts = obj["timestamp"] as string | undefined;
          // Events without a timestamp are always included (e.g. ai-title events)
          if (ts && !isTimestampOnLocalDate(ts, filterDate)) continue;
        }
        events.push(obj);
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file not readable
  }
  return events;
}


// XML patterns matching Claude Code slash command wrappers
const COMMAND_ARGS_RE = /<command-args>\s*([\s\S]+?)\s*<\/command-args>/;
const COMMAND_NAME_RE = /<command-name>(\/\S+)<\/command-name>/;
const XML_TAG_RE =
  /<command-name>[\s\S]*?<\/command-args>\s*|<local-command-stdout>[\s\S]*?<\/local-command-stdout>\s*|<command-message>[^<]*<\/command-message>\s*/g;

/**
 * Extract the user's actual input from a Claude Code user message, handling
 * slash command XML wrappers. Port of Python extract_user_message().
 * Returns null if there is no meaningful user content.
 */
export function extractUserMessage(text: string): string | null {
  // Try <command-args> first — this is the user's real question
  const argsMatch = COMMAND_ARGS_RE.exec(text);
  if (argsMatch) return argsMatch[1].trim();

  // Strip XML wrappers, use remaining text
  const cleaned = text.replace(XML_TAG_RE, "").trim();
  if (cleaned) return cleaned;

  // Command name only (no args) — still meaningful
  const nameMatch = COMMAND_NAME_RE.exec(text);
  if (nameMatch) return `[slash command: ${nameMatch[1]}]`;

  return null;
}

/**
 * Build a flat [{role, time, text}] message list from Claude Code JSONL events,
 * including both user input and assistant text output (no tool_use blocks).
 * Port of Python build_messages_claude().
 */
export function buildMessagesClaudeCode(
  events: Record<string, unknown>[],
): ChunkMessage[] {
  const messages: ChunkMessage[] = [];

  for (const event of events) {
    const t = event["type"] as string | undefined;
    const ts = event["timestamp"] as string | undefined;
    const timeStr = ts ? formatLocalTime(new Date(ts)) : "";

    if (t === "user") {
      const msg = event["message"] as Record<string, unknown> | undefined;
      const content = msg?.["content"];
      let text: string | null = null;

      if (typeof content === "string" && content.trim()) {
        text = extractUserMessage(content);
      } else if (Array.isArray(content)) {
        const textParts = (content as Record<string, unknown>[])
          .filter((c) => c["type"] === "text")
          .map((c) => String(c["text"] ?? ""))
          .filter(Boolean);
        if (textParts.length) text = textParts.join("\n");
      }

      if (text) messages.push({ role: "user", time: timeStr, text });
    } else if (t === "assistant") {
      const msg = event["message"] as Record<string, unknown> | undefined;
      const content = msg?.["content"];
      if (Array.isArray(content)) {
        const textParts = (content as Record<string, unknown>[])
          .filter((c) => c["type"] === "text" && c["text"])
          .map((c) => String(c["text"]));
        if (textParts.length) {
          messages.push({ role: "assistant", time: timeStr, text: textParts.join("\n\n") });
        }
      }
    }
  }

  return messages;
}

/**
 * Collect all data for a single Claude Code session on a given date.
 */
export function collectClaudeCodeSession(
  jsonlPath: string,
  projectName: string,
  sessionId: string,
  date: string,
  opts?: ClaudeCollectOptions
): SessionData {
  const events = timed(opts, `Parse Claude events for ${sessionId} on ${date}`, () => parseEvents(jsonlPath, date));
  logClaude(opts, `Claude session ${sessionId}: ${events.length} event(s) on ${date}.`);

  // Session title: prefer user-set customTitle, fall back to AI-generated aiTitle.
  // custom-title events have no timestamp so may not appear in date-filtered events;
  // scan the full file for them separately.
  let sessionName = sessionId.slice(0, 8);
  const allEvents = timed(opts, `Parse all Claude events for title ${sessionId}`, () => parseEvents(jsonlPath)); // no date filter
  for (const event of allEvents) {
    if (event["type"] === "custom-title") {
      const title = event["customTitle"];
      if (typeof title === "string" && title.trim()) {
        sessionName = title.trim();
        break;
      }
    }
  }
  if (sessionName === sessionId.slice(0, 8)) {
    for (const event of events) {
      if (event["type"] === "ai-title") {
        const title = event["aiTitle"];
        if (typeof title === "string" && title.trim()) {
          sessionName = title.trim();
          break;
        }
      }
    }
  }

  // CWD from first user event
  let cwd = "";
  for (const event of events) {
    if (event["type"] === "user") {
      const cwdVal = event["cwd"] as string | undefined;
      if (cwdVal) {
        cwd = cwdVal;
        break;
      }
    }
  }

  // Aggregate usage buckets from assistant events
  let buckets = timed(opts, `Aggregate Claude token usage ${sessionId}`, () =>
    aggregateUsageBuckets(events, "claude-code", "claude_code_pricing_table_estimate")
  );

  // Message stats
  let userCount = 0;
  let assistantCount = 0;
  let toolCallCount = 0;

  for (const event of events) {
    if (event["type"] === "user") {
      // Only count user events where content is a plain string (not a list).
      // List content includes @file expansions, skill injections, and tool_results —
      // the Python reference implementation (uid-team-skills) skips all list content.
      const message = event["message"] as Record<string, unknown> | undefined;
      const content = message?.["content"];
      if (typeof content === "string" && (content as string).trim()) userCount++;
    } else if (event["type"] === "assistant") {
      assistantCount++;
      // Count tool_use content blocks
      const message = event["message"] as Record<string, unknown> | undefined;
      if (message) {
        const content = message["content"] as unknown[] | undefined;
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as Record<string, unknown>;
            if (b["type"] === "tool_use") toolCallCount++;
          }
        }
      }
    }
  }

  // Time range: first and last event timestamps for the date
  let firstTs: Date | null = null;
  let lastTs: Date | null = null;

  for (const event of events) {
    const ts = event["timestamp"] as string | undefined;
    if (!ts) continue;
    const d = new Date(ts);
    if (!firstTs || d < firstTs) firstTs = d;
    if (!lastTs || d > lastTs) lastTs = d;
  }

  let timeDisplay = "unknown";
  let startLocal: string | undefined;
  if (firstTs && lastTs) {
    timeDisplay = `${formatLocalTime(firstTs)} - ${formatLocalTime(lastTs)}`;
    startLocal = firstTs.toISOString();
  }

  // Resolve git remote for the session's working directory
  const repoRemote = timed(opts, `Resolve Claude git remote ${sessionId}`, () => gitRemoteRepo(cwd));

  // Files changed — parse from tool_use events (Edit, Write, Read tool calls)
  const filesChanged: FileChange[] = [];
  const filesSet = new Set<string>();
  timed(opts, `Extract Claude file changes ${sessionId}`, () => {
  for (const event of events) {
    if (event["type"] === "assistant") {
      const message = event["message"] as Record<string, unknown> | undefined;
      if (!message) continue;
      const content = message["content"] as unknown[] | undefined;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b["type"] !== "tool_use") continue;
        const toolName = b["name"] as string | undefined;
        const input = b["input"] as Record<string, unknown> | undefined;
        if (!input) continue;

        const filePath = extractPathFromInput(input);
        if (!filePath) continue;
        let added = 0;
        let deleted = 0;
        if (toolName === "Edit") {
          added = countLines(input["new_string"]);
          deleted = countLines(input["old_string"]);
        } else if (toolName === "Write") {
          added = countLines(input["content"]);
        }
        if (!filesSet.has(filePath)) {
          filesSet.add(filePath);
          filesChanged.push({ path: filePath, added, deleted, repo: repoRemote, change_type: toolName });
        } else {
          const existing = filesChanged.find((f) => f.path === filePath);
          if (existing) { existing.added += added; existing.deleted += deleted; }
        }
      }
    }
  }
  });
  logClaude(opts, `Claude session ${sessionId}: ${filesChanged.length} changed file(s).`);

  // Merge sub-agent sessions (stored at <projectDir>/<sessionId>/subagents/agent-*.jsonl).
  // Sub-agent user turns are agent-generated prompts, not human inputs — only merge
  // token usage, file changes, and tool call counts into the parent session.
  const subagentsDir = join(dirname(jsonlPath), sessionId, "subagents");
  let subAgentFiles: string[] = [];
  try {
    subAgentFiles = timed(opts, `Read Claude subagent directory ${sessionId}`, () =>
      readdirSync(subagentsDir)
        .filter((f) => f.startsWith("agent-") && f.endsWith(".jsonl"))
    );
  } catch {
    // No subagents directory — normal session without sub-agents
  }
  logClaude(opts, `Claude session ${sessionId}: ${subAgentFiles.length} subagent file(s).`);
  for (const subFile of subAgentFiles) {
    const subEvents = timed(opts, `Parse Claude subagent ${subFile}`, () =>
      parseEvents(join(subagentsDir, subFile), date)
    );
    if (!subEvents.length) continue;
    buckets = mergeUsageBuckets(buckets, timed(opts, `Aggregate Claude subagent usage ${subFile}`, () =>
      aggregateUsageBuckets(subEvents, "claude-code", "claude_code_pricing_table_estimate")
    ));
    for (const ev of subEvents) {
      if (ev["type"] !== "assistant") continue;
      const msg = ev["message"] as Record<string, unknown> | undefined;
      if (!msg) continue;
      const content = msg["content"] as unknown[] | undefined;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b["type"] !== "tool_use") continue;
        toolCallCount++;
        const toolName = b["name"] as string | undefined;
        const input = b["input"] as Record<string, unknown> | undefined;
        if (!input) continue;
        const filePath = extractPathFromInput(input);
        if (!filePath) continue;
        let added = 0;
        let deleted = 0;
        if (toolName === "Edit") {
          added = countLines(input["new_string"]);
          deleted = countLines(input["old_string"]);
        } else if (toolName === "Write") {
          added = countLines(input["content"]);
        }
        if (!filesSet.has(filePath)) {
          filesSet.add(filePath);
          filesChanged.push({ path: filePath, added, deleted, repo: repoRemote, change_type: toolName });
        } else {
          const existing = filesChanged.find((f) => f.path === filePath);
          if (existing) { existing.added += added; existing.deleted += deleted; }
        }
      }
    }
  }

  const modelUsage = timed(opts, `Fold Claude model usage ${sessionId}`, () => foldBucketsToModel(buckets));
  const usageBreakdown = Object.values(buckets);

  // Repos touched — group by git remote, summing line counts
  const reposTouched: RepoTouched[] = repoRemote
    ? [{
        repo: repoRemote,
        files: filesChanged.length,
        added: filesChanged.reduce((s, f) => s + (f.added ?? 0), 0),
        deleted: filesChanged.reduce((s, f) => s + (f.deleted ?? 0), 0),
      }]
    : [];

  const linesAdded = filesChanged.reduce((s, f) => s + (f.added ?? 0), 0);
  const linesDeleted = filesChanged.reduce((s, f) => s + (f.deleted ?? 0), 0);

  // Extract human inputs: real user text messages, categorized by keyword heuristics.
  interface QualifiedTurn {
    index: number;
    text: string;
    startTs: string | null;
    category: HumanInput["category"];
  }
  const qualifiedTurns: QualifiedTurn[] = [];
  const seen = new Set<string>();
  timed(opts, `Extract Claude human inputs ${sessionId}`, () => {
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event["type"] !== "user") continue;
    const message = event["message"] as Record<string, unknown> | undefined;
    const content = message?.["content"];
    let text: string | null = null;
    if (typeof content === "string") {
      text = extractUserMessage(content)?.trim() ?? null;
    } else if (Array.isArray(content)) {
      const textBlock = (content as Record<string, unknown>[]).find((b) => b["type"] === "text");
      if (textBlock) text = String(textBlock["text"] ?? "").trim();
    }
    if (!text || text.length < 10) continue;
    if (/\[Request interrupted/.test(text)) continue;
    if (/^Continue from where you left off\.?$/i.test(text)) continue;
    if (/^Base directory for this skill:/.test(text)) continue;
    if (/^This session is being continued/.test(text)) continue;
    if (/<command-message>/.test(text)) continue;
    if (/^(git |npm |npx |cawplan |cd |ls |cat |echo )/.test(text)) continue;
    if (/^@"/.test(text) || /^file:\//.test(text)) continue;
    if (text.length > 1500) continue;
    if (/[@%$]\s*(npm|npx|node|tsc|cawplan|git)\b/.test(text)) continue;
    const key = text.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);

    const category = classifyHumanInput(text);

    qualifiedTurns.push({
      index: i,
      text,
      startTs: (event["timestamp"] as string | undefined) ?? null,
      category,
    });
  }
  });

  // end_time = last assistant event's timestamp before the next qualifying human turn.
  // files_changed = unique file paths touched by tool_use in the same range.
  const humanInputs: HumanInput[] = [];
  timed(opts, `Build Claude human input windows ${sessionId}`, () => {
  for (let qi = 0; qi < qualifiedTurns.length; qi++) {
    const turn = qualifiedTurns[qi];
    const nextIdx = qi + 1 < qualifiedTurns.length ? qualifiedTurns[qi + 1].index : events.length;
    let endTs: string | null = null;
    let assistantMessage: string | undefined;
    const turnFileDeltas = new Map<string, FileDelta>();
    let turnLinesAdded = 0;
    let turnLinesDeleted = 0;
    for (let j = turn.index + 1; j < nextIdx; j++) {
      const ev = events[j];
      if (ev["type"] !== "assistant") continue;
      const ts = ev["timestamp"] as string | undefined;
      if (ts) endTs = ts;
      const content = (ev["message"] as Record<string, unknown> | undefined)?.["content"];
      const assistantText = extractAssistantTextFromBlocks(content);
      if (assistantText) {
        assistantMessage = appendAssistantMessage(assistantMessage, assistantText);
      }
      if (!Array.isArray(content)) continue;
      for (const block of content as Record<string, unknown>[]) {
        if (block["type"] !== "tool_use") continue;
        const toolName = block["name"] as string | undefined;
        const input = block["input"] as Record<string, unknown> | undefined;
        if (!input) continue;
        const fp = extractPathFromInput(input);
        if (!fp) continue;
        if (toolName === "Edit") {
          const added = countLines(input?.["new_string"]);
          const deleted = countLines(input?.["old_string"]);
          turnLinesAdded += added;
          turnLinesDeleted += deleted;
          appendFileDelta(turnFileDeltas, { path: fp, added, deleted });
        } else if (toolName === "Write") {
          const added = countLines(input?.["content"] ?? input?.["contents"] ?? input?.["new_string"]);
          turnLinesAdded += added;
          appendFileDelta(turnFileDeltas, { path: fp, added, deleted: 0 });
        }
      }
    }
    const mergedTurnFiles = mergeFileDeltas([...turnFileDeltas.values()]);
    humanInputs.push({
      category: turn.category,
      content: turn.text,
      assistant_message: assistantMessage,
      session_title: sessionName,
      session_agent: "claude-code",
      start_time: turn.startTs,
      end_time: endTs,
      time_precision: "exact",
      files_changed: mergedTurnFiles.length > 0 ? mergedTurnFiles.length : undefined,
      lines_added: turnLinesAdded > 0 ? turnLinesAdded : undefined,
      lines_deleted: turnLinesDeleted > 0 ? turnLinesDeleted : undefined,
      file_changes: mergedTurnFiles.length > 0 ? mergedTurnFiles : undefined,
    });
  }
  });
  logClaude(opts, `Claude session ${sessionId}: human_inputs=${humanInputs.length}, users=${userCount}, assistants=${assistantCount}, tool_calls=${toolCallCount}.`);

  const project = cwd ? basename(cwd) : projectName;

  return {
    schema: "2.0",
    date,
    agent: "claude-code",
    session_id: sessionId,
    session_name: sessionName,
    project,
    cwd,
    time_range: {
      display: timeDisplay,
      timezone: getLocalTimezone(),
      start: startLocal,
    },
    model_usage: modelUsage,
    usage_breakdown: usageBreakdown,
    files_changed: filesChanged.length,
    files_added: linesAdded > 0 ? linesAdded : undefined,
    files_deleted: linesDeleted > 0 ? linesDeleted : undefined,
    repos_touched: reposTouched,
    message_stats: {
      user: userCount,
      assistant: assistantCount,
      tool_calls: toolCallCount,
    },
    human_inputs: humanInputs.length > 0 ? humanInputs : undefined,
  };
}

/**
 * When Claude Code's context auto-compacts, it starts a new session file whose
 * first event is a "compact_boundary" system message carrying `logicalParentUuid`
 * — the uuid of the last preserved message in the conversation it continues from.
 * Returns that uuid, or null if this session did not start from a compaction.
 */
export function findCompactionOriginUuid(jsonlPath: string): string | null {
  let content: string;
  try {
    content = readFileSync(jsonlPath, "utf-8");
  } catch {
    return null;
  }
  if (!content.includes("compact_boundary")) return null;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("compact_boundary")) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (obj["type"] === "system" && obj["subtype"] === "compact_boundary") {
        const originUuid = obj["logicalParentUuid"] as string | undefined;
        if (originUuid) return originUuid;
      }
    } catch {
      // skip malformed line
    }
  }
  return null;
}

/**
 * True if this session's transcript contains a message with the given uuid —
 * i.e. it is the historical conversation another session's compaction boundary
 * continues from.
 */
export function sessionContainsUuid(jsonlPath: string, uuid: string): boolean {
  let content: string;
  try {
    content = readFileSync(jsonlPath, "utf-8");
  } catch {
    return false;
  }
  if (!content.includes(uuid)) return false;
  for (const line of content.split("\n")) {
    if (!line.includes(uuid)) continue;
    try {
      const obj = JSON.parse(line.trim()) as Record<string, unknown>;
      if (obj["uuid"] === uuid) return true;
    } catch {
      // skip malformed line
    }
  }
  return false;
}

export interface CollectedClaudeSession {
  jsonlPath: string;
  sessionId: string;
  session: SessionData;
}

function mergeTimeRangeDisplay(members: SessionData[]): string {
  const parts = members.map((m) => m.time_range.display).filter((d) => d && d.includes(" - "));
  if (!parts.length) return members[0]?.time_range.display ?? "unknown";
  const starts = parts.map((p) => p.split(" - ")[0]).sort();
  const ends = parts.map((p) => p.split(" - ")[1]).sort();
  return `${starts[0]} - ${ends[ends.length - 1]}`;
}

function mergeSessionDataGroup(members: SessionData[], canonicalIndex: number): SessionData {
  const canonical = members[canonicalIndex];

  const buckets: Record<string, UsageBucket> = {};
  for (const m of members) {
    for (const b of m.usage_breakdown) {
      const key = bucketKey({ model: b.model, speed: b.speed, service_tier: b.service_tier, effort: b.effort });
      if (!buckets[key]) {
        buckets[key] = { ...b };
        continue;
      }
      const existing = buckets[key];
      existing.api_calls += b.api_calls;
      existing.input_tokens += b.input_tokens;
      existing.output_tokens += b.output_tokens;
      existing.cache_read_input_tokens += b.cache_read_input_tokens;
      existing.cache_creation_input_tokens += b.cache_creation_input_tokens;
      existing.cost += b.cost;
    }
  }
  const usageBreakdown = Object.values(buckets);
  const modelUsage = foldBucketsToModel(buckets);

  // collectClaudeCodeSession() never populates the top-level file_changes array
  // (only human_inputs[].file_changes, which the daily aggregator later rolls up
  // into it) — so files_changed here must be summed directly from each member's
  // count, not derived from a field that's always empty at this pipeline stage.
  const filesChangedCount = members.reduce((s, m) => s + (m.files_changed ?? 0), 0);

  const humanInputs = members
    .flatMap((m) => m.human_inputs ?? [])
    .sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));

  const messageStats: MessageStats = {
    user: members.reduce((s, m) => s + m.message_stats.user, 0),
    assistant: members.reduce((s, m) => s + m.message_stats.assistant, 0),
    tool_calls: members.reduce((s, m) => s + m.message_stats.tool_calls, 0),
  };

  const repoMap = new Map<string, RepoTouched>();
  for (const m of members) {
    for (const r of m.repos_touched) {
      const existing = repoMap.get(r.repo);
      if (!existing) {
        repoMap.set(r.repo, { ...r });
        continue;
      }
      existing.files += r.files;
      existing.added += r.added;
      existing.deleted += r.deleted;
    }
  }

  const starts = members.map((m) => m.time_range.start).filter((s): s is string => Boolean(s)).sort();
  const filesAdded = members.reduce((s, m) => s + (m.files_added ?? 0), 0);
  const filesDeleted = members.reduce((s, m) => s + (m.files_deleted ?? 0), 0);
  const ticketIds = [...new Set(members.flatMap((m) => m.ticket_ids ?? []))];
  const ticketDisplayIds = [...new Set(members.flatMap((m) => m.ticket_display_ids ?? []))];

  // total_tokens/session_cost/models/cost_basis/token_source are intentionally
  // left unset here, same as a plain collectClaudeCodeSession() result — the
  // daily aggregator derives them from usage_breakdown/model_usage. Setting an
  // explicit value here (even 0) would short-circuit that derivation, since it
  // only falls back when the field is nullish.
  return {
    ...canonical,
    time_range: {
      ...canonical.time_range,
      display: mergeTimeRangeDisplay(members),
      start: starts[0] ?? canonical.time_range.start,
    },
    models: undefined,
    total_tokens: undefined,
    session_cost: undefined,
    cost_basis: undefined,
    token_source: undefined,
    model_usage: modelUsage,
    usage_breakdown: usageBreakdown,
    files_changed: filesChangedCount,
    files_added: filesAdded > 0 ? filesAdded : undefined,
    files_deleted: filesDeleted > 0 ? filesDeleted : undefined,
    repos_touched: [...repoMap.values()],
    message_stats: messageStats,
    human_inputs: humanInputs.length > 0 ? humanInputs : undefined,
    ticket_ids: ticketIds.length > 0 ? ticketIds : undefined,
    ticket_display_ids: ticketDisplayIds.length > 0 ? ticketDisplayIds : undefined,
  };
}

/**
 * Merge Claude Code sessions that are really the same long-running work thread
 * split across multiple files by auto-compaction (see findCompactionOriginUuid).
 * Sessions that share a compaction origin uuid are grouped; if one of today's
 * other collected sessions is itself the historical conversation they continue
 * from, that session becomes the canonical merged entry, otherwise the earliest
 * session in the group is used. Groups of size 1 pass through unchanged.
 */
export function mergeCompactionContinuations(
  collected: CollectedClaudeSession[],
  opts?: ClaudeCollectOptions
): SessionData[] {
  if (collected.length <= 1) return collected.map((c) => c.session);

  const originUuidByIndex = collected.map((c) => findCompactionOriginUuid(c.jsonlPath));

  // Group indices by shared origin uuid (siblings continuing from the same point).
  const groupsByOrigin = new Map<string, number[]>();
  originUuidByIndex.forEach((uuid, i) => {
    if (!uuid) return;
    const group = groupsByOrigin.get(uuid) ?? [];
    group.push(i);
    groupsByOrigin.set(uuid, group);
  });

  // For each distinct origin uuid, check whether one of today's OTHER sessions
  // is the actual historical file it continues from — if so it joins the group
  // as the canonical parent. A session can both have its own external origin
  // (it forked from an even older ancestor) AND be the parent of a later fork,
  // so having an origin does not disqualify it from being a parent here.
  const parentIndexByOrigin = new Map<string, number>();
  for (const uuid of groupsByOrigin.keys()) {
    for (let i = 0; i < collected.length; i++) {
      if (groupsByOrigin.get(uuid)!.includes(i)) continue;
      if (sessionContainsUuid(collected[i].jsonlPath, uuid)) {
        parentIndexByOrigin.set(uuid, i);
        break;
      }
    }
  }

  const merged: SessionData[] = [];
  const consumed = new Set<number>();

  for (const [uuid, memberIndices] of groupsByOrigin.entries()) {
    const parentIndex = parentIndexByOrigin.get(uuid);
    const groupIndices = parentIndex !== undefined ? [parentIndex, ...memberIndices] : memberIndices;
    if (groupIndices.length <= 1) continue; // nothing to merge
    if (groupIndices.some((i) => consumed.has(i))) continue; // already part of another merged group

    const members = groupIndices.map((i) => collected[i].session);
    const canonicalIndex = parentIndex !== undefined ? 0 : members
      .map((m, i) => ({ i, start: m.time_range.start ?? "" }))
      .sort((a, b) => a.start.localeCompare(b.start))[0].i;

    logClaude(
      opts,
      `Merging ${groupIndices.length} compaction-continuation session(s) into "${members[canonicalIndex].session_name}" (origin ${uuid.slice(0, 8)}...).`
    );
    merged.push(mergeSessionDataGroup(members, canonicalIndex));
    groupIndices.forEach((i) => consumed.add(i));
  }

  for (let i = 0; i < collected.length; i++) {
    if (!consumed.has(i)) merged.push(collected[i].session);
  }

  return merged;
}
