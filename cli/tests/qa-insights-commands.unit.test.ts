import { describe, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError } from "../src/lib/http";
import {
  runModuleTreeNodeCreate,
  runRequirementsCreate,
  runRequirementsUpdate,
  runRequirementsReconcile,
  runTestPointsArchive,
  runTestPointsReconcile,
} from "../src/commands/qa-insights";
import type { QAInsightsWriteEnvelope } from "../src/lib/qa-insights/types";

const PRODUCT = "019fb1ff-d547-741f-bfa2-405386d04d5b";
const REQUIREMENT = "019fcfa0-da13-78db-b552-323598ce1c38";
const NODE = "019fcf73-7fd1-7b6a-8745-97c2ffaded05";

interface Call {
  method?: string;
  path: string;
  body?: unknown;
  query?: Record<string, string>;
}

/** Records every request so tests can assert which calls were (not) made. */
function harness(responses: unknown[] | ((call: Call) => unknown)) {
  const calls: Call[] = [];
  let index = 0;
  const envelopes: QAInsightsWriteEnvelope[] = [];

  const request = async (options: Call) => {
    calls.push(options);
    if (typeof responses === "function") return responses(options);
    const next = responses[index++];
    if (next instanceof Error) throw next;
    return next;
  };

  const emit = (envelope: QAInsightsWriteEnvelope) => {
    envelopes.push(envelope);
  };

  return {
    calls,
    deps: { request: request as never, emit: emit as never },
    get envelope() {
      return envelopes[0];
    },
    writes: () => calls.filter((c) => c.method === "POST" || c.method === "PATCH"),
    gets: () => calls.filter((c) => (c.method ?? "GET") === "GET"),
  };
}

const ok = (data: unknown) => ({ code: "SUCCESS", msg: "success", data });

const fiveFields = {
  function_description: "Config 视频设置页面",
  entry_trigger: "Product 页面完成产品选择后进入",
  normal_expectation: "用户可选择 Publish to、Resolution、Duration",
  constraints: "共 11 个平台",
  out_of_scope: "Video Type 差异化配置由 Idea 需求覆盖",
};

const createBody = { ...fiveFields, module_tree_node_id: NODE, summary: "视频导出参数配置" };

async function tempJson(name: string, value: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "qa-insights-"));
  const file = join(dir, name);
  await writeFile(file, JSON.stringify(value), "utf8");
  return file;
}

// ---------------------------------------------------------------------------

describe("A1-MT-1 / P11 module-tree node create", () => {
  test("A1-MT-1 posts { parent_id, name }", async () => {
    const h = harness([ok({ id: "node-1", level: 1 })]);
    await runModuleTreeNodeCreate(PRODUCT, { parentId: null as never, name: "视频生成" }, h.deps);
    expect(h.calls[0].method).toBe("POST");
    expect(h.calls[0].body).toEqual({ parent_id: null, name: "视频生成" });
    expect(h.envelope.outcome).toBe("SUCCESS");
  });
  test("A1-MT-1 --dry-run prints post_body and sends nothing", async () => {
    const h = harness([]);
    await runModuleTreeNodeCreate(PRODUCT, { parentId: NODE, name: "子节点", dryRun: true }, h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.post_body).toEqual({ parent_id: NODE, name: "子节点" });
    expect(h.envelope.meta.dry_run).toBe(true);
  });
  test("P11 depth>5 envelope maps to FAILURE / validation (measured payload)", async () => {
    const h = harness([
      { code: "FAILURE_INVALID_INPUT", data: { parent_id: null }, msg: "module tree depth exceeds limit (5)" },
    ]);
    await runModuleTreeNodeCreate(PRODUCT, { parentId: NODE, name: "太深了" }, h.deps);
    expect(h.envelope.outcome).toBe("FAILURE");
    expect(h.envelope.error?.type).toBe("validation");
  });
  test("A1-MT-1 empty name fails validation without any request", async () => {
    const h = harness([]);
    await runModuleTreeNodeCreate(PRODUCT, { name: "  " }, h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.error?.type).toBe("validation");
  });
});

/*
 * P1 — the defining behaviour of `requirements create`: a plain POST with no
 * pre-flight GET. A1 step 11 routes a first archive straight to 11a, and
 * de-duplication is the skill's Table B decision.
 */
describe("A1-TB-1 / P1 requirements create — plain POST, never a pre-flight GET", () => {
  test("P1 issues exactly one POST and zero GETs", async () => {
    const h = harness([ok({ id: "req-1", url: "/product/…/requirements/req-1" })]);
    await runRequirementsCreate(PRODUCT, { body: JSON.stringify(createBody) }, h.deps);
    expect(h.gets()).toHaveLength(0);
    expect(h.writes()).toHaveLength(1);
    expect(h.calls[0].path).toBe(`/api/v1/public/openapi/product/${PRODUCT}/qa/requirements`);
  });
  test("P1 a second identical create still POSTs (no CLI-side dedup)", async () => {
    const h = harness([ok({ id: "req-2" })]);
    await runRequirementsCreate(PRODUCT, { body: JSON.stringify(createBody) }, h.deps);
    expect(h.envelope.outcome).toBe("SUCCESS");
    expect(h.gets()).toHaveLength(0);
  });
  test("A1-TB-1 reads the body from --body-file", async () => {
    const file = await tempJson("body.json", createBody);
    const h = harness([ok({ id: "req-1" })]);
    await runRequirementsCreate(PRODUCT, { bodyFile: file }, h.deps);
    expect((h.calls[0].body as Record<string, unknown>).summary).toBe("视频导出参数配置");
  });
  test("P6 forbidden product_id in body fails validation with no request", async () => {
    const h = harness([]);
    await runRequirementsCreate(
      PRODUCT,
      { body: JSON.stringify({ ...createBody, product_id: PRODUCT }) },
      h.deps,
    );
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.outcome).toBe("FAILURE");
    expect(h.envelope.error?.type).toBe("validation");
  });
  test("P6 forbidden review_status fails validation with no request", async () => {
    const h = harness([]);
    await runRequirementsCreate(
      PRODUCT,
      { body: JSON.stringify({ ...createBody, review_status: "PENDING" }) },
      h.deps,
    );
    expect(h.calls).toHaveLength(0);
  });
  test("A1-TB-1 --dry-run sends nothing and previews post_body", async () => {
    const h = harness([]);
    await runRequirementsCreate(PRODUCT, { body: JSON.stringify(createBody), dryRun: true }, h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.post_body).toMatchObject({ module_tree_node_id: NODE });
  });
  test("A1-PW-2 write 5xx maps to UNKNOWN, never an auto-retry", async () => {
    const h = harness([new ApiError("API error 500", 500, {})]);
    await runRequirementsCreate(PRODUCT, { body: JSON.stringify(createBody) }, h.deps);
    expect(h.envelope.outcome).toBe("UNKNOWN");
    expect(h.writes()).toHaveLength(1);
  });
  test("A1-PW-2 transport failure maps to UNKNOWN with a reconcile hint", async () => {
    const h = harness([new TypeError("fetch failed")]);
    await runRequirementsCreate(PRODUCT, { body: JSON.stringify(createBody) }, h.deps);
    expect(h.envelope.outcome).toBe("UNKNOWN");
    expect(h.envelope.error?.message).toMatch(/reconcile/i);
  });
  test("§6 not-found envelope maps to FAILURE / not_found", async () => {
    const h = harness([{ code: "FAILURE_INVALID_INPUT", data: {}, msg: "requirement not found" }]);
    await runRequirementsCreate(PRODUCT, { body: JSON.stringify(createBody) }, h.deps);
    expect(h.envelope.error?.type).toBe("not_found");
  });
  test("A1-WB-3 invalid JSON input fails validation with no request", async () => {
    const h = harness([]);
    await runRequirementsCreate(PRODUCT, { body: "{not json" }, h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.error?.type).toBe("validation");
  });
});

describe("A1-WB-4 / A1-TB-3 / P4 requirements update — changed keys only", () => {
  test("P4 summary-only change patches exactly { summary }", async () => {
    const desired = await tempJson("d.json", { ...fiveFields, summary: "新的摘要" });
    const snapshot = await tempJson("s.json", { ...fiveFields, summary: "旧摘要" });
    const h = harness([ok({ id: REQUIREMENT })]);
    await runRequirementsUpdate(PRODUCT, REQUIREMENT, { desiredFile: desired, snapshotFile: snapshot }, h.deps);
    expect(h.calls[0].method).toBe("PATCH");
    expect(h.calls[0].body).toEqual({ summary: "新的摘要" });
  });
  test("A1-WB-4 unchanged fields are never included", async () => {
    const desired = await tempJson("d.json", { ...fiveFields, constraints: "改后的约束", summary: "同一摘要" });
    const snapshot = await tempJson("s.json", { ...fiveFields, summary: "同一摘要" });
    const h = harness([ok({ id: REQUIREMENT })]);
    await runRequirementsUpdate(PRODUCT, REQUIREMENT, { desiredFile: desired, snapshotFile: snapshot }, h.deps);
    expect(h.calls[0].body).toEqual({ constraints: "改后的约束" });
  });
  test("P4 empty diff yields NOOP and sends no PATCH", async () => {
    const same = { ...fiveFields, summary: "没变" };
    const desired = await tempJson("d.json", same);
    const snapshot = await tempJson("s.json", same);
    const h = harness([]);
    await runRequirementsUpdate(PRODUCT, REQUIREMENT, { desiredFile: desired, snapshotFile: snapshot }, h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.outcome).toBe("NOOP");
  });
  test("A1-FC-2 out_of_scope placeholder vs null is not a change (NOOP)", async () => {
    const desired = await tempJson("d.json", { ...fiveFields, out_of_scope: "（素材未提及）" });
    const snapshot = await tempJson("s.json", { ...fiveFields, out_of_scope: null });
    const h = harness([]);
    await runRequirementsUpdate(PRODUCT, REQUIREMENT, { desiredFile: desired, snapshotFile: snapshot }, h.deps);
    expect(h.envelope.outcome).toBe("NOOP");
  });
  test("A1-WB-4 --dry-run previews patch_body without sending", async () => {
    const desired = await tempJson("d.json", { ...fiveFields, summary: "新" });
    const snapshot = await tempJson("s.json", { ...fiveFields, summary: "旧" });
    const h = harness([]);
    await runRequirementsUpdate(
      PRODUCT,
      REQUIREMENT,
      { desiredFile: desired, snapshotFile: snapshot, dryRun: true },
      h.deps,
    );
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.patch_body).toEqual({ summary: "新" });
  });
  test("A1-WB-4 missing --snapshot-file fails validation", async () => {
    const desired = await tempJson("d.json", fiveFields);
    const h = harness([]);
    await runRequirementsUpdate(PRODUCT, REQUIREMENT, { desiredFile: desired }, h.deps);
    expect(h.envelope.error?.type).toBe("validation");
    expect(h.calls).toHaveLength(0);
  });
  test("A1-PW-2 PATCH 5xx maps to UNKNOWN", async () => {
    const desired = await tempJson("d.json", { ...fiveFields, summary: "新" });
    const snapshot = await tempJson("s.json", { ...fiveFields, summary: "旧" });
    const h = harness([new ApiError("API error 503", 503, {})]);
    await runRequirementsUpdate(PRODUCT, REQUIREMENT, { desiredFile: desired, snapshotFile: snapshot }, h.deps);
    expect(h.envelope.outcome).toBe("UNKNOWN");
  });
});

/*
 * Phase 2 step 1b/1c — inline JSON inputs.
 *
 * The skill holds five_field_snapshot / summary_snapshot in conversation state,
 * so requiring a real file forced it to spill that state to disk on every
 * update. Inline is additive: the --*-file forms keep working unchanged.
 */
describe("OQ-3 / 1b requirements update — inline --desired / --snapshot", () => {
  const snapshotState = { ...fiveFields, summary: "旧摘要" };
  const desiredState = { ...fiveFields, summary: "新摘要" };

  test("1b inline inputs produce a PATCH of only the changed keys", async () => {
    const h = harness([ok({ id: REQUIREMENT })]);
    await runRequirementsUpdate(
      PRODUCT, REQUIREMENT,
      { desired: JSON.stringify(desiredState), snapshot: JSON.stringify(snapshotState) },
      h.deps,
    );
    expect(h.calls[0].method).toBe("PATCH");
    expect(h.calls[0].body).toEqual({ summary: "新摘要" });
  });

  test("1b inline and file forms produce an IDENTICAL patch_body", async () => {
    const inline = harness([ok({ id: REQUIREMENT })]);
    await runRequirementsUpdate(
      PRODUCT, REQUIREMENT,
      { desired: JSON.stringify(desiredState), snapshot: JSON.stringify(snapshotState) },
      inline.deps,
    );

    const desiredFile = await tempJson("d.json", desiredState);
    const snapshotFile = await tempJson("s.json", snapshotState);
    const file = harness([ok({ id: REQUIREMENT })]);
    await runRequirementsUpdate(PRODUCT, REQUIREMENT, { desiredFile, snapshotFile }, file.deps);

    expect(inline.envelope.patch_body).toEqual(file.envelope.patch_body);
    expect(inline.calls[0].body).toEqual(file.calls[0].body);
  });

  test("1b mixing --desired-file with --desired is a validation failure", async () => {
    const desiredFile = await tempJson("d.json", desiredState);
    const h = harness([]);
    await runRequirementsUpdate(
      PRODUCT, REQUIREMENT,
      { desiredFile, desired: JSON.stringify(desiredState), snapshot: JSON.stringify(snapshotState) },
      h.deps,
    );
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.error?.type).toBe("validation");
    expect(h.envelope.error?.message).toMatch(/not both/);
  });

  test("1b mixing --snapshot-file with --snapshot is a validation failure", async () => {
    const snapshotFile = await tempJson("s.json", snapshotState);
    const h = harness([]);
    await runRequirementsUpdate(
      PRODUCT, REQUIREMENT,
      { desired: JSON.stringify(desiredState), snapshotFile, snapshot: JSON.stringify(snapshotState) },
      h.deps,
    );
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.error?.message).toMatch(/not both/);
  });

  test("1b omitting desired entirely is a validation failure", async () => {
    const h = harness([]);
    await runRequirementsUpdate(
      PRODUCT, REQUIREMENT, { snapshot: JSON.stringify(snapshotState) }, h.deps,
    );
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.error?.message).toMatch(/--desired-file or --desired is required/);
  });

  test("1b omitting snapshot entirely is a validation failure", async () => {
    const h = harness([]);
    await runRequirementsUpdate(
      PRODUCT, REQUIREMENT, { desired: JSON.stringify(desiredState) }, h.deps,
    );
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.error?.message).toMatch(/--snapshot-file or --snapshot is required/);
  });

  test("1b inline malformed JSON is a validation failure with no request", async () => {
    const h = harness([]);
    await runRequirementsUpdate(
      PRODUCT, REQUIREMENT, { desired: "{not json", snapshot: JSON.stringify(snapshotState) }, h.deps,
    );
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.error?.type).toBe("validation");
  });

  test("1b inline no-change input still yields NOOP without a PATCH", async () => {
    const h = harness([]);
    await runRequirementsUpdate(
      PRODUCT, REQUIREMENT,
      { desired: JSON.stringify(snapshotState), snapshot: JSON.stringify(snapshotState) },
      h.deps,
    );
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.outcome).toBe("NOOP");
  });
});

/*
 * E19 — the snapshot must be the values LAST WRITTEN to CawPlan, not the current
 * draft and not a fresh GET. Both wrong sources fail silently rather than
 * erroring, so they are pinned here explicitly.
 */
describe("E19 update --snapshot provenance — wrong sources fail silently", () => {
  const lastWritten = { ...fiveFields, summary: "上次写入的摘要" };
  const draft = { ...fiveFields, constraints: "我改过的约束", summary: "上次写入的摘要" };

  test("E19 correct snapshot (last written) yields only the real change", async () => {
    const h = harness([ok({ id: REQUIREMENT })]);
    await runRequirementsUpdate(
      PRODUCT, REQUIREMENT,
      { desired: JSON.stringify(draft), snapshot: JSON.stringify(lastWritten) },
      h.deps,
    );
    expect(h.envelope.patch_body).toEqual({ constraints: "我改过的约束" });
  });

  test("E19 passing the CURRENT DRAFT as snapshot silently swallows the change", async () => {
    const h = harness([]);
    await runRequirementsUpdate(
      PRODUCT, REQUIREMENT,
      { desired: JSON.stringify(draft), snapshot: JSON.stringify(draft) },
      h.deps,
    );
    // No error — just a NOOP that loses the edit. This is why prose must pin the source.
    expect(h.envelope.outcome).toBe("NOOP");
    expect(h.calls).toHaveLength(0);
  });

  test("E19 passing a LIVE GET as snapshot re-sends someone else's concurrent edit", async () => {
    // Another author changed normal_expectation on the server after our last write.
    const liveGet = { ...lastWritten, normal_expectation: "他人并发改过的预期" };
    const h = harness([ok({ id: REQUIREMENT })]);
    await runRequirementsUpdate(
      PRODUCT, REQUIREMENT,
      { desired: JSON.stringify(draft), snapshot: JSON.stringify(liveGet) },
      h.deps,
    );
    // Our own edit plus a revert of their edit — silently clobbering their work.
    expect(h.envelope.patch_body).toHaveProperty("normal_expectation");
    expect(Object.keys(h.envelope.patch_body ?? {}).sort())
      .toEqual(["constraints", "normal_expectation"]);
  });
});

describe("A1-TA-1 / P2 / P13 requirements reconcile — read-only Table A", () => {
  test("P2 single strong match yields RECONCILED and issues no write", async () => {
    const probe = await tempJson("p.json", fiveFields);
    const h = harness([ok([{ id: "req-1", ...fiveFields, summary: "任意" }])]);
    await runRequirementsReconcile(PRODUCT, { moduleTreeNodeId: NODE, probeFile: probe }, h.deps);
    expect(h.writes()).toHaveLength(0);
    expect(h.envelope.outcome).toBe("RECONCILED");
    expect(h.envelope.reconcile?.matched_requirement_ids).toEqual(["req-1"]);
  });
  test("P2 the GET is filtered by module_tree_node_id", async () => {
    const probe = await tempJson("p.json", fiveFields);
    const h = harness([ok([])]);
    await runRequirementsReconcile(PRODUCT, { moduleTreeNodeId: NODE, probeFile: probe }, h.deps);
    expect(h.calls[0].query).toEqual({ module_tree_node_id: NODE });
  });
  test("P13 multiple matches list every id and yield FAILURE", async () => {
    const probe = await tempJson("p.json", fiveFields);
    const h = harness([ok([{ id: "req-1", ...fiveFields }, { id: "req-2", ...fiveFields }])]);
    await runRequirementsReconcile(PRODUCT, { moduleTreeNodeId: NODE, probeFile: probe }, h.deps);
    expect(h.envelope.outcome).toBe("FAILURE");
    expect(h.envelope.reconcile?.matched_requirement_ids).toEqual(["req-1", "req-2"]);
    expect(h.writes()).toHaveLength(0);
  });
  test("A1-TA-5 no match yields FAILURE / no_match, still no write", async () => {
    const probe = await tempJson("p.json", fiveFields);
    const h = harness([ok([{ id: "other", ...fiveFields, constraints: "不同" }])]);
    await runRequirementsReconcile(PRODUCT, { moduleTreeNodeId: NODE, probeFile: probe }, h.deps);
    expect(h.envelope.reconcile?.decision).toBe("no_match");
    expect(h.writes()).toHaveLength(0);
  });
  test("A1-TA-3 pending PATCH already applied yields RECONCILED", async () => {
    const probe = await tempJson("p.json", fiveFields);
    const patch = await tempJson("i.json", { constraints: "新的约束" });
    const h = harness([ok([{ id: REQUIREMENT, ...fiveFields, constraints: "新的约束" }])]);
    await runRequirementsReconcile(
      PRODUCT,
      { moduleTreeNodeId: NODE, probeFile: probe, targetRequirementId: REQUIREMENT, intendedPatchFile: patch },
      h.deps,
    );
    expect(h.envelope.reconcile?.decision).toBe("patch_already_applied");
    expect(h.envelope.outcome).toBe("RECONCILED");
  });
  test("A1-TA-4 pending PATCH still old yields patch_still_old", async () => {
    const probe = await tempJson("p.json", fiveFields);
    const patch = await tempJson("i.json", { constraints: "新的约束" });
    const h = harness([ok([{ id: REQUIREMENT, ...fiveFields }])]);
    await runRequirementsReconcile(
      PRODUCT,
      { moduleTreeNodeId: NODE, probeFile: probe, targetRequirementId: REQUIREMENT, intendedPatchFile: patch },
      h.deps,
    );
    expect(h.envelope.reconcile?.decision).toBe("patch_still_old");
  });
  test("P9 reconcile issues GET only, on every branch", async () => {
    const probe = await tempJson("p.json", fiveFields);
    const h = harness([ok([{ id: "req-1", ...fiveFields }])]);
    await runRequirementsReconcile(PRODUCT, { moduleTreeNodeId: NODE, probeFile: probe }, h.deps);
    expect(h.calls.every((c) => (c.method ?? "GET") === "GET")).toBe(true);
  });
  test("A1-TA-5 missing --module-tree-node-id fails validation with no request", async () => {
    const probe = await tempJson("p.json", fiveFields);
    const h = harness([]);
    await runRequirementsReconcile(PRODUCT, { probeFile: probe }, h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.error?.type).toBe("validation");
  });
});

describe("A2-§9.5 / A2-§8.5 / P7 testpoints archive — POST only, no follow-up GET", () => {
  const batch = {
    test_points: [
      { title: "第一条", tags: ["异常"], group: "注册", is_edited: false },
      { title: "第二条", tags: [], group: "", is_edited: true },
    ],
  };

  test("P7 success is judged from the POST envelope with no GET", async () => {
    const h = harness([ok({ test_points: [{ id: "tp-1" }, { id: "tp-2" }] })]);
    await runTestPointsArchive(PRODUCT, REQUIREMENT, { body: JSON.stringify(batch) }, h.deps);
    expect(h.gets()).toHaveLength(0);
    expect(h.writes()).toHaveLength(1);
    expect(h.envelope.outcome).toBe("SUCCESS");
  });
  test("A2-§9.5 returned length shorter than posted is a FAILURE", async () => {
    const h = harness([ok({ test_points: [{ id: "tp-1" }] })]);
    await runTestPointsArchive(PRODUCT, REQUIREMENT, { body: JSON.stringify(batch) }, h.deps);
    expect(h.envelope.outcome).toBe("FAILURE");
    expect(h.envelope.error?.message).toMatch(/all-or-nothing/);
  });
  test("A2-§9.5 SUCCESS without a test_points array is a FAILURE", async () => {
    const h = harness([ok({})]);
    await runTestPointsArchive(PRODUCT, REQUIREMENT, { body: JSON.stringify(batch) }, h.deps);
    expect(h.envelope.outcome).toBe("FAILURE");
  });
  test("P10 an item carrying id fails validation with no request", async () => {
    const h = harness([]);
    await runTestPointsArchive(
      PRODUCT,
      REQUIREMENT,
      { body: JSON.stringify({ test_points: [{ ...batch.test_points[0], id: "tp-x" }] }) },
      h.deps,
    );
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.error?.type).toBe("validation");
  });
  test("A2-§9-is is_edited is passed through untouched", async () => {
    const h = harness([ok({ test_points: [{ id: "1" }, { id: "2" }] })]);
    await runTestPointsArchive(PRODUCT, REQUIREMENT, { body: JSON.stringify(batch) }, h.deps);
    const sent = h.calls[0].body as { test_points: { is_edited: boolean }[] };
    expect(sent.test_points.map((p) => p.is_edited)).toEqual([false, true]);
  });
  test("P9 batch 5xx yields UNKNOWN and does not GET or re-POST", async () => {
    const h = harness([new ApiError("API error 500", 500, {})]);
    await runTestPointsArchive(PRODUCT, REQUIREMENT, { body: JSON.stringify(batch) }, h.deps);
    expect(h.envelope.outcome).toBe("UNKNOWN");
    expect(h.calls).toHaveLength(1);
    expect(h.gets()).toHaveLength(0);
  });
  test("§6 not-found envelope maps to not_found (measured OQ-B shape)", async () => {
    const h = harness([{ code: "FAILURE_INVALID_INPUT", data: {}, msg: "requirement not found" }]);
    await runTestPointsArchive(PRODUCT, REQUIREMENT, { body: JSON.stringify(batch) }, h.deps);
    expect(h.envelope.error?.type).toBe("not_found");
  });
  test("A2-§9-body --dry-run sends nothing", async () => {
    const h = harness([]);
    await runTestPointsArchive(PRODUCT, REQUIREMENT, { body: JSON.stringify(batch), dryRun: true }, h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.outcome).toBe("SUCCESS");
  });
});

describe("A2-§9.4 / P8 / P9 testpoints reconcile — one GET, never a POST", () => {
  const rows = (n: number) => ok({ test_points: Array.from({ length: n }, (_, i) => ({ id: `tp-${i}` })) });

  test("P8 old + batch yields RECONCILED", async () => {
    const h = harness([rows(10)]);
    await runTestPointsReconcile(PRODUCT, REQUIREMENT, { countBefore: "7", batchSize: "3" }, h.deps);
    expect(h.envelope.outcome).toBe("RECONCILED");
    expect(h.envelope.reconcile?.decision).toBe("count_matched");
  });
  test("A2-§9.4 unchanged count yields retry_same_batch", async () => {
    const h = harness([rows(7)]);
    await runTestPointsReconcile(PRODUCT, REQUIREMENT, { countBefore: "7", batchSize: "3" }, h.deps);
    expect(h.envelope.reconcile?.decision).toBe("retry_same_batch");
  });
  test("A2-§9.4 any other count yields count_unexpected", async () => {
    const h = harness([rows(9)]);
    await runTestPointsReconcile(PRODUCT, REQUIREMENT, { countBefore: "7", batchSize: "3" }, h.deps);
    expect(h.envelope.reconcile?.decision).toBe("count_unexpected");
  });
  test("P9 only a GET is issued, never a POST", async () => {
    const h = harness([rows(10)]);
    await runTestPointsReconcile(PRODUCT, REQUIREMENT, { countBefore: "7", batchSize: "3" }, h.deps);
    expect(h.writes()).toHaveLength(0);
    expect(h.gets()).toHaveLength(1);
  });
  test("A2-§9.4 missing --count-before fails validation with no request", async () => {
    const h = harness([]);
    await runTestPointsReconcile(PRODUCT, REQUIREMENT, { batchSize: "3" }, h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.error?.type).toBe("validation");
    expect(h.envelope.error?.message).toMatch(/--count-before/);
  });
  test("A2-§9.4 the command refuses to guess the baseline", async () => {
    const h = harness([]);
    await runTestPointsReconcile(PRODUCT, REQUIREMENT, { batchSize: "3" }, h.deps);
    expect(h.envelope.error?.message).toMatch(/will not guess/i);
  });
  test("A2-§9.4 missing --batch-size fails validation", async () => {
    const h = harness([]);
    await runTestPointsReconcile(PRODUCT, REQUIREMENT, { countBefore: "7" }, h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.error?.type).toBe("validation");
  });
  test("A2-§9.4 non-numeric --count-before fails validation", async () => {
    const h = harness([]);
    await runTestPointsReconcile(PRODUCT, REQUIREMENT, { countBefore: "abc", batchSize: "3" }, h.deps);
    expect(h.calls).toHaveLength(0);
  });
});
