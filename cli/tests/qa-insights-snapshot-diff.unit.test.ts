import { describe, expect, test } from "vitest";
import {
  computePatchBody,
  changedFiveFieldKeys,
  isEmptyDiff,
  isSummaryOnlyChange,
} from "../src/lib/qa-insights/snapshot-diff";

const snapshot = {
  function_description: "Config 视频设置页面",
  entry_trigger: "Product 页面完成产品选择后进入",
  normal_expectation: "用户可选择 Publish to、Resolution、Duration",
  constraints: "共 11 个平台；Duration 仅 5s/10s/15s 三挡",
  out_of_scope: "Video Type 差异化配置由 Idea 需求覆盖",
  summary: "视频导出参数配置",
};

describe("A1-WB-4 / P4 computePatchBody — only changed keys are emitted", () => {
  test("P4 no changes yields empty diff", () => {
    expect(computePatchBody({ ...snapshot }, snapshot)).toEqual({});
  });
  test("P4 only summary changed yields exactly {summary}", () => {
    const body = computePatchBody({ ...snapshot, summary: "新的摘要" }, snapshot);
    expect(body).toEqual({ summary: "新的摘要" });
  });
  test("A1-TB-3 summary-only change is detected", () => {
    const body = computePatchBody({ ...snapshot, summary: "新的摘要" }, snapshot);
    expect(isSummaryOnlyChange(body)).toBe(true);
  });
  test("A1-WB-4 single five-field change emits only that key", () => {
    const body = computePatchBody({ ...snapshot, constraints: "改后的约束" }, snapshot);
    expect(body).toEqual({ constraints: "改后的约束" });
  });
  test("A1-WB-4 unchanged summary is NOT included when five fields change", () => {
    const body = computePatchBody({ ...snapshot, constraints: "改后的约束" }, snapshot);
    expect(body).not.toHaveProperty("summary");
  });
  test("A1-TB-4 five fields and summary both changed emits both", () => {
    const body = computePatchBody(
      { ...snapshot, constraints: "改后的约束", summary: "新的摘要" },
      snapshot,
    );
    expect(body).toEqual({ constraints: "改后的约束", summary: "新的摘要" });
  });
  test("A1-WB-4 multiple five-field changes emit each changed key", () => {
    const body = computePatchBody(
      { ...snapshot, function_description: "改了描述", normal_expectation: "改了预期" },
      snapshot,
    );
    expect(Object.keys(body).sort()).toEqual(["function_description", "normal_expectation"]);
  });
  test("A1-WB-4 emitted value is the trimmed desired value", () => {
    const body = computePatchBody({ ...snapshot, constraints: "  改后的约束  " }, snapshot);
    expect(body).toEqual({ constraints: "改后的约束" });
  });
});

describe("A1-FC-1 / A1-FC-2 computePatchBody — normalization suppresses false diffs", () => {
  test("A1-FC-1 whitespace-only difference is not a change", () => {
    const body = computePatchBody(
      { ...snapshot, constraints: `  ${snapshot.constraints}  ` },
      snapshot,
    );
    expect(body).toEqual({});
  });
  test("A1-FC-2 out_of_scope null vs （素材未提及） is not a change", () => {
    const base = { ...snapshot, out_of_scope: "（素材未提及）" };
    const body = computePatchBody({ ...base, out_of_scope: null }, base);
    expect(body).toEqual({});
  });
  test("A1-FC-2 out_of_scope empty vs null is not a change", () => {
    const base = { ...snapshot, out_of_scope: null };
    const body = computePatchBody({ ...base, out_of_scope: "" }, base);
    expect(body).toEqual({});
  });
  test("A1-FC-2 out_of_scope content -> placeholder IS a change (clearing)", () => {
    const body = computePatchBody({ ...snapshot, out_of_scope: "（素材未提及）" }, snapshot);
    expect(body).toEqual({ out_of_scope: "" });
  });
  test("A1-FC-2 out_of_scope placeholder -> content IS a change", () => {
    const base = { ...snapshot, out_of_scope: "（素材未提及）" };
    const body = computePatchBody({ ...base, out_of_scope: "新增不测范围" }, base);
    expect(body).toEqual({ out_of_scope: "新增不测范围" });
  });
  test("A1-FC-3 removing an inference marker IS a change", () => {
    const base = { ...snapshot, constraints: "（惯例推断）须二次确认" };
    const body = computePatchBody({ ...base, constraints: "须二次确认" }, base);
    expect(body).toEqual({ constraints: "须二次确认" });
  });
});

describe("A1-WB-4 computePatchBody — omitted keys mean leave-as-is", () => {
  test("A1-WB-4 key absent from desired is never emitted", () => {
    const body = computePatchBody({ summary: "只改摘要" }, snapshot);
    expect(body).toEqual({ summary: "只改摘要" });
  });
  test("A1-WB-4 omitted five fields are not cleared to empty", () => {
    const body = computePatchBody({ summary: "只改摘要" }, snapshot);
    expect(body).not.toHaveProperty("constraints");
    expect(body).not.toHaveProperty("function_description");
  });
  test("A1-WB-4 explicitly emptying a field IS emitted as a change", () => {
    const body = computePatchBody({ ...snapshot, constraints: "" }, snapshot);
    expect(body).toEqual({ constraints: "" });
  });
  test("A1-WB-4 empty desired object yields empty diff", () => {
    expect(computePatchBody({}, snapshot)).toEqual({});
  });
  test("A1-WB-4 non-five-field extra keys are never copied into the body", () => {
    const body = computePatchBody(
      { ...snapshot, constraints: "改了", id: "x", product_id: "y", review_status: "PENDING" },
      snapshot,
    );
    expect(body).toEqual({ constraints: "改了" });
  });
  test("ticket_id change emits { ticket_id } only", () => {
    const body = computePatchBody(
      { ...snapshot, ticket_id: "CAWP-04606" },
      { ...snapshot, ticket_id: null },
    );
    expect(body).toEqual({ ticket_id: "CAWP-04606" });
  });
  test("ticket_id unlink emits { ticket_id: null }", () => {
    const body = computePatchBody(
      { ...snapshot, ticket_id: null },
      { ...snapshot, ticket_id: "CAWP-04606" },
    );
    expect(body).toEqual({ ticket_id: null });
  });
  test("ticket_id null vs absent is not a change", () => {
    const body = computePatchBody({ ...snapshot, ticket_id: null }, snapshot);
    expect(body).toEqual({});
  });
});

describe("A1-WB-4 computePatchBody — summary vs summary_snapshot", () => {
  test("A1-WB-4 null snapshot summary + new summary is a change", () => {
    const base = { ...snapshot, summary: null };
    const body = computePatchBody({ ...base, summary: "首次写入摘要" }, base);
    expect(body).toEqual({ summary: "首次写入摘要" });
  });
  test("A1-WB-4 null snapshot summary + absent desired summary is no change", () => {
    const base = { ...snapshot, summary: null };
    const { summary: _drop, ...withoutSummary } = base;
    expect(computePatchBody(withoutSummary, base)).toEqual({});
  });
  test("A1-FC-1 summary whitespace-only difference is not a change", () => {
    const body = computePatchBody({ ...snapshot, summary: `  ${snapshot.summary}  ` }, snapshot);
    expect(body).toEqual({});
  });
});

describe("A1-WB-4 changedFiveFieldKeys — summary excluded from the key list", () => {
  test("A1-WB-4 reports changed five-field keys only", () => {
    const keys = changedFiveFieldKeys(
      { ...snapshot, constraints: "改了", summary: "也改了" },
      snapshot,
    );
    expect(keys).toEqual(["constraints"]);
  });
  test("A1-TB-3 summary-only change yields no five-field keys", () => {
    expect(changedFiveFieldKeys({ ...snapshot, summary: "改了" }, snapshot)).toEqual([]);
  });
  test("A1-WB-4 keys are returned in canonical order", () => {
    const keys = changedFiveFieldKeys(
      { ...snapshot, out_of_scope: "改了", function_description: "也改了" },
      snapshot,
    );
    expect(keys).toEqual(["function_description", "out_of_scope"]);
  });
});

describe("P4 isEmptyDiff — NOOP gate for requirements update", () => {
  test("P4 empty body is an empty diff (caller must NOOP, not PATCH)", () => {
    expect(isEmptyDiff(computePatchBody({ ...snapshot }, snapshot))).toBe(true);
  });
  test("P4 non-empty body is not an empty diff", () => {
    expect(isEmptyDiff(computePatchBody({ ...snapshot, summary: "改了" }, snapshot))).toBe(false);
  });
  test("A1-TB-3 summary-only change is not summary-only when five fields also changed", () => {
    const body = computePatchBody({ ...snapshot, constraints: "改了", summary: "也改了" }, snapshot);
    expect(isSummaryOnlyChange(body)).toBe(false);
  });
});
