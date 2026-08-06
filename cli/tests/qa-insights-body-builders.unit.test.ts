import { describe, expect, test } from "vitest";
import {
  BodyValidationError,
  assertNoForbiddenKeys,
  buildRequirementCreateBody,
  validateRequirementPatchBody,
  buildTestPointBatchBody,
  buildModuleTreeNodeBody,
} from "../src/lib/qa-insights/body-builders";

const validCreate = {
  module_tree_node_id: "019fcf73-7fd1-7b6a-8745-97c2ffaded05",
  function_description: "Config 视频设置页面",
  entry_trigger: "Product 页面完成产品选择后进入",
  normal_expectation: "用户可选择 Publish to、Resolution、Duration",
  constraints: "共 11 个平台",
  out_of_scope: "Video Type 差异化配置由 Idea 需求覆盖",
  summary: "视频导出参数配置",
};

describe("A1-WB-1 / P6 forbidden key — product_id belongs in the URL only", () => {
  test("A1-WB-1 create body containing product_id is a hard failure", () => {
    expect(() => buildRequirementCreateBody({ ...validCreate, product_id: "019fb1ff" }))
      .toThrow(BodyValidationError);
  });
  test("P6 product_id is NOT silently stripped — it throws", () => {
    expect(() => buildRequirementCreateBody({ ...validCreate, product_id: "019fb1ff" }))
      .toThrow(/product_id/);
  });
  test("A1-WB-1 patch body containing product_id is a hard failure", () => {
    expect(() => validateRequirementPatchBody({ constraints: "改了", product_id: "x" }))
      .toThrow(BodyValidationError);
  });
});

describe("A1-WB-2 / P6 forbidden keys — review_status and is_edited", () => {
  test("A1-WB-2 create body containing review_status is a hard failure", () => {
    expect(() => buildRequirementCreateBody({ ...validCreate, review_status: "PENDING" }))
      .toThrow(/review_status/);
  });
  test("A1-WB-2 create body containing is_edited is a hard failure", () => {
    expect(() => buildRequirementCreateBody({ ...validCreate, is_edited: false }))
      .toThrow(/is_edited/);
  });
  test("A1-WB-2 patch body containing review_status is a hard failure", () => {
    expect(() => validateRequirementPatchBody({ summary: "改了", review_status: "PENDING" }))
      .toThrow(/review_status/);
  });
  test("P6 all three forbidden keys are reported together", () => {
    try {
      assertNoForbiddenKeys(
        { product_id: "a", review_status: "b", is_edited: true },
        "test body",
      );
      throw new Error("should have thrown");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("product_id");
      expect(message).toContain("review_status");
      expect(message).toContain("is_edited");
    }
  });
  test("P6 clean body passes the forbidden-key guard", () => {
    expect(() => assertNoForbiddenKeys({ constraints: "x" }, "test body")).not.toThrow();
  });
});

/*
 * Read/write asymmetry (step 1 field map): GET responses DO include product_id
 * and review_status. Feeding a fetched row straight back as a write body is
 * exactly the mistake the guard is meant to catch.
 */
describe("P6 forbidden keys — a fetched row cannot be reused as a write body", () => {
  test("P6 GET-shaped row with echo fields is rejected as a create body", () => {
    const fetched = {
      ...validCreate,
      id: "019fcfa0",
      product_id: "019fb1ff-d547-741f-bfa2-405386d04d5b",
      review_status: "PENDING",
      url: "/product/…/requirements/019fcfa0",
    };
    expect(() => buildRequirementCreateBody(fetched)).toThrow(BodyValidationError);
  });
});

describe("A1-WB-3 requirement create body — required fields", () => {
  test("A1-WB-3 valid body is accepted", () => {
    expect(() => buildRequirementCreateBody(validCreate)).not.toThrow();
  });
  test("A1-WB-3 missing module_tree_node_id is a hard failure", () => {
    const { module_tree_node_id: _drop, ...rest } = validCreate;
    expect(() => buildRequirementCreateBody(rest)).toThrow(/module_tree_node_id/);
  });
  test("A1-WB-3 empty module_tree_node_id is a hard failure", () => {
    expect(() => buildRequirementCreateBody({ ...validCreate, module_tree_node_id: "  " }))
      .toThrow(/module_tree_node_id/);
  });
  test("A1-WB-3 missing constraints is a hard failure", () => {
    expect(() => buildRequirementCreateBody({ ...validCreate, constraints: "" }))
      .toThrow(/constraints/);
  });
  test("A1-WB-3 missing function_description is a hard failure", () => {
    expect(() => buildRequirementCreateBody({ ...validCreate, function_description: "" }))
      .toThrow(/function_description/);
  });
  test("A1-WB-3 empty summary is a hard failure (A1 always sends non-empty)", () => {
    expect(() => buildRequirementCreateBody({ ...validCreate, summary: "" }))
      .toThrow(/summary/);
  });
  test("A1-WB-3 out_of_scope may be empty", () => {
    expect(() => buildRequirementCreateBody({ ...validCreate, out_of_scope: "" })).not.toThrow();
  });
  test("A1-WB-3 out_of_scope placeholder normalizes to empty string", () => {
    const body = buildRequirementCreateBody({ ...validCreate, out_of_scope: "（素材未提及）" });
    expect(body.out_of_scope).toBe("");
  });
  test("A1-WB-3 field values are trimmed", () => {
    const body = buildRequirementCreateBody({ ...validCreate, constraints: "  共 11 个平台  " });
    expect(body.constraints).toBe("共 11 个平台");
  });
  test("A1-WB-3 non-object body is rejected", () => {
    expect(() => buildRequirementCreateBody("not an object")).toThrow(BodyValidationError);
    expect(() => buildRequirementCreateBody(null)).toThrow(BodyValidationError);
    expect(() => buildRequirementCreateBody([])).toThrow(BodyValidationError);
  });
});

describe("A1-WB-2 optional API fields pass through untouched", () => {
  test("A1-WB-2 reviewer_user_ids is preserved", () => {
    const body = buildRequirementCreateBody({ ...validCreate, reviewer_user_ids: ["u1", "u2"] });
    expect(body.reviewer_user_ids).toEqual(["u1", "u2"]);
  });
  test("A1-WB-2 reviewer_group is preserved", () => {
    const body = buildRequirementCreateBody({ ...validCreate, reviewer_group: { id: "g1" } });
    expect(body.reviewer_group).toEqual({ id: "g1" });
  });
  test("A1-WB-3 ticket_id null is preserved", () => {
    const body = buildRequirementCreateBody({ ...validCreate, ticket_id: null });
    expect(body.ticket_id).toBeNull();
  });
});

describe("A1-WB-4 requirement patch body validation", () => {
  test("A1-WB-4 changed-keys body is accepted", () => {
    expect(() => validateRequirementPatchBody({ constraints: "改了" })).not.toThrow();
  });
  test("A1-WB-4 empty patch body is rejected (caller must NOOP)", () => {
    expect(() => validateRequirementPatchBody({})).toThrow(/NOOP/);
  });
  test("A1-WB-4 summary-only patch body is accepted", () => {
    expect(() => validateRequirementPatchBody({ summary: "改了" })).not.toThrow();
  });
});

describe("A2-§9-body / P10 testpoint batch — exactly four keys per item", () => {
  const point = { title: "用户名含特殊字符应被拦截", tags: ["异常"], group: "注册校验", is_edited: false };

  test("A2-§9-body valid four-key item is accepted", () => {
    const body = buildTestPointBatchBody({ test_points: [point] });
    expect(body.test_points).toHaveLength(1);
    expect(Object.keys(body.test_points[0]).sort()).toEqual(["group", "is_edited", "tags", "title"]);
  });
  test("P10 extra key `id` is a hard failure, not stripped", () => {
    expect(() => buildTestPointBatchBody({ test_points: [{ ...point, id: "tp-1" }] }))
      .toThrow(/id/);
  });
  test("P10 extra key `sort_order` is a hard failure", () => {
    expect(() => buildTestPointBatchBody({ test_points: [{ ...point, sort_order: 3 }] }))
      .toThrow(/sort_order/);
  });
  test("P10 extra key `requirement_id` is a hard failure", () => {
    expect(() => buildTestPointBatchBody({ test_points: [{ ...point, requirement_id: "r-1" }] }))
      .toThrow(/requirement_id/);
  });
  test("P10 the offending item index is reported", () => {
    expect(() => buildTestPointBatchBody({ test_points: [point, { ...point, id: "tp-2" }] }))
      .toThrow(/test_points\[1\]/);
  });
  test("A2-§9-body empty title is a hard failure", () => {
    expect(() => buildTestPointBatchBody({ test_points: [{ ...point, title: "   " }] }))
      .toThrow(/title/);
  });
  test("A2-§9-body empty tags array is allowed", () => {
    const body = buildTestPointBatchBody({ test_points: [{ ...point, tags: [] }] });
    expect(body.test_points[0].tags).toEqual([]);
  });
  test("A2-§9-body empty group is allowed (displays as 未分组)", () => {
    const body = buildTestPointBatchBody({ test_points: [{ ...point, group: "" }] });
    expect(body.test_points[0].group).toBe("");
  });
  test("A2-§9-body non-array tags is a hard failure", () => {
    expect(() => buildTestPointBatchBody({ test_points: [{ ...point, tags: "异常" }] }))
      .toThrow(/tags/);
  });
  test("A2-§9-body non-boolean is_edited is a hard failure", () => {
    expect(() => buildTestPointBatchBody({ test_points: [{ ...point, is_edited: "true" }] }))
      .toThrow(/is_edited/);
  });
  test("A2-§9-is is_edited is passed through, never inferred", () => {
    const body = buildTestPointBatchBody({ test_points: [{ ...point, is_edited: true }] });
    expect(body.test_points[0].is_edited).toBe(true);
  });
  test("A2-§9-body missing test_points array is a hard failure", () => {
    expect(() => buildTestPointBatchBody({})).toThrow(/test_points/);
  });
  test("A2-§9-body empty test_points array is a hard failure", () => {
    expect(() => buildTestPointBatchBody({ test_points: [] })).toThrow(/at least one/);
  });
  test("A2-§9-body array order is preserved (order = display = sort_order)", () => {
    const body = buildTestPointBatchBody({
      test_points: [
        { ...point, title: "第一条" },
        { ...point, title: "第二条" },
        { ...point, title: "第三条" },
      ],
    });
    expect(body.test_points.map((p) => p.title)).toEqual(["第一条", "第二条", "第三条"]);
  });
});

describe("A1-MT-1 module tree node body", () => {
  test("A1-MT-1 parent_id null builds a root node", () => {
    expect(buildModuleTreeNodeBody({ parentId: null, name: "视频生成" }))
      .toEqual({ parent_id: null, name: "视频生成" });
  });
  test("A1-MT-1 literal string \"null\" is treated as root", () => {
    expect(buildModuleTreeNodeBody({ parentId: "null", name: "视频生成" }).parent_id).toBeNull();
  });
  test("A1-MT-1 omitted parentId is treated as root", () => {
    expect(buildModuleTreeNodeBody({ name: "视频生成" }).parent_id).toBeNull();
  });
  test("A1-MT-1 concrete parent id is preserved", () => {
    expect(buildModuleTreeNodeBody({ parentId: "019fcf73", name: "子节点" }).parent_id)
      .toBe("019fcf73");
  });
  test("A1-MT-1 empty name is a hard failure", () => {
    expect(() => buildModuleTreeNodeBody({ parentId: null, name: "  " })).toThrow(/name/);
  });
  test("A1-MT-1 name is trimmed", () => {
    expect(buildModuleTreeNodeBody({ parentId: null, name: "  视频生成  " }).name).toBe("视频生成");
  });
});
