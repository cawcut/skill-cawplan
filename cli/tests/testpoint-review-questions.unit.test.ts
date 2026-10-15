import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createReviewStateFromInput} from "../src/lib/testpoint-review/create-review.js";
import {applyAiOptimization, AiOptimizationValidationError} from "../src/lib/testpoint-review/optimize-apply.js";
import {testPointReviewHtml} from "../src/lib/testpoint-review/testpoint-review-html.js";
import {dispatchTestPointReviewRequest} from "../src/lib/testpoint-review/testpoint-review-web-server.js";
import {reviewFilePath, saveReviewState} from "../src/lib/testpoint-review/store.js";
import type {ReviewState} from "../src/lib/testpoint-review/types.js";

const TOKEN = "test-token";

function req(method: string, path: string) {
  return {method, url: `${path}${path.includes("?") ? "&" : "?"}token=${TOKEN}`};
}

function review(openQuestions: string[] = ["Question one", "Question two"]): ReviewState {
  return createReviewStateFromInput({
    productId: "prod_1",
    requirementId: "req_1",
    testPoints: [{title: "Draft", group: "Group", tags: [], priority: "HIGH"}],
    openQuestions,
  });
}

describe("Questions to confirm", () => {
  let dir: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testpoint-review-questions-"));
    originalPath = process.env.CAWPLAN_TESTPOINT_REVIEW_PATH;
    process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = dir;
  });

  afterEach(() => {
    if (originalPath === undefined) delete process.env.CAWPLAN_TESTPOINT_REVIEW_PATH;
    else process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = originalPath;
    rmSync(dir, {recursive: true, force: true});
    vi.restoreAllMocks();
  });

  test("hides the entire region when the list is empty", () => {
    const html = testPointReviewHtml(review([]), TOKEN);
    expect(html).not.toContain('id="questions-page"');
    expect(html).not.toContain("Questions to confirm");
  });

  test("Questions page: Ignore + Continue, no test point table, Add or Save", () => {
    const html = testPointReviewHtml(review(["Q1", "Q2"]), TOKEN);
    expect(html).toContain('id="questions-page"');
    expect(html).toContain('<span class="questions-counts">2 Questions</span>');
    expect(html.match(/class="question-ignore-btn"/g)).toHaveLength(2);
    expect(html).toContain(">Ignore</button>");
    expect(html).toMatch(/id="optimize-btn" disabled>Submit to AI<\/button>/);
    expect(html).not.toContain('class="group"');
    expect(html).not.toContain('id="add-tp-toggle"');
    expect(html).not.toContain('id="save-cawplan-btn"');
  });

  test("Questions page enables Submit to AI only when all are answered", () => {
    const state = review(["Q1", "Q2"]);
    state.language = "en";
    expect(testPointReviewHtml(state, TOKEN)).toMatch(/id="optimize-btn" disabled>Submit to AI<\/button>/);
    expect(testPointReviewHtml(state, TOKEN)).toContain(">Ignore</button>");
    state.open_questions![0].answer = "A1";
    expect(testPointReviewHtml(state, TOKEN)).toMatch(/id="optimize-btn" disabled>/);
    state.open_questions![1].answer = "Ignore";
    expect(testPointReviewHtml(state, TOKEN)).toMatch(/id="optimize-btn">Submit to AI<\/button>/);
    state.review_status = "pending_optimize";
    expect(testPointReviewHtml(state, TOKEN)).toMatch(/id="optimize-btn" disabled>Submit to AI<\/button>/);
  });

  test("Review page (all questions baselined) shows no Questions region and keeps the table", () => {
    const state = review(["Q1"]);
    state.open_questions![0].answer = "A1";
    state.open_questions![0].round_answer_baseline = "A1";
    const html = testPointReviewHtml(state, TOKEN);
    expect(html).not.toContain('id="questions-page"');
    expect(html).not.toContain(`class="question-ignore-btn"`);
    expect(html).toContain('id="add-tp-toggle"');
    expect(html).toContain('id="save-cawplan-btn"');
    expect(html).toContain("Submit to AI");
  });

  test("Ignore writes the constant through the shared answer input", () => {
    const html = testPointReviewHtml(review(), TOKEN);
    expect(html).toContain('var IGNORE_ANSWER = "Ignore";');
    expect(html).toContain('input.value = undoing ? "" : IGNORE_ANSWER;');
    expect(html).toContain("enqueueQuestionSave(state);");
  });

  test("disables answer inputs while the whole Review is locked", () => {
    const state = review();
    state.review_status = "pending_optimize";
    const html = testPointReviewHtml(state, TOKEN);
    expect(html).toContain('class="question-answer-input" rows="1" placeholder="Type your answer..." disabled');
    expect(html).toContain("setQuestionInputsFrozen(true)");
  });

  test("wires debounced, blur, lifecycle, retry, and action-flush auto-save behavior", () => {
    const html = testPointReviewHtml(review(), TOKEN);
    expect(html).toContain("}, 650);");
    expect(html).toContain('input.addEventListener("blur"');
    expect(html).toContain('document.addEventListener("visibilitychange"');
    expect(html).toContain('window.addEventListener("pagehide"');
    expect(html).toContain('window.addEventListener("beforeunload"');
    expect(html).toContain("keepalive: keepalive");
    expect(html).toContain("runNonQuestionMutation");
    expect(html).toContain("flushQuestionAnswers({ requireSuccess: true })");
    expect(html).toContain("state.retryRevision = state.conflictRevision");
    expect(html).toContain("state.forceSave = true");
  });

  test("emits syntactically valid browser JavaScript", () => {
    const html = testPointReviewHtml(review(), TOKEN);
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script!)).not.toThrow();
  });

  test("submits and updates one answer, persists only the latest value, and restores it in HTML", async () => {
    const state = review();
    saveReviewState(state);
    const first = await dispatchTestPointReviewRequest(
      req("POST", "/api/open-questions/oq_001/answer"),
      JSON.stringify({answer: "first"}), TOKEN, {reviewState: state},
    );
    const second = await dispatchTestPointReviewRequest(
      req("POST", `/api/open-questions/oq_001/answer?updated_at=${encodeURIComponent(state.updated_at)}`),
      JSON.stringify({answer: "final"}), TOKEN, {reviewState: state},
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(state.open_questions?.[0].answer).toBe("final");
    const persisted = JSON.parse(readFileSync(reviewFilePath(state.review_id), "utf8")) as ReviewState;
    expect(persisted.open_questions?.[0].answer).toBe("final");
    expect(JSON.stringify(persisted)).not.toContain("first");
    expect(testPointReviewHtml(persisted, TOKEN)).toContain(">final</textarea>");
  });

  test.each([
    {name: "missing answer", path: "/api/open-questions/oq_001/answer", body: {}, status: 400},
    {name: "invalid answer type", path: "/api/open-questions/oq_001/answer", body: {answer: 1}, status: 400},
    {name: "unknown question", path: "/api/open-questions/oq_999/answer", body: {answer: "x"}, status: 404},
  ])("rejects $name", async ({path, body, status}) => {
    const state = review();
    saveReviewState(state);
    const result = await dispatchTestPointReviewRequest(req("POST", path), JSON.stringify(body), TOKEN, {reviewState: state});
    expect(result.status).toBe(status);
  });

  test.each([{answer: "  "}, {answer: null}])("persists a cleared answer as null", async (body) => {
    const state = review();
    state.open_questions![0].answer = "old answer";
    saveReviewState(state);
    const result = await dispatchTestPointReviewRequest(
      req("POST", "/api/open-questions/oq_001/answer"), JSON.stringify(body), TOKEN, {reviewState: state},
    );
    expect(result.status).toBe(200);
    expect(state.open_questions?.[0].answer).toBeNull();
    const persisted = JSON.parse(readFileSync(reviewFilePath(state.review_id), "utf8")) as ReviewState;
    expect(persisted.open_questions?.[0].answer).toBeNull();
  });

  test("treats a normalized duplicate answer as an idempotent write", async () => {
    const state = review();
    state.open_questions![0].answer = "same";
    saveReviewState(state);
    const updatedAt = state.updated_at;
    const result = await dispatchTestPointReviewRequest(
      req("POST", "/api/open-questions/oq_001/answer"), JSON.stringify({answer: " same "}), TOKEN, {reviewState: state},
    );
    expect(result.status).toBe(200);
    expect(state.updated_at).toBe(updatedAt);
  });

  test("rejects stale or locked answer writes", async () => {
    const state = review();
    saveReviewState(state);
    const stale = await dispatchTestPointReviewRequest(
      req("POST", "/api/open-questions/oq_001/answer?updated_at=stale"),
      JSON.stringify({answer: "x"}), TOKEN, {reviewState: state},
    );
    expect(stale.status).toBe(409);
    state.review_status = "pending_optimize";
    const locked = await dispatchTestPointReviewRequest(
      req("POST", "/api/open-questions/oq_001/answer"),
      JSON.stringify({answer: "x"}), TOKEN, {reviewState: state},
    );
    expect(locked.status).toBe(409);
  });

  test("an answer alone makes page optimization eligible and blocks Save until AI consumes it", async () => {
    const state = review();
    state.open_questions![0].answer = "final";
    saveReviewState(state);
    const recordHumanInput = vi.fn(() => ({status: "written" as const, eventId: "hie_1"}));
    const optimize = await dispatchTestPointReviewRequest(
      req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state, recordHumanInput},
    );
    expect(optimize.closeServer).toBe(true);
    expect(recordHumanInput).toHaveBeenCalledWith(state, "optimize");

    const saveState = review();
    saveState.open_questions![0].answer = "final";
    const archiveTestPoints = vi.fn(async () => ({
      outcome: "SUCCESS" as const,
      command: "testpoints archive",
      meta: {product_id: "prod_1", requirement_id: "req_1", dry_run: false},
    }));
    const save = await dispatchTestPointReviewRequest(
      req("POST", "/api/save-to-cawplan"), "{}", TOKEN, {reviewState: saveState, archiveTestPoints},
    );
    expect(save.status).toBe(409);
    expect(save.body).toMatchObject({error: "unresolved_feedback", answered_question_count: 1});
    expect(archiveTestPoints).not.toHaveBeenCalled();
  });

  test("clearing an answer from the round baseline makes page optimization eligible", async () => {
    const state = review();
    state.open_questions![0].round_answer_baseline = "previous answer";
    state.open_questions![0].answer = null;
    saveReviewState(state);
    const recordHumanInput = vi.fn(() => ({status: "written" as const, eventId: "hie_1"}));
    const result = await dispatchTestPointReviewRequest(
      req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state, recordHumanInput},
    );
    expect(result.closeServer).toBe(true);
    expect(recordHumanInput).toHaveBeenCalledOnce();
  });

  test("AI questions output atomically retains, removes, and adds for the next round", () => {
    const state = review();
    state.open_questions![0].answer = "HTML answer";
    state.review_status = "pending_optimize";
    const result = applyAiOptimization(state, {
      modified: [],
      added: [],
      questions: {retained_ids: ["oq_001"], added: ["New question"]},
    });

    expect(result.reviewState.round).toBe(2);
    expect(result.reviewState.open_questions).toEqual([
      {id: "oq_001", text: "Question one", answer: "HTML answer", round_answer_baseline: "HTML answer"},
      {id: "oq_003", text: "New question", answer: null, round_answer_baseline: null},
    ]);
  });

  test("invalid or missing questions output leaves the whole pending state unchanged", () => {
    const state = review();
    state.review_status = "pending_optimize";
    const before = structuredClone(state);
    expect(() => applyAiOptimization(state, {
      modified: [{id: "tp_001", fields: {title: "changed", group: "g", tags: [], priority: "HIGH"}}],
      added: [],
    })).toThrow(AiOptimizationValidationError);
    expect(state).toEqual(before);
    expect(() => applyAiOptimization(state, {
      modified: [], added: [], questions: {retained_ids: ["oq_999"], added: []},
    })).toThrow("does not reference an active question");
    expect(state).toEqual(before);
    expect(() => applyAiOptimization(state, {
      modified: [], added: [], questions: {retained_ids: ["oq_001", "oq_001"], added: []},
    })).toThrow("duplicates");
    expect(state).toEqual(before);
    expect(() => applyAiOptimization(state, {
      modified: [], added: [], questions: {retained_ids: [], added: ["  "]},
    })).toThrow("questions.added[0] must be a non-empty string");
    expect(state).toEqual(before);
  });

  test("legacy Review without question fields accepts the old optimization shape", () => {
    const state = review();
    delete state.open_questions;
    delete state.next_question_seq;
    expect(() => applyAiOptimization(state, {modified: [], added: []})).not.toThrow();
  });
});

describe("close-tab hint", () => {
  test("page script tries to close the tab and shows a localized completion hint", () => {
    const zh = testPointReviewHtml(review(), TOKEN);
    expect(zh).toContain("function tryCloseTab(");
    expect(zh).toContain("window.close()");
    expect(zh).toContain(`var DONE_CLOSE_HINT = "已完成，可关闭此页";`);
    const en = createReviewStateFromInput({
      productId: "prod_1", requirementId: "req_1", language: "en",
      testPoints: [{title: "Draft", group: "Group", tags: [], priority: "HIGH"}],
    });
    expect(testPointReviewHtml(en, TOKEN)).toContain(`var DONE_CLOSE_HINT = "Done — you can close this tab";`);
  });
});
