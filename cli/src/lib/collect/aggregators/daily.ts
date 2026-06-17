import {
  ApiSessionData,
  DailyApiJson,
  ModelUsageEntry,
  RepoTouched,
  SessionData,
  UsageBucket,
  MessageStats,
} from "../types.js";

function unionAgents(a?: string[], b?: string[]): string[] | undefined {
  const all = [...(a ?? []), ...(b ?? [])];
  if (!all.length) return undefined;
  return [...new Set(all)].sort();
}
import { mergeUsageBuckets, foldBucketsToModel, sumCostByCurrency } from "./tokens.js";

/**
 * Merge two RepoTouched arrays, deduplicating by repo name and summing counters.
 */
function mergeRepos(a: RepoTouched[], b: RepoTouched[]): RepoTouched[] {
  const map: Record<string, RepoTouched> = {};

  for (const repo of [...a, ...b]) {
    if (!repo.repo) continue;
    if (!map[repo.repo]) {
      map[repo.repo] = { ...repo };
    } else {
      map[repo.repo].files += repo.files;
      map[repo.repo].added += repo.added;
      map[repo.repo].deleted += repo.deleted;
    }
  }

  return Object.values(map);
}

function sumMessageStats(a: MessageStats, b: MessageStats): MessageStats {
  return {
    user: a.user + b.user,
    assistant: a.assistant + b.assistant,
    tool_calls: a.tool_calls + b.tool_calls,
  };
}

function parseTimeRangeStart(session: SessionData): number | null {
  const raw = session.time_range.start_local;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : t;
}

function parseDisplayBounds(display: string): { start: string | null; end: string | null } {
  const times = display.match(/\d{2}:\d{2}/g) ?? [];
  if (!times.length) return { start: null, end: null };
  return { start: times[0] ?? null, end: times[times.length - 1] ?? null };
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function mergeTimeDisplay(a: string, b: string): string {
  const aBounds = parseDisplayBounds(a);
  const bBounds = parseDisplayBounds(b);
  const starts = [aBounds.start, bBounds.start].filter((v): v is string => !!v);
  const ends = [aBounds.end, bBounds.end].filter((v): v is string => !!v);
  if (!starts.length || !ends.length) return a !== "unknown" ? a : b;

  const start = starts.sort((x, y) => timeToMinutes(x) - timeToMinutes(y))[0];
  const end = ends.sort((x, y) => timeToMinutes(y) - timeToMinutes(x))[0];
  return start === end ? start : `${start} - ${end}`;
}

function mergeSessionRecords(sessions: SessionData[]): SessionData[] {
  const map = new Map<string, SessionData>();

  for (const session of sessions) {
    const key = `${session.date}|${session.agent}|${session.cwd || session.project}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        ...session,
        model_usage: { ...session.model_usage },
        usage_breakdown: session.usage_breakdown.map((b) => ({ ...b })),
        repos_touched: session.repos_touched.map((r) => ({ ...r })),
        human_inputs: session.human_inputs ? [...session.human_inputs] : undefined,
      });
      continue;
    }

    existing.session_id = existing.session_id || session.session_id;
    existing.session_name = existing.session_name || session.session_name;
    existing.model_usage = mergeModelUsage(existing.model_usage, session.model_usage);
    existing.usage_breakdown = Object.values(
      mergeUsageBuckets(bucketsToMap(existing.usage_breakdown), bucketsToMap(session.usage_breakdown))
    );
    existing.repos_touched = mergeRepos(existing.repos_touched, session.repos_touched);
    existing.message_stats = sumMessageStats(existing.message_stats, session.message_stats);
    existing.files_changed += session.files_changed;
    existing.files_added = (existing.files_added ?? 0) + (session.files_added ?? 0) || undefined;
    existing.files_deleted = (existing.files_deleted ?? 0) + (session.files_deleted ?? 0) || undefined;
    existing.human_inputs = [...(existing.human_inputs ?? []), ...(session.human_inputs ?? [])];
    existing.time_range.display = mergeTimeDisplay(existing.time_range.display, session.time_range.display);

    const existingStart = parseTimeRangeStart(existing);
    const sessionStart = parseTimeRangeStart(session);
    if (existingStart == null || (sessionStart != null && sessionStart < existingStart)) {
      existing.time_range.start_local = session.time_range.start_local;
    }
  }

  return Array.from(map.values());
}

function buildTopLevelSummary(
  date: string,
  sessions: SessionData[],
  costByCurrency: Record<string, number>
): string {
  const byAgent: Record<string, number> = {};
  for (const s of sessions) byAgent[s.agent] = (byAgent[s.agent] ?? 0) + 1;
  const agentText = Object.entries(byAgent)
    .sort((a, b) => b[1] - a[1])
    .map(([agent, count]) => `${agent} ${count}个`)
    .join("，");
  const costText = Object.entries(costByCurrency)
    .map(([currency, cost]) => `${currency}${Math.round(cost * 100) / 100}`)
    .join("，");
  return `${date} 共采集 ${sessions.length} 个会话（${agentText || "无"}），总成本 ${costText || "未知"}。`;
}

/**
 * Convert an array of UsageBuckets to a bucket map (keyed by bucketKey format).
 */
function bucketsToMap(buckets: UsageBucket[]): Record<string, UsageBucket> {
  const map: Record<string, UsageBucket> = {};
  for (const bucket of buckets) {
    const key = `${bucket.model}|speed=${bucket.speed}|tier=${bucket.service_tier}|effort=${bucket.effort}`;
    if (!map[key]) {
      map[key] = { ...bucket };
    } else {
      const existing = map[key];
      existing.api_calls += bucket.api_calls;
      existing.input_tokens += bucket.input_tokens;
      existing.output_tokens += bucket.output_tokens;
      existing.cache_read_input_tokens += bucket.cache_read_input_tokens;
      existing.cache_creation_input_tokens += bucket.cache_creation_input_tokens;
      if (bucket.cost === "unknown") {
        existing.cost = "unknown";
      } else if (existing.cost !== "unknown") {
        (existing as { cost: number }).cost += bucket.cost as number;
      }
      existing.agents = unionAgents(existing.agents, bucket.agents);
    }
  }
  return map;
}

/**
 * Merge two model_usage maps, summing all counters.
 */
function mergeModelUsage(
  a: Record<string, ModelUsageEntry>,
  b: Record<string, ModelUsageEntry>
): Record<string, ModelUsageEntry> {
  const result: Record<string, ModelUsageEntry> = { ...a };

  for (const [model, entry] of Object.entries(b)) {
    if (!result[model]) {
      result[model] = { ...entry };
    } else {
      const existing = result[model];
      existing.api_calls += entry.api_calls;
      existing.input_tokens += entry.input_tokens;
      existing.output_tokens += entry.output_tokens;
      existing.cache_read_input_tokens += entry.cache_read_input_tokens;
      existing.cache_creation_input_tokens += entry.cache_creation_input_tokens;
      if (entry.cost === "unknown") {
        existing.cost = "unknown";
      } else if (existing.cost !== "unknown") {
        (existing as { cost: number }).cost += entry.cost as number;
      }
    }
  }

  return result;
}

function agentDisplay(session: SessionData): string {
  if (session.agent === "cursor-cli" || session.agent === "cursor-gui") return session.agent;
  if (session.agent === "cursor") {
    return session.message_stats.tool_calls > 0 ? "cursor-gui" : "cursor-cli";
  }
  return session.agent;
}

function apiAgent(session: SessionData): string {
  if (session.agent === "cursor-cli" || session.agent === "cursor-gui") return "cursor";
  return session.agent;
}

function sessionSource(session: SessionData): string {
  if (session.agent === "cursor-cli") return "cli";
  if (session.agent === "cursor-gui") return "gui";
  if (session.agent === "cursor") return session.message_stats.tool_calls > 0 ? "gui" : "cli";
  return "";
}

function totalTokens(buckets: UsageBucket[]): number {
  return buckets.reduce(
    (sum, bucket) =>
      sum +
      bucket.input_tokens +
      bucket.output_tokens +
      bucket.cache_read_input_tokens +
      bucket.cache_creation_input_tokens,
    0
  );
}

function sessionCost(buckets: UsageBucket[], round2: (value: number) => number): number {
  const total = buckets.reduce((sum, bucket) => {
    if (typeof bucket.cost !== "number") return sum;
    return sum + bucket.cost;
  }, 0);
  return round2(total);
}

function tokenSource(session: SessionData): string {
  for (const bucket of session.usage_breakdown) {
    if (bucket.token_source) return bucket.token_source;
  }
  for (const entry of Object.values(session.model_usage)) {
    if (entry.token_source) return entry.token_source;
  }
  if (apiAgent(session) === "cursor") return "char-based estimate (API unavailable)";
  return "";
}

function costBasis(session: SessionData): string {
  return tokenSource(session).includes("estimate") ? "estimate" : "unknown";
}

function toApiSession(session: SessionData, round2: (value: number) => number): ApiSessionData {
  return {
    agent: apiAgent(session),
    source: sessionSource(session),
    agent_display: agentDisplay(session),
    session_id: session.session_id,
    session_name: session.session_name,
    time_range: session.time_range.display,
    project: session.project || session.cwd,
    message_stats: session.message_stats,
    files_changed: session.files_changed,
    files_added: session.files_added ?? 0,
    files_deleted: session.files_deleted ?? 0,
    models: Object.keys(session.model_usage),
    total_tokens: totalTokens(session.usage_breakdown),
    session_cost: sessionCost(session.usage_breakdown, round2),
    cost_basis: costBasis(session),
    token_source: tokenSource(session),
    repos_touched: session.repos_touched.map((repo) => repo.repo),
    repos_touched_detail: session.repos_touched,
  };
}

function normalizeProjectName(project: string): string {
  const p = (project ?? "").trim();
  if (!p) return "";
  const parts = p.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] ?? p : p;
}

function pickSessionModel(session: SessionData): string {
  if (session.usage_breakdown.length > 0 && session.usage_breakdown[0]?.model) {
    return session.usage_breakdown[0].model;
  }
  const models = Object.keys(session.model_usage ?? {});
  return models.length > 0 ? models[0] ?? "" : "";
}

function nonEmpty(value?: string): string | undefined {
  const t = (value ?? "").trim();
  return t.length > 0 ? t : undefined;
}

function enrichSessionHumanInputs(session: SessionData) {
  return (session.human_inputs ?? []).map((h) => ({
    ...h,
    session_title: h.session_title ?? session.session_name,
    session_agent: h.session_agent ?? agentDisplay(session),
    session_time: nonEmpty(h.session_time ?? h.start_time),
    session_model: h.session_model ?? pickSessionModel(session),
    project: h.project ?? normalizeProjectName(session.project),
    files_changed: h.files_changed ?? 0,
    lines_added: h.lines_added ?? 0,
    lines_deleted: h.lines_deleted ?? 0,
    start_time: nonEmpty(h.start_time ?? h.session_time),
    end_time: nonEmpty(h.end_time ?? h.start_time ?? h.session_time),
  }));
}

/**
 * Build the daily.api.json from collected sessions and optional Cursor API usage.
 *
 * Cursor API usage is treated as authoritative — it replaces cursor char-estimate
 * entries in the aggregated buckets.
 */
export function buildDailyApiJson(
  sessions: SessionData[],
  date: string,
  author: string,
  cursorApiUsage?: {
    byModel: Record<string, ModelUsageEntry>;
    totalCost: number;
    currency: string;
  }
): DailyApiJson {
  // Keep only real conversation sessions. Metadata-only records (0 user + 0 assistant)
  // should not count as "talked to an agent today".
  const conversationSessions = mergeSessionRecords(sessions.filter(
    (s) => (s.message_stats.user + s.message_stats.assistant) > 0
  ));

  // 1. Merge all session usage_breakdown buckets
  let allBuckets: Record<string, UsageBucket> = {};
  let allRepos: RepoTouched[] = [];
  const agents = new Set<string>();
  let totalMessages: MessageStats = { user: 0, assistant: 0, tool_calls: 0 };
  let totalFilesChanged = 0;

  for (const session of conversationSessions) {
    const sessionBuckets = bucketsToMap(session.usage_breakdown);
    allBuckets = mergeUsageBuckets(allBuckets, sessionBuckets);
    allRepos = mergeRepos(allRepos, session.repos_touched);
    agents.add(agentDisplay(session));
    totalMessages = sumMessageStats(totalMessages, session.message_stats);
    totalFilesChanged += session.files_changed;
  }

  // 2. If cursorApiUsage provided: remove cursor char-estimate entries, add exact API data
  if (cursorApiUsage) {
    // Remove existing cursor-related buckets (those with cost=unknown from cursor-cli/cursor-gui)
    const filteredBuckets: Record<string, UsageBucket> = {};
    for (const [key, bucket] of Object.entries(allBuckets)) {
      // Keep non-cursor entries (claude-code, codex, etc.)
      // Cursor entries are identified by having cost="unknown" and agent mismatch
      // or we can use the model name heuristic
      const isComposerModel = bucket.model.startsWith("composer-");
      if (!isComposerModel || bucket.cost !== "unknown") {
        filteredBuckets[key] = bucket;
      }
    }
    allBuckets = filteredBuckets;

    // Add exact API data as buckets
    for (const [model, entry] of Object.entries(cursorApiUsage.byModel)) {
      const key = `${model}|speed=standard|tier=api|effort=default`;
      if (!allBuckets[key]) {
        allBuckets[key] = {
          ...entry,
          model,
          speed: "standard",
          service_tier: "api",
          effort: "default",
          agents: ["cursor"],
        };
      } else {
        const existing = allBuckets[key];
        existing.api_calls += entry.api_calls;
        existing.input_tokens += entry.input_tokens;
        existing.output_tokens += entry.output_tokens;
        existing.cache_read_input_tokens += entry.cache_read_input_tokens;
        existing.cache_creation_input_tokens += entry.cache_creation_input_tokens;
        if (entry.cost === "unknown") {
          existing.cost = "unknown";
        } else if (existing.cost !== "unknown") {
          (existing as { cost: number }).cost += entry.cost as number;
        }
        existing.agents = unionAgents(existing.agents, ["cursor"]);
      }
    }
  }

  // 3. Fold buckets to model_usage
  const modelUsage = foldBucketsToModel(allBuckets);

  // 4. Sum cost by currency for totals
  const costByCurrency = sumCostByCurrency(allBuckets);

  // 5. Build usage_breakdown array (sorted by cost desc)
  const usageBreakdown = Object.values(allBuckets).sort((a, b) => {
    const costA = typeof a.cost === "number" ? a.cost : 0;
    const costB = typeof b.cost === "number" ? b.cost : 0;
    return costB - costA;
  });

  const r2 = (v: number) => Math.round(v * 100) / 100;

  return {
    schema: "2.0",
    date,
    author,
    generated_at: new Date().toISOString(),
    include_conversation: false,
    summary: buildTopLevelSummary(date, conversationSessions, costByCurrency),
    totals: {
      sessions: conversationSessions.length,
      agents: Array.from(agents).sort(),
      messages: totalMessages,
      files_changed: totalFilesChanged,
      cost: Object.fromEntries(Object.entries(costByCurrency).map(([k, v]) => [k, r2(v)])),
    },
    usage_breakdown: usageBreakdown.map((b) => ({
      ...b,
      cost: typeof b.cost === "number" ? r2(b.cost) : b.cost,
    })),
    model_usage: Object.fromEntries(
      Object.entries(modelUsage).map(([k, v]) => [
        k,
        { ...v, cost: typeof v.cost === "number" ? r2(v.cost) : v.cost },
      ])
    ),
    sessions: conversationSessions.map((session) => toApiSession(session, r2)),
    repos: allRepos,
    human_inputs: conversationSessions.flatMap((s) => enrichSessionHumanInputs(s)),
  };
}
