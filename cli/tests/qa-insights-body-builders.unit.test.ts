import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  BodyValidationError,
  assertNoForbiddenKeys,
  applyAiGeneratedToRequirementPatch,
  buildRequirementCreateBody,
  validateRequirementPatchBody,
  buildTestPointBatchBody,
  buildModuleTreeNodeBody,
} from "../src/lib/qa-insights/body-builders";
import {
  classifyTestPointCategory,
  createTestPointCategoryMapping,
  TESTPOINT_CATEGORY_MAPPING_VERSION,
} from "../src/lib/qa-insights/testpoint-category";
import {
  IS_AI_GENERATED,
  TESTPOINT_CALLER_KEYS,
} from "../src/lib/qa-insights/types";

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
  test("CWP-18709 create body injects is_ai_generated at top level", () => {
    const body = buildRequirementCreateBody(validCreate);
    expect(body.is_ai_generated).toBe(IS_AI_GENERATED);
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

describe("CWP-18709 applyAiGeneratedToRequirementPatch", () => {
  test("empty diff stays empty (NOOP gate)", () => {
    expect(applyAiGeneratedToRequirementPatch({})).toEqual({});
  });
  test("non-empty patch gets is_ai_generated at top level", () => {
    expect(applyAiGeneratedToRequirementPatch({ summary: "新" })).toEqual({
      summary: "新",
      is_ai_generated: IS_AI_GENERATED,
    });
  });
});

describe("qa-testpoint-category/v1 mapping and injection contract", () => {
  const officialZh = [
    ["正向", "POSITIVE"],
    ["边界", "BOUNDARY"],
    ["异常", "EXCEPTION"],
    ["逆向", "REVERSE_ACTION"],
    ["输入类型", "INPUT_TYPE"],
    ["交互反馈", "INTERACTION_FEEDBACK"],
    ["状态迁移", "STATE_TRANSITION"],
    ["角色权限", "ROLE_PERMISSION"],
    ["来源入口", "SOURCE_ENTRY"],
    ["幂等", "IDEMPOTENCY"],
    ["并发", "CONCURRENCY"],
    ["一致性", "CONSISTENCY"],
    ["存量兼容", "BACKWARD_COMPATIBILITY"],
    ["环境兼容", "ENVIRONMENT_COMPATIBILITY"],
    ["性能", "PERFORMANCE"],
    ["安全审计", "SECURITY_AUDIT"],
    ["可观测", "OBSERVABILITY"],
  ] as const;
  const officialEn = [
    ["Positive", "POSITIVE"],
    ["Boundary", "BOUNDARY"],
    ["Exception", "EXCEPTION"],
    ["Reverse Action", "REVERSE_ACTION"],
    ["Input Type", "INPUT_TYPE"],
    ["Interaction Feedback", "INTERACTION_FEEDBACK"],
    ["State Transition", "STATE_TRANSITION"],
    ["Role & Permission", "ROLE_PERMISSION"],
    ["Source Entry", "SOURCE_ENTRY"],
    ["Idempotency", "IDEMPOTENCY"],
    ["Concurrency", "CONCURRENCY"],
    ["Consistency", "CONSISTENCY"],
    ["Backward Compatibility", "BACKWARD_COMPATIBILITY"],
    ["Environment Compatibility", "ENVIRONMENT_COMPATIBILITY"],
    ["Performance", "PERFORMANCE"],
    ["Security Audit", "SECURITY_AUDIT"],
    ["Observability", "OBSERVABILITY"],
  ] as const;
  const categoryPoint = {
    title: "分类测试点",
    tags: ["正向"],
    group: "分类",
    priority: "HIGH",
    is_edited: false,
  };

  test("CATEGORY-V1-01 maps all 17 official Chinese terms", () => {
    for (const [term, code] of officialZh) {
      expect(classifyTestPointCategory([term]), term).toBe(code);
    }
  });

  test("CATEGORY-V1-02 maps all 17 official English terms", () => {
    for (const [term, code] of officialEn) {
      expect(classifyTestPointCategory([term]), term).toBe(code);
    }
  });

  test("CATEGORY-V1-03 maps Reverse Action to REVERSE_ACTION", () => {
    expect(classifyTestPointCategory(["Reverse Action"])).toBe("REVERSE_ACTION");
  });

  test("CATEGORY-V1-04 maps 正面 and 主流程 aliases to POSITIVE", () => {
    expect(classifyTestPointCategory(["正面"])).toBe("POSITIVE");
    expect(classifyTestPointCategory(["主流程"])).toBe("POSITIVE");
  });

  test("CATEGORY-V1-05 maps Permission alias to ROLE_PERMISSION", () => {
    expect(classifyTestPointCategory(["Permission"])).toBe("ROLE_PERMISSION");
  });

  test("CATEGORY-V1-06 normalizes English letter case", () => {
    expect(classifyTestPointCategory(["pOsItIvE"])).toBe("POSITIVE");
    expect(classifyTestPointCategory(["ROLE & PERMISSION"])).toBe("ROLE_PERMISSION");
  });

  test("CATEGORY-V1-07 trims surrounding whitespace", () => {
    expect(classifyTestPointCategory([" \tPositive\n"])).toBe("POSITIVE");
  });

  test("CATEGORY-V1-08 applies NFKC to full-width English and ampersand", () => {
    expect(classifyTestPointCategory(["Ｒｏｌｅ ＆ Ｐｅｒｍｉｓｓｉｏｎ"]))
      .toBe("ROLE_PERMISSION");
  });

  test("CATEGORY-V1-09 returns null for an unknown term", () => {
    expect(classifyTestPointCategory(["自定义"])).toBeNull();
  });

  test("CATEGORY-V1-10 returns null for a misspelling", () => {
    expect(classifyTestPointCategory(["Positve"])).toBeNull();
  });

  test("CATEGORY-V1-11 returns null for an empty primary tag", () => {
    expect(classifyTestPointCategory([""])).toBeNull();
    expect(classifyTestPointCategory(["   "])).toBeNull();
  });

  test("CATEGORY-V1-12 returns null for an empty tags array", () => {
    expect(classifyTestPointCategory([])).toBeNull();
  });

  test("CATEGORY-V1-13 only uses tags[0] when multiple tags are present", () => {
    expect(classifyTestPointCategory(["异常", "正向"])).toBe("EXCEPTION");
  });

  test("CATEGORY-V1-14 ignores a recognized tags[1] when tags[0] is unknown", () => {
    expect(classifyTestPointCategory(["自定义", "正向"])).toBeNull();
  });

  test("CATEGORY-V1-15 does not perform substring matching", () => {
    expect(classifyTestPointCategory(["正向流程"])).toBeNull();
    expect(classifyTestPointCategory(["Permission Check"])).toBeNull();
  });

  test("CATEGORY-V1-16 does not collapse internal whitespace", () => {
    expect(classifyTestPointCategory(["Role  & Permission"])).toBeNull();
  });

  test("CATEGORY-V1-17 automatic mapping never returns OTHER", () => {
    for (const [term] of [...officialZh, ...officialEn]) {
      expect(classifyTestPointCategory([term])).not.toBe("OTHER");
    }
    expect(classifyTestPointCategory(["Other"])).toBeNull();
    expect(classifyTestPointCategory(["其他"])).toBeNull();
  });

  test("CATEGORY-V1-18 duplicate normalized keys make initialization fail", () => {
    const manifest = JSON.parse(
      readFileSync(
        new URL("../config/qa-testpoint-category-mapping.v1.json", import.meta.url),
        "utf8",
      ),
    ) as {
      categories: Array<{ code: string; aliases: { en: string[] } }>;
    };
    const boundary = manifest.categories.find((category) => category.code === "BOUNDARY");
    if (!boundary) throw new Error("test fixture is missing BOUNDARY");
    boundary.aliases.en.push(" ＰＯＳＩＴＩＶＥ ");
    expect(() => createTestPointCategoryMapping(manifest)).toThrow(/duplicate normalized mapping key/);
  });

  test("CATEGORY-V1-19 exposes the frozen mapping version", () => {
    expect(TESTPOINT_CATEGORY_MAPPING_VERSION).toBe("qa-testpoint-category/v1");
  });

  test("CATEGORY-V1-20 rejects caller-supplied category_code", () => {
    expect(() => buildTestPointBatchBody({
      test_points: [{ ...categoryPoint, category_code: "POSITIVE" }],
    })).toThrow(/category_code/);
  });

  test("CATEGORY-V1-21 keeps caller keys strictly at five", () => {
    expect(TESTPOINT_CALLER_KEYS).toEqual(["title", "tags", "group", "priority", "is_edited"]);
  });
});

describe("A2-§9-body / P10 testpoint batch — caller five keys; CLI injects is_ai_generated per item", () => {
  const point = {
    title: "用户名含特殊字符应被拦截",
    tags: ["异常"],
    group: "注册校验",
    priority: "HIGH",
    is_edited: false,
  };

  test("A2-§9-body valid five-key item is accepted and injects is_ai_generated per element", () => {
    const body = buildTestPointBatchBody({ test_points: [point] });
    expect(body.test_points).toHaveLength(1);
    expect(Object.keys(body.test_points[0]).sort()).toEqual(
      ["category_code", "group", "is_ai_generated", "is_edited", "priority", "tags", "title"],
    );
    expect(body.test_points[0].is_ai_generated).toBe(IS_AI_GENERATED);
    expect(body.test_points[0].category_code).toBe("EXCEPTION");
  });
  test("A2-§9-body priority is passed through, never inferred", () => {
    const body = buildTestPointBatchBody({ test_points: [{ ...point, priority: "CRITICAL" }] });
    expect(body.test_points[0].priority).toBe("CRITICAL");
  });
  test("A2-§9-body missing priority is a hard failure", () => {
    const { priority, ...withoutPriority } = point;
    expect(() => buildTestPointBatchBody({ test_points: [withoutPriority] }))
      .toThrow(/priority/);
  });
  test("A2-§9-body invalid priority value is a hard failure", () => {
    expect(() => buildTestPointBatchBody({ test_points: [{ ...point, priority: "URGENT" }] }))
      .toThrow(/priority/);
  });
  test("P10 caller-supplied is_ai_generated is a hard failure (CLI injects it)", () => {
    expect(() =>
      buildTestPointBatchBody({ test_points: [{ ...point, is_ai_generated: true }] }),
    ).toThrow(/is_ai_generated/);
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
    expect(body.test_points[0].category_code).toBeNull();
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
