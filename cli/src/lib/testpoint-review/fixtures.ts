import { randomUUID } from "node:crypto";
import { formatTestPointId } from "./test-point-id.js";
import type { ReviewState, TestPoint } from "./types.js";

const FIXTURE_TEST_POINTS: Array<Pick<TestPoint["current"], "title" | "group" | "tags" | "priority">> = [
  {
    title: "登录页,用户名密码均正确时可正常登录",
    group: "登录校验",
    tags: ["正向"],
    priority: "HIGH",
  },
  {
    title: "登录页,密码错误时提示错误信息",
    group: "登录校验",
    tags: ["异常"],
    priority: "HIGH",
  },
  {
    title: "购物车为空时,结算按钮不可点击",
    group: "购物车",
    tags: ["边界"],
    priority: "MEDIUM",
  },
];

export function createFixtureReviewState(params: {
  productId: string;
  requirementId: string;
  language?: "zh" | "en";
}): ReviewState {
  const now = new Date().toISOString();
  const testPoints: TestPoint[] = FIXTURE_TEST_POINTS.map((fields, index) => {
    const id = formatTestPointId(index + 1);
    return {
      id,
      original: { ...fields },
      current: { ...fields },
      status: "unchanged",
      source: "ai",
      ai_status: "none",
      comments: [],
    };
  });

  return {
    schema_version: 1,
    review_id: `rv_${randomUUID()}`,
    round: 1,
    review_status: "reviewing",
    product_id: params.productId,
    requirement_id: params.requirementId,
    requirement: {
      note: "(示例需求快照,占位数据,步骤 3 不接入真实需求内容)",
    },
    // Fixture rows are unsaved drafts, so the remote reconcile baseline is empty.
    count_before: 0,
    next_seq: testPoints.length + 1,
    language: params.language ?? "zh",
    updated_at: now,
    test_points: testPoints,
    global_comments: [],
    deleted_tombstones: [],
  };
}
