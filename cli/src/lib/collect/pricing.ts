interface PricingEntry {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  currency: string;
}

const PRICING: Record<string, PricingEntry> = {
  // DeepSeek (¥/MTok)
  "deepseek-v4-pro":   { input: 3,  output: 6,   cache_read: 0.025, cache_write: 3,     currency: "¥" },
  "deepseek-v4-flash": { input: 1,  output: 2,   cache_read: 0.02,  cache_write: 1,     currency: "¥" },
  // Claude Opus ($/MTok)
  "claude-opus-4-8":      { input: 5,  output: 25,  cache_read: 0.50, cache_write: 6.25,  currency: "$" },
  "claude-opus-4-8-fast": { input: 10, output: 50,  cache_read: 1,    cache_write: 12.5,  currency: "$" },
  "claude-opus-4-7":      { input: 5,  output: 25,  cache_read: 0.50, cache_write: 6.25,  currency: "$" },
  "claude-opus-4-7-fast": { input: 30, output: 150, cache_read: 3,    cache_write: 37.5,  currency: "$" },
  "claude-opus-4-6":      { input: 5,  output: 25,  cache_read: 0.50, cache_write: 6.25,  currency: "$" },
  "claude-opus-4-6-fast": { input: 30, output: 150, cache_read: 3,    cache_write: 37.5,  currency: "$" },
  "claude-opus-4-5":      { input: 5,  output: 25,  cache_read: 0.50, cache_write: 6.25,  currency: "$" },
  "claude-opus-4-1":      { input: 15, output: 75,  cache_read: 1.50, cache_write: 18.75, currency: "$" },
  // Claude Sonnet ($/MTok)
  "claude-sonnet-4-7": { input: 3, output: 15, cache_read: 0.30, cache_write: 3.75, currency: "$" },
  "claude-sonnet-4-6": { input: 3, output: 15, cache_read: 0.30, cache_write: 3.75, currency: "$" },
  "claude-sonnet-4-5": { input: 3, output: 15, cache_read: 0.30, cache_write: 3.75, currency: "$" },
  // Claude Haiku ($/MTok)
  "claude-haiku-4-5":  { input: 1,    output: 5,  cache_read: 0.10, cache_write: 1.25, currency: "$" },
  "claude-haiku-3-5":  { input: 0.80, output: 4,  cache_read: 0.08, cache_write: 1,    currency: "$" },
  // Cursor Composer ($/MTok)
  "composer-2.5":      { input: 0.50, output: 2.50,  cache_read: 0, cache_write: 0, currency: "$" },
  "composer-2.5-fast": { input: 3.00, output: 15.00, cache_read: 0, cache_write: 0, currency: "$" },
  "composer-2.0":      { input: 0.50, output: 2.50,  cache_read: 0, cache_write: 0, currency: "$" },
};

/**
 * Normalize a model name to match a pricing key.
 * Handles version suffixes like "-20250514", dots vs dashes, etc.
 */
function normalizeModel(model: string): string {
  let m = model.toLowerCase().trim();
  // Strip date suffix like -20250514
  m = m.replace(/-\d{8}$/, "");
  // Replace dots with dashes in version numbers (e.g. claude-3.5-haiku -> claude-3-5-haiku)
  m = m.replace(/\./g, "-");
  return m;
}

export function matchPricing(model: string): PricingEntry | null {
  const normalized = normalizeModel(model);

  // Exact match first
  if (PRICING[normalized]) return PRICING[normalized];

  // Prefix match — longest prefix wins
  let bestKey = "";
  let bestEntry: PricingEntry | null = null;
  for (const [key, entry] of Object.entries(PRICING)) {
    if (normalized.startsWith(key) && key.length > bestKey.length) {
      bestKey = key;
      bestEntry = entry;
    }
  }
  return bestEntry;
}

export function calculateCost(
  model: string,
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  },
  opts?: { speed?: string }
): number | null {
  // Determine effective model key (fast variant if speed=fast)
  const effectiveModel = opts?.speed === "fast" ? `${model}-fast` : model;
  const pricing = matchPricing(effectiveModel) ?? matchPricing(model);
  if (!pricing) return null;

  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;

  // Cost = tokens / 1_000_000 * rate
  const cost =
    (input / 1_000_000) * pricing.input +
    (output / 1_000_000) * pricing.output +
    (cacheRead / 1_000_000) * pricing.cache_read +
    (cacheWrite / 1_000_000) * pricing.cache_write;

  return cost;
}

export function getCurrency(model: string, opts?: { speed?: string }): string {
  const effectiveModel = opts?.speed === "fast" ? `${model}-fast` : model;
  const pricing = matchPricing(effectiveModel) ?? matchPricing(model);
  return pricing?.currency ?? "$";
}
