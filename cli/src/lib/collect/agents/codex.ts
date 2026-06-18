/**
 * Codex (OpenAI Codex CLI) session reader.
 *
 * Data source: ~/.codex/state_5.sqlite (SQLite)
 *   Table: threads — one row per session with columns:
 *     id, rollout_path, created_at (ISO8601), model, tokens_used (total), title, cwd
 *
 *   Rollout JSONL (optional): per-session event log at rollout_path or
 *     ~/.codex/sessions/<id>/rollout.jsonl — contains user/assistant messages with
 *     timestamps and tool_use blocks; used to derive message counts and time range.
 *
 * What we extract:
 *   - Session list: all threads where created_at matches the target date
 *   - Time range: timestamps from rollout JSONL; falls back to thread.created_at
 *   - Model: thread.model
 *   - Tokens: rollout token_count events when available; falls back to thread.tokens_used total
 *   - Message counts / tool calls: parsed from rollout JSONL
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { codexStateDb, codexSessionsDir } from "../paths.js";

const require = createRequire(import.meta.url);
import { SessionData, ModelUsageEntry, UsageBucket, RepoTouched, HumanInput } from "../types.js";
import { calculateCost, getCurrency } from "../pricing.js";

interface CodexThread {
  id: string;
  rollout_path: string | null;
  created_at: string | number;
  model: string;
  tokens_used: number | null;
  title: string | null;
  cwd: string | null;
}

function getLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function formatLocalTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function localDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateFromCodexTimestamp(value: string | number | null | undefined): Date | null {
  if (typeof value === "number") {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    return isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return dateFromCodexTimestamp(numeric);
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const b = block as Record<string, unknown>;
      const type = b["type"];
      if (type === "input_text" || type === "output_text" || type === "text") {
        return String(b["text"] ?? "").trim();
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isHumanInputText(text: string): boolean {
  if (text.length < 4) return false;
  if (text.length > 1500) return false;
  if (text.includes("<environment_context>")) return false;
  if (text.includes("<INSTRUCTIONS>")) return false;
  if (/^# AGENTS\.md instructions/.test(text)) return false;
  if (/^Base directory for this skill:/.test(text)) return false;
  if (/^This session is being continued/.test(text)) return false;
  if (/^Continue from where you left off\.?$/i.test(text)) return false;
  if (/^(git |npm |npx |cawplan |cd |ls |cat |echo )/.test(text)) return false;
  return true;
}

function classifyHumanInput(text: string): HumanInput["category"] {
  const lower = text.toLowerCase();
  const contains = (words: string[]) => words.some((w) => lower.includes(w));
  if (contains(["决定","決定","定了","採用","采用","改成","改為","用这个","用這個","最终","最終","结论","結論","就按","agreed","decide","decision"])) {
    return "decision";
  }
  if (contains(["计划","計劃","方案","步驟","步骤","下一步","roadmap","plan","planning","拆分","排期"])) {
    return "planning";
  }
  if (contains(["修复","修復","修正","改一下","不对","不對","有问题","有問題","报错","報錯","错误","錯誤","bug","fix","broken","failed"])) {
    return "correction";
  }
  return "direction";
}

function countDiffLines(diff: string): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) deleted++;
  }
  return { added, deleted };
}

function countTextLines(value: unknown): number {
  if (typeof value !== "string" || !value) return 0;
  return value.split("\n").length;
}

function numberField(record: Record<string, unknown>, field: string): number {
  const value = Number(record[field] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Parse Codex rollout JSONL to count messages and find time bounds.
 */
function parseRollout(
  rolloutPath: string | null,
  fallbackSessionsDir: string,
  sessionId: string,
  filterDate?: string
): {
  userCount: number;
  assistantCount: number;
  toolCallCount: number;
  firstTs: Date | null;
  lastTs: Date | null;
  humanInputs: HumanInput[];
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  tokenUsage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  tokenCountEvents: number;
} {
  const result = {
    userCount: 0,
    assistantCount: 0,
    toolCallCount: 0,
    firstTs: null as Date | null,
    lastTs: null as Date | null,
    humanInputs: [] as HumanInput[],
    filesChanged: 0,
    linesAdded: 0,
    linesDeleted: 0,
    tokenUsage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    tokenCountEvents: 0,
  };

  // Determine path to rollout JSONL
  const paths: string[] = [];
  if (rolloutPath) paths.push(rolloutPath);
  paths.push(join(fallbackSessionsDir, sessionId, "rollout.jsonl"));
  paths.push(join(fallbackSessionsDir, `${sessionId}.jsonl`));

  let content: string | null = null;
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        content = readFileSync(p, "utf-8");
        break;
      } catch {
        // try next
      }
    }
  }

  if (!content) return result;

  const seenHumanInputs = new Set<string>();
  const allChangedFiles = new Set<string>();
  const humanInputFiles: Array<Set<string>> = [];
  let currentHumanInputIndex: number | null = null;
  const seenTokenCounts = new Set<string>();

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      const payload = event["payload"] as Record<string, unknown> | undefined;
      const role = (event["role"] ?? payload?.["role"]) as string | undefined;
      const eventType = event["type"] as string | undefined;
      const payloadType = payload?.["type"] as string | undefined;
      const ts = (event["timestamp"] ?? payload?.["timestamp"]) as string | undefined;
      const d = ts ? new Date(ts) : null;
      const eventOnDate = !filterDate || (d !== null && !isNaN(d.getTime()) && localDateString(d) === filterDate);

      if (eventOnDate && d !== null && !isNaN(d.getTime())) {
          if (!result.firstTs || d < result.firstTs) result.firstTs = d;
          if (!result.lastTs || d > result.lastTs) result.lastTs = d;
      }

      if (!eventOnDate) continue;

      if (eventType === "event_msg" && payload?.["type"] === "token_count") {
        const info = payload["info"] as Record<string, unknown> | undefined;
        const lastUsage = info?.["last_token_usage"] as Record<string, unknown> | undefined;
        if (lastUsage) {
          const dedupKey = `${ts ?? ""}::${JSON.stringify(lastUsage)}`;
          if (!seenTokenCounts.has(dedupKey)) {
            seenTokenCounts.add(dedupKey);
            const inputTokens = numberField(lastUsage, "input_tokens");
            const cachedInputTokens = numberField(lastUsage, "cached_input_tokens");
            result.tokenUsage.input_tokens += Math.max(inputTokens - cachedInputTokens, 0);
            result.tokenUsage.cache_read_input_tokens += cachedInputTokens;
            result.tokenUsage.output_tokens += numberField(lastUsage, "output_tokens");
            result.tokenCountEvents += 1;
          }
        }
      }

      if (role === "user") {
        result.userCount++;
        if (eventType === "response_item" && payloadType === "message") {
          const text = extractTextContent(payload?.["content"]);
          if (isHumanInputText(text)) {
            const key = text.slice(0, 120);
            if (!seenHumanInputs.has(key)) {
              seenHumanInputs.add(key);
              result.humanInputs.push({
                category: classifyHumanInput(text),
                content: text,
                session_agent: "codex",
                start_time: ts ?? null,
                files_changed: 0,
                lines_added: 0,
                lines_deleted: 0,
              });
              humanInputFiles.push(new Set<string>());
              currentHumanInputIndex = result.humanInputs.length - 1;
            }
          }
        }
      }
      else if (role === "assistant") {
        result.assistantCount++;
        if (eventType === "response_item" && payloadType === "message" && currentHumanInputIndex != null && ts) {
          result.humanInputs[currentHumanInputIndex]!.end_time = ts;
        }
        // Count tool calls in content
        const content = event["content"] ?? payload?.["content"];
        if (Array.isArray(content)) {
          for (const block of content as unknown[]) {
            const b = block as Record<string, unknown>;
            if (b["type"] === "tool_use") result.toolCallCount++;
          }
        }
      }

      if (eventType === "response_item" && payloadType === "function_call") {
        result.toolCallCount++;
      }
      if (eventType === "response_item" && payloadType === "custom_tool_call") {
        result.toolCallCount++;
      }

      if (eventType === "event_msg" && payload?.["type"] === "patch_apply_end") {
        const changes = payload["changes"] as Record<string, Record<string, unknown>> | undefined;
        if (!changes) continue;
        const humanInput = currentHumanInputIndex == null ? null : result.humanInputs[currentHumanInputIndex];
        const filesForInput = currentHumanInputIndex == null ? null : humanInputFiles[currentHumanInputIndex];
        for (const [filePath, change] of Object.entries(changes)) {
          allChangedFiles.add(filePath);
          filesForInput?.add(filePath);

          let delta = countDiffLines(String(change["unified_diff"] ?? ""));
          if (delta.added === 0 && delta.deleted === 0) {
            if (change["type"] === "delete") {
              delta = { added: 0, deleted: countTextLines(change["content"]) };
            } else if (change["type"] === "add") {
              delta = { added: countTextLines(change["content"]), deleted: 0 };
            }
          }

          result.linesAdded += delta.added;
          result.linesDeleted += delta.deleted;
          if (humanInput) {
            humanInput.lines_added = (humanInput.lines_added ?? 0) + delta.added;
            humanInput.lines_deleted = (humanInput.lines_deleted ?? 0) + delta.deleted;
            humanInput.files_changed = filesForInput?.size ?? humanInput.files_changed ?? 0;
          }
        }
        result.filesChanged = allChangedFiles.size;
      }
    } catch {
      // skip
    }
  }

  return result;
}

/**
 * Collect Codex sessions from ~/.codex/state_5.sqlite for a given date.
 */
export function collectCodexSessions(filterDate: string): SessionData[] {
  const dbPath = codexStateDb();
  if (!existsSync(dbPath)) return [];

  const sessions: SessionData[] = [];
  const sessionsDir = codexSessionsDir();

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });

    try {
      const threads = db
        .prepare(
          "SELECT id, rollout_path, created_at, model, tokens_used, title, cwd FROM threads"
        )
        .all() as CodexThread[];

      for (const thread of threads) {
        const createdAt = dateFromCodexTimestamp(thread.created_at);
        const threadDate = createdAt ? localDateString(createdAt) : "";

        const model = thread.model || "unknown";
        const tokensUsed = thread.tokens_used ?? 0;
        const currency = getCurrency(model);
        const cwd = thread.cwd ?? "";

        // Parse rollout for message counts and timestamps scoped to the target day.
        const rolloutData = parseRollout(thread.rollout_path, sessionsDir, thread.id, filterDate);
        const hasRolloutActivityOnDate =
          rolloutData.firstTs !== null ||
          rolloutData.userCount > 0 ||
          rolloutData.assistantCount > 0 ||
          rolloutData.tokenCountEvents > 0 ||
          rolloutData.filesChanged > 0;
        if (threadDate !== filterDate && !hasRolloutActivityOnDate) continue;

        const hasDetailedUsage =
          rolloutData.tokenCountEvents > 0 &&
          rolloutData.tokenUsage.input_tokens +
            rolloutData.tokenUsage.output_tokens +
            rolloutData.tokenUsage.cache_read_input_tokens +
            rolloutData.tokenUsage.cache_creation_input_tokens >
            0;
        const usage = hasDetailedUsage
          ? rolloutData.tokenUsage
          : {
            input_tokens: 0,
            output_tokens: tokensUsed,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          };
        const calculatedCost = hasDetailedUsage ? calculateCost(model, usage) : null;

        // Build model usage from rollout token_count events when present.
        const modelEntry: ModelUsageEntry = {
          api_calls: rolloutData.tokenCountEvents || rolloutData.assistantCount || 1,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cache_read_input_tokens: usage.cache_read_input_tokens,
          cache_creation_input_tokens: usage.cache_creation_input_tokens,
          cost: calculatedCost ?? "unknown",
          currency,
          token_source: hasDetailedUsage ? "codex_token_count_estimate" : "total_only",
          note: hasDetailedUsage
            ? "Estimated from Codex rollout token_count events"
            : "Codex only provides total token count without input/output breakdown",
        };

        const modelUsage: Record<string, ModelUsageEntry> = { [model]: modelEntry };

        const usageBucket: UsageBucket = {
          ...modelEntry,
          model,
          speed: "standard",
          service_tier: "standard",
          effort: "default",
          agents: ["codex"],
        };

        const reposTouched: RepoTouched[] = cwd
          ? [{
            repo: cwd,
            files: rolloutData.filesChanged,
            added: rolloutData.linesAdded,
            deleted: rolloutData.linesDeleted,
          }]
          : [];

        // Time range
        let timeDisplay = "unknown";
        let startLocal: string | undefined;

        if (rolloutData.firstTs && rolloutData.lastTs) {
          timeDisplay = `${formatLocalTime(rolloutData.firstTs)} - ${formatLocalTime(rolloutData.lastTs)}`;
          startLocal = rolloutData.firstTs.toISOString();
        } else if (createdAt) {
          timeDisplay = formatLocalTime(createdAt);
          startLocal = createdAt.toISOString();
        }

        const sessionName = thread.title || thread.id.slice(0, 8);

        sessions.push({
          schema: "2.0",
          date: filterDate,
          agent: "codex",
          session_id: thread.id,
          session_name: sessionName,
          project: cwd ? cwd.split("/").pop() ?? cwd : thread.id.slice(0, 8),
          cwd,
          time_range: {
            display: timeDisplay,
            timezone: getLocalTimezone(),
            start: startLocal,
          },
          model_usage: modelUsage,
          usage_breakdown: [usageBucket],
          files_changed: rolloutData.filesChanged,
          files_added: rolloutData.linesAdded,
          files_deleted: rolloutData.linesDeleted,
          repos_touched: reposTouched,
          message_stats: {
            user: rolloutData.userCount,
            assistant: rolloutData.assistantCount,
            tool_calls: rolloutData.toolCallCount,
          },
          human_inputs: rolloutData.humanInputs.length > 0 ? rolloutData.humanInputs : undefined,
        });
      }
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn(`Warning: codex reader: ${(e as Error).message}`);
  }

  return sessions;
}
