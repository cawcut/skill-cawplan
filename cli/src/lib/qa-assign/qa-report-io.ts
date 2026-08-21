import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname} from "node:path";
import type {QaDailyApiJson} from "../collect/qa-types.js";

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
