import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { registerTestPointReviewCommand } from "../src/commands/testpoint-review.js";
import type { ReviewState } from "../src/lib/testpoint-review/types.js";

describe("testpoint-review start incremental contract", () => {
  let dir: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testpoint-review-start-test-"));
    originalPath = process.env.CAWPLAN_TESTPOINT_REVIEW_PATH;
    process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = dir;
  });

  afterEach(() => {
    if (originalPath === undefined) delete process.env.CAWPLAN_TESTPOINT_REVIEW_PATH;
    else process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test("returns additive counts and persists archived N separately from new M", async () => {
    const input = [
      { id: "saved-1", title: "已存 1", group: "登录", archived: true },
      { id: "saved-2", title: "已存 2", group: "权限", archived: true },
      { title: "新增 1", group: "登录" },
      { title: "新增 2", group: "边界" },
      { title: "新增 3", group: "边界" },
    ];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const program = new Command();
    program.exitOverride();
    registerTestPointReviewCommand(program);

    await program.parseAsync([
      "node",
      "cawplan",
      "qa-insights",
      "testpoint-review",
      "start",
      "--product-id",
      "prod_1",
      "--requirement-id",
      "req_1",
      "--test-points",
      JSON.stringify(input),
    ]);

    expect(log).toHaveBeenCalledTimes(1);
    const receipt = JSON.parse(String(log.mock.calls[0][0])) as {
      review_id: string;
      file: string;
      draft_count: number;
      archived_count: number;
      group_count: number;
      count_before: number;
    };
    expect(receipt).toMatchObject({
      draft_count: 3,
      archived_count: 2,
      group_count: 2,
      count_before: 2,
    });

    const persisted = JSON.parse(readFileSync(receipt.file, "utf8")) as ReviewState;
    expect(persisted.review_id).toBe(receipt.review_id);
    expect(persisted.count_before).toBe(2);
    expect(persisted.test_points.filter((testPoint) => testPoint.archived === true)).toHaveLength(2);
    expect(persisted.test_points.filter((testPoint) => testPoint.archived !== true)).toHaveLength(3);
  });
});
