import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname} from "node:path";
import type {DailyApiJson} from "../collect/types.js";
import type {AssignmentReport} from "./types.js";

export function writeDailyReport(path: string, daily: DailyApiJson): void {
    const dir = dirname(path);
    if (dir && dir !== ".") {
        mkdirSync(dir, {recursive: true});
    }
    writeFileSync(path, JSON.stringify(daily, null, 2), "utf-8");
}

export function readDailyReport(path: string): DailyApiJson {
    try {
        const daily = JSON.parse(readFileSync(path, "utf-8")) as DailyApiJson;
        if (!daily?.author || !daily.date || !Array.isArray(daily.sessions)) {
            throw new Error("daily report must contain author, date, and sessions");
        }
        return daily;
    } catch (e) {
        throw new Error(`cannot read ${path}: ${(e as Error).message}`);
    }
}

export function readDailyReports(files: string[]): AssignmentReport[] {
    const uniqueFiles = [...new Set(files.map((file) => file.trim()).filter(Boolean))];
    if (uniqueFiles.length === 0) {
        throw new Error("--files requires at least one ai-daily JSON path");
    }
    return uniqueFiles.map((file) => ({
        file,
        daily: readDailyReport(file),
    }));
}

export function assignmentReportPayload(report: AssignmentReport): Record<string, unknown> {
    return {
        file: report.file,
        date: report.daily.date,
        report: report.daily,
    };
}
