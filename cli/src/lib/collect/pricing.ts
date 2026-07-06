interface PricingEntry {
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
    currency: string;
}

export const COST_CURRENCY = "$";

const PRICING: Record<string, PricingEntry> = {

    // Claude ($/MTok - official pricing from https://platform.claude.com/docs/en/about-claude/pricing)
    "claude-fable-5": {input: 10, output: 50, cache_read: 1, cache_write: 12.50, currency: "$"},
    "claude-mythos-5": {input: 10, output: 50, cache_read: 1, cache_write: 12.50, currency: "$"},
    "claude-opus-4-8": {input: 5, output: 25, cache_read: 0.50, cache_write: 6.25, currency: "$"},
    "claude-opus-4-7": {input: 5, output: 25, cache_read: 0.50, cache_write: 6.25, currency: "$"},
    "claude-opus-4-6": {input: 5, output: 25, cache_read: 0.50, cache_write: 6.25, currency: "$"},
    "claude-opus-4-5": {input: 5, output: 25, cache_read: 0.50, cache_write: 6.25, currency: "$"},
    "claude-opus-4-1": {input: 15, output: 75, cache_read: 1.50, cache_write: 18.75, currency: "$"},
    "claude-opus-4": {input: 15, output: 75, cache_read: 1.50, cache_write: 18.75, currency: "$"},
    // Claude Sonnet 5 has temporary pricing through August 31, 2026.
    "claude-sonnet-5": {input: 2, output: 10, cache_read: 0.20, cache_write: 2.50, currency: "$"},
    "claude-sonnet-4-7": {input: 3, output: 15, cache_read: 0.30, cache_write: 3.75, currency: "$"},
    "claude-sonnet-4-6": {input: 3, output: 15, cache_read: 0.30, cache_write: 3.75, currency: "$"},
    "claude-sonnet-4-5": {input: 3, output: 15, cache_read: 0.30, cache_write: 3.75, currency: "$"},
    "claude-sonnet-4": {input: 3, output: 15, cache_read: 0.30, cache_write: 3.75, currency: "$"},
    "claude-haiku-4-5": {input: 1, output: 5, cache_read: 0.10, cache_write: 1.25, currency: "$"},
    "claude-haiku-3-5": {input: 0.80, output: 4, cache_read: 0.08, cache_write: 1, currency: "$"},

    // OpenAI ($/MTok - official pricing from https://developers.openai.com/api/docs/pricing)
    "gpt-5-5": {input: 5, output: 30, cache_read: 0.50, cache_write: 0, currency: "$"},
    "gpt-5.5": {input: 5, output: 30, cache_read: 0.50, cache_write: 0, currency: "$"},
    "gpt-5-4": {input: 2.5, output: 15, cache_read: 0.25, cache_write: 0, currency: "$"},
    "gpt-5.4": {input: 2.5, output: 15, cache_read: 0.25, cache_write: 0, currency: "$"},

    // DeepSeek ($/MTok — official pricing from https://api-docs.deepseek.com/quick_start/pricing)
    "deepseek-v4-pro": {input: 0.435, output: 0.87, cache_read: 0.003625, cache_write: 0.435, currency: "$"},
    "deepseek-v4-flash": {input: 0.14, output: 0.28, cache_read: 0.0028, cache_write: 0.14, currency: "$"},
    // Legacy aliases (deepseek-chat / deepseek-reasoner map to v4-flash;
    // deprecated 2026-07-24 per DeepSeek docs)
    "deepseek-chat": {input: 0.14, output: 0.28, cache_read: 0.0028, cache_write: 0.14, currency: "$"},
    "deepseek-reasoner": {input: 0.14, output: 0.28, cache_read: 0.0028, cache_write: 0.14, currency: "$"},

    // Cursor Composer ($/MTok - official pricing from https://cursor.com/cn/docs/models-and-pricing)
    "composer-2.5": {input: 0.50, output: 2.50, cache_read: 0, cache_write: 0, currency: "$"},
    "composer-2.5-fast": {input: 3.00, output: 15.00, cache_read: 0, cache_write: 0, currency: "$"},
    "composer-2.0": {input: 0.50, output: 2.50, cache_read: 0, cache_write: 0, currency: "$"},
};

/**
 * Normalize a model name to match a pricing key.
 * Handles version suffixes like "-20250514", dots vs dashes, etc.
 */
function normalizeModel(model: string): string {
    let m = model.toLowerCase().trim();
    // Strip date suffix like -20250514
    m = m.replace(/-\d{8}$/, "");
    // Strip context-window suffix like [1m]
    m = m.replace(/\[\d+[km]\]$/i, "");
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

    // input_tokens includes cache tokens per Anthropic API convention.
    // Bill non-cache inputs at the base rate; bill cache reads/writes at
    // their own rates to avoid double-counting.
    const billableInput = Math.max(0, input - cacheRead - cacheWrite);

    const cost =
        (billableInput / 1_000_000) * pricing.input +
        (output / 1_000_000) * pricing.output +
        (cacheRead / 1_000_000) * pricing.cache_read +
        (cacheWrite / 1_000_000) * pricing.cache_write;

    return cost;
}

