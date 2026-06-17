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
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { claudeProjectsDir } from "../paths.js";
import { SessionData, FileChange, RepoTouched, HumanInput } from "../types.js";
import { aggregateUsageBuckets, foldBucketsToModel } from "../aggregators/tokens.js";
import { gitRemoteRepo } from "../git.js";
import { ChunkMessage } from "../aggregators/chunks.js";

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
          if (ts) return ts.slice(0, 10);
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
        if (ts) { lastDate = ts.slice(0, 10); break; }
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
export function findSessionsByDate(targetDate: string, endDate?: string): SessionRef[] {
  const projectsDir = claudeProjectsDir();
  const results: SessionRef[] = [];

  let projectDirs: string[] = [];
  try {
    projectDirs = readdirSync(projectsDir);
  } catch {
    return results;
  }

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

    for (const sessionFile of sessionFiles) {
      const jsonlPath = join(projectPath, sessionFile);
      const sessionId = basename(sessionFile, ".jsonl");
      const projectName = decodeProjectName(projectEncoded);

      const { firstDate, lastDate } = getFileDateBounds(jsonlPath);
      if (!firstDate && !lastDate) continue;

      const start = firstDate ?? lastDate!;
      const end = lastDate ?? firstDate!;
      const checkEnd = endDate ?? targetDate;

      // Overlap check: [start, end] overlaps [targetDate, checkEnd]
      if (end >= targetDate && start <= checkEnd) {
        results.push({ jsonlPath, projectName, sessionId });
      }
    }
  }

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
          if (ts && ts.slice(0, 10) !== filterDate) continue;
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

function formatLocalTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function getLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
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
  date: string
): SessionData {
  const events = parseEvents(jsonlPath, date);

  // Session title: prefer user-set customTitle, fall back to AI-generated aiTitle.
  // custom-title events have no timestamp so may not appear in date-filtered events;
  // scan the full file for them separately.
  let sessionName = sessionId.slice(0, 8);
  const allEvents = parseEvents(jsonlPath); // no date filter
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
  const buckets = aggregateUsageBuckets(events, "claude-code");
  const modelUsage = foldBucketsToModel(buckets);
  const usageBreakdown = Object.values(buckets);

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
  const repoRemote = gitRemoteRepo(cwd);

  // Files changed — parse from tool_use events (Edit, Write, Read tool calls)
  const filesChanged: FileChange[] = [];
  const filesSet = new Set<string>();
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

        const filePath = (input["file_path"] ?? input["path"]) as string | undefined;
        if (filePath && !filesSet.has(filePath)) {
          filesSet.add(filePath);
          filesChanged.push({
            path: filePath,
            added: 0,
            deleted: 0,
            repo: repoRemote,
            change_type: toolName,
          });
        }
      }
    }
  }

  // Repos touched — group by git remote
  const reposTouched: RepoTouched[] = repoRemote
    ? [{ repo: repoRemote, files: filesChanged.length, added: 0, deleted: 0 }]
    : [];

  const linesAdded = filesChanged.reduce((s, f) => s + (f.added ?? 0), 0);
  const linesDeleted = filesChanged.reduce((s, f) => s + (f.deleted ?? 0), 0);

  // Extract human inputs: real user text messages, categorized by keyword heuristics.
  // Skip noise: interruptions, very short messages, slash commands, git/npm one-liners, duplicates.
  const humanInputs: HumanInput[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event["type"] !== "user") continue;
    const message = event["message"] as Record<string, unknown> | undefined;
    const content = message?.["content"];
    let text: string | null = null;
    if (typeof content === "string") {
      text = content.trim();
    } else if (Array.isArray(content)) {
      const textBlock = (content as Record<string, unknown>[]).find((b) => b["type"] === "text");
      if (textBlock) text = String(textBlock["text"] ?? "").trim();
    }
    if (!text || text.length < 10) continue;
    // Skip system-injected content
    if (/\[Request interrupted/.test(text)) continue;
    if (/^Base directory for this skill:/.test(text)) continue;
    if (/^This session is being continued/.test(text)) continue;
    if (/<command-message>/.test(text)) continue;
    // Skip shell/CLI one-liners
    if (/^(git |npm |npx |cawplan |cd |ls |cat |echo )/.test(text)) continue;
    // Skip messages that are mainly @file references
    if (/^@"/.test(text) || /^file:\//.test(text)) continue;
    // Skip very long messages (>1500 chars) — likely injected skill or context content
    if (text.length > 1500) continue;
    // Skip messages that contain shell prompts (terminal output pasted into chat)
    if (/[@%$]\s*(npm|npx|node|tsc|cawplan|git)\b/.test(text)) continue;
    // Deduplicate
    const key = text.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);

    const lower = text.toLowerCase();
    const contains = (words: string[]) => words.some((w) => lower.includes(w));
    let category: HumanInput["category"] = "direction";
    if (contains(["决定","決定","定了","採用","采用","改成","改為","用这个","用這個","最终","最終","结论","結論","就按","agreed","decide","decision"]))
      category = "decision";
    else if (contains(["计划","計劃","方案","步驟","步骤","下一步","roadmap","plan","planning","拆分","排期"]))
      category = "planning";
    else if (contains(["修复","修復","修正","改一下","不对","不對","有问题","有問題","报错","報錯","错误","錯誤","bug","fix","broken","failed"]))
      category = "correction";
    else if (contains(["需要","必须","必須","要求","请确保","請確保","should","must","requirement","需求"]))
      category = "direction"; // requirement maps to direction (type has no "requirement")
    else if (contains(["帮我","幫我","请","請","分析","看看","解释","解釋","实现","實現","优化","優化","梳理","how","why","what","please"]))
      category = "direction";

    humanInputs.push({ category, content: text, session_title: sessionName, session_agent: "claude-code" });
  }

  return {
    schema: "2.0",
    date,
    agent: "claude-code",
    session_id: sessionId,
    session_name: sessionName,
    project: projectName,
    cwd,
    time_range: {
      display: timeDisplay,
      timezone: getLocalTimezone(),
      start_local: startLocal,
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
