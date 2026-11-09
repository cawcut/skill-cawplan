import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {dispatchTestPointReviewRequest} from "../src/lib/testpoint-review/testpoint-review-web-server.js";
import type {ArchiveTestPointsFn, ReconcileTestPointsFn} from "../src/lib/testpoint-review/testpoint-review-web-server.js";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";
import {createReviewStateFromInput} from "../src/lib/testpoint-review/create-review.js";
import {loadReviewState, reviewFilePath, saveReviewState} from "../src/lib/testpoint-review/store.js";
import {runTestPointsArchive} from "../src/commands/qa-insights.js";
import {applyAiOptimization} from "../src/lib/testpoint-review/optimize-apply.js";
import {testPointReviewHtml} from "../src/lib/testpoint-review/testpoint-review-html.js";
import type {ReviewState} from "../src/lib/testpoint-review/types.js";
import type {QAInsightsWriteEnvelope, TestPointDraft} from "../src/lib/qa-insights/types.js";

const TOKEN = "test-token";

function req(method: string, path: string) {
    return {method, url: `${path}${path.includes("?") ? "&" : "?"}token=${TOKEN}`};
}

function successEnvelope(): QAInsightsWriteEnvelope {
    return {outcome: "SUCCESS", command: "testpoints archive", meta: {product_id: "p", requirement_id: "r", dry_run: false}};
}

function failureEnvelope(): QAInsightsWriteEnvelope {
    return {
        outcome: "FAILURE",
        command: "testpoints archive",
        meta: {product_id: "p", requirement_id: "r", dry_run: false},
        error: {type: "api", message: "boom"},
    };
}

function unknownEnvelope(): QAInsightsWriteEnvelope {
    return {
        outcome: "UNKNOWN",
        command: "testpoints archive",
        meta: {product_id: "p", requirement_id: "r", dry_run: false},
        error: {type: "transport", message: "timed out"},
    };
}

function reconcileEnvelope(decision: "count_matched" | "retry_same_batch" | "count_unexpected"): QAInsightsWriteEnvelope {
    return {
        outcome: decision === "count_matched" ? "RECONCILED" : "FAILURE",
        command: "testpoints reconcile",
        meta: {product_id: "p", requirement_id: "r", dry_run: false},
        reconcile: {strategy: "testpoint_count", decision, count_before: 0, count_after: 0, batch_size: 0},
    };
}

/** A reconcileTestPoints mock that fails the test if called — used where UNKNOWN must never happen. */
function unreachableReconcile(): ReconcileTestPointsFn {
    return vi.fn(async () => {
        throw new Error("reconcileTestPoints should not have been called");
    });
}

describe("dispatchTestPointReviewRequest /api/save-to-cawplan (design §4/§4.1, plan step 19)", () => {
    let dir: string;
    let originalEnv: string | undefined;
    let state: ReviewState;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "testpoint-review-save-test-"));
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

    test.each(["initial", "page edits", "AI optimization", "reordered state", "filtered rows", "deleted first row"])(
        "POST group_order matches the final Review after %s; row order is unchanged",
        async (stage) => {
            state = createReviewStateFromInput({
                productId: "prod_1", requirementId: "req_1",
                testPoints: ["A", "B", "A", "B", "C"].map((group, i) => ({
                    title: `point ${i}`, group, tags: [], priority: "HIGH",
                })),
            });
            if (stage === "page edits") {
                for (const tp of state.test_points) {
                    const group = tp.current.group === "A" ? "B" : tp.current.group === "B" ? "A" : "C";
                    const edit = await dispatchTestPointReviewRequest(
                        req("POST", `/api/test-points/${tp.id}`), JSON.stringify({group}), TOKEN, {reviewState: state},
                    );
                    expect(edit.status).toBe(200);
                }
            } else if (stage === "AI optimization") {
                state = applyAiOptimization(state, {
                    modified: state.test_points.map((tp) => ({
                        id: tp.id,
                        fields: {...tp.current, group: tp.current.group === "A" ? "B" : tp.current.group === "B" ? "A" : "C"},
                    })),
                    questions: {retained_ids: [], added: []},
                }).reviewState;
            } else if (stage === "reordered state") {
                const [a1, b1, a2, b2, c1] = state.test_points;
                state.test_points = [b1, a1, b2, a2, c1];
            } else if (stage === "filtered rows") {
                const template = state.test_points[0];
                state.test_points.unshift(
                    {...template, id: "archived", archived: true, current: {...template.current, group: "Archived"}},
                    {...template, id: "deleted", status: "deleted", current: {...template.current, group: "Deleted"}},
                );
            } else if (stage === "deleted first row") {
                state.test_points[0].status = "deleted";
            }
            saveReviewState(state);
            state = loadReviewState(state.review_id);
            const expectedTitles = state.test_points.filter((tp) => !tp.archived && tp.status !== "deleted").map((tp) => tp.current.title);
            const expectedGroups = ["initial", "filtered rows", "deleted first row"].includes(stage) ? ["A", "B", "C"] : ["B", "A", "C"];
            const html = testPointReviewHtml(state, TOKEN);
            expect([...html.matchAll(/<h2>\d+\. ([ABC])<\/h2>/g)].map((match) => match[1])).toEqual(expectedGroups);

            const request = vi.fn(async (options: {body?: unknown; method?: string}) => ({
                code: "SUCCESS", data: {test_points: options.method === "POST"
                    ? (options.body as {test_points: TestPointDraft[]}).test_points : []},
            }));
            const archiveTestPoints: ArchiveTestPointsFn = async (productId, requirementId, body) => {
                let envelope: QAInsightsWriteEnvelope | undefined;
                await runTestPointsArchive(productId, requirementId, {body: JSON.stringify(body)}, {
                    request: request as never, emit: (result) => { envelope = result; },
                });
                return envelope!;
            };
            const result = await dispatchTestPointReviewRequest(
                req("POST", "/api/save-to-cawplan"), "{}", TOKEN, {reviewState: state, archiveTestPoints},
            );
            expect(result.status).toBe(200);
            expect(result.body).toMatchObject({outcome: "SUCCESS", archived_count: expectedTitles.length});
            expect(request).toHaveBeenCalledTimes(2);
            const sent = request.mock.calls[1][0].body as {test_points: TestPointDraft[]};
            expect(sent.test_points.map((tp) => tp.group_order)).toEqual(
                stage === "deleted first row" ? [2, 1, 2, 3] : [1, 2, 1, 2, 3],
            );
            expect(sent.test_points.map((tp) => tp.title)).toEqual(expectedTitles);
            expect(sent.test_points.every((tp) => !("sort_order" in tp))).toBe(true);
            const orderedGroups = [...new Map(sent.test_points.map((tp) => [tp.group, tp.group_order]))]
                .sort((a, b) => a[1] - b[1]).map(([group]) => group);
            expect(orderedGroups).toEqual(expectedGroups);
        },
    );

    test("multiple saves and a new Review reuse BE orders, including external additions", async () => {
        let existing: TestPointDraft[] = [];
        const requests: string[] = [];
        const archiveTestPoints: ArchiveTestPointsFn = async (productId, requirementId, body) => {
            let result: QAInsightsWriteEnvelope | undefined;
            await runTestPointsArchive(productId, requirementId, {body: JSON.stringify(body)}, {
                request: (async (options: {method?: string; body?: {test_points: TestPointDraft[]}}) => {
                    requests.push(options.method ?? "GET");
                    if (options.method !== "POST") return {code: "SUCCESS", data: {test_points: existing}};
                    const added = options.body!.test_points;
                    existing = [...existing, ...added];
                    return {code: "SUCCESS", data: {test_points: added}};
                }) as never,
                emit: (envelope) => {result = envelope;},
            });
            return result!;
        };
        const create = (groups: string[]) => createReviewStateFromInput({
            productId: "prod_1", requirementId: "req_1",
            testPoints: groups.map((group) => ({title: group, group, tags: [], priority: "HIGH"})),
        });
        const save = async () => {
            const result = await dispatchTestPointReviewRequest(req("POST", "/api/save-to-cawplan"), "{}", TOKEN,
                {reviewState: state, archiveTestPoints});
            expect(result.status).toBe(200);
            state = loadReviewState(state.review_id);
        };
        state = create(["A", "B", "C"]);
        await save();
        expect(state.test_points.map((tp) => tp.group_order)).toEqual([1, 2, 3]);
        state = applyAiOptimization(state, {
            added: ["D", "E", "B"].map((group) => ({title: group, group, tags: [], priority: "HIGH"})),
            questions: {retained_ids: [], added: []},
        }).reviewState;
        await save();
        expect(existing.map((p) => p.group_order)).toEqual([1, 2, 3, 4, 5, 2]);
        expect(state.test_points.filter((tp) => tp.current.group === "B").map((tp) => tp.group_order)).toEqual([2, 2]);
        // A new Review does not need a cached copy of the old groups.
        state = create(["F", "A"]);
        await save();
        expect(existing.slice(-2).map((p) => p.group_order)).toEqual([6, 1]);
        // Another client creates a group after this Review has been prepared.
        state = create(["G", "A"]);
        existing.push({...existing[0], group: "external", group_order: 20});
        await save();
        expect(existing.slice(-2).map((p) => p.group_order)).toEqual([21, 1]);
        expect(requests).toEqual(["GET", "POST", "GET", "POST", "GET", "POST", "GET", "POST"]);
    });

    test("submits all non-deleted, non-archived test points and marks them archived on SUCCESS", async () => {
        state.test_points[0].current.priority = "LOW";
        state.test_points[0].status = "edited";
        const archiveTestPoints = vi.fn<ArchiveTestPointsFn>().mockResolvedValue(successEnvelope());

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/save-to-cawplan"),
            "{}",
            TOKEN,
            {reviewState: state, archiveTestPoints},
        );

        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({archived_count: 3, outcome: "SUCCESS"});
        expect(archiveTestPoints).toHaveBeenCalledWith(
            "prod_1",
            "req_1",
            {test_points: expect.arrayContaining([
                expect.objectContaining({priority: "LOW", is_edited: true}),
                expect.objectContaining({is_edited: false}),
            ])},
        );
        expect(state.test_points.every((tp) => tp.archived === true)).toBe(true);
        // Step 20: a successful save closes the local server (same hand-back mechanism as /api/optimize)
        // so the waiting host Agent can read the result and post a Chat receipt automatically.
        expect(result.closeServer).toBe(true);

        const persisted = JSON.parse(readFileSync(reviewFilePath(state.review_id), "utf8")) as ReviewState;
        expect(persisted.test_points.every((tp) => tp.archived === true)).toBe(true);
    });

    test("excludes deleted test points from the submission", async () => {
        state.test_points[0].status = "deleted";
        const archiveTestPoints = vi.fn<ArchiveTestPointsFn>().mockResolvedValue(successEnvelope());

        await dispatchTestPointReviewRequest(
            req("POST", "/api/save-to-cawplan"),
            "{}",
            TOKEN,
            {reviewState: state, archiveTestPoints},
        );

        const [, , body] = archiveTestPoints.mock.calls[0];
        expect((body.test_points as Array<{title: string}>).map((tp) => tp.title)).not.toContain(
            state.test_points[0].original.title,
        );
        expect(state.test_points[0].archived).toBeFalsy();
    });

    test("second click only submits newly-eligible rows, not already-archived ones", async () => {
        state.test_points[0].archived = true;
        const archiveTestPoints = vi.fn<ArchiveTestPointsFn>().mockResolvedValue(successEnvelope());

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/save-to-cawplan"),
            "{}",
            TOKEN,
            {reviewState: state, archiveTestPoints},
        );

        expect(result.body).toMatchObject({archived_count: 2});
        const [, , body] = archiveTestPoints.mock.calls[0];
        expect(body.test_points).toHaveLength(2);
    });

    test("incremental start submits only new M and advances the archived N reconcile baseline", async () => {
        state = createReviewStateFromInput({
            productId: "prod_1",
            requirementId: "req_1",
            testPoints: [
                {id: "saved-1", title: "已存 1", group: "登录", archived: true},
                {id: "saved-2", title: "已存 2", group: "登录", archived: true},
                {title: "新增 1", group: "异常", tags: ["异常"], priority: "HIGH"},
                {title: "新增 2", group: "边界", tags: ["边界"], priority: "MEDIUM"},
            ],
        });
        saveReviewState(state);
        const archiveTestPoints = vi.fn<ArchiveTestPointsFn>().mockResolvedValue(successEnvelope());

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/save-to-cawplan"),
            "{}",
            TOKEN,
            {reviewState: state, archiveTestPoints},
        );

        const [, , body] = archiveTestPoints.mock.calls[0];
        expect((body.test_points as Array<{title: string}>).map((tp) => tp.title)).toEqual(["新增 1", "新增 2"]);
        expect(result.body).toMatchObject({archived_count: 2, outcome: "SUCCESS"});
        expect(state.count_before).toBe(4);
        expect(state.test_points.every((tp) => tp.archived === true)).toBe(true);
    });

    test("rejects with 409 when there are comments not yet processed by AI", async () => {
        state.test_points[0].comments.push({id: "c_1", text: "边界没覆盖", author: "qa", resolved: false});
        const archiveTestPoints = vi.fn<ArchiveTestPointsFn>();

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/save-to-cawplan"),
            "{}",
            TOKEN,
            {reviewState: state, archiveTestPoints},
        );

        expect(result.status).toBe(409);
        expect(result.body).toMatchObject({error: "unresolved_feedback", commented_test_point_count: 1});
        expect(archiveTestPoints).not.toHaveBeenCalled();
    });

    test("rejects with 409 when a question answer has not yet been processed by AI", async () => {
        state.open_questions = [{id: "oq_001", text: "Which policy?", answer: "Use strict mode", round_answer_baseline: null}];
        const archiveTestPoints = vi.fn<ArchiveTestPointsFn>();
        const recordHumanInput = vi.fn();

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/save-to-cawplan"),
            "{}",
            TOKEN,
            {reviewState: state, archiveTestPoints, recordHumanInput},
        );

        expect(result.status).toBe(409);
        expect(result.body).toMatchObject({error: "unresolved_feedback", answered_question_count: 1});
        expect(recordHumanInput).not.toHaveBeenCalled();
        expect(archiveTestPoints).not.toHaveBeenCalled();
    });

    test("allows Save when a question answer was already consumed in the current round baseline", async () => {
        state.open_questions = [{
            id: "oq_001", text: "Which policy?", answer: "Use strict mode", round_answer_baseline: "Use strict mode",
        }];
        const archiveTestPoints = vi.fn<ArchiveTestPointsFn>().mockResolvedValue(successEnvelope());

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/save-to-cawplan"),
            "{}",
            TOKEN,
            {reviewState: state, archiveTestPoints},
        );

        expect(result.status).toBe(200);
        expect(archiveTestPoints).toHaveBeenCalledOnce();
    });

    test("records after feedback validation and before delete-only NOOP", async () => {
        state.test_points[0].status = "deleted";
        state.test_points[1].archived = true;
        state.test_points[2].archived = true;
        const recordHumanInput = vi.fn(() => ({status: "written" as const, eventId: "hie_1"}));
        const archiveTestPoints = vi.fn<ArchiveTestPointsFn>();

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/save-to-cawplan"), "{}", TOKEN,
            {reviewState: state, archiveTestPoints, recordHumanInput},
        );

        expect(result.body).toEqual({archived_count: 0, outcome: "NOOP"});
        expect(recordHumanInput).toHaveBeenCalledOnce();
        expect(recordHumanInput).toHaveBeenCalledWith(state, "save");
        expect(archiveTestPoints).not.toHaveBeenCalled();
    });

    test("does not record blocked Save and recorder exceptions do not block archive", async () => {
        state.test_points[0].comments.push({id: "c_1", text: "blocked", author: "qa", resolved: false});
        const blockedRecorder = vi.fn();
        const archiveTestPoints = vi.fn<ArchiveTestPointsFn>().mockResolvedValue(successEnvelope());
        const blocked = await dispatchTestPointReviewRequest(
            req("POST", "/api/save-to-cawplan"), "{}", TOKEN,
            {reviewState: state, archiveTestPoints, recordHumanInput: blockedRecorder},
        );
        expect(blocked.status).toBe(409);
        expect(blockedRecorder).not.toHaveBeenCalled();

        state.test_points[0].comments = [];
        const throwingRecorder = vi.fn(() => { throw new Error("disk failure"); });
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const saved = await dispatchTestPointReviewRequest(
            req("POST", "/api/save-to-cawplan"), "{}", TOKEN,
            {reviewState: state, archiveTestPoints, recordHumanInput: throwingRecorder},
        );
        expect(saved.status).toBe(200);
        expect(archiveTestPoints).toHaveBeenCalledOnce();
        expect(error).toHaveBeenCalledWith("Warning: QA Human Input event was not recorded; Review action continues.");
        error.mockRestore();
    });

    test("rejects force:true when comments have not been processed by AI", async () => {
        state.test_points[0].comments.push({id: "c_1", text: "边界没覆盖", author: "qa", resolved: false});
        const archiveTestPoints = vi.fn<ArchiveTestPointsFn>().mockResolvedValue(successEnvelope());

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/save-to-cawplan"),
            JSON.stringify({force: true}),
            TOKEN,
            {reviewState: state, archiveTestPoints},
        );

        expect(result.status).toBe(409);
        expect(result.body).toMatchObject({error: "unresolved_feedback", commented_test_point_count: 1});
        expect(archiveTestPoints).not.toHaveBeenCalled();
    });

    test("does not mark anything archived when the archive API reports FAILURE, and never calls reconcile", async () => {
        const archiveTestPoints = vi.fn<ArchiveTestPointsFn>().mockResolvedValue(failureEnvelope());
        const reconcileTestPoints = unreachableReconcile();

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/save-to-cawplan"),
            "{}",
            TOKEN,
            {reviewState: state, archiveTestPoints, reconcileTestPoints},
        );

        expect(result.status).toBe(502);
        expect(state.test_points.every((tp) => tp.archived !== true)).toBe(true);
        expect(result.closeServer).toBeFalsy();
        expect(reconcileTestPoints).not.toHaveBeenCalled();
    });

    test("does not mark anything archived when the archive request throws, and never calls reconcile", async () => {
        const archiveTestPoints = vi.fn<ArchiveTestPointsFn>().mockRejectedValue(new Error("network down"));
        const reconcileTestPoints = unreachableReconcile();

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/save-to-cawplan"),
            "{}",
            TOKEN,
            {reviewState: state, archiveTestPoints, reconcileTestPoints},
        );

        expect(result.status).toBe(502);
        expect(state.test_points.every((tp) => tp.archived !== true)).toBe(true);
        expect(result.closeServer).toBeFalsy();
        expect(reconcileTestPoints).not.toHaveBeenCalled();
    });

    describe("UNKNOWN archive outcome (SKILL.md §9/§10 count-reconcile, now run by the page instead of Chat)", () => {
        test("incremental start reconciles with archived N as count_before and new M as batch_size", async () => {
            state = createReviewStateFromInput({
                productId: "prod_1",
                requirementId: "req_1",
                testPoints: [
                    {id: "saved-1", title: "已存 1", archived: true},
                    {id: "saved-2", title: "已存 2", archived: true},
                    {title: "新增 1"},
                    {title: "新增 2"},
                    {title: "新增 3"},
                ],
            });
            saveReviewState(state);
            const archiveTestPoints = vi.fn<ArchiveTestPointsFn>().mockResolvedValue(unknownEnvelope());
            const reconcileTestPoints = vi
                .fn<ReconcileTestPointsFn>()
                .mockResolvedValue(reconcileEnvelope("count_matched"));

            const result = await dispatchTestPointReviewRequest(
                req("POST", "/api/save-to-cawplan"),
                "{}",
                TOKEN,
                {reviewState: state, archiveTestPoints, reconcileTestPoints},
            );

            expect(reconcileTestPoints).toHaveBeenCalledWith("prod_1", "req_1", 2, 3);
            expect(result.body).toMatchObject({archived_count: 3, outcome: "RECONCILED"});
            expect(state.count_before).toBe(5);
        });

        test("reconcile count_matched: marks archived, closes server, does not re-submit", async () => {
            const archiveTestPoints = vi.fn<ArchiveTestPointsFn>().mockResolvedValue(unknownEnvelope());
            const reconcileTestPoints = vi
                .fn<ReconcileTestPointsFn>()
                .mockResolvedValue(reconcileEnvelope("count_matched"));
            const countBeforeAtStart = state.count_before;

            const result = await dispatchTestPointReviewRequest(
                req("POST", "/api/save-to-cawplan"),
                "{}",
                TOKEN,
                {reviewState: state, archiveTestPoints, reconcileTestPoints},
            );

            expect(archiveTestPoints).toHaveBeenCalledTimes(1);
            expect(reconcileTestPoints).toHaveBeenCalledWith("prod_1", "req_1", countBeforeAtStart, 3);
            expect(result.status).toBe(200);
            expect(result.body).toMatchObject({archived_count: 3, outcome: "RECONCILED"});
            expect(result.closeServer).toBe(true);
            expect(state.test_points.every((tp) => tp.archived === true)).toBe(true);
            expect(state.count_before).toBe(countBeforeAtStart + 3);
        });

        test("reconcile retry_same_batch: reports failure, does not mark archived, does not close server", async () => {
            const archiveTestPoints = vi.fn<ArchiveTestPointsFn>().mockResolvedValue(unknownEnvelope());
            const reconcileTestPoints = vi
                .fn<ReconcileTestPointsFn>()
                .mockResolvedValue(reconcileEnvelope("retry_same_batch"));

            const result = await dispatchTestPointReviewRequest(
                req("POST", "/api/save-to-cawplan"),
                "{}",
                TOKEN,
                {reviewState: state, archiveTestPoints, reconcileTestPoints},
            );

            expect(result.status).toBe(502);
            expect(state.test_points.every((tp) => tp.archived !== true)).toBe(true);
            expect(result.closeServer).toBeFalsy();
        });

        test("reconcile count_unexpected: reports failure, does not mark archived, does not close server", async () => {
            const archiveTestPoints = vi.fn<ArchiveTestPointsFn>().mockResolvedValue(unknownEnvelope());
            const reconcileTestPoints = vi
                .fn<ReconcileTestPointsFn>()
                .mockResolvedValue(reconcileEnvelope("count_unexpected"));

            const result = await dispatchTestPointReviewRequest(
                req("POST", "/api/save-to-cawplan"),
                "{}",
                TOKEN,
                {reviewState: state, archiveTestPoints, reconcileTestPoints},
            );

            expect(result.status).toBe(502);
            expect(state.test_points.every((tp) => tp.archived !== true)).toBe(true);
            expect(result.closeServer).toBeFalsy();
        });

        test("reconcile call itself throwing is reported as a failure, not swallowed", async () => {
            const archiveTestPoints = vi.fn<ArchiveTestPointsFn>().mockResolvedValue(unknownEnvelope());
            const reconcileTestPoints = vi
                .fn<ReconcileTestPointsFn>()
                .mockRejectedValue(new Error("reconcile transport error"));

            const result = await dispatchTestPointReviewRequest(
                req("POST", "/api/save-to-cawplan"),
                "{}",
                TOKEN,
                {reviewState: state, archiveTestPoints, reconcileTestPoints},
            );

            expect(result.status).toBe(502);
            expect(state.test_points.every((tp) => tp.archived !== true)).toBe(true);
            expect(result.closeServer).toBeFalsy();
        });
    });

    test("returns NOOP with archived_count 0 when nothing is eligible (everything already archived)", async () => {
        for (const tp of state.test_points) tp.archived = true;
        const archiveTestPoints = vi.fn<ArchiveTestPointsFn>();

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/save-to-cawplan"),
            "{}",
            TOKEN,
            {reviewState: state, archiveTestPoints},
        );

        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({archived_count: 0, outcome: "NOOP"});
        expect(archiveTestPoints).not.toHaveBeenCalled();
        // A no-op click (nothing to submit) has nothing to hand back — server stays up.
        expect(result.closeServer).toBeFalsy();
    });

    test("rejects with 409 while the review is locked for AI optimization", async () => {
        state.review_status = "pending_optimize";
        const archiveTestPoints = vi.fn<ArchiveTestPointsFn>();

        const result = await dispatchTestPointReviewRequest(
            req("POST", "/api/save-to-cawplan"),
            "{}",
            TOKEN,
            {reviewState: state, archiveTestPoints},
        );

        expect(result.status).toBe(409);
        expect(archiveTestPoints).not.toHaveBeenCalled();
    });
});
