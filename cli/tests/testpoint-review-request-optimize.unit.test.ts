import { describe, expect, test } from "vitest";
import { requestOptimize } from "../src/lib/testpoint-review/testpoint-review-web-server.js";
import { createFixtureReviewState } from "../src/lib/testpoint-review/fixtures.js";

describe("requestOptimize (Chat-only trigger, no HTTP/page involved)", () => {
  test("locks a reviewing review and returns every test point id", () => {
    const state = createFixtureReviewState({ productId: "prod_1", requirementId: "req_1" });

    const result = requestOptimize(state);

    expect(result.alreadyLocked).toBe(false);
    expect(result.lockedIds.sort()).toEqual(state.test_points.map((tp) => tp.id).sort());
    expect(state.review_status).toBe("pending_optimize");
    expect(state.optimize_requested_at).toBeDefined();
  });

  test("calling again while already pending_optimize is a no-op reporting alreadyLocked", () => {
    const state = createFixtureReviewState({ productId: "prod_1", requirementId: "req_1" });

    requestOptimize(state);
    const requestedAt = state.optimize_requested_at;
    const second = requestOptimize(state);

    expect(second.alreadyLocked).toBe(true);
    expect(state.optimize_requested_at).toBe(requestedAt);
  });
});
