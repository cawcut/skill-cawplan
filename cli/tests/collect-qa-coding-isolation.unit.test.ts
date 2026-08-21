import {existsSync, readdirSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, test} from "vitest";
import {collect, collectQaResult} from "../src/lib/collect/index.js";
import {assignProjectsFromCloudMappings} from "../src/lib/assign/auto-assign.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = join(__dirname, "fixtures", "coding-baseline");

function stripGeneratedAt(obj: unknown): unknown {
    const clone = JSON.parse(JSON.stringify(obj));
    delete clone.generated_at;
    return clone;
}

const baselineDates: string[] = existsSync(BASELINE_DIR)
    ? readdirSync(BASELINE_DIR)
          .filter((f: string) => f.startsWith("before-") && f.endsWith(".json"))
          .map((f: string) => f.slice("before-".length, -".json".length))
    : [];

/**
 * Regression item 8 (S5.5): QA collect must not mutate coding output.
 * Coding baseline dates are used when fixtures exist locally.
 */
describe("QA/coding collect isolation (S5.5)", () => {
    test.each(baselineDates.length > 0 ? baselineDates : ["2026-08-11"])(
        "coding report for %s is unchanged after a QA collect run",
        async (date: string) => {
            const codingAlone = stripGeneratedAt(await collect({date}));
            await collectQaResult({date, collectMode: "qa"});
            const codingAfterQa = stripGeneratedAt(await collect({date}));
            expect(codingAfterQa).toEqual(codingAlone);
        },
        60_000,
    );

    test.each(baselineDates)("coding report for %s still matches pre-refactor baseline", async (date: string) => {
        const baseline = JSON.parse(readFileSync(join(BASELINE_DIR, `before-${date}.json`), "utf-8"));
        const after = await collect({date});
        await assignProjectsFromCloudMappings(after);
        expect(stripGeneratedAt(after)).toEqual(stripGeneratedAt(baseline));
    }, 60_000);

    test("QA included and excluded session lists do not overlap", async () => {
        const date = baselineDates[0] ?? "2026-08-11";
        const {daily, excludedSessions} = await collectQaResult({date, collectMode: "qa"});
        const includedIds = new Set(daily.sessions.map((s) => s.session_id));
        const excludedIds = excludedSessions.map((s) => s.session_id);
        const overlap = excludedIds.filter((id) => includedIds.has(id));
        expect(overlap).toEqual([]);
    }, 60_000);

    test("QA-included sessions may have empty skill_layers", async () => {
        const date = baselineDates[0] ?? "2026-08-11";
        const {daily} = await collectQaResult({date, collectMode: "qa"});
        for (const session of daily.sessions) {
            expect(Array.isArray(session.skill_layers)).toBe(true);
        }
    }, 60_000);
});
