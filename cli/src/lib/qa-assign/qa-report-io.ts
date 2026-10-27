import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname} from "node:path";
import type {QaExcludedSession} from "../collect/aggregators/qa-daily.js";
import type {QaDailyApiJson} from "../collect/qa-types.js";

export function qaExcludedSidecarPath(dailyPath: string): string {
    if (dailyPath.endsWith(".json")) {
        return `${dailyPath.slice(0, -".json".length)}.excluded.json`;
    }
    return `${dailyPath}.excluded.json`;
}

export function writeQaExcludedSessions(dailyPath: string, excludedSessions: QaExcludedSession[]): void {
    const path = qaExcludedSidecarPath(dailyPath);
    const dir = dirname(path);
    if (dir && dir !== ".") {
        mkdirSync(dir, {recursive: true});
    }
    writeFileSync(path, JSON.stringify(excludedSessions, null, 2), "utf-8");
}

export function readQaExcludedSessions(dailyPath: string): QaExcludedSession[] {
    const path = qaExcludedSidecarPath(dailyPath);
    if (!existsSync(path)) return [];

    try {
        const parsed = JSON.parse(readFileSync(path, "utf-8"));
        if (!Array.isArray(parsed)) {
            throw new Error("excluded sidecar must be a JSON array");
        }
        return parsed as QaExcludedSession[];
    } catch (e) {
        throw new Error(`cannot read ${path}: ${(e as Error).message}`);
    }
}

export function writeQaDailyReport(path: string, daily: QaDailyApiJson): void {
    const dir = dirname(path);
    if (dir && dir !== ".") {
        mkdirSync(dir, {recursive: true});
    }
    writeFileSync(path, JSON.stringify(daily, null, 2), "utf-8");
}

export function readQaDailyReport(path: string): QaDailyApiJson {
    try {
        const daily = JSON.parse(readFileSync(path, "utf-8")) as QaDailyApiJson;
        if (daily?.schema !== "qa-session.1" || !daily.date || !daily.author || !Array.isArray(daily.sessions)) {
            throw new Error("QA daily report must contain schema qa-session.1, date, author, and sessions");
        }
        return daily;
    } catch (e) {
        throw new Error(`cannot read ${path}: ${(e as Error).message}`);
    }
}
