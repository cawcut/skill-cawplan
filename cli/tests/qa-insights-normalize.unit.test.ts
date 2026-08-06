import { describe, expect, test } from "vitest";
import {
  normalizeField,
  normalizeOutOfScope,
  normalizeFieldByKey,
  extractFiveFields,
  fieldsEqual,
} from "../src/lib/qa-insights/normalize";

describe("A1-FC-1 normalize — trim whitespace", () => {
  test("A1-FC-1 trims leading and trailing whitespace", () => {
    expect(normalizeField("  用户登录  ")).toBe("用户登录");
  });
  test("A1-FC-1 trims newlines and tabs", () => {
    expect(normalizeField("\n\t用户登录\n")).toBe("用户登录");
  });
  test("A1-FC-1 null and undefined become empty string", () => {
    expect(normalizeField(null)).toBe("");
    expect(normalizeField(undefined)).toBe("");
  });
  test("A1-FC-1 whitespace-only becomes empty string", () => {
    expect(normalizeField("   ")).toBe("");
  });
  test("A1-FC-1 inner whitespace is preserved (trim only, no collapse)", () => {
    expect(normalizeField(" a  b ")).toBe("a  b");
  });
});

describe("A1-FC-2 normalize — out_of_scope three-state equivalence", () => {
  test("A1-FC-2 null is empty", () => {
    expect(normalizeOutOfScope(null)).toBe("");
  });
  test("A1-FC-2 empty string is empty", () => {
    expect(normalizeOutOfScope("")).toBe("");
  });
  test("A1-FC-2 （素材未提及） is empty", () => {
    expect(normalizeOutOfScope("（素材未提及）")).toBe("");
  });
  test("A1-FC-2 （素材未提及） with surrounding whitespace is empty", () => {
    expect(normalizeOutOfScope("  （素材未提及）  ")).toBe("");
  });
  test("A1-FC-2 halfwidth (素材未提及) is empty", () => {
    expect(normalizeOutOfScope("(素材未提及)")).toBe("");
  });
  test("A1-FC-2 all three states compare equal to one another", () => {
    expect(fieldsEqual("out_of_scope", null, "")).toBe(true);
    expect(fieldsEqual("out_of_scope", "", "（素材未提及）")).toBe(true);
    expect(fieldsEqual("out_of_scope", null, "（素材未提及）")).toBe(true);
  });
});

/*
 * Step 1 field map (proto, 2026-08-06): real rows carry substantive out_of_scope
 * prose far more often than the three empty states, so content comparison is the
 * primary case here — the empty-state equivalence above is the boundary case.
 */
describe("A1-FC-2 normalize — out_of_scope with real content (primary case)", () => {
  const real =
    "Video Type 三种类型在 Idea 及后续流程中产生的差异化配置项/素材要求（如 Talking Video 的出镜人物设置），不在本次 Config 需求范围内，由 Idea 相关需求覆盖。";

  test("A1-FC-2 substantive content is preserved verbatim", () => {
    expect(normalizeOutOfScope(real)).toBe(real);
  });
  test("A1-FC-2 substantive content only trimmed, not emptied", () => {
    expect(normalizeOutOfScope(`  ${real}  `)).toBe(real);
  });
  test("A1-FC-2 identical content compares equal", () => {
    expect(fieldsEqual("out_of_scope", real, `${real}`)).toBe(true);
  });
  test("A1-FC-2 different content compares unequal", () => {
    expect(fieldsEqual("out_of_scope", real, `${real}补充一句。`)).toBe(false);
  });
  test("A1-FC-2 content is never equal to the empty states", () => {
    expect(fieldsEqual("out_of_scope", real, null)).toBe(false);
    expect(fieldsEqual("out_of_scope", real, "（素材未提及）")).toBe(false);
  });
});

describe("A1-FC-2 normalize — placeholder is NOT special-cased for other fields", () => {
  test("A1-FC-2 （素材未提及） stays literal in constraints", () => {
    expect(normalizeFieldByKey("constraints", "（素材未提及）")).toBe("（素材未提及）");
  });
  test("A1-FC-2 constraints placeholder differs from empty", () => {
    expect(fieldsEqual("constraints", "（素材未提及）", "")).toBe(false);
  });
});

describe("A1-FC-1 / A1-FC-5 extractFiveFields — five keys only, summary excluded", () => {
  const row = {
    id: "019fcfa0-da13-78db-b552-323598ce1c38",
    function_description: "  Config 页面  ",
    entry_trigger: "Product 页面完成选择后进入",
    normal_expectation: "可选择发布平台",
    constraints: "共 11 个平台",
    out_of_scope: "（素材未提及）",
    summary: "视频导出参数配置",
    product_id: "019fb1ff-d547-741f-bfa2-405386d04d5b",
    review_status: "PENDING",
  };

  test("A1-FC-5 returns exactly the five field keys", () => {
    expect(Object.keys(extractFiveFields(row)).sort()).toEqual([
      "constraints",
      "entry_trigger",
      "function_description",
      "normal_expectation",
      "out_of_scope",
    ]);
  });
  test("A1-FC-5 summary is not extracted", () => {
    expect(extractFiveFields(row)).not.toHaveProperty("summary");
  });
  test("A1-FC-5 read-only echo fields are not extracted", () => {
    const five = extractFiveFields(row);
    expect(five).not.toHaveProperty("product_id");
    expect(five).not.toHaveProperty("review_status");
    expect(five).not.toHaveProperty("id");
  });
  test("A1-FC-1 values are trimmed during extraction", () => {
    expect(extractFiveFields(row).function_description).toBe("Config 页面");
  });
  test("A1-FC-2 out_of_scope placeholder normalized to empty during extraction", () => {
    expect(extractFiveFields(row).out_of_scope).toBe("");
  });
  test("A1-FC-1 missing fields default to empty string", () => {
    const five = extractFiveFields({ function_description: "只有一个字段" });
    expect(five.entry_trigger).toBe("");
    expect(five.out_of_scope).toBe("");
  });
  test("A1-FC-1 null / undefined source yields all-empty five fields", () => {
    expect(extractFiveFields(null)).toEqual({
      function_description: "",
      entry_trigger: "",
      normal_expectation: "",
      constraints: "",
      out_of_scope: "",
    });
  });
});

/*
 * P3 — normalize is the precondition for strong match: inference markers must
 * survive normalization so SQA-visible inferred bullets stay traceable (A1-FC-3).
 */
describe("P3 / A1-FC-3 normalize — inference markers are preserved", () => {
  test("P3 （惯例推断） marker is not stripped", () => {
    const v = "（惯例推断）必填项未满足或校验未通过时应拦截提交并给出明确提示";
    expect(normalizeField(v)).toBe(v);
  });
  test("P3 （界面推断） marker is not stripped", () => {
    const v = "（界面推断）必填项未填全时提交按钮呈不可用状态";
    expect(normalizeField(v)).toBe(v);
  });
  test("P3 marked and unmarked text compare unequal", () => {
    expect(
      fieldsEqual("constraints", "（惯例推断）须二次确认", "须二次确认"),
    ).toBe(false);
  });
});
