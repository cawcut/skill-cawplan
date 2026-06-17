import { ModelUsageEntry, UsageBucket } from "../types.js";
import { calculateCost, getCurrency } from "../pricing.js";

const TOKEN_FIELDS = [
  "input_tokens",
  "output_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
] as const;

export function bucketKey(dims: {
  model: string;
  speed: string;
  service_tier: string;
  effort: string;
}): string {
  return `${dims.model}|speed=${dims.speed}|tier=${dims.service_tier}|effort=${dims.effort}`;
}

function emptyBucket(
  model: string,
  speed: string,
  service_tier: string,
  effort: string,
  currency: string
): UsageBucket {
  return {
    model,
    speed,
    service_tier,
    effort,
    api_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cost: 0,
    currency,
  };
}

function hasBillableTokens(usage: Record<string, unknown>): boolean {
  return TOKEN_FIELDS.some((field) => Number(usage[field] ?? 0) > 0);
}

function stableUsageJson(usage: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(usage).sort()) {
    sorted[key] = usage[key];
  }
  return JSON.stringify(sorted);
}

function unionAgents(a?: string[], b?: string[]): string[] | undefined {
  const all = [...(a ?? []), ...(b ?? [])];
  if (!all.length) return undefined;
  return [...new Set(all)].sort();
}

/**
 * Processes Claude Code assistant events and aggregates usage into buckets.
 * Deduplicates by message.id if present, otherwise by (timestamp, usageJSON).
 * Returns a map from bucketKey to UsageBucket.
 */
export function aggregateUsageBuckets(
  events: Record<string, unknown>[],
  agent?: string
): Record<string, UsageBucket> {
  const buckets: Record<string, UsageBucket> = {};
  const seen = new Set<string>();

  for (const event of events) {
    if (event["type"] !== "assistant") continue;

    const message = event["message"] as Record<string, unknown> | undefined;
    if (!message) continue;

    const usage = message["usage"] as Record<string, unknown> | undefined;
    if (!usage) continue;
    if (!hasBillableTokens(usage)) continue;

    const model = (message["model"] as string | undefined) ?? "";
    if (!model || model === "<synthetic>") continue;

    // Dedup key
    let dedupKey: string;
    const msgId = message["id"] as string | undefined;
    if (msgId) {
      dedupKey = msgId;
    } else {
      const ts = (event["timestamp"] as string | undefined) ?? "";
      dedupKey = `${ts}::${stableUsageJson(usage)}`;
    }

    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    // Extract dimension attributes
    const speed = (usage["speed"] as string | undefined) || "standard";
    const service_tier = (usage["service_tier"] as string | undefined) || "standard";
    const effort = (usage["effort"] as string | undefined) || (message["effort"] as string | undefined) || "default";

    const key = bucketKey({ model, speed, service_tier, effort });
    const currency = getCurrency(model, { speed });

    if (!buckets[key]) {
      buckets[key] = emptyBucket(model, speed, service_tier, effort, currency);
      if (agent) buckets[key].agents = [agent];
    }

    const bucket = buckets[key];
    const input = (usage["input_tokens"] as number) ?? 0;
    const output = (usage["output_tokens"] as number) ?? 0;
    const cacheRead = (usage["cache_read_input_tokens"] as number) ?? 0;
    const cacheWrite = (usage["cache_creation_input_tokens"] as number) ?? 0;

    bucket.api_calls += 1;
    bucket.input_tokens += input;
    bucket.output_tokens += output;
    bucket.cache_read_input_tokens += cacheRead;
    bucket.cache_creation_input_tokens += cacheWrite;

    const callCost = calculateCost(model, { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite }, { speed });
    if (callCost !== null) {
      bucket.cost = (bucket.cost as number) + callCost;
    } else if (bucket.cost === 0) {
      bucket.cost = "unknown";
    }
  }

  return buckets;
}

/**
 * Collapses per-dimension buckets into per-model totals.
 */
export function foldBucketsToModel(
  buckets: Record<string, UsageBucket>
): Record<string, ModelUsageEntry> {
  const models: Record<string, ModelUsageEntry> = {};

  for (const bucket of Object.values(buckets)) {
    const { model } = bucket;
    if (!models[model]) {
      models[model] = {
        api_calls: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cost: 0,
        currency: bucket.currency,
      };
    }
    const entry = models[model];
    entry.api_calls += bucket.api_calls;
    entry.input_tokens += bucket.input_tokens;
    entry.output_tokens += bucket.output_tokens;
    entry.cache_read_input_tokens += bucket.cache_read_input_tokens;
    entry.cache_creation_input_tokens += bucket.cache_creation_input_tokens;

    if (bucket.cost === "unknown") {
      entry.cost = "unknown";
    } else if (entry.cost !== "unknown") {
      (entry as { cost: number }).cost += bucket.cost as number;
    }
    entry.agents = unionAgents(entry.agents, bucket.agents);
  }

  return models;
}

/**
 * Merge two bucket maps — sum all numeric fields, sum pre-calculated costs.
 */
export function mergeUsageBuckets(
  a: Record<string, UsageBucket>,
  b: Record<string, UsageBucket>
): Record<string, UsageBucket> {
  const result: Record<string, UsageBucket> = {};

  for (const [key, bucket] of Object.entries(a)) {
    result[key] = { ...bucket };
  }

  for (const [key, bucket] of Object.entries(b)) {
    if (!result[key]) {
      result[key] = { ...bucket };
    } else {
      const existing = result[key];
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

  return result;
}

/**
 * Sum total cost by currency across all buckets.
 */
export function sumCostByCurrency(
  buckets: Record<string, UsageBucket>
): Record<string, number> {
  const totals: Record<string, number> = {};

  for (const bucket of Object.values(buckets)) {
    if (bucket.cost === "unknown") continue;
    const currency = bucket.currency;
    totals[currency] = (totals[currency] ?? 0) + (bucket.cost as number);
  }

  return totals;
}
