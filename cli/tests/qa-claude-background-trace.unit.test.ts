import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, test, vi} from "vitest";
import {tracesFromToolResultStdout} from "../src/lib/collect/qa-trace-extract.js";
import {collectQaAssetChanges} from "../src/lib/collect/qa-asset-changes.js";

describe("Claude background Review receipts", () => {
    let dir: string;
    afterEach(() => {
        if (dir) rmSync(dir, {recursive: true, force: true});
        vi.restoreAllMocks();
    });

    function fixture(options: {duplicate?: boolean; missing?: boolean; command?: string; outcome?: string; dryRun?: boolean} = {}) {
        dir = mkdtempSync(join(tmpdir(), "qa-claude-review-"));
        const sessionId = "review-session";
        const taskId = "background-task";
        const taskDir = join(dir, sessionId, "tasks");
        mkdirSync(taskDir, {recursive: true});
        const outputFile = join(taskDir, `${taskId}.output`);
        const receipt = JSON.stringify({
            command: "testpoints archive", outcome: options.outcome ?? "SUCCESS",
            meta: {product_id: "p1", requirement_id: "r1", dry_run: options.dryRun ?? false},
            api: {data: {test_points: Array.from({length: 28}, (_, i) => ({id: `point-${i}`}))}},
        });
        if (!options.missing) writeFileSync(outputFile, `Review URL\n${receipt}\nTESTPOINT_REVIEW_EVENT save_completed\n`);
        const events = [
            {type: "assistant", timestamp: "2026-10-12T01:00:00Z", message: {content: [{
                type: "tool_use", name: "Bash", id: "tool-1", input: {
                    command: options.command ?? "cawplan qa-insights testpoint-review open --review-id rv_test --no-browser",
                    run_in_background: true,
                },
            }]}},
            {type: "user", timestamp: "2026-10-12T01:00:01Z", message: {content: [{type: "tool_result", tool_use_id: "tool-1"}]},
                toolUseResult: {stdout: "", backgroundTaskId: taskId}},
            {type: "user", sessionId, timestamp: "2026-10-13T02:00:00Z", message: {content:
                `<task-notification>\n<task-id>${taskId}</task-id>\n<output-file>${outputFile}</output-file>\n<status>completed</status>\n</task-notification>`}},
        ];
        if (options.duplicate) events.push({type: "user", timestamp: "2026-10-13T02:00:01Z",
            toolUseResult: {stdout: receipt}} as typeof events[number]);
        const path = join(dir, "session.jsonl");
        writeFileSync(path, events.map((event) => JSON.stringify(event)).join("\n"));
        return path;
    }

    test("counts 28 saved points on completion day, even if the server started the previous day", () => {
        const path = fixture();
        expect(collectQaAssetChanges(tracesFromToolResultStdout(path, "2026-10-13")).testpoint.added).toBe(28);
        expect(collectQaAssetChanges(tracesFromToolResultStdout(path, "2026-10-12")).testpoint.added).toBe(0);
    });

    test("does not double count a receipt also read into stdout", () => {
        const path = fixture({duplicate: true});
        expect(tracesFromToolResultStdout(path)).toHaveLength(1);
        expect(collectQaAssetChanges(tracesFromToolResultStdout(path)).testpoint.added).toBe(28);
    });

    test("does not follow unrelated background tasks", () => {
        expect(tracesFromToolResultStdout(fixture({command: "echo unrelated"}))).toEqual([]);
    });

    test.each([{outcome: "FAILURE"}, {dryRun: true}])("does not count unsuccessful or preview saves: %j", (options) => {
        expect(collectQaAssetChanges(tracesFromToolResultStdout(fixture(options))).testpoint.added).toBe(0);
    });

    test("warns without inventing counts when the task output is missing", () => {
        const warn = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(tracesFromToolResultStdout(fixture({missing: true}))).toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("could not read Claude Review task output"));
    });
});
