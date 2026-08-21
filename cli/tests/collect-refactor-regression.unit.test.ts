import {existsSync, readdirSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, test} from "vitest";
import {collect} from "../src/lib/collect/index.js";
import {assignProjectsFromCloudMappings} from "../src/lib/assign/auto-assign.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// S1.3 regression gate: collect()'s scanSessions() extraction (A1, pure refactor)
// must not change coding report output byte-for-byte (generated_at excluded).
// Baselines were captured via the `session collect` CLI (S1.1), which also runs
// assignProjectsFromCloudMappings() after collect() — replicate that here so the
// comparison matches what was actually captured, not raw collect() output.
// Baselines are gitignored (they embed real local paths, session titles, and
// cost data) — this test only runs when a developer has captured them locally;
// it is a no-op skip otherwise.
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

describe.skipIf(baselineDates.length === 0)("collect() refactor regression (S1.3)", () => {
    test.each(baselineDates)("coding report for %s matches pre-refactor baseline", async (date: string) => {
        const baseline = JSON.parse(readFileSync(join(BASELINE_DIR, `before-${date}.json`), "utf-8"));
        const after = await collect({date});
        await assignProjectsFromCloudMappings(after);
        expect(stripGeneratedAt(after)).toEqual(stripGeneratedAt(baseline));
    }, 30_000);
});
