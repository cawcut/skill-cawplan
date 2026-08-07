import { describe, expect, test } from "vitest";
import {
  isStrongMatch,
  differingFields,
  findStrongMatches,
  strongMatchIds,
} from "../src/lib/qa-insights/strong-match";
import type { RequirementRow } from "../src/lib/qa-insights/types";

const base = {
  function_description: "Config 视频设置页面",
  entry_trigger: "Product 页面完成产品选择后进入 Config 页面",
  normal_expectation: "用户可选择 Publish to、Resolution、Duration",
  constraints: "共 11 个平台；Duration 仅 5s/10s/15s 三挡",
  out_of_scope: "Video Type 差异化配置由 Idea 需求覆盖",
};

describe("A1-FC-5 strong match — all five fields must be equal", () => {
  test("A1-FC-5 identical five fields match", () => {
    expect(isStrongMatch(base, { ...base })).toBe(true);
  });
  test("A1-FC-5 differing function_description does not match", () => {
    expect(isStrongMatch(base, { ...base, function_description: "别的页面" })).toBe(false);
  });
  test("A1-FC-5 differing entry_trigger does not match", () => {
    expect(isStrongMatch(base, { ...base, entry_trigger: "别的入口" })).toBe(false);
  });
  test("A1-FC-5 differing normal_expectation does not match", () => {
    expect(isStrongMatch(base, { ...base, normal_expectation: "别的预期" })).toBe(false);
  });
  test("A1-FC-5 differing constraints does not match", () => {
    expect(isStrongMatch(base, { ...base, constraints: "别的约束" })).toBe(false);
  });
  test("A1-FC-5 differing out_of_scope does not match", () => {
    expect(isStrongMatch(base, { ...base, out_of_scope: "别的不测范围" })).toBe(false);
  });
  test("A1-FC-1 whitespace-only differences still match (normalize first)", () => {
    expect(isStrongMatch(base, { ...base, constraints: `  ${base.constraints}  ` })).toBe(true);
  });
  test("A1-FC-2 out_of_scope null vs （素材未提及） still match", () => {
    const a = { ...base, out_of_scope: null };
    const b = { ...base, out_of_scope: "（素材未提及）" };
    expect(isStrongMatch(a, b)).toBe(true);
  });
});

/*
 * P3 — summary must never participate in strong match. Verified against real
 * proto data (step 1 field map): one module-tree node held two distinct rows
 * whose summaries were "视频导出参数配置" and "视频生成参数配置" — near-identical
 * labels on different requirements. Matching on summary would be wrong in both
 * directions, so it is excluded entirely.
 */
describe("P3 / A1-FC-5 strong match — summary does NOT participate", () => {
  test("P3 different summary still matches when five fields are equal", () => {
    const a = { ...base, summary: "视频导出参数配置" };
    const b = { ...base, summary: "视频生成参数配置" };
    expect(isStrongMatch(a, b)).toBe(true);
  });
  test("P3 missing vs present summary still matches", () => {
    expect(isStrongMatch({ ...base }, { ...base, summary: "任意摘要" })).toBe(true);
  });
  test("P3 null summary still matches", () => {
    expect(isStrongMatch({ ...base, summary: null }, { ...base, summary: "有值" })).toBe(true);
  });
  test("P3 identical summary does NOT rescue differing five fields", () => {
    const a = { ...base, summary: "同一个摘要" };
    const b = { ...base, constraints: "不同的约束", summary: "同一个摘要" };
    expect(isStrongMatch(a, b)).toBe(false);
  });
  test("P3 summary never appears in differingFields", () => {
    const a = { ...base, summary: "摘要甲" };
    const b = { ...base, summary: "摘要乙" };
    expect(differingFields(a, b)).toEqual([]);
  });
});

/*
 * A1-FC-3 — inference markers stay in the compared text. A row whose bullet was
 * SQA-verified (marker removed) is NOT the same row as one still marked inferred.
 */
describe("A1-FC-3 strong match — inference markers are not stripped", () => {
  test("A1-FC-3 （惯例推断） vs unmarked does not match", () => {
    const a = { ...base, constraints: "（惯例推断）须二次确认" };
    const b = { ...base, constraints: "须二次确认" };
    expect(isStrongMatch(a, b)).toBe(false);
  });
  test("A1-FC-3 （界面推断） vs unmarked does not match", () => {
    const a = { ...base, normal_expectation: "（界面推断）按钮置灰" };
    const b = { ...base, normal_expectation: "按钮置灰" };
    expect(isStrongMatch(a, b)).toBe(false);
  });
  test("A1-FC-3 same marker on both sides matches", () => {
    const marked = { ...base, constraints: "（惯例推断）须二次确认" };
    expect(isStrongMatch(marked, { ...marked })).toBe(true);
  });
  test("A1-FC-3 （惯例推断） vs （界面推断） does not match", () => {
    const a = { ...base, constraints: "（惯例推断）须二次确认" };
    const b = { ...base, constraints: "（界面推断）须二次确认" };
    expect(isStrongMatch(a, b)).toBe(false);
  });
});

describe("A1-FC-5 differingFields — reports which of the five differ", () => {
  test("A1-FC-5 no differences yields empty list", () => {
    expect(differingFields(base, { ...base })).toEqual([]);
  });
  test("A1-FC-5 single difference reported", () => {
    expect(differingFields(base, { ...base, constraints: "改了" })).toEqual(["constraints"]);
  });
  test("A1-FC-5 multiple differences reported in canonical key order", () => {
    const changed = { ...base, function_description: "改了", out_of_scope: "也改了" };
    expect(differingFields(base, changed)).toEqual(["function_description", "out_of_scope"]);
  });
});

/*
 * P13 — multiple strong matches must all be surfaced. Table A row 2 requires
 * listing every id so SQA picks the binding target; the CLI never auto-binds.
 */
describe("P13 findStrongMatches — surfaces every match, never picks one", () => {
  const rows: RequirementRow[] = [
    { id: "id-1", ...base },
    { id: "id-2", function_description: "完全不同的需求", entry_trigger: "x", normal_expectation: "y", constraints: "z", out_of_scope: "" },
    { id: "id-3", ...base, summary: "摘要不同但五字段相同" },
  ];

  test("P13 finds all rows whose five fields match", () => {
    expect(strongMatchIds(base, rows)).toEqual(["id-1", "id-3"]);
  });
  test("P13 non-matching rows are excluded", () => {
    expect(strongMatchIds(base, rows)).not.toContain("id-2");
  });
  test("A1-TA-1 exactly one match yields a single id", () => {
    expect(strongMatchIds(base, [rows[0], rows[1]])).toEqual(["id-1"]);
  });
  test("A1-TA-5 no match yields empty list", () => {
    expect(strongMatchIds({ ...base, constraints: "谁都不等于" }, rows)).toEqual([]);
  });
  test("A1-TA-5 empty row list yields empty list", () => {
    expect(strongMatchIds(base, [])).toEqual([]);
  });
  test("P13 findStrongMatches returns whole rows, preserving list order", () => {
    expect(findStrongMatches(base, rows).map((r) => r.id)).toEqual(["id-1", "id-3"]);
  });
  test("A1-FC-2 probe with omitted out_of_scope matches row with （素材未提及）", () => {
    const probe = {
      function_description: base.function_description,
      entry_trigger: base.entry_trigger,
      normal_expectation: base.normal_expectation,
      constraints: base.constraints,
    };
    const row: RequirementRow = { id: "id-9", ...probe, out_of_scope: "（素材未提及）" };
    expect(strongMatchIds(probe, [row])).toEqual(["id-9"]);
  });
});
