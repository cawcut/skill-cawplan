import {existsSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {describe, expect, test} from "vitest";
import {collectQa} from "../src/lib/collect/index.js";

const QA_DIR = join(homedir(), ".claude/projects/-Users-zhenling-zeng-ui-com-Documents-skill-claud");
const REAL_SESSION_ID = "fcc914fb-041a-4ce6-8c2d-f79910c13d0d";
const DATE = "2026-08-20";

const hasFixture = existsSync(join(QA_DIR, `${REAL_SESSION_ID}.jsonl`));

describe.skipIf(!hasFixture)("buildQaDailyJson R9 serialization guard (real session)", () => {
    test("serialized payload never contains category/topic substrings", async () => {
        const payload = await collectQa({date: DATE, collectMode: "qa"});
        const serialized = JSON.stringify(payload);
        expect(serialized).not.toContain("\"category\"");
        expect(serialized).not.toContain("\"topic\"");
        expect(serialized).not.toContain("\"topic_source\"");
    }, 30000);

    test("every human_inputs entry omits category/topic as own properties", async () => {
        const payload = await collectQa({date: DATE, collectMode: "qa"});
        expect(payload.human_inputs.length).toBeGreaterThan(0);
        for (const h of payload.human_inputs) {
            expect(Object.prototype.hasOwnProperty.call(h, "category")).toBe(false);
            expect(Object.prototype.hasOwnProperty.call(h, "topic")).toBe(false);
        }
    }, 30000);
});
