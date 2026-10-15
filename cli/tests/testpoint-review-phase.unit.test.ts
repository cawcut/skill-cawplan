import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {mkdtempSync, readFileSync, readdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Command} from "commander";
import {registerTestPointReviewCommand} from "../src/commands/testpoint-review.js";
import {reviewPhase} from "../src/lib/testpoint-review/review-phase.js";
import {checkUnresolvedFeedback} from "../src/lib/testpoint-review/archive-submission.js";
import {dispatchTestPointReviewRequest} from "../src/lib/testpoint-review/testpoint-review-web-server.js";
import type {ArchiveTestPointsFn} from "../src/lib/testpoint-review/testpoint-review-web-server.js";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";
import {saveReviewState} from "../src/lib/testpoint-review/store.js";
import type {OpenQuestion, ReviewState} from "../src/lib/testpoint-review/types.js";

const TOKEN = "test-token";

function req(method: string, path: string) {
  return {method, url: `${path}${path.includes("?") ? "&" : "?"}token=${TOKEN}`};
}

function stateWith(questions: OpenQuestion[] | undefined): ReviewState {
  const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
  state.open_questions = questions;
  return state;
}

describe("reviewPhase", () => {
  test("a question with no baseline keeps the Questions phase", () => {
    expect(reviewPhase(stateWith([{id: "oq_001", text: "Q", answer: null, round_answer_baseline: null}]))).toBe("questions");
  });

  test("answering everything does not leave the Questions phase until AI consumes it", () => {
    expect(reviewPhase(stateWith([{id: "oq_001", text: "Q", answer: "A", round_answer_baseline: null}]))).toBe("questions");
  });

  test("clearing an answer keeps the Questions phase", () => {
    expect(reviewPhase(stateWith([{id: "oq_001", text: "Q", answer: null, round_answer_baseline: null}]))).toBe("questions");
  });

  test("retained, already-answered questions put the Review in the review phase", () => {
    expect(reviewPhase(stateWith([{id: "oq_001", text: "Q", answer: "A", round_answer_baseline: "A"}]))).toBe("review");
  });

  test("no questions, or a legacy Review without open_questions, is the review phase", () => {
    expect(reviewPhase(stateWith([]))).toBe("review");
    expect(reviewPhase(stateWith(undefined))).toBe("review");
  });

  test("checkUnresolvedFeedback reports questionsPending", () => {
    const pending = checkUnresolvedFeedback(stateWith([{id: "oq_001", text: "Q", answer: null, round_answer_baseline: null}]));
    expect(pending.questionsPending).toBe(true);
    expect(pending.hasUnresolvedFeedback).toBe(true);
    expect(checkUnresolvedFeedback(stateWith([])).questionsPending).toBe(false);
  });
});

describe("Questions phase guards", () => {
  let dir: string;
  let saved: Record<string, string | undefined>;
  let state: ReviewState;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testpoint-review-phase-test-"));
    saved = {
      path: process.env.CAWPLAN_TESTPOINT_REVIEW_PATH,
      outbox: process.env.CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR,
      session: process.env.CODEX_SESSION_ID,
    };
    process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = dir;
    process.env.CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR = join(dir, "outbox");
    process.env.CODEX_SESSION_ID = "phase-session-1";
    state = stateWith([
      {id: "oq_001", text: "Q1", answer: null, round_answer_baseline: null},
      {id: "oq_002", text: "Q2", answer: null, round_answer_baseline: null},
    ]);
    saveReviewState(state);
  });

  afterEach(() => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("CAWPLAN_TESTPOINT_REVIEW_PATH", saved.path);
    restore("CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR", saved.outbox);
    restore("CODEX_SESSION_ID", saved.session);
    rmSync(dir, {recursive: true, force: true});
    vi.restoreAllMocks();
  });

  test("HTTP Save is rejected with 409 questions_pending", async () => {
    const archiveTestPoints = vi.fn<ArchiveTestPointsFn>();
    const result = await dispatchTestPointReviewRequest(
      req("POST", "/api/save-to-cawplan"), "{}", TOKEN, {reviewState: state, archiveTestPoints},
    );

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({error: "unresolved_feedback", questions_pending: true});
    expect(archiveTestPoints).not.toHaveBeenCalled();
  });

  test("CLI save is rejected in the Questions phase", async () => {
    const program = new Command();
    program.exitOverride();
    registerTestPointReviewCommand(program);

    await expect(program.parseAsync([
      "node", "cawplan", "qa-insights", "testpoint-review", "save",
      "--review-id", state.review_id, "--product-id", "prod_1", "--requirement-id", "req_1", "--dry-run",
    ])).rejects.toThrow(/Questions to Confirm are still open/);
  });

  test("Continue after answering and ignoring succeeds (not NO_CHANGES) and locks the page", async () => {
    const answer = (id: string, text: string) => dispatchTestPointReviewRequest(
      req("POST", `/api/open-questions/${id}/answer`), JSON.stringify({answer: text}), TOKEN, {reviewState: state},
    );
    expect((await answer("oq_001", "Use strict mode")).status).toBe(200);
    expect((await answer("oq_002", "Ignore")).status).toBe(200);

    const result = await dispatchTestPointReviewRequest(req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state});

    expect(result.status).toBe(200);
    expect(result.body).not.toEqual({outcome: "NO_CHANGES"});
    expect(state.review_status).toBe("pending_optimize");
  });

  test("a repeated Continue after the lock does not record a second event", async () => {
    state.open_questions![0].answer = "Use strict mode";
    state.open_questions![1].answer = "Ignore";

    await dispatchTestPointReviewRequest(req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state});
    const outboxDir = process.env.CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR!;
    const countRows = () => readdirSync(outboxDir).flatMap(
      (file) => readFileSync(join(outboxDir, file), "utf8").split(/\r?\n/).filter(Boolean),
    ).length;
    expect(countRows()).toBe(1);

    const again = await dispatchTestPointReviewRequest(req("POST", "/api/optimize"), "{}", TOKEN, {reviewState: state});
    expect(again.status).toBe(200);
    expect(countRows()).toBe(1);
  });
});

describe("last_viewed_review_round (GET /)", () => {
  let dir: string;
  let saved: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testpoint-review-viewed-test-"));
    saved = process.env.CAWPLAN_TESTPOINT_REVIEW_PATH;
    process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = dir;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.CAWPLAN_TESTPOINT_REVIEW_PATH;
    else process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = saved;
    rmSync(dir, {recursive: true, force: true});
  });

  const get = (state: ReviewState) => dispatchTestPointReviewRequest(req("GET", "/"), "", TOKEN, {reviewState: state});

  test("Review phase GET records the round without touching updated_at, and is idempotent", async () => {
    const state = stateWith([]);
    saveReviewState(state);
    const updatedAt = state.updated_at;
    await get(state);
    expect(state.last_viewed_review_round).toBe(state.round);
    expect(state.updated_at).toBe(updatedAt);
    state.last_viewed_review_round = state.round;
    await get(state);
    expect(state.last_viewed_review_round).toBe(state.round);
  });

  test("Questions phase GET does not record", async () => {
    const state = stateWith([{id: "oq_001", text: "Q", answer: null, round_answer_baseline: null}]);
    saveReviewState(state);
    await get(state);
    expect(state.last_viewed_review_round).toBeUndefined();
  });

  test("an empty or archived-only list does not count as the first visible list", async () => {
    const state = stateWith([]);
    state.test_points.forEach((tp) => { tp.archived = true; });
    await get(state);
    expect(state.last_viewed_review_round).toBeUndefined();
    state.test_points = [];
    await get(state);
    expect(state.last_viewed_review_round).toBeUndefined();
  });

  test("first view resets AI labels while preserving QA edits, archived points and content baselines", async () => {
    const state = stateWith([]);
    state.test_points[0].ai_status = "modified";
    state.test_points[0].status = "edited";
    state.test_points[1].source = "qa";
    state.test_points[1].status = "added";
    state.test_points[2].archived = true;
    state.test_points[2].ai_status = "added";
    const before = structuredClone(state.test_points);

    await get(state);

    expect(state.test_points).toEqual([
      {...before[0], ai_status: "none"},
      before[1],
      before[2],
    ]);
  });

  test("locked Review GET does not record", async () => {
    const state = stateWith([]);
    state.review_status = "pending_optimize";
    saveReviewState(state);
    await get(state);
    expect(state.last_viewed_review_round).toBeUndefined();
  });
});
