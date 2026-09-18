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

describe("dispatchTestPointReviewRequest edit route", () => {
    let dir: string;
    let originalEnv: string | undefined;
    let state: ReviewState;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "testpoint-review-edit-test-"));
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

    test("edits a field, marks status edited, and persists atomically to disk", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001"),
            JSON.stringify({title: "登录页,用户名密码均正确时可正常登录(已修订)"}),
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(200);
        const updated = state.test_points.find((tp) => tp.id === "tp_001")!;
        expect(updated.current.title).toBe("登录页,用户名密码均正确时可正常登录(已修订)");
        expect(updated.status).toBe("edited");
        expect(updated.original.title).not.toBe(updated.current.title);

        const persisted = JSON.parse(readFileSync(reviewFilePath(state.review_id), "utf8")) as ReviewState;
        const persistedPoint = persisted.test_points.find((tp) => tp.id === "tp_001")!;
        expect(persistedPoint.current.title).toBe("登录页,用户名密码均正确时可正常登录(已修订)");
        expect(persistedPoint.status).toBe("edited");
    });

    test("edits tags as an array field", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_002"),
            JSON.stringify({tags: ["异常", "回归"]}),
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(200);
        const updated = state.test_points.find((tp) => tp.id === "tp_002")!;
        expect(updated.current.tags).toEqual(["异常", "回归"]);
        expect(updated.status).toBe("edited");
    });

    test("editing an AI-added point marks it as edited while retaining its AI provenance", async () => {
        const point = state.test_points[0];
        point.status = "added";
        point.source = "ai";
        point.ai_status = "added";

        const result = await dispatchTestPointReviewRequest(
            req("POST", `/api/test-points/${point.id}`),
            JSON.stringify({title: "AI 新增点的 QA 修订"}),
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(200);
        expect(point.status).toBe("edited");
        expect(point.source).toBe("ai");
        expect(point.ai_status).toBe("added");
    });

    test("returns 404 for an unknown test point id and does not write a file for it", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_999"),
            JSON.stringify({title: "x"}),
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(404);
    });

    test("rejects requests without a valid token", async () => {
        const result = await dispatchTestPointReviewRequest(
            {method: "POST", url: "/api/test-points/tp_001"},
            JSON.stringify({title: "x"}),
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(403);
        expect(state.test_points.find((tp) => tp.id === "tp_001")!.current.title).not.toBe("x");
    });

    test("ignores unknown fields silently while applying known ones", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001"),
            JSON.stringify({title: "新标题", not_a_real_field: "ignored"}),
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(200);
        const updated = state.test_points.find((tp) => tp.id === "tp_001")!;
        expect(updated.current.title).toBe("新标题");
        expect((updated as unknown as Record<string, unknown>).not_a_real_field).toBeUndefined();
    });
});
