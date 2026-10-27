import { ModelUsageEntry, UsageBucket } from "../types.js";
import { calculateCost, COST_CURRENCY } from "../pricing.js";

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

export function normalizeUsageBucketCurrency(bucket: UsageBucket): UsageBucket {
  return {
    ...bucket,
    currency: COST_CURRENCY,
  };
}

export function normalizeModelUsageCurrency(entry: ModelUsageEntry): ModelUsageEntry {
  return {
    ...entry,
    currency: COST_CURRENCY,
  };
}

/**
 * Processes Claude Code assistant events and aggregates usage into buckets.
 * Deduplicates by message.id if present, otherwise by (timestamp, usageJSON).
 * Returns a map from bucketKey to UsageBucket.
 */
export function aggregateUsageBuckets(
  events: Record<string, unknown>[],
  agent?: string,
  tokenSource?: string
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
    if (!buckets[key]) {
      buckets[key] = emptyBucket(model, speed, service_tier, effort, COST_CURRENCY);
      if (agent) buckets[key].agents = [agent];
      if (tokenSource) buckets[key].token_source = tokenSource;
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
      bucket.cost += callCost;
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
    const normalizedBucket = normalizeUsageBucketCurrency(bucket);
    const { model } = normalizedBucket;
    if (!models[model]) {
      models[model] = {
        api_calls: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cost: 0,
        currency: COST_CURRENCY,
      };
    }
    const entry = models[model];
    entry.api_calls += normalizedBucket.api_calls;
    entry.input_tokens += normalizedBucket.input_tokens;
    entry.output_tokens += normalizedBucket.output_tokens;
    entry.cache_read_input_tokens += normalizedBucket.cache_read_input_tokens;
    entry.cache_creation_input_tokens += normalizedBucket.cache_creation_input_tokens;

    entry.cost += normalizedBucket.cost;
    entry.agents = unionAgents(entry.agents, normalizedBucket.agents);
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
    result[key] = normalizeUsageBucketCurrency(bucket);
  }

  for (const [key, bucket] of Object.entries(b)) {
    const normalizedBucket = normalizeUsageBucketCurrency(bucket);
    if (!result[key]) {
      result[key] = normalizedBucket;
    } else {
      const existing = result[key];
      existing.api_calls += normalizedBucket.api_calls;
      existing.input_tokens += normalizedBucket.input_tokens;
      existing.output_tokens += normalizedBucket.output_tokens;
      existing.cache_read_input_tokens += normalizedBucket.cache_read_input_tokens;
      existing.cache_creation_input_tokens += normalizedBucket.cache_creation_input_tokens;

      existing.cost += normalizedBucket.cost;
      existing.agents = unionAgents(existing.agents, normalizedBucket.agents);
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
    const normalizedBucket = normalizeUsageBucketCurrency(bucket);
    totals[COST_CURRENCY] = (totals[COST_CURRENCY] ?? 0) + normalizedBucket.cost;
  }

  return totals;
}
