import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import http from "node:http";
import {startTestPointReviewWebServer} from "../src/lib/testpoint-review/testpoint-review-web-server.js";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";
import {loadReviewState, saveReviewState} from "../src/lib/testpoint-review/store.js";
import type {ReviewState} from "../src/lib/testpoint-review/types.js";

function get(url: string): Promise<{status: number; text: string}> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => {
        resolve({status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf-8")});
      });
    });
    req.on("error", reject);
  });
}

function post(url: string, body: string): Promise<{status: number; json: Record<string, unknown>}> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {method: "POST", headers: {"content-type": "application/json"}}, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          json: JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>,
        });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

function extractServerUrl(errorSpy: ReturnType<typeof vi.spyOn>): string {
  const call = errorSpy.mock.calls.find((args) => typeof args[0] === "string" && args[0].includes("http://"));
  if (!call) throw new Error("server URL not printed to stderr");
  const match = (call[0] as string).match(/http:\/\/[^\s]+/);
  if (!match) throw new Error("could not parse server URL");
  return match[0];
}

describe("test point review server live reload", () => {
  let dir: string;
  let originalEnv: string | undefined;
  let state: ReviewState;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testpoint-review-live-reload-test-"));
    originalEnv = process.env.CAWPLAN_TESTPOINT_REVIEW_PATH;
    process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = dir;
    state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
    saveReviewState(state);
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CAWPLAN_TESTPOINT_REVIEW_PATH;
    else process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = originalEnv;
    rmSync(dir, {recursive: true, force: true});
    vi.restoreAllMocks();
  });

  test("the same URL renders a newer round written by a separate process", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const serverPromise = startTestPointReviewWebServer(state.review_id, {}, {launchBrowser: false});
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    const url = extractServerUrl(errorSpy);
    const parsedUrl = new URL(url);

    try {
      const nextRound = loadReviewState(state.review_id);
      nextRound.round = 2;
      nextRound.test_points[0].current.title = "Round 2 latest title";
      nextRound.test_points[0].status = "edited";
      nextRound.updated_at = "2099-01-01T00:00:00.000Z";
      saveReviewState(nextRound);

      const response = await get(url);
      expect(response.status).toBe(200);
      expect(response.text).toContain("Round 2");
      expect(response.text).toContain("Round 2 latest title");
    } finally {
      await post(`${parsedUrl.origin}/api/optimize?token=${parsedUrl.searchParams.get("token")}`, "{}");
      await serverPromise;
    }
  });

  test("a stale page cannot overwrite a newer round written to disk", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const serverPromise = startTestPointReviewWebServer(state.review_id, {}, {launchBrowser: false});
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    const url = extractServerUrl(errorSpy);
    const parsedUrl = new URL(url);
    const staleUpdatedAt = state.updated_at;

    try {
      const nextRound = loadReviewState(state.review_id);
      nextRound.round = 2;
      nextRound.test_points[0].current.title = "Round 2 preserved title";
      nextRound.test_points[0].status = "edited";
      nextRound.updated_at = "2099-01-01T00:00:00.000Z";
      saveReviewState(nextRound);

      const editUrl = new URL(`/api/test-points/tp_001`, parsedUrl.origin);
      editUrl.searchParams.set("token", parsedUrl.searchParams.get("token") ?? "");
      editUrl.searchParams.set("updated_at", staleUpdatedAt);
      const response = await post(editUrl.toString(), JSON.stringify({title: "stale overwrite"}));

      expect(response.status).toBe(409);
      expect(response.json.reason).toBe("stale_updated_at");
      expect(loadReviewState(state.review_id).test_points[0].current.title).toBe("Round 2 preserved title");
    } finally {
      await post(`${parsedUrl.origin}/api/optimize?token=${parsedUrl.searchParams.get("token")}`, "{}");
      await serverPromise;
    }
  });
});
