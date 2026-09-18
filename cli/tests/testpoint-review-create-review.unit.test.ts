import { describe, expect, test } from "vitest";
import {
  createReviewStateFromInput,
  reviewStartCounts,
} from "../src/lib/testpoint-review/create-review.js";
import { testPointsPendingArchive } from "../src/lib/testpoint-review/archive-submission.js";

describe("createReviewStateFromInput", () => {
  test("builds a review state from real test points, assigning stable sequential ids", () => {
    const state = createReviewStateFromInput({
      productId: "prod_1",
      requirementId: "req_1",
      testPoints: [
        { title: "正确账号密码登录应成功", group: "登录校验", tags: ["正向"], priority: "HIGH" },
        { title: "错误密码登录应提示失败", group: "登录校验", tags: ["异常"], priority: "MEDIUM" },
      ],
    });

    expect(state.test_points).toHaveLength(2);
    expect(state.test_points.map((tp) => tp.id)).toEqual(["tp_001", "tp_002"]);
    expect(state.test_points[0].current).toEqual({
      title: "正确账号密码登录应成功",
      group: "登录校验",
      tags: ["正向"],
      priority: "HIGH",
    });
    expect(state.test_points[0].original).toEqual(state.test_points[0].current);
    expect(state.test_points.every((tp) => tp.status === "unchanged" && tp.source === "ai")).toBe(true);
    expect(state.next_seq).toBe(3);
    expect(state.count_before).toBe(0);
    expect(state.round).toBe(1);
    expect(state.review_status).toBe("reviewing");
    expect(state.language).toBe("zh");
  });

  test("defaults group/tags/priority when omitted, and honors language + requirement snapshot", () => {
    const state = createReviewStateFromInput({
      productId: "prod_1",
      requirementId: "req_1",
      language: "en",
      requirement: { summary: "Login" },
      testPoints: [{ title: "Only a title" }],
    });

    expect(state.test_points[0].current).toEqual({ title: "Only a title", group: "", tags: [], priority: "" });
    expect(state.language).toBe("en");
    expect(state.requirement).toEqual({ summary: "Login" });
  });

  test("rejects an empty test point list", () => {
    expect(() =>
      createReviewStateFromInput({ productId: "prod_1", requirementId: "req_1", testPoints: [] }),
    ).toThrow(/at least one test point/);
  });

  test("rejects a blank title", () => {
    expect(() =>
      createReviewStateFromInput({
        productId: "prod_1",
        requirementId: "req_1",
        testPoints: [{ title: "   " }],
      }),
    ).toThrow(/non-empty title/);
  });

  test("creates an incremental review with archived N as the reconcile baseline and only new M pending", () => {
    const state = createReviewStateFromInput({
      productId: "prod_1",
      requirementId: "req_1",
      testPoints: [
        { id: "saved-1", title: "已存 1", group: "登录", archived: true },
        { id: "saved-2", title: "已存 2", group: "权限", archived: true },
        { title: "新增 1", group: "登录", tags: ["正向"], priority: "HIGH" },
        { title: "新增 2", group: "边界", tags: ["边界"], priority: "MEDIUM" },
      ],
    });

    expect(state.count_before).toBe(2);
    expect(state.test_points.slice(0, 2).map((tp) => ({ id: tp.id, archived: tp.archived }))).toEqual([
      { id: "saved-1", archived: true },
      { id: "saved-2", archived: true },
    ]);
    expect(state.test_points.slice(2).map((tp) => tp.id)).toEqual(["tp_001", "tp_002"]);
    expect(testPointsPendingArchive(state).map((tp) => tp.current.title)).toEqual(["新增 1", "新增 2"]);
    expect(reviewStartCounts(state)).toEqual({
      draft_count: 2,
      archived_count: 2,
      group_count: 2,
      count_before: 2,
    });
  });

  test("keeps generated ids unique when an archived API id uses the local id format", () => {
    const state = createReviewStateFromInput({
      productId: "prod_1",
      requirementId: "req_1",
      testPoints: [
        { id: "tp_001", title: "已存", archived: true },
        { title: "新增" },
      ],
    });

    expect(state.test_points.map((tp) => tp.id)).toEqual(["tp_001", "tp_002"]);
    expect(state.next_seq).toBe(3);
  });

  test.each([
    {
      name: "an archived row without an id",
      testPoints: [{ title: "已存", archived: true }],
      message: /archived and requires a non-empty id/,
    },
    {
      name: "an id on a new draft",
      testPoints: [{ id: "saved-1", title: "新增" }],
      message: /id is only allowed when archived is true/,
    },
    {
      name: "duplicate archived ids",
      testPoints: [
        { id: "saved-1", title: "已存 1", archived: true },
        { id: "saved-1", title: "已存 2", archived: true },
      ],
      message: /ids must be unique/,
    },
  ])("rejects $name", ({ testPoints, message }) => {
    expect(() =>
      createReviewStateFromInput({
        productId: "prod_1",
        requirementId: "req_1",
        testPoints,
      }),
    ).toThrow(message);
  });
});
