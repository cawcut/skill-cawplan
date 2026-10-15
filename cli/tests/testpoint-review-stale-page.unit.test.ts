import {afterEach, beforeEach, describe, expect, test} from "vitest";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {dispatchTestPointReviewRequest} from "../src/lib/testpoint-review/testpoint-review-web-server.js";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";
import {loadReviewState, saveReviewState} from "../src/lib/testpoint-review/store.js";
import {testPointReviewHtml} from "../src/lib/testpoint-review/testpoint-review-html.js";
import type {ReviewState} from "../src/lib/testpoint-review/types.js";
import type {QAInsightsWriteEnvelope} from "../src/lib/qa-insights/types.js";

const TOKEN = "test-token";

function req(method: string, path: string, updatedAt?: string) {
    const params = new URLSearchParams({token: TOKEN});
    if (updatedAt !== undefined) params.set("updated_at", updatedAt);
    return {method, url: `${path}?${params.toString()}`};
}

const success: QAInsightsWriteEnvelope = {
    outcome: "SUCCESS",
    command: "testpoints archive",
    meta: {product_id: "p", requirement_id: "r", dry_run: false},
};
const noRecord = () => ({status: "skipped_empty" as const});

describe("stale page protection for Optimize / Save / in-flight Save", () => {
    let dir: string;
    let originalEnv: string | undefined;
    let state: ReviewState;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "testpoint-review-stale-page-"));
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

    test("Save from a page with a stale updated_at is rejected and archives nothing", async () => {
        let archived = false;
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/save-to-cawplan", "1999-01-01T00:00:00.000Z"), "{}", TOKEN,
            {reviewState: state, recordHumanInput: noRecord, archiveTestPoints: async () => { archived = true; return success; }},
        );
        expect(result.status).toBe(409);
        expect((result.body as {error: string}).error).toBe("conflict");
        expect(archived).toBe(false);
    });

    test("Save with the current updated_at still succeeds", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/save-to-cawplan", state.updated_at), "{}", TOKEN,
            {reviewState: state, recordHumanInput: noRecord, archiveTestPoints: async () => success},
        );
        expect(result.status).toBe(200);
    });

    test("Optimize from a stale page is rejected before it can lock the review", async () => {
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/optimize", "1999-01-01T00:00:00.000Z"), "{}", TOKEN,
            {reviewState: state, recordHumanInput: noRecord},
        );
        expect(result.status).toBe(409);
        expect((result.body as {error: string}).error).toBe("conflict");
        expect(state.review_status).toBe("reviewing");
    });

    test("an edit accepted-looking during an in-flight Save is rejected instead of being overwritten", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        let editStatus = 0;
        const save = dispatchTestPointReviewRequest(
            req("POST", "/api/save-to-cawplan", state.updated_at), "{}", TOKEN,
            {
                reviewState: state,
                recordHumanInput: noRecord,
                archiveTestPoints: async () => {
                    const live = loadReviewState(state.review_id);
                    const edit = await dispatchTestPointReviewRequest(
                        req("POST", "/api/test-points/tp_001", live.updated_at),
                        JSON.stringify({title: "typed during save"}), TOKEN, {reviewState: live},
                    );
                    editStatus = edit.status;
                    await gate;
                    return success;
                },
            },
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        release();
        expect((await save).status).toBe(200);
        expect(editStatus).toBe(409);
        expect(loadReviewState(state.review_id).test_points[0].current.title).not.toBe("typed during save");

        // The flag is released afterwards: normal writes work again.
        const after = loadReviewState(state.review_id);
        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001", after.updated_at), JSON.stringify({title: "after"}), TOKEN, {reviewState: after},
        );
        expect(result.status).toBe(200);
    });

    test("page sends its revision on Optimize/Save and renders a stale banner that locks the page", () => {
        const html = testPointReviewHtml(state, TOKEN);
        expect(html).toContain('id="stale-banner"');
        expect(html).toContain('withUpdatedAt("/api/optimize?token="');
        expect(html).toContain('withUpdatedAt("/api/save-to-cawplan?token="');
        expect(html).toContain("showStaleFor409");
    });
});
