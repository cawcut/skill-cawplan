import {
    DailyApiJson,
    ModelUsageEntry,
    RepoTouched,
    SessionData,
    UsageBucket,
    MessageStats,
} from "../types.js";
import {inferHumanInputTopic} from "./human-topic.js";

function unionAgents(a?: string[], b?: string[]): string[] | undefined {
    const all = [...(a ?? []), ...(b ?? [])];
    if (!all.length) return undefined;
    return [...new Set(all)].sort();
}

import {mergeUsageBuckets, foldBucketsToModel, sumCostByCurrency} from "./tokens.js";

/**
 * Merge two RepoTouched arrays, deduplicating by repo name and summing counters.
 */
function mergeRepos(a: RepoTouched[], b: RepoTouched[]): RepoTouched[] {
    const map: Record<string, RepoTouched> = {};

    for (const repo of [...a, ...b]) {
        if (!repo.repo) continue;
        if (!map[repo.repo]) {
            map[repo.repo] = {...repo};
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
            map[key] = {...bucket};
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

function primaryBucketAgent(bucket: UsageBucket): string | undefined {
    if (bucket.agent) return bucket.agent;
    const agents = bucket.agents ?? [];
    if (agents.length === 0) return undefined;
    if (agents.includes("cursor") || agents.includes("cursor-cli") || agents.includes("cursor-gui")) {
        return "cursor";
    }
    if (agents.length === 1) return agents[0];
    return agents[0];
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
    const source = tokenSource(session);
    if (source === "dashboard_api" || source.includes("dashboard API")) return "actual";
    if (source.includes("estimate") && !source.includes("model unavailable")) return "estimate";
    return "unknown";
}

function projectBasename(value?: string | null): string {
    const raw = (value ?? "").trim();
    if (!raw) return "";
    const parts = raw.split(/[\\/]/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] ?? raw : raw;
}

function isEncodedCursorProject(value: string): boolean {
    return value.startsWith("Users-") || value.includes("-code-");
}

function readableEncodedCursorProject(value: string): string {
    const marker = "-code-";
    const idx = value.lastIndexOf(marker);
    return idx >= 0 ? value.slice(idx + marker.length) : value;
}

function sessionProjectName(session: SessionData): string {
    const repoName = projectBasename(session.repos_touched[0]?.repo);
    if (repoName) return repoName;
    const cwdName = projectBasename(session.cwd);
    if (cwdName) return cwdName;
    const project = normalizeProjectName(session.project);
    return isEncodedCursorProject(project) ? readableEncodedCursorProject(project) : project;
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

function nonEmpty(value?: string | null): string | undefined {
    const t = (value ?? "").trim();
    return t.length > 0 ? t : undefined;
}

function toLocalDateString(isoLike?: string | null): string | undefined {
    const t = (isoLike ?? "").trim();
    if (!t) return undefined;
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return undefined;
    const yyyy = d.getFullYear().toString().padStart(4, "0");
    const mm = (d.getMonth() + 1).toString().padStart(2, "0");
    const dd = d.getDate().toString().padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function isHumanInputOnDate(
    h: { start_time?: string | null; session_time?: string | null },
    targetDate: string
): boolean {
    const anchor = nonEmpty(h.start_time ?? h.session_time);
    if (!anchor) return true;
    const localDate = toLocalDateString(anchor);
    if (!localDate) return true;
    return localDate === targetDate;
}

function enrichSessionHumanInputs(session: SessionData, targetDate: string) {
    const project = sessionProjectName(session);
    const stableSessionTitle = session.session_title ?? session.title ?? session.session_name;
    return (session.human_inputs ?? [])
        .filter((h) => isHumanInputOnDate(h, targetDate))
        .map((h) => ({
            ...h,
            topic: inferHumanInputTopic({
                content: h.content,
                category: h.category,
                sessionTitle: stableSessionTitle,
                topic: h.topic,
            }),
            session_title: h.session_title ?? stableSessionTitle,
            session_agent: h.session_agent ?? agentDisplay(session),
            session_time: nonEmpty(h.session_time ?? h.start_time),
            session_model: h.session_model ?? pickSessionModel(session),
            project,
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

    const nonEmpty = (v?: string | null): string | undefined => {
        const t = (v ?? "").trim();
        return t.length > 0 ? t : undefined;
    };

    const enrichSessionHumanInputs = (session: SessionData) => {
        const stableSessionTitle = session.session_title ?? session.title ?? session.session_name;
        return (session.human_inputs ?? [])
            .filter((h) => isHumanInputOnDate(h, date))
            .map((h) => ({
                ...h,
                topic: inferHumanInputTopic({
                    content: h.content,
                    category: h.category,
                    sessionTitle: stableSessionTitle,
                    topic: h.topic,
                }),
                session_title: h.session_title ?? stableSessionTitle,
                session_agent: h.session_agent ?? session.agent,
                session_time: nonEmpty(h.session_time ?? h.start_time),
                session_model: h.session_model ?? pickSessionModel(session),
                project: h.project ?? normalizeProjectName(session.project),
                files_changed: h.files_changed ?? 0,
                lines_added: h.lines_added ?? 0,
                lines_deleted: h.lines_deleted ?? 0,
                start_time: nonEmpty(h.start_time ?? h.session_time),
                end_time: nonEmpty(h.end_time ?? h.start_time ?? h.session_time),
            }));
    };


    // 1. Merge all session usage_breakdown buckets
    let allBuckets: Record<string, UsageBucket> = {};
    let allRepos: RepoTouched[] = [];
    const agents = new Set<string>();
    let totalMessages: MessageStats = {user: 0, assistant: 0, tool_calls: 0};
    let totalFilesChanged = 0;

    for (const session of sessions) {
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
            agent: primaryBucketAgent(b),
            cost: typeof b.cost === "number" ? r2(b.cost) : b.cost,
        })),
        model_usage: Object.fromEntries(
            Object.entries(modelUsage).map(([k, v]) => [
                k,
                { ...v, cost: typeof v.cost === "number" ? r2(v.cost) : v.cost },
            ])
        ),
        sessions: sessions.map(({ human_inputs: _humanInputs, title: _legacyTitle, ...session }) => ({
            ...session,
            source: session.source ?? sessionSource(session),
            session_title: session.session_title ?? _legacyTitle ?? session.session_name,
            models: session.models ?? Object.keys(session.model_usage),
            total_tokens: session.total_tokens ?? totalTokens(session.usage_breakdown),
            session_cost: session.session_cost ?? sessionCost(session.usage_breakdown, r2),
            cost_basis: session.cost_basis ?? costBasis(session),
            token_source: session.token_source ?? tokenSource(session),
        })),
        repos: allRepos,
        human_inputs: sessions.flatMap((s) => enrichSessionHumanInputs(s)),
    };
}
