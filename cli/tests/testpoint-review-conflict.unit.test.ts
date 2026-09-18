import {afterEach, beforeEach, describe, expect, test} from "vitest";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {dispatchTestPointReviewRequest} from "../src/lib/testpoint-review/testpoint-review-web-server.js";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";
import {saveReviewState} from "../src/lib/testpoint-review/store.js";
import type {ReviewState} from "../src/lib/testpoint-review/types.js";

const TOKEN = "test-token";

function req(method: string, path: string, updatedAt?: string) {
    const params = new URLSearchParams({token: TOKEN});
    if (updatedAt !== undefined) params.set("updated_at", updatedAt);
    return {method, url: `${path}?${params.toString()}`};
}

describe("dispatchTestPointReviewRequest concurrent/multi-tab conflict detection (design §8.8)", () => {
    let dir: string;
    let originalEnv: string | undefined;
    let state: ReviewState;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "testpoint-review-conflict-test-"));
        originalEnv = process.env.CAWPLAN_TESTPOINT_REVIEW_PATH;
        process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = dir;
        state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        saveReviewState(state);
    });

    afterEach(() => {
        if (originalEnv === undefined) delete process.env.CAWPLAN_TESTPOINT_REVIEW_PATH;
        else process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = originalEnv;
        rmSync(dir, {recursive: true, force: true});
    });

    test("editing without an updated_at param never conflicts (backward compatible)", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001"),
            JSON.stringify({title: "no timestamp sent"}),
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(200);
    });

    test("editing with the current updated_at succeeds and returns the new updated_at", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001", state.updated_at),
            JSON.stringify({title: "matches current timestamp"}),
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(200);
        expect((result.body as {updated_at: string}).updated_at).toBe(state.updated_at);
    });

    test("tab A edits, tab B (stale updated_at) then edits and gets a 409 conflict instead of silently overwriting", async () => {
        const staleTimestamp = state.updated_at;

        const tabA = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001", staleTimestamp),
            JSON.stringify({title: "tab A wins"}),
            TOKEN,
            {reviewState: state},
        );
        expect(tabA.status).toBe(200);
        expect(state.updated_at).not.toBe(staleTimestamp);

        const tabB = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_002", staleTimestamp),
            JSON.stringify({title: "tab B should be rejected"}),
            TOKEN,
            {reviewState: state},
        );

        expect(tabB.status).toBe(409);
        expect((tabB.body as {error: string}).error).toBe("conflict");
        expect(state.test_points.find((tp) => tp.id === "tp_002")!.current.title).not.toBe("tab B should be rejected");
        expect(state.test_points.find((tp) => tp.id === "tp_001")!.current.title).toBe("tab A wins");
    });

    test("delete/restore honors the conflict check", async () => {
        const staleTimestamp = state.updated_at;
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001", staleTimestamp),
            JSON.stringify({title: "bump timestamp"}),
            TOKEN,
            {reviewState: state},
        );

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_002/delete", staleTimestamp),
            "{}",
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(409);
        expect(state.test_points.find((tp) => tp.id === "tp_002")!.status).not.toBe("deleted");
    });

    test("adding a test-point comment honors the conflict check", async () => {
        const staleTimestamp = state.updated_at;
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001", staleTimestamp),
            JSON.stringify({title: "bump timestamp"}),
            TOKEN,
            {reviewState: state},
        );

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_002/comments", staleTimestamp),
            JSON.stringify({text: "should be rejected"}),
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(409);
        expect(state.test_points.find((tp) => tp.id === "tp_002")!.comments).toHaveLength(0);
    });

    test("deleting a test-point comment honors the conflict check", async () => {
        const withComment = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "first"}),
            TOKEN,
            {reviewState: state},
        );
        const commentId = (withComment.body as {test_point: {comments: {id: string}[]}}).test_point.comments[0].id;
        const staleTimestamp = state.updated_at;

        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_002"),
            JSON.stringify({title: "bump timestamp"}),
            TOKEN,
            {reviewState: state},
        );

        const result = await dispatchTestPointReviewRequest(
            req("DELETE", `/api/test-points/tp_001/comments/${commentId}`, staleTimestamp),
            "",
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(409);
        expect(state.test_points.find((tp) => tp.id === "tp_001")!.comments).toHaveLength(1);
    });

    test("global comment add/delete and add-test-point all honor the conflict check", async () => {
        const staleTimestamp = state.updated_at;
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001"),
            JSON.stringify({title: "bump timestamp"}),
            TOKEN,
            {reviewState: state},
        );

        const addGlobal = await dispatchTestPointReviewRequest(
            req("POST", "/api/global-comments", staleTimestamp),
            JSON.stringify({text: "should be rejected"}),
            TOKEN,
            {reviewState: state},
        );
        expect(addGlobal.status).toBe(409);

        const addTestPoint = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points", staleTimestamp),
            JSON.stringify({title: "should be rejected"}),
            TOKEN,
            {reviewState: state},
        );
        expect(addTestPoint.status).toBe(409);
    });

    test("lock check still wins over conflict check when the review is locked", async () => {
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "lock it"}),
            TOKEN,
            {reviewState: state},
        );
        await dispatchTestPointReviewRequest(req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state});

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001", "some-arbitrary-stale-value"),
            JSON.stringify({title: "irrelevant"}),
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(409);
        expect((result.body as {error: string}).error).toBe("review is locked for AI optimization");
    });
});
