import {describe, expect, test} from "vitest";
import {collect} from "../src/lib/collect/index.js";

// S2.4 regression item 3: calling collect() without collectMode must still
// return a coding DailyApiJson shape (unchanged default path after S2.3
// introduced the optional collectMode field).
describe("collect() default mode (S2.4)", () => {
    test("collect({date, agents}) without collectMode returns coding DailyApiJson", async () => {
        const daily = await collect({date: "2026-08-11", agents: ["claude-code", "cursor"]});
        expect(daily.schema).toBe("2.0");
        expect(Array.isArray(daily.sessions)).toBe(true);
    }, 30_000);
});
