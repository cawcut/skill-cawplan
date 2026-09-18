import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { registerTestPointReviewCommand } from "../src/commands/testpoint-review.js";
import { createFixtureReviewState } from "../src/lib/testpoint-review/fixtures.js";
import { saveReviewState } from "../src/lib/testpoint-review/store.js";

describe("testpoint-review show", () => {
  let dir: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testpoint-review-show-test-"));
    originalPath = process.env.CAWPLAN_TESTPOINT_REVIEW_PATH;
    process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = dir;
  });

  afterEach(() => {
    if (originalPath === undefined) delete process.env.CAWPLAN_TESTPOINT_REVIEW_PATH;
    else process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test("prints the persisted page edits for the AI optimization handoff", async () => {
    const state = createFixtureReviewState({ productId: "prod_1", requirementId: "req_1" });
    state.review_status = "pending_optimize";
    state.test_points[0].current.title = "Saved page edit";
    state.test_points[0].status = "edited";
    state.global_comments.push({ id: "c_global", text: "Use the page edit", author: "qa", resolved: false });
    saveReviewState(state);

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const program = new Command();
    program.exitOverride();
    registerTestPointReviewCommand(program);

    await program.parseAsync([
      "node",
      "cawplan",
      "qa-insights",
      "testpoint-review",
      "show",
      "--review-id",
      state.review_id,
    ]);

    expect(log).toHaveBeenCalledTimes(1);
    const result = JSON.parse(String(log.mock.calls[0][0])) as typeof state;
    expect(result.review_id).toBe(state.review_id);
    expect(result.review_status).toBe("pending_optimize");
    expect(result.test_points.find((testPoint) => testPoint.id === "tp_001")).toMatchObject({
      status: "edited",
      current: { title: "Saved page edit" },
    });
    expect(result.global_comments).toMatchObject([{ text: "Use the page edit" }]);
  });
});
