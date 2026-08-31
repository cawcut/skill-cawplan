import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, test} from "vitest";
import {collectQaAssetChanges} from "../src/lib/collect/qa-asset-changes.js";
import {tracesFromToolResultStdout} from "../src/lib/collect/qa-trace-extract.js";

/**
 * R11 synthetic fixtures — real session fcc914fb only has one SUCCESS archive (6).
 * Other scenarios use stdout JSON shaped like the real archive receipt.
 */

function stdoutEvent(body: Record<string, unknown>) {
    return {type: "user", toolUseResult: {stdout: JSON.stringify(body)}};
}

function writeFixtureJsonl(events: Record<string, unknown>[]): string {
    const dir = mkdtempSync(join(tmpdir(), "qa-r11-"));
    const path = join(dir, "session.jsonl");
    writeFileSync(path, events.map((e) => JSON.stringify(e)).join("\n"), "utf-8");
    return path;
}

describe("collectQaAssetChanges R11 scenarios (constructed fixtures)", () => {
    const tmpPaths: string[] = [];

    afterEach(() => {
        for (const p of tmpPaths.splice(0)) {
            rmSync(join(p, ".."), {recursive: true, force: true});
        }
    });

    function fixture(events: Record<string, unknown>[]): string {
        const path = writeFixtureJsonl(events);
        tmpPaths.push(path);
        return path;
    }

    test("multiple SUCCESS archives accumulate landed counts (6 + 4 = 10)", () => {
        const path = fixture([
            stdoutEvent({
                outcome: "SUCCESS",
                command: "testpoints archive",
                meta: {product_id: "p1", requirement_id: "r1", dry_run: false},
                api: {code: "SUCCESS", data: {test_points: Array.from({length: 6}, (_, i) => ({id: String(i)}))}},
            }),
            stdoutEvent({
                outcome: "SUCCESS",
                command: "testpoints archive",
                meta: {product_id: "p1", requirement_id: "r1", dry_run: false},
                api: {code: "SUCCESS", data: {test_points: Array.from({length: 4}, (_, i) => ({id: String(i + 6)}))}},
            }),
        ]);
        expect(collectQaAssetChanges(tracesFromToolResultStdout(path)).testpoint.added).toBe(10);
    });

    test("UNKNOWN archive plus reconcile count_matched adds batch_size only", () => {
        const path = fixture([
            stdoutEvent({
                outcome: "UNKNOWN",
                command: "testpoints archive",
                meta: {product_id: "p1", requirement_id: "r1", dry_run: false},
            }),
            stdoutEvent({
                outcome: "RECONCILED",
                command: "testpoints reconcile",
                meta: {product_id: "p1", requirement_id: "r1"},
                reconcile: {decision: "count_matched", batch_size: 5},
            }),
        ]);
        expect(collectQaAssetChanges(tracesFromToolResultStdout(path)).testpoint.added).toBe(5);
    });

    test("reconcile retry_same_batch does not add to testpoint.added", () => {
        const path = fixture([
            stdoutEvent({
                outcome: "SUCCESS",
                command: "testpoints archive",
                meta: {product_id: "p1", requirement_id: "r1", dry_run: false},
                api: {code: "SUCCESS", data: {test_points: Array.from({length: 6}, (_, i) => ({id: String(i)}))}},
            }),
            stdoutEvent({
                outcome: "FAILURE",
                command: "testpoints reconcile",
                meta: {product_id: "p1", requirement_id: "r1"},
                reconcile: {decision: "retry_same_batch", batch_size: 6},
            }),
        ]);
        // Constructed sample: real SUCCESS (6) must not be inflated by retry_same_batch reconcile.
        expect(collectQaAssetChanges(tracesFromToolResultStdout(path)).testpoint.added).toBe(6);
    });

    test("dry_run SUCCESS archive is skipped", () => {
        const path = fixture([
            stdoutEvent({
                outcome: "SUCCESS",
                command: "testpoints archive",
                meta: {product_id: "p1", requirement_id: "r1", dry_run: true},
                api: {code: "SUCCESS", data: {test_points: [{id: "1"}, {id: "2"}]}},
            }),
        ]);
        expect(collectQaAssetChanges(tracesFromToolResultStdout(path)).testpoint.added).toBe(0);
    });

    test("FAILURE archive is skipped", () => {
        const path = fixture([
            stdoutEvent({
                outcome: "FAILURE",
                command: "testpoints archive",
                meta: {product_id: "p1", requirement_id: "r1", dry_run: false},
            }),
        ]);
        expect(collectQaAssetChanges(tracesFromToolResultStdout(path)).testpoint.added).toBe(0);
    });
});
