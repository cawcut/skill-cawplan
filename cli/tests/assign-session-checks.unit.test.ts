import {describe, expect, test} from "vitest";
import {reportsNeedAssignment} from "../src/lib/assign/session-checks.js";
import type {DailyApiJson} from "../src/lib/collect/types.js";

function daily(productIds: Array<string | undefined>): {daily: DailyApiJson} {
    return {
        daily: {
            author: "t",
            date: "2026-10-12",
            sessions: productIds.map((product_id, i) => ({session_id: `s${i}`, product_id})),
        } as unknown as DailyApiJson,
    };
}

describe("reportsNeedAssignment", () => {
    test("false when every session already has a product", () => {
        expect(reportsNeedAssignment([daily(["p1", "p2"]), daily(["p1"])])).toBe(false);
    });

    test("true when any session in any report lacks a product", () => {
        expect(reportsNeedAssignment([daily(["p1"]), daily(["p1", undefined])])).toBe(true);
    });
});
