import {describe, expect, test} from "vitest";
import {
    AiOptimizationValidationError,
    applyAiOptimization,
    validateAiOptimizeOutput,
} from "../src/lib/testpoint-review/optimize-apply.js";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";
import type {RawAiOptimizeOutput} from "../src/lib/testpoint-review/optimize-apply.js";

describe("validateAiOptimizeOutput (design §8.5, plan step 18)", () => {
    test("accepts a modified entry that references an existing, active test point", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        const raw: RawAiOptimizeOutput = {
            modified: [{id: "tp_002", fields: {title: "revised", group: "g", tags: [], priority: "HIGH"}}],
            added: [],
        };

        const {output, skippedCount, errors} = validateAiOptimizeOutput(state, raw);

        expect(skippedCount).toBe(0);
        expect(output.modified).toEqual([{id: "tp_002", fields: {title: "revised", group: "g", tags: [], priority: "HIGH"}}]);
    });

    test("drops a modified entry whose id does not exist in the current round", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        const raw: RawAiOptimizeOutput = {
            modified: [{id: "tp_999", fields: {title: "ghost", group: "g", tags: [], priority: "LOW"}}],
            added: [],
        };

        const {output, skippedCount} = validateAiOptimizeOutput(state, raw);

        expect(output.modified).toHaveLength(0);
        expect(skippedCount).toBe(1);
    });

    test("drops a modified entry that targets a test point the QA already deleted (design §8.7)", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.test_points[0].status = "deleted";
        const raw: RawAiOptimizeOutput = {
            modified: [{id: state.test_points[0].id, fields: {title: "resurrected", group: "g", tags: [], priority: "LOW"}}],
            added: [],
        };

        const {output, skippedCount} = validateAiOptimizeOutput(state, raw);

        expect(output.modified).toHaveLength(0);
        expect(skippedCount).toBe(1);
    });

    test("drops a modified entry that targets an already-archived test point", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.test_points[0].archived = true;
        const raw: RawAiOptimizeOutput = {
            modified: [{id: state.test_points[0].id, fields: {title: "should not apply", group: "g", tags: [], priority: "LOW"}}],
            added: [],
        };

        const {output, skippedCount} = validateAiOptimizeOutput(state, raw);

        expect(output.modified).toHaveLength(0);
        expect(skippedCount).toBe(1);
    });

    test("drops a modified entry with a missing or blank title", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        const raw: RawAiOptimizeOutput = {
            modified: [{id: "tp_001", fields: {title: "  ", group: "g", tags: [], priority: "LOW"}}],
            added: [],
        };

        const {output, skippedCount} = validateAiOptimizeOutput(state, raw);

        expect(output.modified).toHaveLength(0);
        expect(skippedCount).toBe(1);
    });

    test("drops a modified entry with malformed tags (not a string array)", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        const raw = {
            modified: [{id: "tp_001", fields: {title: "ok", group: "g", tags: "not-an-array", priority: "LOW"}}],
            added: [],
        } as unknown as RawAiOptimizeOutput;

        const {output, skippedCount} = validateAiOptimizeOutput(state, raw);

        expect(output.modified).toHaveLength(0);
        expect(skippedCount).toBe(1);
    });

    test("accepts a well-formed added entry", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        const raw: RawAiOptimizeOutput = {
            modified: [],
            added: [{title: "new one", group: "g", tags: ["x"], priority: "LOW"}],
        };

        const {output, skippedCount} = validateAiOptimizeOutput(state, raw);

        expect(skippedCount).toBe(0);
        expect(output.added).toEqual([{title: "new one", group: "g", tags: ["x"], priority: "LOW"}]);
    });

    test("drops an added entry with an empty title", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        const raw: RawAiOptimizeOutput = {
            modified: [],
            added: [{title: "", group: "g", tags: [], priority: "LOW"}],
        };

        const {output, skippedCount} = validateAiOptimizeOutput(state, raw);

        expect(output.added).toHaveLength(0);
        expect(skippedCount).toBe(1);
    });

    test("reports concrete errors for invalid entries while retaining the valid projection for inspection", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        const raw: RawAiOptimizeOutput = {
            modified: [
                {id: "tp_001", fields: {title: "good edit", group: "g", tags: [], priority: "HIGH"}},
                {id: "tp_999", fields: {title: "bad id", group: "g", tags: [], priority: "LOW"}},
            ],
            added: [
                {title: "good add", group: "g", tags: [], priority: "LOW"},
                {title: "", group: "g", tags: [], priority: "LOW"},
            ],
        };

        const {output, skippedCount, errors} = validateAiOptimizeOutput(state, raw);

        expect(output.modified).toEqual([{id: "tp_001", fields: {title: "good edit", group: "g", tags: [], priority: "HIGH"}}]);
        expect(output.added).toEqual([{title: "good add", group: "g", tags: [], priority: "LOW"}]);
        expect(skippedCount).toBe(2);
        expect(errors).toEqual([
            'modified[1].id "tp_999" does not reference an active test point',
            "added[1].title must be a non-empty string",
        ]);
    });
});

describe("applyAiOptimization (design §3.4/§3.7, plan step 18)", () => {
    test("advances the round, unlocks the review, and clears optimize_requested_at", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.review_status = "pending_optimize";
        state.optimize_requested_at = new Date().toISOString();
        const roundBefore = state.round;

        const {reviewState, skippedCount} = applyAiOptimization(state, {
            modified: [{id: "tp_001", fields: {title: "revised", group: "g", tags: [], priority: "HIGH"}}],
            added: [],
        });

        expect(skippedCount).toBe(0);
        expect(reviewState.round).toBe(roundBefore + 1);
        expect(reviewState.review_status).toBe("reviewing");
        expect(reviewState.optimize_requested_at).toBeUndefined();
        expect(reviewState.test_points.find((tp) => tp.id === "tp_001")!.ai_status).toBe("modified");
    });

    test("rejects a malformed batch atomically, preserving the pending round and all QA feedback", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.review_status = "pending_optimize";
        state.optimize_requested_at = "2026-09-17T13:20:00.000Z";
        state.test_points[0].status = "edited";
        state.test_points[0].current.title = "QA edit stays put";
        state.test_points[1].status = "deleted";
        state.test_points[2].comments = [{id: "c_1", text: "Point feedback", author: "qa", resolved: false}];
        state.global_comments = [{id: "c_g", text: "Overall feedback", author: "qa", resolved: false}];
        const before = structuredClone(state);
        const malformedOutput = {
            modified: [{id: "tp_001", current: {title: "wrong wrapper", group: "g", tags: [], priority: "LOW"}}],
            added: [{title: "valid add that must not partially apply", group: "g", tags: [], priority: "LOW"}],
        } as unknown as RawAiOptimizeOutput;

        expect(() => applyAiOptimization(state, malformedOutput)).toThrow(AiOptimizationValidationError);
        expect(() => applyAiOptimization(state, malformedOutput)).toThrow("modified[0].fields is required");

        expect(state).toEqual(before);
    });

    test("applies a corrected mixed batch once after a rejected attempt", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.review_status = "pending_optimize";
        const malformedOutput = {
            modified: [{id: "tp_001", title: "wrong wrapper", group: "g", tags: [], priority: "LOW"}],
            added: [{title: "new point", group: "g", tags: [], priority: "LOW"}],
        } as unknown as RawAiOptimizeOutput;

        expect(() => applyAiOptimization(state, malformedOutput)).toThrow("modified[0].fields is required");

        const {reviewState, skippedCount} = applyAiOptimization(state, {
            modified: [{id: "tp_001", fields: {title: "corrected", group: "g", tags: [], priority: "HIGH"}}],
            added: [{title: "new point", group: "g", tags: [], priority: "LOW"}],
        });

        expect(skippedCount).toBe(0);
        expect(reviewState.round).toBe(2);
        expect(reviewState.test_points.find((tp) => tp.id === "tp_001")!.current.title).toBe("corrected");
        expect(reviewState.test_points.find((tp) => tp.id === "tp_004")!.ai_status).toBe("added");
    });
});
