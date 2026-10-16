import {mkdtempSync, readFileSync, readdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Command} from "commander";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {registerTestPointReviewCommand} from "../src/commands/testpoint-review.js";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";
import {loadReviewState, saveReviewState} from "../src/lib/testpoint-review/store.js";
import type {TestPointReviewHumanInputEvent} from "../src/lib/testpoint-review/human-input-event.js";

describe("testpoint-review request-optimize Human Input handoff", () => {
  let dir: string;
  let outboxDir: string;
  const originalEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testpoint-review-request-optimize-command-"));
    outboxDir = join(dir, "outbox");
    for (const key of [
      "CAWPLAN_TESTPOINT_REVIEW_PATH",
      "CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR",
      "CLAUDE_CODE_SESSION_ID",
      "CODEX_SESSION_ID",
      "CODEX_THREAD_ID",
    ]) {
      originalEnv.set(key, process.env[key]);
    }
    process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = join(dir, "reviews");
    process.env.CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR = outboxDir;
    delete process.env.CLAUDE_CODE_SESSION_ID;
    process.env.CODEX_SESSION_ID = "chat-session-1";
    delete process.env.CODEX_THREAD_ID;
  });

  afterEach(() => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    originalEnv.clear();
    rmSync(dir, {recursive: true, force: true});
    vi.restoreAllMocks();
  });

  async function requestOptimize(reviewId: string): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerTestPointReviewCommand(program);
    await program.parseAsync([
      "node",
      "cawplan",
      "qa-insights",
      "testpoint-review",
      "request-optimize",
      "--review-id",
      reviewId,
    ]);
  }

  test("collects every saved HTML operation before Chat locks the round and skips locked retries", async () => {
    const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
    state.updated_at = "2026-10-12T01:00:00.000Z";
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
    saveReviewState(state);

    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await requestOptimize(state.review_id);

    const persisted = loadReviewState(state.review_id);
    expect(persisted.review_status).toBe("pending_optimize");
    expect(persisted.test_points.find((testPoint) => testPoint.id === "tp_001")?.current.title).toBe("Edited in HTML");

    const files = readdirSync(outboxDir);
    expect(files).toHaveLength(1);
    const rows = readFileSync(join(outboxDir, files[0]), "utf8").split(/\r?\n/).filter(Boolean);
    expect(rows).toHaveLength(1);
    const event = JSON.parse(rows[0]) as TestPointReviewHumanInputEvent;
    expect(event.action).toBe("optimize");
    expect(event.state_updated_at).toBe("2026-10-12T01:00:00.000Z");
    expect(event.units.map((unit) => unit.kind)).toEqual([
      "edit",
      "comment",
      "delete",
      "add",
      "answer_question",
    ]);
    expect(event.units.at(-1)?.content).toContain("Answer: HTML final answer");

    await requestOptimize(state.review_id);
    const retryRows = readFileSync(join(outboxDir, files[0]), "utf8").split(/\r?\n/).filter(Boolean);
    expect(retryRows).toHaveLength(1);
  });
});
