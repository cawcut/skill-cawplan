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
import { appendAssistantMessage } from "../aggregators/human-assistant.js";
import { formatLocalTime, getLocalTimezone, localDateString } from "../date-utils.js";
import { countDiffLines } from "../aggregators/tool-utils.js";

interface CodexCollectOptions {
  log?: (message: string) => void;
}

interface CodexTokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

interface CodexModelTokenUsage {
  tokenUsage: CodexTokenUsage;
  tokenCountEvents: number;
}

function emptyCodexTokenUsage(): CodexTokenUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function logCodex(opts: CodexCollectOptions | undefined, message: string): void {
  opts?.log?.(`[codex] ${message}`);
}

function timed<T>(opts: CodexCollectOptions | undefined, label: string, run: () => T): T {
  logCodex(opts, `${label}...`);
  const startedAt = Date.now();
  try {
    const result = run();
    logCodex(opts, `${label} done in ${formatDuration(Date.now() - startedAt)}.`);
    return result;
  } catch (e) {
    logCodex(opts, `${label} failed after ${formatDuration(Date.now() - startedAt)}: ${(e as Error).message}`);
    throw e;
  }
}

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
  filterDate?: string,
  opts?: CodexCollectOptions
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
  tokenUsage: CodexTokenUsage;
  tokenUsageByModel: Record<string, CodexModelTokenUsage>;
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
    tokenUsage: emptyCodexTokenUsage(),
    tokenUsageByModel: {} as Record<string, CodexModelTokenUsage>,
    tokenCountEvents: 0,
    model: null as string | null,
    rolloutPath: null as string | null,
  };

  let content: string | null = null;
  const candidates = timed(opts, `Build Codex rollout candidates ${sessionId}`, () =>
    rolloutPathCandidates(rolloutPath, fallbackSessionsDir, sessionId)
  );
  logCodex(opts, `Codex session ${sessionId}: rollout candidates=${candidates.length}.`);
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        content = timed(opts, `Read Codex rollout ${sessionId}`, () => readFileSync(p, "utf-8"));
        result.rolloutPath = p;
        break;
      } catch {
        // try next
      }
    }
  }

  if (!content) {
    logCodex(opts, `Codex session ${sessionId}: no rollout file found.`);
    return result;
  }

  const seenHumanInputs = new Set<string>();
  const allChangedFiles = new Set<string>();
  const humanInputFiles: Array<Set<string>> = [];
  let currentHumanInputIndex: number | null = null;
  let activeModel: string | null = null;
  const seenTokenCounts = new Set<string>();

  const lines = timed(opts, `Split Codex rollout lines ${sessionId}`, () => content.split("\n"));
  timed(opts, `Parse Codex rollout events ${sessionId}`, () => {
  for (const line of lines) {
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

      if (eventType === "turn_context") {
        const contextModel = String(payload?.["model"] ?? event["model"] ?? "").trim();
        if (contextModel) {
          activeModel = contextModel;
          if (eventOnDate && !result.model) result.model = contextModel;
        }
      }

      if (eventOnDate && d !== null && !isNaN(d.getTime())) {
          if (!result.firstTs || d < result.firstTs) result.firstTs = d;
          if (!result.lastTs || d > result.lastTs) result.lastTs = d;
      }

      if (!eventOnDate) continue;

      if (eventType === "event_msg" && payload?.["type"] === "token_count") {
        const info = payload["info"] as Record<string, unknown> | undefined;
        const lastUsage = info?.["last_token_usage"] as Record<string, unknown> | undefined;
        if (lastUsage) {
          const model = String(info?.["model"] ?? payload["model"] ?? event["model"] ?? activeModel ?? "").trim();
          if (model && !result.model) result.model = model;
          const dedupKey = `${ts ?? ""}::${model}::${JSON.stringify(lastUsage)}`;
          if (!seenTokenCounts.has(dedupKey)) {
            seenTokenCounts.add(dedupKey);
            const inputTokens = numberField(lastUsage, "input_tokens");
            const cachedInputTokens = numberField(lastUsage, "cached_input_tokens");
            const outputTokens = numberField(lastUsage, "output_tokens");
            const modelUsage = result.tokenUsageByModel[model] ?? {
              tokenUsage: emptyCodexTokenUsage(),
              tokenCountEvents: 0,
            };
            const uncachedInputTokens = Math.max(inputTokens - cachedInputTokens, 0);
            result.tokenUsage.input_tokens += uncachedInputTokens;
            result.tokenUsage.cache_read_input_tokens += cachedInputTokens;
            result.tokenUsage.output_tokens += outputTokens;
            modelUsage.tokenUsage.input_tokens += uncachedInputTokens;
            modelUsage.tokenUsage.cache_read_input_tokens += cachedInputTokens;
            modelUsage.tokenUsage.output_tokens += outputTokens;
            modelUsage.tokenCountEvents += 1;
            result.tokenUsageByModel[model] = modelUsage;
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
                session_model: activeModel ?? undefined,
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
        if (eventType === "response_item" && payloadType === "message" && currentHumanInputIndex != null) {
          if (ts) {
            result.humanInputs[currentHumanInputIndex]!.end_time = ts;
          }
          const assistantText = extractTextContent(event["content"] ?? payload?.["content"]);
          if (assistantText) {
            const humanInput = result.humanInputs[currentHumanInputIndex]!;
            humanInput.assistant_message = appendAssistantMessage(
              humanInput.assistant_message,
              assistantText
            );
          }
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
  });
  logCodex(opts, `Codex session ${sessionId}: users=${result.userCount}, assistants=${result.assistantCount}, tool_calls=${result.toolCallCount}, token_events=${result.tokenCountEvents}, files=${result.filesChanged}.`);

  return result;
}

/**
 * Collect Codex sessions from ~/.codex/state_5.sqlite for a given date.
 */
export function collectCodexSessions(filterDate: string, opts?: CodexCollectOptions): SessionData[] {
  const dbPath = codexStateDb();
  logCodex(opts, `State DB: ${dbPath}`);
  if (!existsSync(dbPath)) {
    logCodex(opts, "Codex state DB does not exist; no sessions collected.");
    return [];
  }

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
    const usageByModel = new Map<string, CodexModelTokenUsage>();
    for (const [recordedModel, recordedUsage] of Object.entries(rolloutData.tokenUsageByModel)) {
      const resolvedModel = recordedModel || model;
      const existing = usageByModel.get(resolvedModel) ?? {
        tokenUsage: emptyCodexTokenUsage(),
        tokenCountEvents: 0,
      };
      existing.tokenUsage.input_tokens += recordedUsage.tokenUsage.input_tokens;
      existing.tokenUsage.output_tokens += recordedUsage.tokenUsage.output_tokens;
      existing.tokenUsage.cache_read_input_tokens += recordedUsage.tokenUsage.cache_read_input_tokens;
      existing.tokenUsage.cache_creation_input_tokens += recordedUsage.tokenUsage.cache_creation_input_tokens;
      existing.tokenCountEvents += recordedUsage.tokenCountEvents;
      usageByModel.set(resolvedModel, existing);
    }
    if (!hasDetailedUsage) {
      usageByModel.set(model, {
        tokenUsage: emptyCodexTokenUsage(),
        tokenCountEvents: rolloutData.assistantCount || 1,
      });
    }

    const modelUsage: Record<string, ModelUsageEntry> = {};
    const usageBreakdown: UsageBucket[] = [];
    let hasUnpricedModel = false;
    timed(opts, `Calculate Codex cost ${id}`, () => {
      for (const [usageModel, recordedUsage] of usageByModel.entries()) {
        const calculatedCost = hasDetailedUsage
          ? calculateCost(usageModel, recordedUsage.tokenUsage)
          : null;
        if (hasDetailedUsage && calculatedCost === null) hasUnpricedModel = true;
        const modelEntry: ModelUsageEntry = {
          api_calls: recordedUsage.tokenCountEvents,
          ...recordedUsage.tokenUsage,
          cost: calculatedCost ?? 0,
          currency: COST_CURRENCY,
          token_source: hasDetailedUsage ? "codex_token_count_estimate" : "total_only",
          note: hasDetailedUsage
            ? "Estimated from Codex rollout token_count events"
            : "Codex only provides total token count without input/output breakdown",
        };
        modelUsage[usageModel] = modelEntry;
        usageBreakdown.push({
          ...modelEntry,
          model: usageModel,
          speed: "standard",
          service_tier: "standard",
          effort: "default",
          agents: ["codex"],
        });
      }
    });

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
    timed(opts, `Build Codex session payload ${id}`, () => sessions.push({
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
      usage_breakdown: usageBreakdown,
      total_tokens: hasDetailedUsage ? undefined : tokensUsed,
      cost_basis: !hasDetailedUsage || hasUnpricedModel ? "unknown" : "estimate",
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
    }));
    logCodex(opts, `Collected Codex session ${id}: models=${Object.keys(modelUsage).join(",")}, users=${rolloutData.userCount}, assistants=${rolloutData.assistantCount}.`);
  }

  try {
    const db = timed(opts, "Open Codex state DB", () => new DatabaseSync(dbPath, { readOnly: true }));

    try {
      const threads = timed(opts, `Select Codex threads for ${filterDate}`, () => selectThreadsForDate(db, filterDate));
      logCodex(opts, `Found ${threads.length} Codex thread candidate(s).`);

      for (const thread of threads) {
        const createdAt = timed(opts, `Parse Codex created_at ${thread.id}`, () =>
          dateFromCodexTimestamp(thread.created_at)
        );
        const threadDate = createdAt ? localDateString(createdAt) : "";

        const model = thread.model || "unknown";
        const tokensUsed = thread.tokens_used ?? 0;
        const cwd = thread.cwd ?? "";

        // Parse rollout for message counts and timestamps scoped to the target day.
        const rolloutData = parseRollout(thread.rollout_path, sessionsDir, thread.id, filterDate, opts);
        const hasRolloutActivityOnDate =
          rolloutData.firstTs !== null ||
          rolloutData.userCount > 0 ||
          rolloutData.assistantCount > 0 ||
          rolloutData.tokenCountEvents > 0 ||
          rolloutData.filesChanged > 0;
        const hasThreadActivityOnDate = threadDate === filterDate && thread.has_user_event !== 0;
        if (!hasRolloutActivityOnDate && !hasThreadActivityOnDate) {
          logCodex(opts, `Skip Codex thread ${thread.id}: no activity on ${filterDate}.`);
          continue;
        }

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

      const fallbackRolloutFiles = timed(opts, `Find Codex fallback rollouts for ${filterDate}`, () =>
        rolloutFilesForDate(sessionsDir, filterDate)
      );
      logCodex(opts, `Found ${fallbackRolloutFiles.length} Codex fallback rollout file(s).`);
      for (const rolloutFile of fallbackRolloutFiles) {
        if (seenRolloutPaths.has(rolloutFile)) continue;
        const rolloutData = parseRollout(rolloutFile, sessionsDir, basename(rolloutFile, ".jsonl"), filterDate, opts);
        if (!rolloutData.rolloutPath || seenRolloutPaths.has(rolloutData.rolloutPath)) continue;
        const hasActivity =
          rolloutData.firstTs !== null ||
          rolloutData.userCount > 0 ||
          rolloutData.assistantCount > 0 ||
          rolloutData.tokenCountEvents > 0 ||
          rolloutData.filesChanged > 0;
        if (!hasActivity) {
          logCodex(opts, `Skip Codex fallback rollout ${rolloutFile}: no activity on ${filterDate}.`);
          continue;
        }
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
      timed(opts, "Close Codex state DB", () => db.close());
    }
  } catch (e) {
    console.warn(`Warning: codex reader: ${(e as Error).message}`);
  }

  logCodex(opts, `Collected ${sessions.length} Codex session(s).`);
  return sessions;
}
