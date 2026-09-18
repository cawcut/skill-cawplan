import {describe, expect, test} from "vitest";
import {
    checkUnresolvedFeedback,
    markTestPointsArchived,
    testPointsPendingArchive,
    toArchiveSubmissionItem,
} from "../src/lib/testpoint-review/archive-submission.js";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";
import type {TestPoint} from "../src/lib/testpoint-review/types.js";

function withTestPoints(overrides: Partial<TestPoint>[]) {
    const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
    state.test_points = state.test_points.map((tp, i) => ({...tp, ...overrides[i]}));
    return state;
}

describe("testPointsPendingArchive (design §4/§4.1, plan step 19)", () => {
    test("excludes deleted test points", () => {
        const state = withTestPoints([{status: "deleted"}, {}, {}]);

        const pending = testPointsPendingArchive(state);

        expect(pending.map((tp) => tp.id)).toEqual(["tp_002", "tp_003"]);
    });

    test("excludes already-archived test points", () => {
        const state = withTestPoints([{archived: true}, {}, {}]);

        const pending = testPointsPendingArchive(state);

        expect(pending.map((tp) => tp.id)).toEqual(["tp_002", "tp_003"]);
    });

    test("includes unchanged, edited, and added test points", () => {
        const state = withTestPoints([{status: "edited"}, {status: "added"}, {}]);

        const pending = testPointsPendingArchive(state);

        expect(pending).toHaveLength(3);
    });
});

describe("toArchiveSubmissionItem (SKILL.md §9 is_edited semantics)", () => {
    test("unchanged test point maps to is_edited: false", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});

        const item = toArchiveSubmissionItem(state.test_points[0]);

        expect(item.is_edited).toBe(false);
        expect(item.title).toBe(state.test_points[0].current.title);
        expect(item.group).toBe(state.test_points[0].current.group);
        expect(item.tags).toEqual(state.test_points[0].current.tags);
        expect(item.priority).toBe(state.test_points[0].current.priority);
    });

    test("edited test point maps to is_edited: true", () => {
        const state = withTestPoints([{status: "edited"}, {}, {}]);

        const item = toArchiveSubmissionItem(state.test_points[0]);

        expect(item.is_edited).toBe(true);
    });

    test("QA-added test point maps to is_edited: true", () => {
        const state = withTestPoints([{status: "added", source: "qa"}, {}, {}]);

        const item = toArchiveSubmissionItem(state.test_points[0]);

        expect(item.is_edited).toBe(true);
    });

    test("submitted item reflects current fields, not original", () => {
        const state = withTestPoints([
            {
                status: "edited",
                current: {title: "revised", group: "g2", tags: ["y"], priority: "LOW"},
            },
            {},
            {},
        ]);

        const item = toArchiveSubmissionItem(state.test_points[0]);

        expect(item).toEqual({title: "revised", group: "g2", tags: ["y"], priority: "LOW", is_edited: true});
    });
});

describe("checkUnresolvedFeedback (design §4.2, plan step 19)", () => {
    test("reports no unresolved feedback when nothing is commented", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});

        const result = checkUnresolvedFeedback(state);

        expect(result.hasUnresolvedFeedback).toBe(false);
    });

    test("flags a pending test-point comment", () => {
        const state = withTestPoints([
            {comments: [{id: "c_1", text: "hi", author: "qa", resolved: false}]},
            {},
            {},
        ]);

        const result = checkUnresolvedFeedback(state);

        expect(result.hasUnresolvedFeedback).toBe(true);
        expect(result.commentedTestPointCount).toBe(1);
    });

    test("flags unresolved overall feedback", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.global_comments = [{id: "c_g", text: "overall", author: "qa", resolved: false}];

        const result = checkUnresolvedFeedback(state);

        expect(result.hasUnresolvedFeedback).toBe(true);
        expect(result.globalCommentCount).toBe(1);
    });

    test("a comment on an already-archived row does not block submission", () => {
        const state = withTestPoints([
            {archived: true, comments: [{id: "c_1", text: "stale", author: "qa", resolved: false}]},
            {},
            {},
        ]);

        const result = checkUnresolvedFeedback(state);

        expect(result.hasUnresolvedFeedback).toBe(false);
    });

    test("a comment on a deleted row blocks submission until AI processes it", () => {
        const state = withTestPoints([
            {status: "deleted", comments: [{id: "c_1", text: "keep this feedback", author: "qa", resolved: false}]},
            {},
            {},
        ]);

        const result = checkUnresolvedFeedback(state);

        expect(result.hasUnresolvedFeedback).toBe(true);
        expect(result.commentedTestPointCount).toBe(1);
    });
});

describe("markTestPointsArchived (design §4.1, plan step 19)", () => {
    test("marks the given ids archived:true, leaves others untouched", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});

        const {archivedCount} = markTestPointsArchived(state, ["tp_001", "tp_002"]);

        expect(archivedCount).toBe(2);
        expect(state.test_points.find((tp) => tp.id === "tp_001")!.archived).toBe(true);
        expect(state.test_points.find((tp) => tp.id === "tp_002")!.archived).toBe(true);
        expect(state.test_points.find((tp) => tp.id === "tp_003")!.archived).toBeFalsy();
    });

    test("does not double count ids that are already archived", () => {
        const state = withTestPoints([{archived: true}, {}, {}]);

        const {archivedCount} = markTestPointsArchived(state, ["tp_001", "tp_002"]);

        expect(archivedCount).toBe(1);
    });

    test("archived test points are then excluded from a subsequent pending-archive pass (repeatable submit, plan step 19 point 7)", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});

        markTestPointsArchived(state, ["tp_001"]);
        const pending = testPointsPendingArchive(state);

        expect(pending.map((tp) => tp.id)).not.toContain("tp_001");
    });
});
