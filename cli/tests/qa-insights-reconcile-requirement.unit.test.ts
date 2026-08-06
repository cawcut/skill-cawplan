import { describe, expect, test } from "vitest";
import { reconcileRequirement } from "../src/lib/qa-insights/reconcile-requirement";
import type { RequirementRow } from "../src/lib/qa-insights/types";

const five = {
  function_description: "Config 视频设置页面",
  entry_trigger: "Product 页面完成产品选择后进入",
  normal_expectation: "用户可选择 Publish to、Resolution、Duration",
  constraints: "共 11 个平台",
  out_of_scope: "Video Type 差异化配置由 Idea 需求覆盖",
};

const row = (id: string, over: Partial<RequirementRow> = {}): RequirementRow => ({
  id,
  ...five,
  summary: "视频导出参数配置",
  ...over,
});

describe("A1-TA-1 / P2 Table A row 1 — single strong match binds, does NOT POST", () => {
  const result = reconcileRequirement({ probe: five, rows: [row("id-1"), row("id-2", { constraints: "别的" })] });

  test("A1-TA-1 outcome is RECONCILED", () => {
    expect(result.outcome).toBe("RECONCILED");
  });
  test("A1-TA-1 decision is strong_match_single", () => {
    expect(result.reconcile.decision).toBe("strong_match_single");
  });
  test("A1-TA-1 matched_requirement_ids has exactly one id (envelope contract)", () => {
    expect(result.reconcile.matched_requirement_ids).toEqual(["id-1"]);
  });
  test("P2 message tells the caller not to create another", () => {
    expect(result.message).toMatch(/do NOT create another/i);
  });
  test("P3 summary differing does not prevent the match", () => {
    const r = reconcileRequirement({ probe: five, rows: [row("id-9", { summary: "完全不同的摘要" })] });
    expect(r.reconcile.decision).toBe("strong_match_single");
  });
});

/*
 * A1-TA-2 / P13 — Table A row 2. The CLI must surface every candidate and stop;
 * choosing one would silently bind SQA to an arbitrary row. There is no
 * --bind-id flag by design.
 */
describe("A1-TA-2 / P13 Table A row 2 — multiple matches list ids, never auto-bind", () => {
  const result = reconcileRequirement({
    probe: five,
    rows: [row("id-1"), row("id-2", { summary: "另一个摘要" }), row("id-3", { constraints: "不同" })],
  });

  test("A1-TA-2 outcome is FAILURE (SQA must decide)", () => {
    expect(result.outcome).toBe("FAILURE");
  });
  test("A1-TA-2 decision is strong_match_multiple", () => {
    expect(result.reconcile.decision).toBe("strong_match_multiple");
  });
  test("P13 every matching id is listed", () => {
    expect(result.reconcile.matched_requirement_ids).toEqual(["id-1", "id-2"]);
  });
  test("P13 outcome is not RECONCILED — nothing was bound", () => {
    expect(result.outcome).not.toBe("RECONCILED");
  });
  test("P13 message directs the choice to SQA", () => {
    expect(result.message).toMatch(/ask SQA/i);
  });
});

describe("A1-TA-5 / P2 Table A row 5 — no match means retry the SAME write", () => {
  const result = reconcileRequirement({
    probe: five,
    rows: [row("id-1", { constraints: "完全不同" })],
  });

  test("A1-TA-5 outcome is FAILURE", () => {
    expect(result.outcome).toBe("FAILURE");
  });
  test("A1-TA-5 decision is no_match", () => {
    expect(result.reconcile.decision).toBe("no_match");
  });
  test("A1-TA-5 matched ids is empty", () => {
    expect(result.reconcile.matched_requirement_ids).toEqual([]);
  });
  test("A1-TA-5 message says retry, explicitly not a second requirement", () => {
    expect(result.message).toMatch(/retry the SAME write/i);
    expect(result.message).toMatch(/not a second requirement/i);
  });
  test("A1-TA-5 empty row list yields no_match", () => {
    expect(reconcileRequirement({ probe: five, rows: [] }).reconcile.decision).toBe("no_match");
  });
});

/*
 * A1-TA-3 / OQ#5 — Table A row 3. Only the keys the PATCH intended to write are
 * compared. Comparing the full record would report "still old" whenever any
 * unrelated field had drifted since the snapshot.
 */
describe("A1-TA-3 / OQ#5 Table A row 3 — patch_already_applied compares ONLY changed keys", () => {
  const target = row("id-1", { constraints: "新的约束", summary: "旧摘要" });

  test("A1-TA-3 intended key already holding the new value is RECONCILED", () => {
    const result = reconcileRequirement({
      probe: five,
      rows: [target],
      targetRequirementId: "id-1",
      intendedPatch: { constraints: "新的约束" },
    });
    expect(result.outcome).toBe("RECONCILED");
    expect(result.reconcile.decision).toBe("patch_already_applied");
  });
  test("OQ#5 unrelated fields differing do NOT block patch_already_applied", () => {
    const drifted = row("id-1", { constraints: "新的约束", function_description: "别人改过的描述" });
    const result = reconcileRequirement({
      probe: five,
      rows: [drifted],
      targetRequirementId: "id-1",
      intendedPatch: { constraints: "新的约束" },
    });
    expect(result.reconcile.decision).toBe("patch_already_applied");
  });
  test("A1-TA-3 summary-only patch is compared against summary", () => {
    const result = reconcileRequirement({
      probe: five,
      rows: [row("id-1", { summary: "新摘要" })],
      targetRequirementId: "id-1",
      intendedPatch: { summary: "新摘要" },
    });
    expect(result.reconcile.decision).toBe("patch_already_applied");
  });
  test("A1-TA-3 multi-key patch requires ALL intended keys to match", () => {
    const result = reconcileRequirement({
      probe: five,
      rows: [row("id-1", { constraints: "新的约束", summary: "旧摘要" })],
      targetRequirementId: "id-1",
      intendedPatch: { constraints: "新的约束", summary: "新摘要" },
    });
    expect(result.reconcile.decision).toBe("patch_still_old");
  });
  test("A1-TA-3 bound id is echoed back", () => {
    const result = reconcileRequirement({
      probe: five,
      rows: [target],
      targetRequirementId: "id-1",
      intendedPatch: { constraints: "新的约束" },
    });
    expect(result.reconcile.matched_requirement_ids).toEqual(["id-1"]);
  });
});

describe("A1-TA-4 Table A row 4 — patch_still_old routes to a PATCH retry", () => {
  const result = reconcileRequirement({
    probe: five,
    rows: [row("id-1", { constraints: "旧的约束" })],
    targetRequirementId: "id-1",
    intendedPatch: { constraints: "新的约束" },
  });

  test("A1-TA-4 outcome is FAILURE", () => {
    expect(result.outcome).toBe("FAILURE");
  });
  test("A1-TA-4 decision is patch_still_old", () => {
    expect(result.reconcile.decision).toBe("patch_still_old");
  });
  test("A1-TA-4 message says PATCH retry, not POST", () => {
    expect(result.message).toMatch(/retry the same PATCH/i);
    expect(result.message).toMatch(/not a POST/i);
  });
  test("A1-TA-4 missing target row yields no_match, not a silent success", () => {
    const missing = reconcileRequirement({
      probe: five,
      rows: [row("other")],
      targetRequirementId: "id-gone",
      intendedPatch: { constraints: "x" },
    });
    expect(missing.reconcile.decision).toBe("no_match");
    expect(missing.outcome).toBe("FAILURE");
  });
  test("A1-TA-4 empty intendedPatch cannot conclude success", () => {
    const noKeys = reconcileRequirement({
      probe: five,
      rows: [row("id-1")],
      targetRequirementId: "id-1",
      intendedPatch: {},
    });
    expect(noKeys.outcome).toBe("FAILURE");
    expect(noKeys.reconcile.decision).toBe("patch_still_old");
  });
});

describe("A1-FC-2 / P5 reconcile — normalization applies to matching", () => {
  test("A1-FC-2 out_of_scope placeholder vs null still strong-matches", () => {
    const probe = { ...five, out_of_scope: "（素材未提及）" };
    const serverRow = row("id-1", { out_of_scope: null });
    expect(reconcileRequirement({ probe, rows: [serverRow] }).reconcile.decision)
      .toBe("strong_match_single");
  });
  test("A1-FC-1 whitespace differences still strong-match", () => {
    const probe = { ...five, constraints: `  ${five.constraints}  ` };
    expect(reconcileRequirement({ probe, rows: [row("id-1")] }).reconcile.decision)
      .toBe("strong_match_single");
  });
  test("A1-FC-3 inference marker differences do NOT match", () => {
    const probe = { ...five, constraints: "（惯例推断）共 11 个平台" };
    expect(reconcileRequirement({ probe, rows: [row("id-1")] }).reconcile.decision)
      .toBe("no_match");
  });
  test("P5 strategy is always five_field_strong_match", () => {
    expect(reconcileRequirement({ probe: five, rows: [] }).reconcile.strategy)
      .toBe("five_field_strong_match");
  });
});

/*
 * P9 — reconcile is read-only decision logic. No branch may tell the caller to
 * POST again: that is exactly the duplicate-creation failure reconcile prevents.
 */
describe("P9 reconcile never recommends an automatic re-POST", () => {
  const cases = [
    { name: "strong_match_single", input: { probe: five, rows: [row("id-1")] } },
    { name: "strong_match_multiple", input: { probe: five, rows: [row("id-1"), row("id-2")] } },
    { name: "no_match", input: { probe: five, rows: [] } },
    {
      name: "patch_already_applied",
      input: { probe: five, rows: [row("id-1", { constraints: "新" })], targetRequirementId: "id-1", intendedPatch: { constraints: "新" } },
    },
    {
      name: "patch_still_old",
      input: { probe: five, rows: [row("id-1")], targetRequirementId: "id-1", intendedPatch: { constraints: "新" } },
    },
  ];

  for (const { name, input } of cases) {
    test(`P9 ${name} never suggests creating a duplicate`, () => {
      const message = reconcileRequirement(input).message.toLowerCase();
      expect(message).not.toMatch(/create (a )?(new|second|another) requirement/);
    });
  }

  test("P9 all five Table A decisions are reachable", () => {
    const decisions = cases.map(({ input }) => reconcileRequirement(input).reconcile.decision);
    expect(new Set(decisions).size).toBe(5);
  });
});
