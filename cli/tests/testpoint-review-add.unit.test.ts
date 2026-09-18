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

describe("dispatchTestPointReviewRequest add test point route", () => {
    let dir: string;
    let originalEnv: string | undefined;
    let state: ReviewState;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "testpoint-review-add-test-"));
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

    test("adds a manual test point with status added and source qa, persists to disk", async () => {
        const previousNextSeq = state.next_seq;

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points"),
            JSON.stringify({title: "新增的测试点", group: "新分组", tags: ["手动"], priority: "LOW"}),
            TOKEN,
            {reviewState: state},
        );

        expect(result.status).toBe(200);
        expect(state.test_points).toHaveLength(4);
        const added = state.test_points[3];
        expect(added.current).toEqual({title: "新增的测试点", group: "新分组", tags: ["手动"], priority: "LOW"});
        expect(added.original).toEqual(added.current);
        expect(added.status).toBe("added");
        expect(added.source).toBe("qa");
        expect(added.ai_status).toBe("none");
        expect(added.comments).toEqual([]);
        expect(state.next_seq).toBe(previousNextSeq + 1);

        const persisted = JSON.parse(readFileSync(reviewFilePath(state.review_id), "utf8")) as ReviewState;
        expect(persisted.test_points).toHaveLength(4);
        expect(persisted.next_seq).toBe(previousNextSeq + 1);
    });

    test("assigns unique, non-colliding, monotonically increasing ids across two additions", async () => {
        const first = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points"),
            JSON.stringify({title: "第一条新增"}),
            TOKEN,
            {reviewState: state},
        );
        const second = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points"),
            JSON.stringify({title: "第二条新增"}),
            TOKEN,
            {reviewState: state},
        );

        const firstId = (first.body as {test_point: {id: string}}).test_point.id;
        const secondId = (second.body as {test_point: {id: string}}).test_point.id;
        expect(firstId).not.toBe(secondId);

        const ids = state.test_points.map((tp) => tp.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test("defaults optional fields when omitted", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points"),
            JSON.stringify({title: "仅标题"}),
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(200);
        const added = state.test_points[state.test_points.length - 1];
        expect(added.current).toEqual({title: "仅标题", group: "", tags: [], priority: ""});
    });

    test("rejects an empty or whitespace-only title", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points"),
            JSON.stringify({title: "   "}),
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(400);
        expect(state.test_points).toHaveLength(3);
    });

    test("rejects requests without a valid token", async () => {
        const result = await dispatchTestPointReviewRequest(
            {method: "POST", url: "/api/test-points"},
            JSON.stringify({title: "x"}),
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(403);
        expect(state.test_points).toHaveLength(3);
    });
});
