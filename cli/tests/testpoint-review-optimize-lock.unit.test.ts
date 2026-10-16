import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {mkdtempSync, readFileSync, readdirSync, rmSync} from "node:fs";
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

describe("dispatchTestPointReviewRequest optimize (whole-page lock, no real AI call)", () => {
    let dir: string;
    let originalEnv: string | undefined;
    let originalOutbox: string | undefined;
    let originalCodexSession: string | undefined;
    let state: ReviewState;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "testpoint-review-optimize-test-"));
        originalEnv = process.env.CAWPLAN_TESTPOINT_REVIEW_PATH;
        originalOutbox = process.env.CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR;
        originalCodexSession = process.env.CODEX_SESSION_ID;
        process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = dir;
        process.env.CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR = join(dir, "outbox");
        process.env.CODEX_SESSION_ID = "html-session-1";
        state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        saveReviewState(state);
    });

    afterEach(() => {
        if (originalEnv === undefined) delete process.env.CAWPLAN_TESTPOINT_REVIEW_PATH;
        else process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = originalEnv;
        if (originalOutbox === undefined) delete process.env.CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR;
        else process.env.CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR = originalOutbox;
        if (originalCodexSession === undefined) delete process.env.CODEX_SESSION_ID;
        else process.env.CODEX_SESSION_ID = originalCodexSession;
        rmSync(dir, {recursive: true, force: true});
    });

    test("does not lock or close the page when there is no change to optimize", async () => {
        const recordHumanInput = vi.fn();
        const result = await dispatchTestPointReviewRequest(req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state, recordHumanInput});

        expect(result).toEqual({status: 200, body: {outcome: "NO_CHANGES"}});
        expect(state.review_status).toBe("reviewing");
        expect(state.optimize_requested_at).toBeUndefined();
        expect(recordHumanInput).not.toHaveBeenCalled();
    });

    test("records page optimize once, skips locked retry, and recorder exceptions do not block locking", async () => {
        state.test_points[0].status = "edited";
        state.test_points[0].current.title = "changed";
        const recordHumanInput = vi.fn(() => { throw new Error("disk failure"); });
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        const first = await dispatchTestPointReviewRequest(
            req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state, recordHumanInput},
        );
        const second = await dispatchTestPointReviewRequest(
            req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state, recordHumanInput},
        );

        expect(first.closeServer).toBe(true);
        expect(second.closeServer).toBe(false);
        expect(state.review_status).toBe("pending_optimize");
        expect(recordHumanInput).toHaveBeenCalledOnce();
        expect(recordHumanInput).toHaveBeenCalledWith(state, "optimize");
        expect(error).toHaveBeenCalledWith("Warning: QA Human Input event was not recorded; Review action continues.");
        error.mockRestore();
    });

    test("HTML optimize writes all saved page operation kinds through the real Human Input outbox", async () => {
        state.test_points[0].current.title = "Edited in HTML";
        state.test_points[0].status = "edited";
        state.test_points[0].comments.push({id: "comment-1", text: "HTML comment", author: "qa", resolved: false});
        state.test_points[1].status = "deleted";
        state.test_points.push({
            id: "tp_999",
            original: {title: "Added in HTML", group: "Extra", tags: ["边界"], priority: "LOW"},
            current: {title: "Added in HTML", group: "Extra", tags: ["边界"], priority: "LOW"},
            round_baseline: null,
            status: "added",
            source: "qa",
            ai_status: "none",
            comments: [],
        });
        state.open_questions = [{id: "oq_001", text: "Question", answer: "HTML final answer", round_answer_baseline: null}];

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state},
        );

        expect(result.closeServer).toBe(true);
        const outboxDir = process.env.CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR!;
        const files = readdirSync(outboxDir);
        expect(files).toHaveLength(1);
        const rows = readFileSync(join(outboxDir, files[0]), "utf8").split(/\r?\n/).filter(Boolean);
        expect(rows).toHaveLength(1);
        const event = JSON.parse(rows[0]) as {action: string; units: Array<{kind: string}>};
        expect(event.action).toBe("optimize");
        expect(event.units.map((unit) => unit.kind)).toEqual([
            "edit",
            "comment",
            "delete",
            "add",
            "answer_question",
        ]);
    });

    test("locks every test point, including ones without comments", async () => {
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "这里边界没覆盖全"}),
            TOKEN,
            {reviewState: state},
        );

        const result = await dispatchTestPointReviewRequest(req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state});

        expect(result.status).toBe(200);
        expect((result.body as {locked_ids: string[]}).locked_ids.sort()).toEqual(
            state.test_points.map((tp) => tp.id).sort(),
        );
        expect(result.closeServer).toBe(true);

        expect(state.review_status).toBe("pending_optimize");
        expect(state.optimize_requested_at).toBeDefined();

        const persisted = JSON.parse(readFileSync(reviewFilePath(state.review_id), "utf8")) as ReviewState;
        expect(persisted.review_status).toBe("pending_optimize");
    });

    test("locked review rejects further edits on any test point with 409", async () => {
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "备注"}),
            TOKEN,
            {reviewState: state},
        );
        await dispatchTestPointReviewRequest(req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state});

        const editCommented = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001"),
            JSON.stringify({title: "改不了"}),
            TOKEN,
            {reviewState: state},
        );
        expect(editCommented.status).toBe(409);
        expect(state.test_points.find((tp) => tp.id === "tp_001")!.current.title).not.toBe("改不了");

        const editUncommented = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_002"),
            JSON.stringify({title: "也改不了"}),
            TOKEN,
            {reviewState: state},
        );
        expect(editUncommented.status).toBe(409);
        expect(state.test_points.find((tp) => tp.id === "tp_002")!.current.title).not.toBe("也改不了");
    });

    test("locked review rejects delete/restore on any test point with 409", async () => {
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "备注"}),
            TOKEN,
            {reviewState: state},
        );
        await dispatchTestPointReviewRequest(req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state});

        const deleteResult = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_002/delete"),
            "{}",
            TOKEN,
            {reviewState: state},
        );
        expect(deleteResult.status).toBe(409);
        expect(state.test_points.find((tp) => tp.id === "tp_002")!.status).not.toBe("deleted");
    });

    test("locked review rejects adding or deleting per-test-point comments with 409", async () => {
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "第一条"}),
            TOKEN,
            {reviewState: state},
        );
        await dispatchTestPointReviewRequest(req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state});

        const commentId = state.test_points.find((tp) => tp.id === "tp_001")!.comments[0].id;

        const addResult = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "第二条"}),
            TOKEN,
            {reviewState: state},
        );
        expect(addResult.status).toBe(409);

        const addOnUncommented = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_002/comments"),
            JSON.stringify({text: "不该成功"}),
            TOKEN,
            {reviewState: state},
        );
        expect(addOnUncommented.status).toBe(409);

        const deleteResult = await dispatchTestPointReviewRequest(
            req("DELETE", `/api/test-points/tp_001/comments/${commentId}`),
            "",
            TOKEN,
            {reviewState: state},
        );
        expect(deleteResult.status).toBe(409);
        expect(state.test_points.find((tp) => tp.id === "tp_001")!.comments).toHaveLength(1);
    });

    test("locked review rejects adding new test points with 409", async () => {
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "需要 AI 处理"}),
            TOKEN,
            {reviewState: state},
        );
        await dispatchTestPointReviewRequest(req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state});

        const addTestPoint = await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points"),
            JSON.stringify({title: "锁定期间新增"}),
            TOKEN,
            {reviewState: state},
        );
        expect(addTestPoint.status).toBe(409);
    });

    test("deleted test points are still counted among locked ids (lock applies to the whole page)", async () => {
        await dispatchTestPointReviewRequest(req("POST", "/api/test-points/tp_001/delete"), "{}", TOKEN, {reviewState: state});

        const result = await dispatchTestPointReviewRequest(req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state});

        expect((result.body as {locked_ids: string[]}).locked_ids.sort()).toEqual(
            state.test_points.map((tp) => tp.id).sort(),
        );
    });

    test("calling optimize again while already pending_optimize is a no-op that returns the same locked ids", async () => {
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "备注"}),
            TOKEN,
            {reviewState: state},
        );
        const first = await dispatchTestPointReviewRequest(req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state});
        const requestedAt = state.optimize_requested_at;

        const second = await dispatchTestPointReviewRequest(req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state});

        expect(second.status).toBe(200);
        expect((second.body as {locked_ids: string[]}).locked_ids).toEqual((first.body as {locked_ids: string[]}).locked_ids);
        expect(state.optimize_requested_at).toBe(requestedAt);
    });

    test("firing two optimize requests concurrently (double-click race) never opens a second round", async () => {
        await dispatchTestPointReviewRequest(
            req("POST", "/api/test-points/tp_001/comments"),
            JSON.stringify({text: "备注"}),
            TOKEN,
            {reviewState: state},
        );
        const [first, second] = await Promise.all([
            dispatchTestPointReviewRequest(req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state}),
            dispatchTestPointReviewRequest(req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state}),
        ]);

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect((first.body as {locked_ids: string[]}).locked_ids.sort()).toEqual(
            (second.body as {locked_ids: string[]}).locked_ids.sort(),
        );
        expect(state.review_status).toBe("pending_optimize");
        expect(state.round).toBe(1);
    });

    test("rejects optimize requests without a valid token", async () => {
        const result = await dispatchTestPointReviewRequest(
            {method: "POST", url: "/api/optimize"},
            "{}",
            TOKEN,
            {reviewState: state},
        );
        expect(result.status).toBe(403);
        expect(state.review_status).toBe("reviewing");
    });

    test("returns 404 when no review state is loaded", async () => {
        const result = await dispatchTestPointReviewRequest(req("POST", "/api/optimize"), "{}", TOKEN, {});
        expect(result.status).toBe(404);
    });
});
