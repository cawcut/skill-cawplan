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
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { codexStateDb, codexSessionsDir } from "../paths.js";
import { SessionData, ModelUsageEntry, UsageBucket, RepoTouched, HumanInput } from "../types.js";
import { calculateCost, COST_CURRENCY } from "../pricing.js";
import { classifyHumanInput } from "../aggregators/human-category.js";
import { formatLocalTime, getLocalTimezone, localDateString } from "../date-utils.js";
import { countDiffLines } from "../aggregators/tool-utils.js";

interface CodexThread {
  id: string;
  rollout_path: string | null;
  created_at: string | number;
  model: string;
  tokens_used: number | null;
  title: string | null;
  cwd: string | null;
  has_user_event?: number | null;
}

function dayBounds(filterDate: string): {
  startSec: number;
  endSec: number;
  startMs: number;
  endMs: number;
} {
  const startMs = new Date(`${filterDate}T00:00:00`).getTime();
  const endMs = new Date(`${filterDate}T23:59:59.999`).getTime();
  return {
    startSec: Math.floor(startMs / 1000),
    endSec: Math.ceil(endMs / 1000),
    startMs,
    endMs,
  };
}

function tableColumnTypes(db: DatabaseSync, table: string): Map<string, string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type?: string }>;
  return new Map(rows.map((row) => [row.name, row.type ?? ""]));
}

function isNumericColumn(columns: Map<string, string>, name: string): boolean {
  const type = (columns.get(name) ?? "").toUpperCase();
  return /INT|REAL|NUM|FLOA|DOUB/.test(type);
}

function selectThreadsForDate(db: DatabaseSync, filterDate: string): CodexThread[] {
  const columns = tableColumnTypes(db, "threads");
  const selectColumns = [
    "id",
    "rollout_path",
    "created_at",
    columns.has("model") ? "model" : "'' AS model",
    "tokens_used",
    "title",
    "cwd",
    columns.has("has_user_event") ? "has_user_event" : "1 AS has_user_event",
  ];
  const predicates: string[] = [];
  const params: Record<string, number> = {};
  const bounds = dayBounds(filterDate);

  if (isNumericColumn(columns, "created_at") && isNumericColumn(columns, "updated_at")) {
    predicates.push("(created_at <= $endSec AND updated_at >= $startSec)");
    params.$startSec = bounds.startSec;
    params.$endSec = bounds.endSec;
  } else if (isNumericColumn(columns, "created_at")) {
    predicates.push("(created_at BETWEEN $startSec AND $endSec)");
    params.$startSec = bounds.startSec;
    params.$endSec = bounds.endSec;
  }

  if (isNumericColumn(columns, "created_at_ms") && isNumericColumn(columns, "updated_at_ms")) {
    predicates.push("(created_at_ms <= $endMs AND updated_at_ms >= $startMs)");
    params.$startMs = bounds.startMs;
    params.$endMs = bounds.endMs;
  } else if (isNumericColumn(columns, "created_at_ms")) {
    predicates.push("(created_at_ms BETWEEN $startMs AND $endMs)");
    params.$startMs = bounds.startMs;
    params.$endMs = bounds.endMs;
  }

  if (isNumericColumn(columns, "recency_at_ms")) {
    predicates.push("(recency_at_ms BETWEEN $startMs AND $endMs)");
    params.$startMs = bounds.startMs;
    params.$endMs = bounds.endMs;
  }

  const where = predicates.length > 0 ? `WHERE ${predicates.join(" OR ")}` : "";
  return db
    .prepare(`SELECT ${selectColumns.join(", ")} FROM threads ${where}`)
    .all(params) as unknown as CodexThread[];
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


function countTextLines(value: unknown): number {
  if (typeof value !== "string" || !value) return 0;
  return value.split("\n").length;
}

function numberField(record: Record<string, unknown>, field: string): number {
  const value = Number(record[field] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function stableHumanInputKey(text: string, ts?: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const hash = createHash("sha256").update(normalized).digest("hex");
  return `${ts ?? ""}::${hash}`;
}

function rolloutPathCandidates(
  rolloutPath: string | null,
  fallbackSessionsDir: string,
  sessionId: string
): string[] {
  const paths = new Set<string>();
  if (rolloutPath) {
    paths.add(rolloutPath);
    const marker = "/sessions/";
    const normalized = rolloutPath.replace(/\\/g, "/");
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex >= 0) {
      const suffix = normalized.slice(markerIndex + marker.length);
      if (suffix) paths.add(join(fallbackSessionsDir, suffix));
    }
  }
  paths.add(join(fallbackSessionsDir, sessionId, "rollout.jsonl"));
  paths.add(join(fallbackSessionsDir, `${sessionId}.jsonl`));
  return [...paths];
}

function rolloutFilesForDate(fallbackSessionsDir: string, filterDate: string): string[] {
  const [year, month, day] = filterDate.split("-");
  if (!year || !month || !day) return [];
  const dir = join(fallbackSessionsDir, year, month, day);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
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
  model: string | null;
  rolloutPath: string | null;
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
    model: null as string | null,
    rolloutPath: null as string | null,
  };

  let content: string | null = null;
  for (const p of rolloutPathCandidates(rolloutPath, fallbackSessionsDir, sessionId)) {
    if (existsSync(p)) {
      try {
        content = readFileSync(p, "utf-8");
        result.rolloutPath = p;
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
          const model = String(info?.["model"] ?? payload["model"] ?? event["model"] ?? "").trim();
          if (model && !result.model) result.model = model;
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
            const key = stableHumanInputKey(text, ts);
            if (!seenHumanInputs.has(key)) {
              seenHumanInputs.add(key);
              result.humanInputs.push({
                category: classifyHumanInput(text),
                content: text,
                session_agent: "codex",
                start_time: ts ?? null,
                time_precision: "exact",
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
  const seenRolloutPaths = new Set<string>();

  function pushSession(params: {
    id: string;
    title: string | null;
    createdAt: Date | null;
    model: string;
    tokensUsed: number;
    cwd: string;
    rolloutData: ReturnType<typeof parseRollout>;
  }): void {
    const { id, title, createdAt, model, tokensUsed, cwd, rolloutData } = params;
    if (rolloutData.rolloutPath) seenRolloutPaths.add(rolloutData.rolloutPath);

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
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      };
    const calculatedCost = hasDetailedUsage ? calculateCost(model, usage) : null;

    const modelEntry: ModelUsageEntry = {
      api_calls: rolloutData.tokenCountEvents || rolloutData.assistantCount || 1,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
      cost: calculatedCost ?? 0,
      currency: COST_CURRENCY,
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

    let timeDisplay = "unknown";
    let startLocal: string | undefined;
    if (rolloutData.firstTs && rolloutData.lastTs) {
      timeDisplay = `${formatLocalTime(rolloutData.firstTs)} - ${formatLocalTime(rolloutData.lastTs)}`;
      startLocal = rolloutData.firstTs.toISOString();
    } else if (createdAt) {
      timeDisplay = formatLocalTime(createdAt);
      startLocal = createdAt.toISOString();
    }

    const sessionName = title || id.slice(0, 8);
    sessions.push({
      schema: "2.0",
      date: filterDate,
      agent: "codex",
      session_id: id,
      session_name: sessionName,
      project: cwd ? cwd.split("/").pop() ?? cwd : id.slice(0, 8),
      cwd,
      time_range: {
        display: timeDisplay,
        timezone: getLocalTimezone(),
        start: startLocal,
      },
      model_usage: modelUsage,
      usage_breakdown: [usageBucket],
      total_tokens: hasDetailedUsage ? undefined : tokensUsed,
      cost_basis: calculatedCost === null ? "unknown" : "estimate",
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

  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });

    try {
      const threads = selectThreadsForDate(db, filterDate);

      for (const thread of threads) {
        const createdAt = dateFromCodexTimestamp(thread.created_at);
        const threadDate = createdAt ? localDateString(createdAt) : "";

        const model = thread.model || "unknown";
        const tokensUsed = thread.tokens_used ?? 0;
        const cwd = thread.cwd ?? "";

        // Parse rollout for message counts and timestamps scoped to the target day.
        const rolloutData = parseRollout(thread.rollout_path, sessionsDir, thread.id, filterDate);
        const hasRolloutActivityOnDate =
          rolloutData.firstTs !== null ||
          rolloutData.userCount > 0 ||
          rolloutData.assistantCount > 0 ||
          rolloutData.tokenCountEvents > 0 ||
          rolloutData.filesChanged > 0;
        const hasThreadActivityOnDate = threadDate === filterDate && thread.has_user_event !== 0;
        if (!hasRolloutActivityOnDate && !hasThreadActivityOnDate) continue;

        pushSession({
          id: thread.id,
          title: thread.title,
          createdAt,
          model,
          tokensUsed,
          cwd,
          rolloutData,
        });
      }

      for (const rolloutFile of rolloutFilesForDate(sessionsDir, filterDate)) {
        if (seenRolloutPaths.has(rolloutFile)) continue;
        const rolloutData = parseRollout(rolloutFile, sessionsDir, basename(rolloutFile, ".jsonl"), filterDate);
        if (!rolloutData.rolloutPath || seenRolloutPaths.has(rolloutData.rolloutPath)) continue;
        const hasActivity =
          rolloutData.firstTs !== null ||
          rolloutData.userCount > 0 ||
          rolloutData.assistantCount > 0 ||
          rolloutData.tokenCountEvents > 0 ||
          rolloutData.filesChanged > 0;
        if (!hasActivity) continue;
        pushSession({
          id: basename(rolloutFile, ".jsonl"),
          title: basename(rolloutFile, ".jsonl"),
          createdAt: rolloutData.firstTs,
          model: rolloutData.model || "unknown",
          tokensUsed: 0,
          cwd: "",
          rolloutData,
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
