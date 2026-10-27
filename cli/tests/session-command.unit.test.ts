import {existsSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, test} from "vitest";
import {formatElapsedMs, resolveReportTempDir} from "../src/commands/session.js";

describe("session command helpers", () => {
    test("formats elapsed collect duration", () => {
        expect(formatElapsedMs(499)).toBe("0s");
        expect(formatElapsedMs(1_400)).toBe("1s");
        expect(formatElapsedMs(65_100)).toBe("1m 5s");
    });

    test("resolveReportTempDir creates and returns the shared temp directory", () => {
        const dir = resolveReportTempDir();
        expect(dir).toBe(join(tmpdir(), "cawplan-ai-daily"));
        expect(existsSync(dir)).toBe(true);
        expect(statSync(dir).isDirectory()).toBe(true);
    });

    test("resolveReportTempDir is idempotent when the directory already exists", () => {
        expect(resolveReportTempDir()).toBe(resolveReportTempDir());
    });
});
