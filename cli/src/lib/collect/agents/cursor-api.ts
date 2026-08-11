/**
 * Cursor API token/cost fetcher.
 *
 * Supplements cursor-gui.ts with actual token and cost data that is not stored locally.
 *
 * Auth: reads access token from (in order):
 *   1. CURSOR_ACCESS_TOKEN env var
 *   2. CURSOR_SESSION_TOKEN env var
 *   3. ItemTable key "cursorAuth/accessToken" in state.vscdb (same SQLite as cursor-gui)
 *   The token is decoded as a JWT to extract the userId, then composed into a session cookie.
 *
 * Endpoint: POST https://cursor.com/api/dashboard/get-filtered-usage-events
 *   Paginates (500 events/page) over a time range to fetch all usage events.
 *   Each event contains: model, tokenUsage (inputTokens / outputTokens / cacheTokens),
 *   chargedCents (actual billed amount in cents).
 *
 * If no token is available, this module throws and collect() treats it as a non-fatal warning.
 */
import {request} from "node:https";
import {existsSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {HumanInput, ModelUsageEntry, UsageBucket} from "../types.js";
import {cursorStateDbCandidates} from "../paths.js";
import {isTimestampOnLocalDate, dayBoundsMs} from "../date-utils.js";
import {calculateCost, COST_CURRENCY} from "../pricing.js";

const PAGE_SIZE = 500;
const DEFAULT_CURSOR_API_TIMEOUT_MS = 30_000;
const MAX_ASSIGN_DISTANCE_MS = 2 * 60 * 60 * 1000; // 2h
const CHARS_PER_TOKEN = 4;
/** Gap between dashboard usage events that starts a new billing burst. */
export const BILLING_BURST_GAP_MS = 5 * 60 * 1000;
/** Keep composer exact times when attributed billing events are within this span. */
export const EXACT_ATTRIBUTED_EVENT_TOLERANCE_MS = 2 * 60 * 1000;

function parseEventTimestampMs(event: Record<string, unknown>): number | null {
    const raw = event["timestamp"] ?? event["createdAt"] ?? event["time"];
    if (raw == null) return null;

    if (typeof raw === "number") {
        if (!Number.isFinite(raw)) return null;
        // Heuristic: seconds vs milliseconds
        return raw < 1e12 ? Math.trunc(raw * 1000) : Math.trunc(raw);
    }

    if (typeof raw === "string") {
        const s = raw.trim();
        if (!s) return null;
        if (/^\d+(\.\d+)?$/.test(s)) {
            const n = Number(s);
            if (!Number.isFinite(n)) return null;
            return n < 1e12 ? Math.trunc(n * 1000) : Math.trunc(n);
        }
        const d = new Date(s);
        const ms = d.getTime();
        return Number.isNaN(ms) ? null : ms;
    }

    return null;
}

/**
 * Read the Cursor access token from env or the state.vscdb SQLite database.
 */
export function readCursorAccessToken(): string | null {
    // Check environment first
    const envToken = process.env.CURSOR_ACCESS_TOKEN;
    if (envToken) return envToken;

    // Try reading from the state.vscdb using synchronous require
    const candidates = cursorStateDbCandidates();
    for (const dbPath of candidates) {
        if (!existsSync(dbPath)) continue;
        try {
            const db = new DatabaseSync(dbPath, {readOnly: true});
            const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get("cursorAuth/accessToken") as {
                value: string
            } | undefined;
            db.close();
            if (row?.value) return row.value;
        } catch {
            // try next candidate
        }
    }
    return null;
}

/**
 * Decode a JWT payload without verification.
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
    const parts = jwt.split(".");
    if (parts.length < 2) return {};
    try {
        const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
        return JSON.parse(Buffer.from(padded, "base64").toString("utf-8")) as Record<string, unknown>;
    } catch {
        return {};
    }
}

/**
 * Build the Cursor session cookie string for API authentication.
 */
export function buildSessionCookie(): { cookie: string; userId: string } {
    // Check env override
    const envSession = process.env.CURSOR_SESSION_TOKEN;
    if (envSession) {
        // Extract userId from token
        const match = envSession.match(/user_[A-Za-z0-9]+/);
        const userId = match ? match[0] : "unknown";
        return {cookie: envSession, userId};
    }

    // Try to read access token and decode JWT
    // Note: readCursorAccessToken uses a sync DB call wrapper via require trick
    const dbCandidates = cursorStateDbCandidates();
    let token: string | null = process.env.CURSOR_ACCESS_TOKEN ?? null;

    if (!token) {
        for (const dbPath of dbCandidates) {
            if (!existsSync(dbPath)) continue;
            try {
                const db = new DatabaseSync(dbPath, {readOnly: true});
                const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get("cursorAuth/accessToken") as {
                    value: string
                } | undefined;
                db.close();
                if (row?.value) {
                    token = row.value;
                    break;
                }
            } catch {
                // try next
            }
        }
    }

    if (!token) {
        throw new Error("No Cursor access token found. Set CURSOR_ACCESS_TOKEN or CURSOR_SESSION_TOKEN env var.");
    }

    const payload = decodeJwtPayload(token);
    const subStr = (payload["sub"] as string | undefined) ?? "";

    // Try to extract user_XXXX pattern
    const match = subStr.match(/user_[A-Za-z0-9]+/) ?? token.match(/user_[A-Za-z0-9]+/);
    const userId = match ? match[0] : subStr || "unknown";

    const cookie = `${userId}::${token}`;
    return {cookie, userId};
}

function positiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function cursorApiTimeoutMs(): number {
    return positiveIntEnv("CAWPLAN_CURSOR_API_TIMEOUT_MS", DEFAULT_CURSOR_API_TIMEOUT_MS);
}

function httpsPost(
    url: string,
    body: Record<string, unknown>,
    headers: Record<string, string>
): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const bodyStr = JSON.stringify(body);
        const timeoutMs = cursorApiTimeoutMs();
        const options = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(bodyStr),
                ...headers,
            },
        };

        const req = request(options, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
                const raw = Buffer.concat(chunks).toString("utf-8");
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`Cursor API HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
                    return;
                }
                try {
                    const data = JSON.parse(raw) as unknown;
                    resolve(data);
                } catch (e) {
                    reject(new Error(`Failed to parse response: ${(e as Error).message}`));
                }
            });
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Cursor API request timed out after ${Math.round(timeoutMs / 1000)}s`));
        });
        req.on("error", reject);
        req.write(bodyStr);
        req.end();
    });
}

/**
 * Fetch all usage events from the Cursor dashboard API for a time range.
 * Paginates until all events are retrieved.
 */
export async function fetchUsageEvents(
    startMs: number,
    endMs: number,
    cookie: string
): Promise<Record<string, unknown>[]> {
    const allEvents: Record<string, unknown>[] = [];
    let page = 1;

    while (true) {
        // uid-team-skills compatible payload shape
        const body = {
            startDate: String(startMs),
            endDate: String(endMs),
            pageSize: PAGE_SIZE,
            page,
        };

        const data = await httpsPost(
            "https://cursor.com/api/dashboard/get-filtered-usage-events",
            body,
            {
                // Keep both cookie forms for compatibility across API versions.
                Cookie: `WorkosCursorSessionToken=${cookie}; WorkosCursorSessionTokenSecure=${cookie}`,
                "User-Agent": "cawplan-cli/1.0",
                Origin: "https://cursor.com",
            }
        ) as Record<string, unknown>;

        // Cursor API has changed field names across versions.
        const events =
            (data["events"] as Record<string, unknown>[] | undefined) ??
            (data["usageEventsDisplay"] as Record<string, unknown>[] | undefined) ??
            [];
        if (!events || events.length === 0) break;

        allEvents.push(...events);

        const total = Number(data["totalUsageEventsCount"] ?? data["total"] ?? 0);
        if ((total > 0 && allEvents.length >= total) || events.length < PAGE_SIZE) break;
        page++;
    }

    return allEvents;
}

/**
 * Aggregate Cursor usage events by model for a given date (local timezone).
 */
export function aggregateCursorUsage(
    events: Record<string, unknown>[],
    date: string
): {
    totalCost: number;
    currency: string;
    byModel: Record<string, ModelUsageEntry>;
} {
    const byModel: Record<string, ModelUsageEntry> = {};
    let totalCost = 0;

    for (const event of events) {
        const tsMs = parseEventTimestampMs(event);
        if (tsMs == null) continue;
        if (!isTimestampOnLocalDate(tsMs, date)) continue;

        const model = (event["model"] as string | undefined) ?? "unknown";
        const tokenUsage = event["tokenUsage"] as Record<string, unknown> | undefined;

        const inputTokens = (tokenUsage?.["inputTokens"] as number) ?? 0;
        const outputTokens = (tokenUsage?.["outputTokens"] as number) ?? 0;
        const cacheReadTokens = (tokenUsage?.["cacheReadTokens"] as number) ?? 0;
        const cacheWriteTokens = (tokenUsage?.["cacheWriteTokens"] as number) ?? 0;

        // Cost from chargedCents (convert from cents to dollars)
        const chargedCents = (event["chargedCents"] as number) ?? 0;
        const costUsd = chargedCents / 100;

        if (!byModel[model]) {
            byModel[model] = {
                api_calls: 0,
                input_tokens: 0,
                output_tokens: 0,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
                cost: 0,
                currency: COST_CURRENCY,
            };
        }

        const entry = byModel[model];
        entry.api_calls += 1;
        entry.input_tokens += inputTokens;
        entry.output_tokens += outputTokens;
        entry.cache_read_input_tokens += cacheReadTokens;
        entry.cache_creation_input_tokens += cacheWriteTokens;
        (entry as { cost: number }).cost += costUsd;

        totalCost += costUsd;
    }

    // If no chargedCents data, try to calculate from tokens
    for (const [model, entry] of Object.entries(byModel)) {
        if (entry.cost === 0 && entry.input_tokens + entry.output_tokens > 0) {
            const calculated = calculateCost(model, {
                input_tokens: entry.input_tokens,
                output_tokens: entry.output_tokens,
                cache_read_input_tokens: entry.cache_read_input_tokens,
                cache_creation_input_tokens: entry.cache_creation_input_tokens,
            });
            if (calculated !== null) {
                entry.cost = calculated;
                totalCost += calculated;
            }
        }
    }

    return { totalCost, currency: COST_CURRENCY, byModel };
}


interface AttributionWindow {
    sessionId: string;
    agent: string;
    startMs: number;
    endMs: number;
    humanInputIndex?: number;
    incrementalInputTokens?: number;
}

export interface SessionUsageAttribution {
    modelUsage: Record<string, ModelUsageEntry>;
    usageBreakdown: UsageBucket[];
    humanInputCosts?: Record<number, number>;
    humanInputApiCalls?: Record<number, number>;
}

function parseIsoMs(value?: string | null): number | null {
    if (!value?.trim()) return null;
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
}

function estimateIncrementalInputTokens(input: {content?: unknown}): number | undefined {
    const content = typeof input.content === "string" ? input.content.trim() : "";
    if (!content) return undefined;
    return Math.max(1, Math.ceil(content.length / CHARS_PER_TOKEN));
}

/**
 * Build attribution windows from human-input prompt times when available.
 * Each prompt owns API events from its start until the next prompt (half-open interval).
 * Falls back to session time_range when prompts lack timestamps.
 */
export function buildCursorAttributionWindows(
    sessions: Array<{
        session_id: string;
        agent: string;
        time_range: { start?: string; display: string };
        human_inputs?: Array<{
            content?: unknown;
            start_time?: string | null;
            end_time?: string | null;
            session_time?: string | null;
        }>;
    }>,
    date: string
): AttributionWindow[] {
    const {endMs: dayEndMs} = dayBoundsMs(date);
    const windows: AttributionWindow[] = [];

    for (const s of sessions) {
        const prompts = (s.human_inputs ?? [])
            .map((h, index) => ({
                index,
                startMs: parseIsoMs(h.start_time ?? h.session_time),
                endMs: parseIsoMs(h.end_time),
                incrementalInputTokens: estimateIncrementalInputTokens(h),
            }))
            .filter((p): p is { index: number; startMs: number; endMs: number | null; incrementalInputTokens: number | undefined } => p.startMs != null)
            .sort((a, b) => a.startMs - b.startMs);

        if (prompts.length > 0) {
            // Bursts with identical startMs share one window; last index in the burst is credited.
            const segments: Array<{ startMs: number; humanInputIndex: number; endMsHint: number | null; incrementalInputTokens?: number }> = [];
            for (const p of prompts) {
                const last = segments[segments.length - 1];
                if (last && last.startMs === p.startMs) {
                    last.humanInputIndex = p.index;
                    last.incrementalInputTokens = p.incrementalInputTokens;
                    if (p.endMs != null && (last.endMsHint == null || p.endMs > last.endMsHint)) {
                        last.endMsHint = p.endMs;
                    }
                } else {
                    segments.push({
                        startMs: p.startMs,
                        humanInputIndex: p.index,
                        endMsHint: p.endMs,
                        incrementalInputTokens: p.incrementalInputTokens,
                    });
                }
            }

            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                const nextStart = segments[i + 1]?.startMs;
                let endMs: number;
                if (nextStart != null) {
                    endMs = nextStart;
                } else if (seg.endMsHint != null && seg.endMsHint > seg.startMs) {
                    endMs = Math.min(seg.endMsHint, dayEndMs);
                } else {
                    endMs = dayEndMs;
                }
                if (endMs <= seg.startMs) {
                    endMs = Math.min(seg.startMs + MAX_ASSIGN_DISTANCE_MS, dayEndMs);
                }
                windows.push({
                    sessionId: s.session_id,
                    agent: s.agent,
                    startMs: seg.startMs,
                    endMs,
                    humanInputIndex: seg.humanInputIndex,
                    incrementalInputTokens: seg.incrementalInputTokens,
                });
            }
            continue;
        }

        const startMs = parseIsoMs(s.time_range.start);
        if (startMs == null) continue;
        const start = new Date(startMs);
        const end = parseDisplayEndFromStart(start, s.time_range.display);
        windows.push({
            sessionId: s.session_id,
            agent: s.agent,
            startMs,
            endMs: Math.max(end.getTime(), startMs + 1),
        });
    }
    return windows;
}

interface SessionWindow {
    sessionId: string;
    agent: string;
    startMs: number;
    endMs: number;
}

function parseDisplayEndFromStart(start: Date, display: string | undefined): Date {
    if (!display || !display.includes("-")) return new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const m = display.match(/(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/);
    if (!m) return new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const end = new Date(start);
    end.setHours(Number(m[3]), Number(m[4]), 0, 0);
    if (end.getTime() < start.getTime()) {
        end.setTime(end.getTime() + 24 * 60 * 60 * 1000);
    }
    return end;
}

export function buildCursorSessionWindows(
    sessions: Array<{
        session_id: string;
        agent: string;
        time_range: { start?: string; display: string };
    }>
): SessionWindow[] {
    return buildCursorAttributionWindows(sessions, "").map(({sessionId, agent, startMs, endMs}) => ({
        sessionId,
        agent,
        startMs,
        endMs,
    }));
}

function eventInsideWindow(tsMs: number, w: AttributionWindow): boolean {
    if (w.humanInputIndex != null) {
        return tsMs >= w.startMs && tsMs < w.endMs;
    }
    return tsMs >= w.startMs && tsMs <= w.endMs;
}

function assignEventToAttributionWindow(
    tsMs: number,
    windows: AttributionWindow[]
): AttributionWindow | null {
    const inside = windows.filter((w) => eventInsideWindow(tsMs, w));
    if (inside.length > 0) {
        inside.sort((a, b) => {
            const spanA = a.endMs - a.startMs;
            const spanB = b.endMs - b.startMs;
            if (spanA !== spanB) return spanA - spanB;
            return Math.abs(tsMs - a.startMs) - Math.abs(tsMs - b.startMs);
        });
        return inside[0];
    }

    let best: { window: AttributionWindow; dist: number } | null = null;
    for (const w of windows) {
        const dist = Math.min(Math.abs(tsMs - w.startMs), Math.abs(tsMs - w.endMs));
        if (dist > MAX_ASSIGN_DISTANCE_MS) continue;
        if (!best || dist < best.dist) best = {window: w, dist};
    }
    return best?.window ?? null;
}

export function aggregateCursorUsageBySession(
    events: Record<string, unknown>[],
    date: string,
    windows: AttributionWindow[] | SessionWindow[]
): Record<string, SessionUsageAttribution> {
    const perSession = new Map<string, Map<string, ModelUsageEntry>>();
    const humanInputCosts = new Map<string, Record<number, number>>();
    const humanInputApiCalls = new Map<string, Record<number, number>>();
    const creditedIncrementalInput = new Set<string>();

    for (const event of events) {
        const tsMs = parseEventTimestampMs(event);
        if (tsMs == null) continue;
        if (!isTimestampOnLocalDate(tsMs, date)) continue;

        const window = assignEventToAttributionWindow(tsMs, windows as AttributionWindow[]);
        if (!window) continue;
        const sid = window.sessionId;

        const model = String(event["model"] ?? "unknown");
        const tokenUsage = (event["tokenUsage"] as Record<string, unknown> | undefined) ?? {};
        const chargedCents = Number(event["chargedCents"] ?? 0);
        const costUsd = chargedCents / 100;
        const rawInputTokens = Number(tokenUsage["inputTokens"] ?? 0);
        const rawCacheReadTokens = Number(tokenUsage["cacheReadTokens"] ?? 0);
        const rawCacheWriteTokens = Number(tokenUsage["cacheWriteTokens"] ?? 0);
        const usesIncrementalInputEstimate =
            window.humanInputIndex != null &&
            typeof window.incrementalInputTokens === "number";
        const promptCreditKey = usesIncrementalInputEstimate
            ? `${sid}:${window.humanInputIndex}`
            : "";
        const inputTokens = usesIncrementalInputEstimate
            ? (
                creditedIncrementalInput.has(promptCreditKey)
                    ? 0
                    : rawInputTokens > 0
                        ? Math.min(rawInputTokens, window.incrementalInputTokens!)
                        : window.incrementalInputTokens!
            )
            : rawInputTokens;
        const cacheReadTokens = usesIncrementalInputEstimate ? 0 : rawCacheReadTokens;
        const cacheWriteTokens = usesIncrementalInputEstimate ? 0 : rawCacheWriteTokens;
        if (usesIncrementalInputEstimate) creditedIncrementalInput.add(promptCreditKey);

        if (!perSession.has(sid)) perSession.set(sid, new Map());
        const byModel = perSession.get(sid)!;
        if (!byModel.has(model)) {
            byModel.set(model, {
                api_calls: 0,
                input_tokens: 0,
                output_tokens: 0,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
                cost: 0,
                currency: COST_CURRENCY,
                note: usesIncrementalInputEstimate
                    ? "Cursor Dashboard cost with daily incremental input token estimate"
                    : "dashboard API human-input window attribution",
                token_source: usesIncrementalInputEstimate
                    ? "dashboard API cost + daily incremental token estimate"
                    : "dashboard_api",
            });
        }

        const entry = byModel.get(model)!;
        entry.api_calls += 1;
        entry.input_tokens += inputTokens;
        entry.output_tokens += Number(tokenUsage["outputTokens"] ?? 0);
        entry.cache_read_input_tokens += cacheReadTokens;
        entry.cache_creation_input_tokens += cacheWriteTokens;
        (entry as { cost: number }).cost += costUsd;

        if (window.humanInputIndex != null) {
            const idx = window.humanInputIndex;
            const costs = humanInputCosts.get(sid) ?? {};
            costs[idx] = (costs[idx] ?? 0) + costUsd;
            humanInputCosts.set(sid, costs);
            const calls = humanInputApiCalls.get(sid) ?? {};
            calls[idx] = (calls[idx] ?? 0) + 1;
            humanInputApiCalls.set(sid, calls);
        }
    }

    const out: Record<string, SessionUsageAttribution> = {};
    for (const [sid, byModel] of perSession.entries()) {
        const modelUsage: Record<string, ModelUsageEntry> = {};
        const usageBreakdown: UsageBucket[] = [];
        for (const [model, entry] of byModel.entries()) {
            modelUsage[model] = entry;
            usageBreakdown.push({
                ...entry,
                model,
                speed: "standard",
                service_tier: "api",
                effort: "default",
                agents: ["cursor", "cursor-gui"],
            });
        }
        out[sid] = {
            modelUsage,
            usageBreakdown,
            humanInputCosts: humanInputCosts.get(sid),
            humanInputApiCalls: humanInputApiCalls.get(sid),
        };
    }
    return out;
}

export interface BillingBurst {
    startMs: number;
    endMs: number;
    eventCount: number;
    chargedCents: number;
}

/** Exported for unit tests. */
export function clusterUsageEventsIntoBursts(
    events: Record<string, unknown>[],
    gapMs = BILLING_BURST_GAP_MS
): BillingBurst[] {
    const sorted = events
        .map((event) => ({event, tsMs: parseEventTimestampMs(event)}))
        .filter((row): row is { event: Record<string, unknown>; tsMs: number } => row.tsMs != null)
        .sort((a, b) => a.tsMs - b.tsMs);

    const bursts: BillingBurst[] = [];
    let current: Array<{ event: Record<string, unknown>; tsMs: number }> = [];

    const flush = (): void => {
        if (!current.length) return;
        const chargedCents = current.reduce((sum, row) => sum + Number(row.event["chargedCents"] ?? 0), 0);
        bursts.push({
            startMs: current[0].tsMs,
            endMs: current[current.length - 1].tsMs,
            eventCount: current.length,
            chargedCents,
        });
        current = [];
    };

    for (const row of sorted) {
        if (current.length && row.tsMs - current[current.length - 1].tsMs > gapMs) {
            flush();
        }
        current.push(row);
    }
    flush();
    return bursts;
}

function sessionActivityBoundsMs(session: {
    time_range: { start?: string; display: string };
}): { startMs: number; endMs: number } | null {
    const startMs = parseIsoMs(session.time_range.start);
    if (startMs == null) return null;
    const end = parseDisplayEndFromStart(new Date(startMs), session.time_range.display);
    return {startMs, endMs: Math.max(end.getTime(), startMs + 1)};
}

/** Exported for unit tests. */
export function partitionUsageEventsBySession(
    events: Record<string, unknown>[],
    sessions: Array<{
        session_id: string;
        time_range: { start?: string; display: string };
    }>,
    date: string
): Map<string, Record<string, unknown>[]> {
    const perSession = new Map<string, Record<string, unknown>[]>();

    for (const event of events) {
        const tsMs = parseEventTimestampMs(event);
        if (tsMs == null || !isTimestampOnLocalDate(tsMs, date)) continue;

        let best: { sessionId: string; span: number } | null = null;
        for (const session of sessions) {
            const bounds = sessionActivityBoundsMs(session);
            if (!bounds || tsMs < bounds.startMs || tsMs > bounds.endMs) continue;
            const span = bounds.endMs - bounds.startMs;
            if (!best || span < best.span) {
                best = {sessionId: session.session_id, span};
            }
        }
        if (!best) continue;

        const list = perSession.get(best.sessionId) ?? [];
        list.push(event);
        perSession.set(best.sessionId, list);
    }

    return perSession;
}

/** File/line edits from transcript tool stats (available before billing attribution). */
export function humanInputFileActivityWeight(h: HumanInput): number {
    return (h.files_changed ?? 0) + (h.lines_added ?? 0) + (h.lines_deleted ?? 0);
}

/** Includes api_calls after attribution; used for reporting only, not burst placement. */
export function humanInputBillingActivityWeight(h: HumanInput): number {
    return humanInputFileActivityWeight(h) + (h.api_calls ?? 0);
}

function hasFileActivity(h: HumanInput): boolean {
    return humanInputFileActivityWeight(h) > 0;
}

function chargedBurstIndices(bursts: BillingBurst[]): number[] {
    const charged = bursts
        .map((burst, index) => ({burst, index}))
        .filter(({burst}) => burst.chargedCents > 0 || burst.eventCount > 0)
        .map(({index}) => index);
    return charged.length > 0 ? charged : bursts.map((_, index) => index);
}

function assignBurstToInput(
    next: HumanInput[],
    index: number,
    burst: BillingBurst
): void {
    const startIso = new Date(burst.startMs).toISOString();
    const endIso = new Date(burst.endMs).toISOString();
    next[index] = {
        ...next[index],
        start_time: startIso,
        end_time: endIso,
        session_time: startIso,
        time_precision: "inferred_from_billing",
    };
}

function inputSequenceOrder(h: HumanInput, fallbackIndex: number): number {
    return h.sequence_index ?? fallbackIndex;
}

function isBillingRefinable(h: HumanInput, rematchInferred: boolean): boolean {
    if (h.time_precision === "exact") return false;
    if (h.time_precision === "inferred_from_billing" && !rematchInferred) return false;
    return true;
}

function sequenceSpanFromRefinable(refinable: Array<{ order: number }>): {
    minOrder: number;
    span: number;
} {
    const orders = refinable.map((row) => row.order);
    const minOrder = Math.min(...orders);
    const maxOrder = Math.max(...orders);
    return {minOrder, span: Math.max(maxOrder - minOrder, 1)};
}

/** Map composer sequence_index position to a billable burst index (monotonic). */
export function burstPosForSequenceOrder(
    order: number,
    minOrder: number,
    span: number,
    billableBurstCount: number,
    lastBurstPos = 0
): number {
    if (billableBurstCount <= 1) return 0;
    const ratio = (order - minOrder) / span;
    const targetPos = Math.min(Math.round(ratio * (billableBurstCount - 1)), billableBurstCount - 1);
    return Math.max(lastBurstPos, targetPos);
}

/** Exported for unit tests. */
export function refineSessionHumanInputsFromBillingBursts(
    humanInputs: HumanInput[],
    bursts: BillingBurst[],
    rematchInferred = false
): HumanInput[] {
    if (!humanInputs.length || !bursts.length) return humanInputs;

    const refinable = humanInputs
        .map((h, index) => ({
            h,
            index,
            weight: humanInputFileActivityWeight(h),
            order: inputSequenceOrder(h, index),
        }))
        .filter(({h}) => isBillingRefinable(h, rematchInferred));

    if (!refinable.length) return humanInputs;

    const next = humanInputs.map((h) => ({...h}));
    const billableBurstIdx = chargedBurstIndices(bursts);
    const {minOrder, span} = sequenceSpanFromRefinable(refinable);

    const active = refinable
        .filter(({weight}) => weight > 0)
        .sort((a, b) => a.order - b.order);
    const passive = refinable
        .filter(({weight}) => weight === 0)
        .sort((a, b) => a.order - b.order);

    const activeBurstPosByInput = new Map<number, number>();
    if (active.length > 0) {
        let lastBurstPos = 0;

        for (const row of active) {
            const burstPos = burstPosForSequenceOrder(
                row.order,
                minOrder,
                span,
                billableBurstIdx.length,
                lastBurstPos
            );
            lastBurstPos = burstPos;
            activeBurstPosByInput.set(row.index, billableBurstIdx[burstPos]);
            assignBurstToInput(next, row.index, bursts[billableBurstIdx[burstPos]]);
        }
    }

    const anchored = refinable
        .filter(({index}) => activeBurstPosByInput.has(index))
        .sort((a, b) => a.order - b.order);

    let lastPassiveBurstPos = 0;
    for (const row of passive) {
        let prev: { burstIndex: number; order: number } | null = null;
        let nextAnchor: { burstIndex: number; order: number } | null = null;

        for (const candidate of anchored) {
            const burstIndex = activeBurstPosByInput.get(candidate.index);
            if (burstIndex == null) continue;
            if (candidate.order < row.order && (!prev || candidate.order > prev.order)) {
                prev = {burstIndex, order: candidate.order};
            }
        }
        for (const candidate of anchored) {
            const burstIndex = activeBurstPosByInput.get(candidate.index);
            if (burstIndex == null) continue;
            if (candidate.order > row.order && (!nextAnchor || candidate.order < nextAnchor.order)) {
                nextAnchor = {burstIndex, order: candidate.order};
            }
        }

        let burstIndex: number;
        if (prev && nextAnchor && nextAnchor.order > prev.order) {
            const t = (row.order - prev.order) / (nextAnchor.order - prev.order);
            burstIndex = Math.round(prev.burstIndex + t * (nextAnchor.burstIndex - prev.burstIndex));
            burstIndex = Math.max(prev.burstIndex, Math.min(burstIndex, nextAnchor.burstIndex));
        } else if (prev && !nextAnchor) {
            burstIndex = Math.min(bursts.length - 1, prev.burstIndex + 1);
        } else if (!prev && nextAnchor) {
            burstIndex = Math.max(0, nextAnchor.burstIndex - 1);
        } else {
            const posInBillable = burstPosForSequenceOrder(
                row.order,
                minOrder,
                span,
                billableBurstIdx.length,
                lastPassiveBurstPos
            );
            lastPassiveBurstPos = posInBillable;
            burstIndex = billableBurstIdx[posInBillable];
        }

        assignBurstToInput(next, row.index, bursts[burstIndex]);
    }

    return next;
}

/** Exported for unit tests. */
export function mapAttributedEventTimesByHumanInput(
    events: Record<string, unknown>[],
    date: string,
    windows: AttributionWindow[]
): Map<string, Map<number, number[]>> {
    const out = new Map<string, Map<number, number[]>>();

    for (const event of events) {
        const tsMs = parseEventTimestampMs(event);
        if (tsMs == null || !isTimestampOnLocalDate(tsMs, date)) continue;

        const window = assignEventToAttributionWindow(tsMs, windows);
        if (window?.humanInputIndex == null) continue;

        let perSession = out.get(window.sessionId);
        if (!perSession) {
            perSession = new Map();
            out.set(window.sessionId, perSession);
        }
        const list = perSession.get(window.humanInputIndex) ?? [];
        list.push(tsMs);
        perSession.set(window.humanInputIndex, list);
    }

    return out;
}

function findSequenceNeighbors(
    order: number,
    anchored: Array<{ order: number; startMs: number; endMs: number }>
): { prev: { order: number; startMs: number; endMs: number } | null; next: { order: number; startMs: number; endMs: number } | null } {
    let prev: { order: number; startMs: number; endMs: number } | null = null;
    let next: { order: number; startMs: number; endMs: number } | null = null;

    for (const row of anchored) {
        if (row.order < order && (!prev || row.order > prev.order)) prev = row;
    }
    for (const row of anchored) {
        if (row.order > order && (!next || row.order < next.order)) next = row;
    }

    return {prev, next};
}

/** Exported for unit tests. */
export function shouldPreserveExactHumanInputTime(
    h: HumanInput,
    eventTimesMs: number[],
    toleranceMs = EXACT_ATTRIBUTED_EVENT_TOLERANCE_MS
): boolean {
    if (h.time_precision !== "exact" || !eventTimesMs.length) return false;
    const bubbleStart = parseIsoMs(h.start_time ?? h.session_time);
    if (bubbleStart == null) return false;
    return eventTimesMs.some((ts) => Math.abs(ts - bubbleStart) <= toleranceMs);
}

/**
 * Second pass: snap human-input times to dashboard events that were attributed
 * to each prompt, then interpolate passive prompts between event-anchored neighbors.
 */
export function refineHumanInputsFromAttributedEvents(
    sessions: Array<{
        session_id: string;
        agent: string;
        human_inputs?: HumanInput[];
    }>,
    events: Record<string, unknown>[],
    date: string,
    windows: AttributionWindow[]
): void {
    const cursorSessions = sessions.filter((s) => s.agent === "cursor-gui" || s.agent === "cursor-cli");
    if (!cursorSessions.length || !events.length || !windows.length) return;

    const eventTimes = mapAttributedEventTimesByHumanInput(events, date, windows);

    for (const session of cursorSessions) {
        if (!session.human_inputs?.length) continue;
        const perInput = eventTimes.get(session.session_id);
        if (!perInput) continue;

        const next = session.human_inputs.map((h) => ({...h}));
        const anchored: Array<{ index: number; order: number; startMs: number; endMs: number }> = [];

        for (let i = 0; i < next.length; i++) {
            const times = perInput.get(i);
            if (!times?.length) continue;

            const min = Math.min(...times);
            const max = Math.max(...times);
            const row = next[i];

            if (shouldPreserveExactHumanInputTime(row, times)) {
                const bubbleStart = parseIsoMs(row.start_time ?? row.session_time) ?? min;
                const bubbleEnd = parseIsoMs(row.end_time) ?? bubbleStart;
                const endMs = Math.max(bubbleEnd, max);
                next[i] = {
                    ...row,
                    start_time: new Date(bubbleStart).toISOString(),
                    end_time: new Date(endMs).toISOString(),
                    session_time: new Date(bubbleStart).toISOString(),
                    time_precision: "exact",
                };
                anchored.push({
                    index: i,
                    order: inputSequenceOrder(next[i], i),
                    startMs: bubbleStart,
                    endMs: endMs,
                });
                continue;
            }

            const startIso = new Date(min).toISOString();
            const endIso = new Date(max).toISOString();
            next[i] = {
                ...row,
                start_time: startIso,
                end_time: endIso,
                session_time: startIso,
                time_precision: "inferred_from_attributed_events",
            };
            anchored.push({
                index: i,
                order: inputSequenceOrder(next[i], i),
                startMs: min,
                endMs: max,
            });
        }

        anchored.sort((a, b) => a.order - b.order);

        for (let i = 0; i < next.length; i++) {
            const h = next[i];
            if (perInput.get(i)?.length || h.time_precision === "exact") continue;
            if (h.time_precision !== "approximate" && h.time_precision !== "inferred_from_billing") continue;

            const order = inputSequenceOrder(h, i);
            const {prev, next: nextAnchor} = findSequenceNeighbors(order, anchored);
            let startMs: number | null = null;
            let endMs: number | null = null;

            if (prev && nextAnchor && nextAnchor.order > prev.order) {
                const t = (order - prev.order) / (nextAnchor.order - prev.order);
                startMs = Math.round(prev.startMs + t * (nextAnchor.startMs - prev.startMs));
                endMs = Math.round(prev.endMs + t * (nextAnchor.endMs - prev.endMs));
            } else if (prev) {
                startMs = prev.startMs;
                endMs = prev.endMs;
            } else if (nextAnchor) {
                startMs = nextAnchor.startMs;
                endMs = nextAnchor.endMs;
            }

            if (startMs == null || endMs == null) continue;

            const startIso = new Date(startMs).toISOString();
            const endIso = new Date(Math.max(endMs, startMs)).toISOString();
            next[i] = {
                ...h,
                start_time: startIso,
                end_time: endIso,
                session_time: startIso,
                time_precision: "inferred_from_billing",
            };
        }

        session.human_inputs = next;
    }
}

/** @deprecated Use refineHumanInputsFromAttributedEvents */
export function snapHumanInputsToAttributedBillingEvents(
    sessions: Array<{
        session_id: string;
        agent: string;
        time_range: { start?: string; display: string };
        human_inputs?: HumanInput[];
    }>,
    events: Record<string, unknown>[],
    date: string
): void {
    const cursorSessions = sessions.filter((s) => s.agent === "cursor-gui" || s.agent === "cursor-cli");
    if (!cursorSessions.length || !events.length) return;

    const partitioned = partitionUsageEventsBySession(events, cursorSessions, date);
    for (const session of cursorSessions) {
        if (!session.human_inputs?.length) continue;
        const sessionEvents = partitioned.get(session.session_id) ?? [];
        if (!sessionEvents.length) continue;

        session.human_inputs = session.human_inputs.map((h) => {
            if ((h.api_calls ?? 0) <= 0) return h;

            const startMs = parseIsoMs(h.start_time ?? h.session_time);
            if (startMs == null) return h;
            let endMs = parseIsoMs(h.end_time) ?? startMs;
            if (endMs < startMs) endMs = startMs;

            const matchedTimes = sessionEvents
                .map((event) => parseEventTimestampMs(event))
                .filter((ts): ts is number => ts != null && ts >= startMs && ts <= endMs);
            if (!matchedTimes.length) return h;

            const min = Math.min(...matchedTimes);
            const max = Math.max(...matchedTimes);
            const startIso = new Date(min).toISOString();
            const endIso = new Date(max).toISOString();
            return {
                ...h,
                start_time: startIso,
                end_time: endIso,
                session_time: startIso,
                time_precision: "inferred_from_billing" as const,
            };
        });
    }
}

/**
 * Align approximate human-input times to Cursor Dashboard billing bursts before
 * cost attribution windows are built.
 */
export function refineCursorHumanInputsFromBillingEvents(
    sessions: Array<{
        session_id: string;
        agent: string;
        time_range: { start?: string; display: string };
        human_inputs?: HumanInput[];
    }>,
    events: Record<string, unknown>[],
    date: string,
    rematchInferred = false
): void {
    const cursorSessions = sessions.filter((s) => s.agent === "cursor-gui" || s.agent === "cursor-cli");
    if (!cursorSessions.length || !events.length) return;

    const dayEvents = events.filter((event) => {
        const tsMs = parseEventTimestampMs(event);
        return tsMs != null && isTimestampOnLocalDate(tsMs, date);
    });
    if (!dayEvents.length) return;

    const allBursts = clusterUsageEventsIntoBursts(dayEvents);
    if (!allBursts.length) return;

    for (const session of cursorSessions) {
        if (!session.human_inputs?.length) continue;
        const bounds = sessionActivityBoundsMs(session);
        const bursts =
            bounds == null
                ? allBursts
                : allBursts.filter(
                      (burst) => burst.startMs >= bounds.startMs && burst.startMs <= bounds.endMs
                  );
        if (!bursts.length) continue;
        session.human_inputs = refineSessionHumanInputsFromBillingBursts(
            session.human_inputs,
            bursts,
            rematchInferred
        );
    }
}
