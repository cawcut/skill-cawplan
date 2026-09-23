import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach, describe, expect, test} from "vitest";
import {tracesFromToolResultStdout} from "../src/lib/collect/qa-trace-extract.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const QA_DIR = join(homedir(), ".claude/projects/-Users-zhenling-zeng-ui-com-Documents-skill-claud");
const SESSION_PATH = join(QA_DIR, "fcc914fb-041a-4ce6-8c2d-f79910c13d0d.jsonl");

function landedCountFromTraces(traces: ReturnType<typeof tracesFromToolResultStdout>): number {
    return traces
        .filter((t) => t.command === "testpoints archive" && t.outcome === "SUCCESS" && t.dryRun !== true)
        .reduce((sum, t) => sum + (t.landedCount ?? 0), 0);
}

// S3.3 判据 3: real session fcc914fb — structured stdout is the authoritative
// source for landed test point counts (§0.7 三重交叉校验).
describe.skipIf(!existsSync(SESSION_PATH))("tracesFromToolResultStdout (S3.3)", () => {
    test("landed count from real session matches the authoritative archive receipt", () => {
        const traces = tracesFromToolResultStdout(SESSION_PATH);
        expect(landedCountFromTraces(traces)).toBe(6);
    });
});

describe("requirements create receipt", () => {
    let tmpDir: string | undefined;

    afterEach(() => {
        if (tmpDir) rmSync(tmpDir, {recursive: true, force: true});
        tmpDir = undefined;
    });

    test("uses api.data.id when the successful create receipt has no meta.requirement_id", () => {
        tmpDir = mkdtempSync(join(tmpdir(), "qa-requirement-create-trace-"));
        const jsonlPath = join(tmpDir, "synthetic.jsonl");
        writeFileSync(jsonlPath, JSON.stringify({
            type: "user",
            toolUseResult: {
                stdout: JSON.stringify({
                    outcome: "SUCCESS",
                    command: "requirements create",
                    meta: {product_id: "p1", dry_run: false},
                    api: {code: "SUCCESS", data: {id: "req-created"}},
                }),
            },
        }), "utf-8");

        const traces = tracesFromToolResultStdout(jsonlPath);
        expect(traces).toHaveLength(1);
        expect(traces[0]?.requirementId).toBe("req-created");
    });
});

describe("模板陷阱 (template-trap) protection", () => {
    let tmpDir: string | undefined;

    afterEach(() => {
        if (tmpDir) rmSync(tmpDir, {recursive: true, force: true});
        tmpDir = undefined;
    });

    test("Chinese receipt template text in user events does not inflate the landed count", () => {
        tmpDir = mkdtempSync(join(tmpdir(), "qa-stdout-trace-"));
        const jsonlPath = join(tmpDir, "synthetic.jsonl");

        const templateEvent = {
            type: "user",
            message: {content: [{type: "text", text: "已保存 N 条测试点到需求「〔需求名〕」下。"}]},
        };
        const realArchiveEvent = {
            type: "user",
            toolUseResult: {
                stdout: JSON.stringify({
                    outcome: "SUCCESS",
                    command: "testpoints archive",
                    meta: {product_id: "p1", requirement_id: "r1", dry_run: false},
                    api: {code: "SUCCESS", data: {test_points: [{id: "1"}, {id: "2"}, {id: "3"}]}},
                }),
            },
        };
        const dryRunEvent = {
            type: "user",
            toolUseResult: {
                stdout: JSON.stringify({
                    outcome: "SUCCESS",
                    command: "testpoints archive",
                    meta: {product_id: "p1", requirement_id: "r1", dry_run: true},
                    api: {code: "SUCCESS", data: {test_points: [{id: "9"}, {id: "10"}]}},
                }),
            },
        };
        const failureEvent = {
            type: "user",
            toolUseResult: {
                stdout: JSON.stringify({
                    outcome: "FAILURE",
                    command: "testpoints archive",
                    meta: {product_id: "p1", requirement_id: "r1", dry_run: false},
                }),
            },
        };

        writeFileSync(
            jsonlPath,
            [templateEvent, templateEvent, realArchiveEvent, dryRunEvent, failureEvent]
                .map((e) => JSON.stringify(e))
                .join("\n"),
            "utf-8"
        );

        const traces = tracesFromToolResultStdout(jsonlPath);
        // exactly 3 structured stdout traces parsed (template-text events are not traces)
        expect(traces).toHaveLength(3);
        // landed = only the SUCCESS + non-dry-run archive (3), not 3 + template count, not dry-run's 2
        expect(landedCountFromTraces(traces)).toBe(3);
    });

    test("implementation does not primary-match on the Chinese receipt phrase", () => {
        const source = readFileSync(join(__dirname, "..", "src/lib/collect/qa-trace-extract.ts"), "utf-8");
        // The phrase may appear in doc comments describing the trap; it must
        // never appear in actual matching logic (a string literal compared
        // against parsed content).
        const codeLines = source
            .split("\n")
            .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"));
        const offendingLines = codeLines.filter((line) => line.includes("已保存"));
        expect(offendingLines).toEqual([]);
    });
});
