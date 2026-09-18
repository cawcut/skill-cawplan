import {describe, expect, test} from "vitest";
import {advanceReviewRound} from "../src/lib/testpoint-review/round-switch.js";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";
import type {TestPoint} from "../src/lib/testpoint-review/types.js";

function withTestPoints(overrides: Partial<TestPoint>[]) {
    const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
    state.test_points = state.test_points.map((tp, i) => ({...tp, ...overrides[i]}));
    return state;
}

describe("advanceReviewRound (design §3.2/§3.3/§3.6, plan step 16.5)", () => {
    test("increments round by 1", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        const before = state.round;

        advanceReviewRound(state, {modified: [], added: []});

        expect(state.round).toBe(before + 1);
    });

    test("deleted test points are removed from test_points and recorded as tombstones", () => {
        const state = withTestPoints([{status: "deleted"}, {}, {}]);
        const deletedTitle = state.test_points[0].original.title;
        const roundBeforeSwitch = state.round;

        advanceReviewRound(state, {modified: [], added: []});

        expect(state.test_points.find((tp) => tp.id === "tp_001")).toBeUndefined();
        expect(state.deleted_tombstones).toHaveLength(1);
        expect(state.deleted_tombstones[0]).toEqual({title: deletedTitle, deleted_in_round: roundBeforeSwitch});
    });

    test("edited/added statuses reset to unchanged unless AI modified them this round", () => {
        const state = withTestPoints([{status: "edited"}, {status: "added"}, {}]);

        advanceReviewRound(state, {modified: [], added: []});

        expect(state.test_points.find((tp) => tp.id === "tp_001")!.status).toBe("unchanged");
        expect(state.test_points.find((tp) => tp.id === "tp_002")!.status).toBe("unchanged");
        expect(state.test_points.find((tp) => tp.id === "tp_003")!.status).toBe("unchanged");
    });

    test("AI-modified ids get ai_status 'modified' and current is replaced with AI's fields; untouched ones get 'none'", () => {
        const state = withTestPoints([{}, {}, {}]);
        const newFields = {title: "revised by AI", group: "g", tags: ["x"], priority: "HIGH"};

        advanceReviewRound(state, {modified: [{id: "tp_002", fields: newFields}], added: []});

        expect(state.test_points.find((tp) => tp.id === "tp_001")!.ai_status).toBe("none");
        expect(state.test_points.find((tp) => tp.id === "tp_002")!.ai_status).toBe("modified");
        expect(state.test_points.find((tp) => tp.id === "tp_002")!.current).toEqual(newFields);
        expect(state.test_points.find((tp) => tp.id === "tp_003")!.ai_status).toBe("none");
    });

    test("AI-added entries get a fresh id from next_seq, status 'added', ai_status 'added', source 'ai'", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        const nextSeqBefore = state.next_seq;

        advanceReviewRound(state, {
            modified: [],
            added: [{title: "new AI test point", group: "g", tags: [], priority: "LOW"}],
        });

        const added = state.test_points.find((tp) => tp.id === `tp_${String(nextSeqBefore).padStart(3, "0")}`);
        expect(added).toBeDefined();
        expect(added!.status).toBe("added");
        expect(added!.ai_status).toBe("added");
        expect(added!.source).toBe("ai");
        expect(added!.original).toEqual({title: "new AI test point", group: "g", tags: [], priority: "LOW"});
        expect(state.next_seq).toBe(nextSeqBefore + 1);
    });

    test("all test-point comments and global_comments are cleared", () => {
        const state = withTestPoints([
            {comments: [{id: "c_1", text: "hi", author: "qa", resolved: false}]},
            {},
            {},
        ]);
        state.global_comments = [{id: "c_g", text: "overall", author: "qa", resolved: false}];

        advanceReviewRound(state, {modified: [], added: []});

        expect(state.test_points.every((tp) => tp.comments.length === 0)).toBe(true);
        expect(state.global_comments).toHaveLength(0);
    });

    test("original is preserved byte-for-byte and never replaced by current, even when AI modifies current again", () => {
        const state = withTestPoints([
            {
                current: {title: "edited title", group: "g", tags: ["x"], priority: "HIGH"},
                status: "edited",
            },
            {},
            {},
        ]);
        const originalBefore = {...state.test_points[0].original};
        const aiFields = {title: "AI-revised title", group: "g", tags: ["x"], priority: "HIGH"};

        advanceReviewRound(state, {modified: [{id: "tp_001", fields: aiFields}], added: []});

        const survivor = state.test_points.find((tp) => tp.id === "tp_001")!;
        expect(survivor.original).toEqual(originalBefore);
        expect(survivor.current).toEqual(aiFields);
        expect(survivor.original).not.toEqual(survivor.current);
    });

    test("archived test points are skipped entirely: no status/ai_status/comments recalculation", () => {
        const state = withTestPoints([
            {
                archived: true,
                status: "edited",
                ai_status: "modified",
                comments: [{id: "c_1", text: "should stay", author: "qa", resolved: false}],
            },
            {},
            {},
        ]);

        advanceReviewRound(state, {modified: [], added: []});

        const archivedPoint = state.test_points.find((tp) => tp.id === "tp_001")!;
        expect(archivedPoint.archived).toBe(true);
        expect(archivedPoint.status).toBe("edited");
        expect(archivedPoint.ai_status).toBe("modified");
        expect(archivedPoint.comments).toHaveLength(1);
    });

    test("archived + deleted test points are kept (archived wins, not turned into a tombstone)", () => {
        const state = withTestPoints([{archived: true, status: "deleted"}, {}, {}]);

        advanceReviewRound(state, {modified: [], added: []});

        expect(state.test_points.find((tp) => tp.id === "tp_001")).toBeDefined();
        expect(state.deleted_tombstones).toHaveLength(0);
    });

    test("pre_delete_status is cleaned up on surviving (non-deleted) test points", () => {
        const state = withTestPoints([{status: "edited", pre_delete_status: "unchanged"}, {}, {}]);

        advanceReviewRound(state, {modified: [], added: []});

        expect(state.test_points.find((tp) => tp.id === "tp_001")!.pre_delete_status).toBeUndefined();
    });

    test("existing tombstones from prior rounds are preserved, not overwritten", () => {
        const state = withTestPoints([{status: "deleted"}, {}, {}]);
        state.deleted_tombstones = [{title: "old deleted thing", deleted_in_round: 1}];

        advanceReviewRound(state, {modified: [], added: []});

        expect(state.deleted_tombstones).toHaveLength(2);
        expect(state.deleted_tombstones[0]).toEqual({title: "old deleted thing", deleted_in_round: 1});
    });
});
