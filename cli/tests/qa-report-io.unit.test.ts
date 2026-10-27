import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, test} from "vitest";
import {
    qaExcludedSidecarPath,
    readQaExcludedSessions,
    writeQaExcludedSessions,
} from "../src/lib/qa-assign/qa-report-io.js";

describe("QA excluded sidecar", () => {
    let tmpDir: string;

    afterEach(() => {
        if (tmpDir) rmSync(tmpDir, {recursive: true, force: true});
    });

    test("derives sidecar path from qa-daily filename", () => {
        expect(qaExcludedSidecarPath("/tmp/cawplan-qa-daily/qa-daily-2026-08-04.json"))
            .toBe("/tmp/cawplan-qa-daily/qa-daily-2026-08-04.excluded.json");
    });

    test("writes and reads excluded sessions beside the daily file", () => {
        tmpDir = mkdtempSync(join(tmpdir(), "qa-sidecar-test-"));
        const dailyPath = join(tmpDir, "qa-daily-2026-08-04.json");
        writeFileSync(dailyPath, "{}", "utf-8");

        const excluded = [{
            session_id: "sess-excluded",
            agent: "cursor-gui",
            title: "Excluded session",
            reason: "no-human-input" as const,
        }];
        writeQaExcludedSessions(dailyPath, excluded);

        const sidecarPath = qaExcludedSidecarPath(dailyPath);
        expect(existsSync(sidecarPath)).toBe(true);
        expect(JSON.parse(readFileSync(sidecarPath, "utf-8"))).toEqual(excluded);
        expect(readQaExcludedSessions(dailyPath)).toEqual(excluded);
    });

    test("returns an empty list when the sidecar is missing", () => {
        tmpDir = mkdtempSync(join(tmpdir(), "qa-sidecar-test-"));
        const dailyPath = join(tmpDir, "qa-daily-2026-08-04.json");
        writeFileSync(dailyPath, "{}", "utf-8");

        expect(readQaExcludedSessions(dailyPath)).toEqual([]);
    });
});
