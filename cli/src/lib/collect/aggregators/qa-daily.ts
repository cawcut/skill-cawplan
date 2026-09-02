import {SessionData, UsageBucket} from "../types.js";
import {QaDailyApiJson, QaDisplayTimeRange, QaHumanInput, QaSessionData, QaSkillLayer} from "../qa-types.js";
import {
    collectSkillLayers,
    findClaudeCodeJsonlPathBySessionId,
    QaStdoutTrace,
    skillLayersFromTraces,
    tracesFromGuiToolResults,
    tracesFromToolResultStdout,
} from "../qa-trace-extract.js";
import {collectQaAssetChanges} from "../qa-asset-changes.js";
import {requirementRefsFromJsonl} from "../qa-requirement-url.js";
import {
    foldBucketsToModel,
    mergeUsageBuckets,
    normalizeModelUsageCurrency,
    normalizeUsageBucketCurrency,
    sumCostByCurrency,
} from "./tokens.js";

function qaBucketsToMap(buckets: UsageBucket[]): Record<string, UsageBucket> {
    const map: Record<string, UsageBucket> = {};
    for (const rawBucket of buckets) {
        const bucket = normalizeUsageBucketCurrency(rawBucket);
        const key = `${bucket.model}|speed=${bucket.speed}|tier=${bucket.service_tier}|effort=${bucket.effort}`;
        map[key] = map[key] ? map[key] : {...bucket};
    }
    return map;
}

/** DB column is varchar(512); truncate defensively so an oversized title can't fail the whole upload. */
const SESSION_TITLE_MAX_LEN = 512;

function truncateSessionTitle(title: string | undefined): string | undefined {
    if (!title || title.length <= SESSION_TITLE_MAX_LEN) return title;
    return title.slice(0, SESSION_TITLE_MAX_LEN);
}

function qaAgentDisplay(session: SessionData): string {
    if (session.agent === "cursor-cli" || session.agent === "cursor-gui") return session.agent;
    if (session.agent === "cursor") {
        return session.message_stats.tool_calls > 0 ? "cursor-gui" : "cursor-cli";
    }
    return session.agent;
}

// gui/cli distinction for the "cursor" umbrella agent — mirrors the coding
// aggregator's sessionSource() (daily.ts) since raw scan output only ever
// disambiguates by tool-call presence, never a dedicated field.
function qaSessionSource(session: SessionData): string {
    if (session.agent === "cursor-cli") return "cli";
    if (session.agent === "cursor-gui") return "gui";
    if (session.agent === "cursor") return session.message_stats.tool_calls > 0 ? "gui" : "cli";
    return "";
}

const r2 = (v: number) => Math.round(v * 100) / 100;

// session_cost isn't populated on the raw scan output either — it's derived
// from that session's own usage buckets, same as coding's sessionCost().
function qaSessionCost(session: SessionData): number {
    const total = session.usage_breakdown.reduce(
        (sum, bucket) => sum + normalizeUsageBucketCurrency(bucket).cost,
        0
    );
    return r2(total);
}

/**
 * session_id doubles as the Cursor GUI composerId — both the agent-transcripts
 * jsonl filename and the vscdb composerData/bubbleId rows are keyed by the
 * same id, so no separate lookup is needed to go from a cursor-gui session to
 * its vscdb trace rows.
 */
function isGuiAgent(session: SessionData): boolean {
    return session.agent === "cursor-gui" || (session.agent === "cursor" && qaSessionSource(session) === "gui");
}

/**
 * Signal-3 stdout traces (`cawplan qa-insights ...` JSON receipts) for a
 * session, keyed by data source: Claude Code reads its JSONL file,
 * Cursor GUI reads vscdb. Other agents (e.g. cursor-cli) have no trace
 * source yet — their sessions get skill_layers: [], empty requirement_ids,
 * and no auto-resolved product_id, same as before this data source existed.
 */
function resolveTraces(session: SessionData, jsonlPath: string | null | undefined, date: string): QaStdoutTrace[] {
    if (session.agent === "claude-code") {
        return jsonlPath ? tracesFromToolResultStdout(jsonlPath, date) : [];
    }
    if (isGuiAgent(session)) {
        return tracesFromGuiToolResults(session.session_id);
    }
    return [];
}

/**
 * Best-effort skill_layers extraction.
 * - Claude Code: full signal 1+2+3 union (collectSkillLayers) via its JSONL file.
 * - Cursor GUI: signal 3 only (skillLayersFromTraces) — no attributionSkill or
 *   Bash tool_use blocks to scan in vscdb.
 * - Other agents: [] until a trace adapter exists.
 */
function resolveSkillLayers(
    session: SessionData,
    jsonlPath: string | null | undefined,
    traces: QaStdoutTrace[],
    date: string,
): QaSkillLayer[] {
    if (session.agent === "claude-code") {
        return jsonlPath ? collectSkillLayers(jsonlPath, date) : [];
    }
    if (isGuiAgent(session)) {
        return skillLayersFromTraces(traces);
    }
    return [];
}

/**
 * One product per session. Tier 1 — product_id from structured stdout receipts
 * (Claude Code and Cursor GUI both feed this from their own traces[]).
 * Tier 2 — product_id parsed from a requirement URL in conversation text
 * (Claude Code only; read-only sessions that never archive). Tier 3 — leave
 * undefined for manual fill on the web page.
 */
function resolveProductId(
    session: SessionData,
    jsonlPath: string | null | undefined,
    traces: QaStdoutTrace[],
    date: string,
): string | undefined {
    const fromStdout = traces.find((t) => t.productId)?.productId;
    if (fromStdout) return fromStdout;
    if (session.agent === "claude-code" && jsonlPath) {
        return requirementRefsFromJsonl(jsonlPath, date)[0]?.productId;
    }
    return undefined;
}

/** Exclude sessions whose human inputs are only cawplan-qa-commit invocations (mirrors coding commit-only filter). */
function isQaCommitOnlySession(session: SessionData): boolean {
    const humanInputs = session.human_inputs ?? [];
    if (humanInputs.length === 0) return false;
    return humanInputs.every((input) => String(input.content ?? "").toLowerCase().includes("cawplan-qa-commit"));
}

export interface QaExcludedSession {
    session_id: string;
    agent: string;
    title?: string;
    reason: "qa-commit-only" | "no-human-input";
}

export interface QaFilterResult {
    included: Array<{
        session: SessionData;
        skillLayers: QaSkillLayer[];
        jsonlPath: string | null | undefined;
        traces: QaStdoutTrace[];
    }>;
    excluded: QaExcludedSession[];
}

/**
 * QA session noise filter — two local rules (all scanned sessions are candidates):
 * 1. Exclude commit-only sessions (cawplan-qa-commit)
 * 2. Exclude sessions with no human_input
 *
 * Excluded sessions are logged to stderr (session_id / agent / title) — never silent drops.
 *
 * jsonlPath and traces are resolved once here (not per-field later) so
 * skill_layers, product_id, requirement_ids, and testpoint counts all read
 * from the same parse of the same underlying trace source.
 */
export function filterQaSessions(sessions: SessionData[], date: string): QaFilterResult {
    const included: QaFilterResult["included"] = [];
    const excluded: QaExcludedSession[] = [];

    for (const session of sessions) {
        const title = session.session_title ?? session.session_name;
        const jsonlPath = session.agent === "claude-code"
            ? findClaudeCodeJsonlPathBySessionId(session.session_id, date)
            : null;
        const traces = resolveTraces(session, jsonlPath, date);
        const skillLayers = resolveSkillLayers(session, jsonlPath, traces, date);

        if (isQaCommitOnlySession(session)) {
            excluded.push({session_id: session.session_id, agent: session.agent, title, reason: "qa-commit-only"});
            continue;
        }
        if ((session.human_inputs ?? []).length === 0) {
            excluded.push({session_id: session.session_id, agent: session.agent, title, reason: "no-human-input"});
            continue;
        }

        included.push({session, skillLayers, jsonlPath, traces});
    }

    return {included, excluded};
}

function pickDisplayTimeRange(session: SessionData): QaDisplayTimeRange | undefined {
    const start = session.time_range?.start;
    const display = session.time_range?.display;
    if (!start && !display) return undefined;
    return {
        ...(start ? {start} : {}),
        ...(display ? {display} : {}),
    };
}

/**
 * Builds the QA daily payload and returns excluded sessions for the assignment UI.
 */
export function buildQaDailyPayload(
    sessions: SessionData[],
    date: string,
    author: string,
): {daily: QaDailyApiJson; excludedSessions: QaExcludedSession[]} {
    const {included, excluded} = filterQaSessions(sessions, date);
    if (excluded.length > 0) {
        console.error(`QA collect: excluded ${excluded.length} session(s) (commit-only or empty):`);
        for (const e of excluded) {
            console.error(`  - ${e.session_id} (${e.agent}) "${e.title ?? "untitled"}" — ${e.reason}`);
        }
    }

    const agents = new Set<string>();
    let allBuckets: Record<string, UsageBucket> = {};
    let totalMessages = {user: 0, assistant: 0, tool_calls: 0};

    for (const {session} of included) {
        agents.add(qaAgentDisplay(session));
        allBuckets = mergeUsageBuckets(allBuckets, qaBucketsToMap(session.usage_breakdown));
        totalMessages = {
            user: totalMessages.user + session.message_stats.user,
            assistant: totalMessages.assistant + session.message_stats.assistant,
            tool_calls: totalMessages.tool_calls + session.message_stats.tool_calls,
        };
    }

    const modelUsage = foldBucketsToModel(allBuckets);
    const costByCurrency = sumCostByCurrency(allBuckets);
    const usageBreakdown = Object.values(allBuckets).sort((a, b) => b.cost - a.cost);

    const qaSessions: QaSessionData[] = included.map(({session, skillLayers, jsonlPath, traces}) => {
        const assetChanges = collectQaAssetChanges(traces);
        const requirementIds = Array.from(
            new Set(traces.map((t) => t.requirementId).filter((id): id is string => Boolean(id)))
        );

        return {
            session_id: session.session_id,
            agent: qaAgentDisplay(session),
            source: session.source ?? qaSessionSource(session),
            session_title: truncateSessionTitle(session.session_title ?? session.session_name),
            product_id: session.product_id ?? resolveProductId(session, jsonlPath, traces, date),
            cwd: session.cwd,
            session_cost: session.session_cost ?? qaSessionCost(session),
            ticket_ids: session.ticket_ids ?? [],
            ticket_display_ids: session.ticket_display_ids ?? [],
            skill_layers: skillLayers,
            models: session.models ?? Object.keys(session.model_usage),
            requirement_ids: requirementIds,
            testpoint: assetChanges.testpoint,
            testcase: assetChanges.testcase,
            display_time_range: pickDisplayTimeRange(session),
        };
    });

    // Human inputs are built with an explicit object literal, never a `{...h}`
    // spread — the coding HumanInput type carries category/topic fields that
    // must never leak into the QA payload (see qa-types.ts for why QaHumanInput
    // omits them entirely rather than allowing them as optional).
    const humanInputs: QaHumanInput[] = included.flatMap(({session}) =>
        (session.human_inputs ?? []).map((h): QaHumanInput => ({
            content: h.content,
            assistant_message: h.assistant_message,
            session_id: session.session_id,
            start_time: h.start_time ?? null,
            end_time: h.end_time ?? null,
        }))
    );

    return {
        daily: {
            schema: "qa-session.1",
            date,
            author,
            generated_at: new Date().toISOString(),
            include_conversation: false,
            totals: {
                sessions: qaSessions.length,
                agents: Array.from(agents).sort(),
                messages: totalMessages,
                cost: Object.fromEntries(Object.entries(costByCurrency).map(([k, v]) => [k, r2(v)])),
            },
            usage_breakdown: usageBreakdown.map((b) => ({
                ...normalizeUsageBucketCurrency(b),
                cost: r2(normalizeUsageBucketCurrency(b).cost),
            })),
            model_usage: Object.fromEntries(
                Object.entries(modelUsage).map(([k, v]) => [k, {...normalizeModelUsageCurrency(v), cost: r2(v.cost)}])
            ),
            sessions: qaSessions,
            human_inputs: humanInputs,
        },
        excludedSessions: excluded,
    };
}

/**
 * Returns only the QA daily JSON. Excluded sessions are omitted; use
 * buildQaDailyPayload() when the assignment UI needs the supplement list.
 */
export function buildQaDailyJson(sessions: SessionData[], date: string, author: string): QaDailyApiJson {
    return buildQaDailyPayload(sessions, date, author).daily;
}

/** Strip assignment-only session fields before upload (R2 / §1.4). */
export function toQaUploadPayload(daily: QaDailyApiJson): QaDailyApiJson {
    return {
        ...daily,
        sessions: daily.sessions.map(({display_time_range: _displayTimeRange, ...session}) => session),
    };
}
