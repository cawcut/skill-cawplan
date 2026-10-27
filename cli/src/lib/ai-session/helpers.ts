import type {Command} from "commander";
import {cawplanRequest} from "../http.js";
import {readCredentials} from "../credentials.js";
import type {UserListItem} from "./types.js";

export const DATE_PAGE_KEYS = ["date", "date_from", "date_to", "page_num", "page_size"] as const;
export const DATE_KEYS = ["date", "date_from", "date_to"] as const;

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function dateParams(opts: {date?: string; from?: string; to?: string}): Record<string, string> {
    const q: Record<string, string> = {};
    if (opts.date) q.date = opts.date;
    if (opts.from) q.date_from = opts.from;
    if (opts.to) q.date_to = opts.to;
    return q;
}

export function pageParams(opts: {pageNum?: number; pageSize?: number}): Record<string, string> {
    const q: Record<string, string> = {};
    if (opts.pageNum != null) q.page_num = String(opts.pageNum);
    if (opts.pageSize != null) q.page_size = String(opts.pageSize);
    return q;
}

export function limitOffsetParams(opts: {limit?: number; offset?: number}): Record<string, string> {
    const q: Record<string, string> = {};
    if (opts.limit != null) q.limit = String(opts.limit);
    if (opts.offset != null) q.offset = String(opts.offset);
    return q;
}

export function addDatePageOptions(cmd: Command): Command {
    return cmd
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date")
        .option("--page-num <n>", "Page number", parseInt)
        .option("--page-size <n>", "Page size", parseInt);
}

export function addDateOptions(cmd: Command): Command {
    return cmd
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date");
}

export function addReportQueryOptions(cmd: Command): Command {
    return cmd
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date")
        .option("--user-id <id>", "Filter by user unique_id")
        .option("--limit <n>", "Result limit", parseInt)
        .option("--offset <n>", "Pagination offset", parseInt);
}

export function extractList<T>(payload: unknown): T[] {
    if (Array.isArray(payload)) return payload as T[];
    const p = payload as Record<string, unknown> | undefined;
    if (Array.isArray(p?.data)) return p.data as T[];
    const inner = p?.data as Record<string, unknown> | undefined;
    if (Array.isArray(inner?.list)) return inner.list as T[];
    if (Array.isArray(inner?.items)) return inner.items as T[];
    if (Array.isArray(inner?.data)) return inner.data as T[];
    return [];
}

export function extractDataObject(payload: unknown): Record<string, unknown> {
    const p = payload as Record<string, unknown> | undefined;
    const data = p?.data as Record<string, unknown> | undefined;
    return data ?? p ?? {};
}

export function userIdFromUsersQuery(payload: unknown, email: string): string | undefined {
    const needle = email.trim().toLowerCase();
    const users = extractList<UserListItem>(payload);
    const user = users.find((item) => String(item.email ?? "").trim().toLowerCase() === needle);
    const userId = user?.unique_id ?? user?.user_id;
    return typeof userId === "string" && userId.trim() ? userId.trim() : undefined;
}

export async function resolveCurrentUserId(): Promise<string | undefined> {
    const credentials = await readCredentials();
    if (credentials?.user_id?.trim()) return credentials.user_id.trim();

    const email = credentials?.email?.trim();
    if (!email) return undefined;

    try {
        const result = await cawplanRequest({
            method: "POST",
            path: "/api/v1/public/openapi/users/query",
            body: {email},
        });
        return userIdFromUsersQuery(result, email);
    } catch (e) {
        console.error(`Warning: cannot resolve current user_id from ${email}: ${(e as Error).message}`);
        return undefined;
    }
}

export async function requireCurrentUserId(): Promise<string> {
    const userId = await resolveCurrentUserId();
    if (userId) return userId;
    throw new Error("current user_id is not available in credentials.json; run: cawplan auth login");
}

export function parseISODate(date: string): Date {
    if (!isoDatePattern.test(date)) throw new Error(`invalid date: ${date}`);
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || formatISODate(parsed) !== date) {
        throw new Error(`invalid date: ${date}`);
    }
    return parsed;
}

export function formatISODate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function addUTCDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}

export function dateRangeInclusive(dateFrom: string, dateTo: string): string[] {
    const start = parseISODate(dateFrom);
    const end = parseISODate(dateTo);
    if (start.getTime() > end.getTime()) return [];

    const dates: string[] = [];
    for (let current = start; current.getTime() <= end.getTime(); current = addUTCDays(current, 1)) {
        dates.push(formatISODate(current));
    }
    return dates;
}
