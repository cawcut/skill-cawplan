import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {mkdtempSync, readFileSync, readdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {dispatchTestPointReviewRequest} from "../src/lib/testpoint-review/testpoint-review-web-server.js";
import type {ArchiveTestPointsFn} from "../src/lib/testpoint-review/testpoint-review-web-server.js";
import {applyAiOptimization} from "../src/lib/testpoint-review/optimize-apply.js";
import type {RawAiOptimizeOutput} from "../src/lib/testpoint-review/optimize-apply.js";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";
import {loadReviewState, saveReviewState} from "../src/lib/testpoint-review/store.js";
import type {ReviewState, TestPointFields} from "../src/lib/testpoint-review/types.js";

const TOKEN = "test-token";

function req(method: string, path: string) {
  return {method, url: `${path}${path.includes("?") ? "&" : "?"}token=${TOKEN}`};
}

describe("two-phase Review → Questions → Questions → Review (e2e, in-process)", () => {
  let dir: string;
  let saved: Record<string, string | undefined>;
  let state: ReviewState;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testpoint-review-two-phase-e2e-"));
    saved = {
      path: process.env.CAWPLAN_TESTPOINT_REVIEW_PATH,
      outbox: process.env.CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR,
      session: process.env.CODEX_SESSION_ID,
    };
    process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = dir;
    process.env.CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR = join(dir, "outbox");
    process.env.CODEX_SESSION_ID = "e2e-session-1";
    state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
    state.open_questions = [];
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

  const call = (method: string, path: string, body: unknown = {}) =>
    dispatchTestPointReviewRequest(req(method, path), method === "GET" ? "" : JSON.stringify(body), TOKEN, {reviewState: state});

  /** What Chat does after the page hands back: apply the AI output, persist, and reload from disk. */
  const aiRound = (raw: RawAiOptimizeOutput) => {
    state = applyAiOptimization(state, raw).reviewState;
    saveReviewState(state);
    state = loadReviewState(state.review_id);
  };

  const fieldsOf = (title: string): TestPointFields => ({title, group: "g", tags: ["t"], priority: "MEDIUM"});

  const outboxUnits = () => {
    const outboxDir = process.env.CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR!;
    return readdirSync(outboxDir)
      .flatMap((file) => readFileSync(join(outboxDir, file), "utf8").split(/\r?\n/).filter(Boolean))
      .map((line) => JSON.parse(line) as {round: number; units: Array<{kind: string; content: string}>});
  };

  const tag = (id: string) => state.test_points.find((tp) => tp.id === id)!.ai_status;

  /** Drives R1 (Review) → R2 (Questions) → R3 (Questions) → R4 (Review). Returns the AI-added row id. */
  async function runToRound4(): Promise<string> {
    const [tp1, tp2, tp3] = state.test_points.map((tp) => tp.id);

    // R1: Review phase. The user sees it, edits tp1, comments on tp2, and asks the AI to optimize.
    expect((await call("GET", "/")).status).toBe(200);
    expect(state.last_viewed_review_round).toBe(1);
    expect((await call("POST", `/api/test-points/${tp1}`, {priority: "LOW"})).status).toBe(200);
    expect((await call("POST", `/api/test-points/${tp2}/comments`, {text: "tighten this"})).status).toBe(200);
    expect((await call("POST", "/api/optimize")).status).toBe(200);
    aiRound({
      modified: [{id: tp2, fields: fieldsOf("tp2 rewritten")}],
      added: [fieldsOf("tp new")],
      questions: {retained_ids: [], added: ["Q1", "Q2"]},
    });
    const newId = state.test_points.find((tp) => tp.source === "ai" && tp.current.title === "tp new")!.id;
    expect(state.round).toBe(2);
    expect(tag(tp2)).toBe("modified");
    expect(tag(newId)).toBe("added");

    // R2: Questions phase. Rendering it must not count as having viewed a Review.
    await call("GET", "/");
    expect(state.last_viewed_review_round).toBe(1);
    expect((await call("POST", "/api/open-questions/oq_001/answer", {answer: "Use strict mode"})).status).toBe(200);
    expect((await call("POST", "/api/open-questions/oq_002/answer", {answer: "Ignore"})).status).toBe(200);
    state = loadReviewState(state.review_id);
    expect(state.open_questions!.map((q) => q.answer)).toEqual(["Use strict mode", "Ignore"]);
    expect((await call("POST", "/api/optimize")).status).toBe(200);
    aiRound({modified: [{id: tp3, fields: fieldsOf("tp3 rewritten")}], added: [], questions: {retained_ids: [], added: ["Q3"]}});
    expect(state.round).toBe(3);
    expect(tag(tp2)).toBe("modified");
    expect(tag(newId)).toBe("added");
    expect(tag(tp3)).toBe("modified");

    // R3: still Questions. Answer Q3 and continue; the AI modifies the AI-added row and asks nothing more.
    await call("GET", "/");
    expect(state.last_viewed_review_round).toBe(1);
    expect((await call("POST", "/api/open-questions/oq_003/answer", {answer: "Q3 answer"})).status).toBe(200);
    expect((await call("POST", "/api/optimize")).status).toBe(200);
    aiRound({modified: [{id: newId, fields: fieldsOf("tp new v2")}], added: [], questions: {retained_ids: [], added: []}});
    expect(state.round).toBe(4);
    return newId;
  }

  test("tags accumulate across the Questions rounds and Human Input carries every answer", async () => {
    const [, tp2, tp3] = state.test_points.map((tp) => tp.id);
    const newId = await runToRound4();

    expect(tag(newId)).toBe("added");
    expect(tag(tp2)).toBe("modified");
    expect(tag(tp3)).toBe("modified");

    const answerContents = outboxUnits()
      .flatMap((event) => event.units)
      .filter((u) => u.kind === "answer_question")
      .map((u) => u.content);
    expect(answerContents).toEqual(expect.arrayContaining([
      expect.stringContaining("Answer: Use strict mode"),
      expect.stringContaining("Answer: Ignore"),
      expect.stringContaining("Answer: Q3 answer"),
    ]));
    expect(answerContents).toHaveLength(3);
  });

  test("R4 Review: viewing records round 4 and a no-change Save succeeds", async () => {
    await runToRound4();

    await call("GET", "/");
    expect(state.last_viewed_review_round).toBe(4);

    const archiveTestPoints = vi.fn<ArchiveTestPointsFn>().mockResolvedValue({
      outcome: "SUCCESS",
      command: "testpoints archive",
      meta: {product_id: "prod_1", requirement_id: "req_1", dry_run: false},
    });
    const result = await dispatchTestPointReviewRequest(
      req("POST", "/api/save-to-cawplan"), "{}", TOKEN, {reviewState: state, archiveTestPoints},
    );
    expect(result.status).toBe(200);
    expect(archiveTestPoints).toHaveBeenCalledOnce();
  });

  test("regression: after the user viewed R4, the next round clears tags by the normal rule", async () => {
    const [tp1, tp2] = state.test_points.map((tp) => tp.id);
    const newId = await runToRound4();

    await call("GET", "/");
    expect((await call("POST", `/api/test-points/${tp1}`, {priority: "HIGH"})).status).toBe(200);
    expect((await call("POST", "/api/optimize")).status).toBe(200);
    aiRound({modified: [{id: tp1, fields: fieldsOf("tp1 rewritten")}], added: [], questions: {retained_ids: [], added: []}});

    expect(state.round).toBe(5);
    expect(tag(tp1)).toBe("modified");
    expect(tag(tp2)).toBe("none");
    expect(tag(newId)).toBe("none");
  });
});
