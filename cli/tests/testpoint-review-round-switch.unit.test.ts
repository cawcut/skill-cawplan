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
        expect(added!.round_baseline).toEqual(added!.current);
        expect(state.next_seq).toBe(nextSeqBefore + 1);
    });

    test("all test-point comments are cleared", () => {
        const state = withTestPoints([
            {comments: [{id: "c_1", text: "hi", author: "qa", resolved: false}]},
            {},
            {},
        ]);

        advanceReviewRound(state, {modified: [], added: []});

        expect(state.test_points.every((tp) => tp.comments.length === 0)).toBe(true);
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
        expect(survivor.round_baseline).toEqual(aiFields);
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

describe("advanceReviewRound change-tag accumulation (two-phase)", () => {
    const aiModifies = (state: ReturnType<typeof withTestPoints>, id: string) => ({
        modified: [{id, fields: {...state.test_points.find((tp) => tp.id === id)!.current, title: "AI edit"}}],
        added: [],
    });
    const statusOf = (state: ReturnType<typeof withTestPoints>, id: string) =>
        state.test_points.find((tp) => tp.id === id)!.ai_status;

    test("round the user viewed: tags are cleared (regression)", () => {
        const state = withTestPoints([{ai_status: "added"}, {ai_status: "modified"}, {}]);
        state.last_viewed_review_round = state.round;

        advanceReviewRound(state, {modified: [], added: []});

        expect(statusOf(state, "tp_001")).toBe("none");
        expect(statusOf(state, "tp_002")).toBe("none");
    });

    test("never-viewed Review (field absent): no accumulation", () => {
        const state = withTestPoints([{ai_status: "added"}, {}, {}]);

        advanceReviewRound(state, aiModifies(state, "tp_002"));

        expect(statusOf(state, "tp_001")).toBe("none");
        expect(statusOf(state, "tp_002")).toBe("modified");
    });

    test("unviewed round after an earlier viewed one: tags accumulate", () => {
        const state = withTestPoints([{ai_status: "added"}, {ai_status: "modified"}, {ai_status: "none"}]);
        state.last_viewed_review_round = state.round - 1;
        const out = {
            modified: ["tp_001", "tp_002", "tp_003"].map((id) => ({
                id, fields: {...state.test_points.find((tp) => tp.id === id)!.current, title: `AI ${id}`},
            })),
            added: [],
        };

        advanceReviewRound(state, out);

        expect(statusOf(state, "tp_001")).toBe("added");    // added + modified
        expect(statusOf(state, "tp_002")).toBe("modified"); // modified + modified
        expect(statusOf(state, "tp_003")).toBe("modified"); // none + modified
    });

    test("accumulation keeps added + untouched as added, none + untouched as none", () => {
        const state = withTestPoints([{ai_status: "added"}, {ai_status: "modified"}, {ai_status: "none"}]);
        state.last_viewed_review_round = state.round - 1;

        advanceReviewRound(state, {modified: [], added: []});

        expect(statusOf(state, "tp_001")).toBe("added");
        expect(statusOf(state, "tp_002")).toBe("modified");
        expect(statusOf(state, "tp_003")).toBe("none");
    });

    test("status still resets, AI-added rows are 'added', round_baseline follows current", () => {
        const state = withTestPoints([{status: "edited", ai_status: "none"}, {}, {}]);
        state.last_viewed_review_round = state.round - 1;

        advanceReviewRound(state, {...aiModifies(state, "tp_002"), added: [{...state.test_points[0].current, title: "New"}]});

        expect(state.test_points.find((tp) => tp.id === "tp_001")!.status).toBe("unchanged");
        const modified = state.test_points.find((tp) => tp.id === "tp_002")!;
        expect(modified.round_baseline).toEqual(modified.current);
        expect(state.test_points.find((tp) => tp.current.title === "New")!.ai_status).toBe("added");
    });
});
