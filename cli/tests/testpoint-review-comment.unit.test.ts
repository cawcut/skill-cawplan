import {afterEach, beforeEach, describe, expect, test} from "vitest";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {dispatchTestPointReviewRequest} from "../src/lib/testpoint-review/testpoint-review-web-server.js";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";
import {reviewFilePath, saveReviewState} from "../src/lib/testpoint-review/store.js";
import type {ReviewState} from "../src/lib/testpoint-review/types.js";

const TOKEN = "test-token";

function req(method: string, path: string) {
    return {method, url: `${path}${path.includes("?") ? "&" : "?"}token=${TOKEN}`};
}

describe("dispatchTestPointReviewRequest comments route", () => {
    let dir: string;
    let originalEnv: string | undefined;
    let state: ReviewState;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "testpoint-review-comment-test-"));
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

    test("adds a comment and persists to disk", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "这里边界没覆盖全"}),
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(200);
        const updated = state.test_points.find((tp) => tp.id === "tp_001")!;
        expect(updated.comments).toHaveLength(1);
        expect(updated.comments[0].text).toBe("这里边界没覆盖全");
        expect(updated.comments[0].author).toBe("qa");
        expect(updated.comments[0].resolved).toBe(false);
        expect((updated.comments[0] as unknown as Record<string, unknown>).to_ai).toBeUndefined();

        const persisted = JSON.parse(readFileSync(reviewFilePath(state.review_id), "utf8")) as ReviewState;
        const persistedPoint = persisted.test_points.find((tp) => tp.id === "tp_001")!;
        expect(persistedPoint.comments).toHaveLength(1);
    });

    test("does not change the test point status when only commenting", async () => {
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "备注"}),
            TOKEN,
            {reviewState: state},
        );
        const updated = state.test_points.find((tp) => tp.id === "tp_001")!;
        expect(updated.status).toBe("unchanged");
    });

    test("supports multiple independent comments on the same test point, in order", async () => {
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "第一条"}),
            TOKEN,
            {reviewState: state},
        );
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "第二条"}),
            TOKEN,
            {reviewState: state},
        );

        const updated = state.test_points.find((tp) => tp.id === "tp_001")!;
        expect(updated.comments).toHaveLength(2);
        expect(updated.comments[0].text).toBe("第一条");
        expect(updated.comments[1].text).toBe("第二条");
    });

    test("rejects an empty or whitespace-only comment", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "   "}),
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(400);
        const updated = state.test_points.find((tp) => tp.id === "tp_001")!;
        expect(updated.comments).toHaveLength(0);
    });

    test("returns 404 for an unknown test point id", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_999/comments"),
            JSON.stringify({text: "x"}),
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(404);
    });

    test("rejects requests without a valid token", async () => {
        const result = await dispatchTestPointReviewRequest(
            {method: "POST", url: "/api/test-points/tp_001/comments"},
            JSON.stringify({text: "x"}),
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(403);
        const updated = state.test_points.find((tp) => tp.id === "tp_001")!;
        expect(updated.comments).toHaveLength(0);
    });

    test("deletes a comment permanently and persists to disk", async () => {
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "第一条"}),
            TOKEN,
            {reviewState: state},
        );
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "第二条"}),
            TOKEN,
            {reviewState: state},
        );
        const beforeDelete = state.test_points.find((tp) => tp.id === "tp_001")!;
        const commentId = beforeDelete.comments[0].id;

        const result = await dispatchTestPointReviewRequest(
            req("DELETE", `/api/test-points/tp_001/comments/${commentId}`),
            "",
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(200);
        const updated = state.test_points.find((tp) => tp.id === "tp_001")!;
        expect(updated.comments).toHaveLength(1);
        expect(updated.comments[0].text).toBe("第二条");

        const persisted = JSON.parse(readFileSync(reviewFilePath(state.review_id), "utf8")) as ReviewState;
        const persistedPoint = persisted.test_points.find((tp) => tp.id === "tp_001")!;
        expect(persistedPoint.comments).toHaveLength(1);
        expect(persistedPoint.comments[0].text).toBe("第二条");
    });

    test("returns 404 when deleting an unknown comment id", async () => {
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "第一条"}),
            TOKEN,
            {reviewState: state},
        );

        const result = await dispatchTestPointReviewRequest(
            req("DELETE", "/api/test-points/tp_001/comments/c_does_not_exist"),
            "",
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(404);
        const updated = state.test_points.find((tp) => tp.id === "tp_001")!;
        expect(updated.comments).toHaveLength(1);
    });

    test("returns 404 when deleting a comment for an unknown test point", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("DELETE", "/api/test-points/tp_999/comments/c_does_not_exist"),
            "",
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(404);
    });

    test("rejects comment deletion without a valid token", async () => {
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "第一条"}),
            TOKEN,
            {reviewState: state},
        );
        const beforeDelete = state.test_points.find((tp) => tp.id === "tp_001")!;
        const commentId = beforeDelete.comments[0].id;

        const result = await dispatchTestPointReviewRequest(
            {method: "DELETE", url: `/api/test-points/tp_001/comments/${commentId}`},
            "",
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(403);
        const updated = state.test_points.find((tp) => tp.id === "tp_001")!;
        expect(updated.comments).toHaveLength(1);
    });
});

describe("dispatchTestPointReviewRequest global comments route", () => {
    let dir: string;
    let originalEnv: string | undefined;
    let state: ReviewState;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "testpoint-review-global-comment-test-"));
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

    test("adds a global comment and persists to disk", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/global-comments"),
            JSON.stringify({text: "漏了超时的边界情况"}),
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(200);
        expect(state.global_comments).toHaveLength(1);
        expect(state.global_comments[0].text).toBe("漏了超时的边界情况");
        expect(state.global_comments[0].author).toBe("qa");

        const persisted = JSON.parse(readFileSync(reviewFilePath(state.review_id), "utf8")) as ReviewState;
        expect(persisted.global_comments).toHaveLength(1);
        expect(persisted.global_comments[0].text).toBe("漏了超时的边界情况");
    });

    test("supports multiple independent global comments, in order", async () => {
        await dispatchTestPointReviewRequest(
            req("POST", "/api/global-comments"),
            JSON.stringify({text: "第一条"}),
            TOKEN,
            {reviewState: state},
        );
        await dispatchTestPointReviewRequest(
            req("POST", "/api/global-comments"),
            JSON.stringify({text: "第二条"}),
            TOKEN,
            {reviewState: state},
        );

        expect(state.global_comments).toHaveLength(2);
        expect(state.global_comments[0].text).toBe("第一条");
        expect(state.global_comments[1].text).toBe("第二条");
    });

    test("rejects an empty or whitespace-only global comment", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/global-comments"),
            JSON.stringify({text: "   "}),
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(400);
        expect(state.global_comments).toHaveLength(0);
    });

    test("rejects adding a global comment without a valid token", async () => {
        const result = await dispatchTestPointReviewRequest(
            {method: "POST", url: "/api/global-comments"},
            JSON.stringify({text: "x"}),
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(403);
        expect(state.global_comments).toHaveLength(0);
    });

    test("deletes a global comment permanently and persists to disk", async () => {
        await dispatchTestPointReviewRequest(
            req("POST", "/api/global-comments"),
            JSON.stringify({text: "第一条"}),
            TOKEN,
            {reviewState: state},
        );
        await dispatchTestPointReviewRequest(
            req("POST", "/api/global-comments"),
            JSON.stringify({text: "第二条"}),
            TOKEN,
            {reviewState: state},
        );
        const commentId = state.global_comments[0].id;

        const result = await dispatchTestPointReviewRequest(
            req("DELETE", `/api/global-comments/${commentId}`),
            "",
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(200);
        expect(state.global_comments).toHaveLength(1);
        expect(state.global_comments[0].text).toBe("第二条");

        const persisted = JSON.parse(readFileSync(reviewFilePath(state.review_id), "utf8")) as ReviewState;
        expect(persisted.global_comments).toHaveLength(1);
        expect(persisted.global_comments[0].text).toBe("第二条");
    });

    test("returns 404 when deleting an unknown global comment id", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("DELETE", "/api/global-comments/c_does_not_exist"),
            "",
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(404);
    });

    test("rejects global comment deletion without a valid token", async () => {
        await dispatchTestPointReviewRequest(
            req("POST", "/api/global-comments"),
            JSON.stringify({text: "第一条"}),
            TOKEN,
            {reviewState: state},
        );
        const commentId = state.global_comments[0].id;

        const result = await dispatchTestPointReviewRequest(
            {method: "DELETE", url: `/api/global-comments/${commentId}`},
            "",
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(403);
        expect(state.global_comments).toHaveLength(1);
    });
});
