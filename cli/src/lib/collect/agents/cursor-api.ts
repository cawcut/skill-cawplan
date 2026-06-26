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
import {ModelUsageEntry, UsageBucket} from "../types.js";
import {cursorStateDbCandidates} from "../paths.js";
import {isTimestampOnLocalDate, dayBoundsMs} from "../date-utils.js";
import {calculateCost} from "../pricing.js";

const PAGE_SIZE = 500;
const MAX_ASSIGN_DISTANCE_MS = 2 * 60 * 60 * 1000; // 2h

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

function httpsPost(url: string, body: Record<string, unknown>, headers: Record<string, string>): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const bodyStr = JSON.stringify(body);
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
                try {
                    const data = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as unknown;
                    resolve(data);
                } catch (e) {
                    reject(new Error(`Failed to parse response: ${(e as Error).message}`));
                }
            });
        });

        req.setTimeout(30000, () => {
            req.destroy(new Error("Cursor API request timed out after 30s"));
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
                currency: "$",
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
            } else {
                entry.cost = "unknown";
            }
        }
    }

    return { totalCost, currency: "$", byModel };
}


interface AttributionWindow {
    sessionId: string;
    agent: string;
    startMs: number;
    endMs: number;
    humanInputIndex?: number;
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
            }))
            .filter((p): p is { index: number; startMs: number; endMs: number | null } => p.startMs != null)
            .sort((a, b) => a.startMs - b.startMs);

        if (prompts.length > 0) {
            // Bursts with identical startMs share one window; last index in the burst is credited.
            const segments: Array<{ startMs: number; humanInputIndex: number; endMsHint: number | null }> = [];
            for (const p of prompts) {
                const last = segments[segments.length - 1];
                if (last && last.startMs === p.startMs) {
                    last.humanInputIndex = p.index;
                    if (p.endMs != null && (last.endMsHint == null || p.endMs > last.endMsHint)) {
                        last.endMsHint = p.endMs;
                    }
                } else {
                    segments.push({startMs: p.startMs, humanInputIndex: p.index, endMsHint: p.endMs});
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
                currency: "$",
                note: "dashboard API human-input window attribution",
                token_source: "dashboard_api",
            });
        }

        const entry = byModel.get(model)!;
        entry.api_calls += 1;
        entry.input_tokens += Number(tokenUsage["inputTokens"] ?? 0);
        entry.output_tokens += Number(tokenUsage["outputTokens"] ?? 0);
        entry.cache_read_input_tokens += Number(tokenUsage["cacheReadTokens"] ?? 0);
        entry.cache_creation_input_tokens += Number(tokenUsage["cacheWriteTokens"] ?? 0);
        if (typeof entry.cost === "number") entry.cost += costUsd;

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