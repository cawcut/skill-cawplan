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

describe("dispatchTestPointReviewRequest delete/restore route", () => {
    let dir: string;
    let originalEnv: string | undefined;
    let state: ReviewState;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "testpoint-review-delete-test-"));
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

    test("marks a test point deleted without removing it, and persists to disk", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/delete"),
            "{}",
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(200);
        const updated = state.test_points.find((tp) => tp.id === "tp_001")!;
        expect(updated.status).toBe("deleted");
        expect(state.test_points).toHaveLength(3);

        const persisted = JSON.parse(readFileSync(reviewFilePath(state.review_id), "utf8")) as ReviewState;
        const persistedPoint = persisted.test_points.find((tp) => tp.id === "tp_001")!;
        expect(persistedPoint.status).toBe("deleted");
        expect(persisted.test_points).toHaveLength(3);
    });

    test("restore reverts an untouched deleted test point back to unchanged", async () => {
        await dispatchTestPointReviewRequest(req("POST", "/api/test-points/tp_001/delete"), "{}", TOKEN, {reviewState: state});

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/restore"),
            "{}",
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(200);
        const updated = state.test_points.find((tp) => tp.id === "tp_001")!;
        expect(updated.status).toBe("unchanged");
    });

    test("restore reverts an edited-then-deleted test point back to edited, not unchanged", async () => {
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001"),
            JSON.stringify({title: "修改后的标题"}),
            TOKEN,
            {reviewState: state},
        );
        await dispatchTestPointReviewRequest(req("POST", "/api/test-points/tp_001/delete"), "{}", TOKEN, {reviewState: state});

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/restore"),
            "{}",
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(200);
        const updated = state.test_points.find((tp) => tp.id === "tp_001")!;
        expect(updated.status).toBe("edited");
        expect(updated.current.title).toBe("修改后的标题");
    });

    test("restore reverts a manually-added-then-deleted test point back to added, not unchanged", async () => {
        const addResult = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points"),
            JSON.stringify({title: "新增的测试点", group: "新分组", tags: ["手动"], priority: "LOW"}),
            TOKEN,
            {reviewState: state},
        );
        const addedId = (addResult.body as {test_point: {id: string}}).test_point.id;

        await dispatchTestPointReviewRequest(req("POST", `/api/test-points/${addedId}/delete`), "{}", TOKEN, {reviewState: state});

        const result = await dispatchTestPointReviewRequest(
            req("POST", `/api/test-points/${addedId}/restore`),
            "{}",
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(200);
        const updated = state.test_points.find((tp) => tp.id === addedId)!;
        expect(updated.status).toBe("added");
    });

    test("delete/restore never mutate the original snapshot field", async () => {
        const before = {...state.test_points.find((tp) => tp.id === "tp_001")!.original};

        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001"),
            JSON.stringify({title: "修改后的标题"}),
            TOKEN,
            {reviewState: state},
        );
        await dispatchTestPointReviewRequest(req("POST", "/api/test-points/tp_001/delete"), "{}", TOKEN, {reviewState: state});
        await dispatchTestPointReviewRequest(req("POST", "/api/test-points/tp_001/restore"), "{}", TOKEN, {reviewState: state});

        const after = state.test_points.find((tp) => tp.id === "tp_001")!.original;
        expect(after).toEqual(before);
    });

    test("returns 404 for an unknown test point id on delete", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_999/delete"),
            "{}",
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(404);
    });

    test("rejects delete requests without a valid token", async () => {
        const result = await dispatchTestPointReviewRequest(
            {method: "POST", url: "/api/test-points/tp_001/delete"},
            "{}",
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(403);
        expect(state.test_points.find((tp) => tp.id === "tp_001")!.status).not.toBe("deleted");
    });

    test("restoring a non-deleted test point is a no-op on status", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/restore"),
            "{}",
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(200);
        const updated = state.test_points.find((tp) => tp.id === "tp_001")!;
        expect(updated.status).toBe("unchanged");
    });
});
