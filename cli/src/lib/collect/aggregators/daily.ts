import {
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
  const normalizeProjectName = (project: string): string => {
    const p = (project ?? "").trim();
    if (!p) return "";
    const parts = p.split("/").filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : p;
  };

  const pickSessionModel = (session: SessionData): string => {
    if (session.usage_breakdown.length > 0 && session.usage_breakdown[0].model) {
      return session.usage_breakdown[0].model;
    }
    const models = Object.keys(session.model_usage ?? {});
    return models.length > 0 ? models[0] : "";
  };

  const enrichSessionHumanInputs = (session: SessionData) =>
    (session.human_inputs ?? []).map((h) => ({
      ...h,
      session_title: h.session_title ?? session.session_name,
      session_agent: h.session_agent ?? session.agent,
      session_time: h.session_time ?? session.time_range.display,
      session_model: h.session_model ?? pickSessionModel(session),
      project: h.project ?? normalizeProjectName(session.project),
    }));

  // 1. Merge all session usage_breakdown buckets
  let allBuckets: Record<string, UsageBucket> = {};
  let allRepos: RepoTouched[] = [];
  const agents = new Set<string>();
  let totalMessages: MessageStats = { user: 0, assistant: 0, tool_calls: 0 };
  let totalFilesChanged = 0;

  for (const session of sessions) {
    const sessionBuckets = bucketsToMap(session.usage_breakdown);
    allBuckets = mergeUsageBuckets(allBuckets, sessionBuckets);
    allRepos = mergeRepos(allRepos, session.repos_touched);
    agents.add(session.agent);
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
    summary: buildTopLevelSummary(date, sessions, costByCurrency),
    totals: {
      sessions: sessions.length,
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
    sessions: sessions.map(({ human_inputs: _, ...rest }) => rest),
    repos: allRepos,
    human_inputs: sessions.flatMap((s) => enrichSessionHumanInputs(s)),
  };
}
