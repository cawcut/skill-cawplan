import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterEach, describe, expect, test, vi} from "vitest";
import {skillLayersFromTraces, tracesFromGuiToolResults} from "../src/lib/collect/qa-trace-extract.js";
import * as paths from "../src/lib/collect/paths.js";

function receiptOutput(body: Record<string, unknown>): string {
    return JSON.stringify({output: JSON.stringify(body)});
}

describe("tracesFromGuiToolResults (Cursor GUI vscdb)", () => {
    const tempRoots: string[] = [];

    afterEach(() => {
        vi.restoreAllMocks();
        for (const root of tempRoots.splice(0)) {
            rmSync(root, {recursive: true, force: true});
        }
    });

    function stageDb(rows: Array<{key: string; value: string}>): string {
        const root = mkdtempSync(join(tmpdir(), "qa-gui-trace-"));
        tempRoots.push(root);
        const dbPath = join(root, "state.vscdb");
        const db = new DatabaseSync(dbPath);
        db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)");
        const insert = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");
        for (const row of rows) insert.run(row.key, row.value);
        db.close();
        vi.spyOn(paths, "cursorStateDbCandidates").mockReturnValue([dbPath]);
        return dbPath;
    }

    test("parses a real-shaped testpoints archive receipt from toolFormerData.result.output", () => {
        const composerId = "bbd213ac-1bcc-4d21-8d54-8180a6cc68f1";
        stageDb([
            {
                key: `bubbleId:${composerId}:27aaf017-c800-45d9-bee5-5aebb3df64d3`,
                value: JSON.stringify({
                    toolFormerData: {
                        name: "run_terminal_command_v2",
                        additionalData: {status: "success", startedAtMs: 1000},
                        result: receiptOutput({
                            outcome: "SUCCESS",
                            command: "testpoints archive",
                            meta: {product_id: "p1", requirement_id: "r1", dry_run: false},
                            api: {data: {test_points: [{id: "tp1"}, {id: "tp2"}]}},
                        }),
                    },
                }),
            },
        ]);

        const traces = tracesFromGuiToolResults(composerId);
        expect(traces).toEqual([
            {
                command: "testpoints archive",
                outcome: "SUCCESS",
                productId: "p1",
                requirementId: "r1",
                dryRun: false,
                landedCount: 2,
                reconcileDecision: undefined,
                batchSize: undefined,
                skillLayer: "cawplan-testpoint-generate",
            },
        ]);
        expect(skillLayersFromTraces(traces)).toEqual(["cawplan-testpoint-generate"]);
    });

    test("ignores non-terminal tool calls (read_file_v2, ask_question) and malformed results", () => {
        const composerId = "composer-mixed-tools";
        stageDb([
            {
                key: `bubbleId:${composerId}:a`,
                value: JSON.stringify({toolFormerData: {name: "read_file_v2", result: JSON.stringify({totalLinesInFile: 10})}}),
            },
            {
                key: `bubbleId:${composerId}:b`,
                value: JSON.stringify({
                    toolFormerData: {name: "ask_question", result: JSON.stringify({answers: []})},
                }),
            },
            {
                key: `bubbleId:${composerId}:c`,
                value: JSON.stringify({
                    toolFormerData: {name: "run_terminal_command_v2", result: "not valid json"},
                }),
            },
            {
                key: `bubbleId:${composerId}:d`,
                value: "not valid json either",
            },
        ]);

        expect(tracesFromGuiToolResults(composerId)).toEqual([]);
    });

    test("sorts bubbles by startedAtMs, not key order, before picking tier-1 product_id", () => {
        const composerId = "composer-multi-product";
        // Insert the later (p2) receipt first in key order to prove sort-by-time wins.
        stageDb([
            {
                key: `bubbleId:${composerId}:zzz-later`,
                value: JSON.stringify({
                    toolFormerData: {
                        name: "run_terminal_command_v2",
                        additionalData: {startedAtMs: 2000},
                        result: receiptOutput({
                            outcome: "SUCCESS",
                            command: "testpoints archive",
                            meta: {product_id: "p2", requirement_id: "r2", dry_run: false},
                            api: {data: {test_points: [{id: "tp3"}]}},
                        }),
                    },
                }),
            },
            {
                key: `bubbleId:${composerId}:aaa-earlier`,
                value: JSON.stringify({
                    toolFormerData: {
                        name: "run_terminal_command_v2",
                        additionalData: {startedAtMs: 1000},
                        result: receiptOutput({
                            outcome: "SUCCESS",
                            command: "testpoints archive",
                            meta: {product_id: "p1", requirement_id: "r1", dry_run: false},
                            api: {data: {test_points: [{id: "tp1"}, {id: "tp2"}]}},
                        }),
                    },
                }),
            },
        ]);

        const traces = tracesFromGuiToolResults(composerId);
        expect(traces.map((t) => t.productId)).toEqual(["p1", "p2"]);
        expect(traces.find((t) => t.productId)?.productId).toBe("p1");
    });

    test("rows without startedAtMs sort last, not first", () => {
        const composerId = "composer-missing-timing";
        stageDb([
            {
                key: `bubbleId:${composerId}:no-timing`,
                value: JSON.stringify({
                    toolFormerData: {
                        name: "run_terminal_command_v2",
                        result: receiptOutput({
                            outcome: "SUCCESS",
                            command: "testpoints archive",
                            meta: {product_id: "p-untimed", requirement_id: "r-untimed", dry_run: false},
                            api: {data: {test_points: [{id: "tp1"}]}},
                        }),
                    },
                }),
            },
            {
                key: `bubbleId:${composerId}:timed`,
                value: JSON.stringify({
                    toolFormerData: {
                        name: "run_terminal_command_v2",
                        additionalData: {startedAtMs: 500},
                        result: receiptOutput({
                            outcome: "SUCCESS",
                            command: "testpoints archive",
                            meta: {product_id: "p-timed", requirement_id: "r-timed", dry_run: false},
                            api: {data: {test_points: [{id: "tp2"}]}},
                        }),
                    },
                }),
            },
        ]);

        const traces = tracesFromGuiToolResults(composerId);
        expect(traces.map((t) => t.productId)).toEqual(["p-timed", "p-untimed"]);
    });

    test("returns [] when no vscdb candidate path exists", () => {
        vi.spyOn(paths, "cursorStateDbCandidates").mockReturnValue(["/nonexistent/state.vscdb"]);
        expect(tracesFromGuiToolResults("any-composer-id")).toEqual([]);
    });

    test("returns [] when the composerId has no matching bubble rows", () => {
        stageDb([
            {
                key: "bubbleId:some-other-composer:x",
                value: JSON.stringify({
                    toolFormerData: {
                        name: "run_terminal_command_v2",
                        result: receiptOutput({outcome: "SUCCESS", command: "testpoints archive", meta: {}}),
                    },
                }),
            },
        ]);
        expect(tracesFromGuiToolResults("composer-with-no-rows")).toEqual([]);
    });
});
