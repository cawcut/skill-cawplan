import { describe, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runTestrailDefectCreateTicket,
  runTestrailDefectDraft,
  runTestrailDefectLinkTicket,
  runTestrailExecutionFailures,
  runTestrailExecutionSummary,
  runTestrailImportExecute,
  runTestrailImportPreview,
  runTestrailJobGet,
  runTestrailMappingsGet,
  runTestrailPlanExecute,
  runTestrailPlanPreview,
  runTestrailPlanRulesGet,
  runTestrailPlanRulesSet,
  runTestrailResolveUrl,
} from "../src/commands/qa-insights";
import type { QAInsightsWriteEnvelope } from "../src/lib/qa-insights/types";

const PRODUCT = "019cf9b6-0840-7b04-929e-850f72a9e333";
const REQUIREMENT = "req_a1b2c3";
const PREVIEW = "qtip_prev_01";
const JOB = "qtij_abc123";
const VERSION = "ver_2_18_0";
const TICKET = "ticket_14460";
const RESULT = 70001;

interface Call {
  method?: string;
  path: string;
  body?: unknown;
}

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
  };
}

const ok = (data: unknown) => ({ code: "SUCCESS", msg: "success", data });

async function tempJson(name: string, value: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "qa-insights-testrail-"));
  const file = join(dir, name);
  await writeFile(file, JSON.stringify(value), "utf8");
  return file;
}

describe("A1 TestRail mappings get", () => {
  test("GET /qa/testrail/mappings", async () => {
    const h = harness([ok({ default_suite_id: 101 })]);
    await runTestrailMappingsGet(PRODUCT, h.deps);
    expect(h.calls[0].path).toBe(`/api/v1/product/${PRODUCT}/qa/testrail/mappings`);
    expect(h.envelope.command).toBe("qa-insights testrail mappings get");
    expect(h.envelope.outcome).toBe("SUCCESS");
  });
});

describe("A2 TestRail plan-rules", () => {
  test("GET /qa/testrail/plan-rules", async () => {
    const h = harness([ok({ rules: { R1: { enabled: true } } })]);
    await runTestrailPlanRulesGet(PRODUCT, h.deps);
    expect(h.calls[0]).toMatchObject({
      method: "GET",
      path: `/api/v1/product/${PRODUCT}/qa/testrail/plan-rules`,
    });
    expect(h.envelope.command).toBe("qa-insights testrail plan-rules get");
    expect(h.envelope.outcome).toBe("SUCCESS");
  });

  test("PUT /qa/testrail/plan-rules", async () => {
    const h = harness([ok({ rules: { R1: { enabled: false } } })]);
    await runTestrailPlanRulesSet(
      PRODUCT,
      { body: JSON.stringify({ rules: { R1: { enabled: false } } }) },
      h.deps,
    );
    expect(h.calls[0]).toMatchObject({
      method: "PUT",
      path: `/api/v1/product/${PRODUCT}/qa/testrail/plan-rules`,
      body: { rules: { R1: { enabled: false } } },
    });
  });

  test("dry-run sends no plan-rules request", async () => {
    const h = harness([]);
    await runTestrailPlanRulesSet(
      PRODUCT,
      { body: JSON.stringify({ rules: { R1: { enabled: true } } }), dryRun: true },
      h.deps,
    );
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.post_body).toEqual({ rules: { R1: { enabled: true } } });
  });
});

describe("A2 TestRail plan preview", () => {
  test("version-scoped preview posts plan body", async () => {
    const h = harness([
      ok({
        preview_id: PREVIEW,
        summary: { ticket_count: 8, plan_count: 5, run_count: 12, case_count: 320 },
      }),
    ]);
    await runTestrailPlanPreview(PRODUCT, { versionId: VERSION }, h.deps);
    expect(h.calls[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/product/${PRODUCT}/qa/testrail/plan/preview`,
      body: { version_id: VERSION },
    });
    expect(h.envelope.command).toBe("qa-insights testrail plan preview");
    expect(h.envelope.meta.version_id).toBe(VERSION);
    expect(h.envelope.meta.preview_id).toBe(PREVIEW);
  });

  test("ticket-scoped preview posts ticket id", async () => {
    const h = harness([ok({ preview_id: PREVIEW })]);
    await runTestrailPlanPreview(
      PRODUCT,
      { versionId: VERSION, ticketId: TICKET, milestoneName: "UniFi Network 2.18.0" },
      h.deps,
    );
    expect(h.calls[0].body).toEqual({
      version_id: VERSION,
      ticket_id: TICKET,
      milestone_name: "UniFi Network 2.18.0",
    });
    expect(h.envelope.meta.ticket_id).toBe(TICKET);
  });

  test("preview posts milestone create strategy", async () => {
    const h = harness([ok({ preview_id: PREVIEW, milestone: { action: "CREATE" } })]);
    await runTestrailPlanPreview(
      PRODUCT,
      {
        versionId: VERSION,
        milestoneName: "UniFi Network 2.18.0",
        milestoneStrategy: "CREATE",
      },
      h.deps,
    );
    expect(h.calls[0].body).toEqual({
      version_id: VERSION,
      milestone_name: "UniFi Network 2.18.0",
      milestone_strategy: "CREATE",
    });
    expect(h.envelope.meta.milestone_strategy).toBe("CREATE");
  });

  test("preview posts milestone reuse by id", async () => {
    const h = harness([
      ok({
        preview_id: PREVIEW,
        milestone: {
          action: "REUSE",
          source: "REQUESTED_ID",
          milestone_id: 88,
        },
      }),
    ]);
    await runTestrailPlanPreview(
      PRODUCT,
      {
        versionId: VERSION,
        milestoneStrategy: "REUSE_BY_ID",
        milestoneId: 88,
      },
      h.deps,
    );
    expect(h.calls[0].body).toEqual({
      version_id: VERSION,
      milestone_strategy: "REUSE_BY_ID",
      milestone_id: 88,
    });
    expect(h.envelope.meta.milestone_strategy).toBe("REUSE_BY_ID");
    expect(h.envelope.meta.milestone_id).toBe(88);
  });

  test("dry-run sends no plan preview request", async () => {
    const h = harness([]);
    await runTestrailPlanPreview(PRODUCT, { versionId: VERSION, ticketIds: "ticket-1,ticket-2", dryRun: true }, h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.post_body).toEqual({
      version_id: VERSION,
      ticket_ids: ["ticket-1", "ticket-2"],
    });
  });

  test("TICKET_NOT_IN_VERSION maps to api failure", async () => {
    const h = harness([
      { code: "TICKET_NOT_IN_VERSION", msg: "Ticket does not belong to version", data: null },
    ]);
    await runTestrailPlanPreview(PRODUCT, { versionId: VERSION, ticketId: TICKET }, h.deps);
    expect(h.envelope.outcome).toBe("FAILURE");
    expect(h.envelope.error?.api_code).toBe("TICKET_NOT_IN_VERSION");
  });

  test("preview posts ticket reuse strategy CREATE_ALL", async () => {
    const h = harness([ok({ preview_id: PREVIEW, ticket_reuse_strategy: "CREATE_ALL" })]);
    await runTestrailPlanPreview(
      PRODUCT,
      { versionId: VERSION, ticketReuseStrategy: "CREATE_ALL" },
      h.deps,
    );
    expect(h.calls[0].body).toEqual({
      version_id: VERSION,
      ticket_reuse_strategy: "CREATE_ALL",
    });
    expect(h.envelope.meta.ticket_reuse_strategy).toBe("CREATE_ALL");
  });
});

describe("A2 TestRail plan execute", () => {
  test("requires --confirm", async () => {
    const h = harness([]);
    await runTestrailPlanExecute(PRODUCT, { previewId: PREVIEW }, h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.error?.api_code).toBe("CONFIRMATION_REQUIRED");
  });

  test("confirm posts execute body", async () => {
    const h = harness([
      ok({
        job_id: JOB,
        status: "COMPLETED",
        mapping: {
          version_id: VERSION,
          plan_mapping_ids: ["map-1", "map-2"],
          reused_plan_mapping_ids: ["map-1"],
          created_plan_mapping_ids: ["map-2"],
        },
      }),
    ]);
    await runTestrailPlanExecute(PRODUCT, { previewId: PREVIEW, confirm: true }, h.deps);
    expect(h.calls[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/product/${PRODUCT}/qa/testrail/plan/execute`,
      body: { preview_id: PREVIEW, confirm: true },
    });
    expect(h.envelope.meta.job_id).toBe(JOB);
    expect(h.envelope.meta.reused_plan_mapping_ids).toEqual(["map-1"]);
    expect(h.envelope.meta.created_plan_mapping_ids).toEqual(["map-2"]);
  });

  test("PREVIEW_EXPIRED maps to api failure", async () => {
    const h = harness([{ code: "PREVIEW_EXPIRED", msg: "Preview expired", data: null }]);
    await runTestrailPlanExecute(PRODUCT, { previewId: PREVIEW, confirm: true }, h.deps);
    expect(h.envelope.outcome).toBe("FAILURE");
    expect(h.envelope.error?.api_code).toBe("PREVIEW_EXPIRED");
  });
});

describe("A1 TestRail import preview", () => {
  test("REQUIREMENT posts preview body", async () => {
    const h = harness([
      ok({ preview_id: PREVIEW, summary: { total: 2, to_create: 2, to_skip: 0, to_fail: 0 } }),
    ]);
    await runTestrailImportPreview(
      PRODUCT,
      { sourceType: "REQUIREMENT", requirementId: REQUIREMENT, suiteId: 101 },
      h.deps,
    );
    expect(h.calls[0].method).toBe("POST");
    expect(h.calls[0].path).toContain("/import/preview");
    expect(h.calls[0].body).toEqual({
      source: { type: "REQUIREMENT", requirement_id: REQUIREMENT },
      suite_id: 101,
    });
    expect(h.envelope.command).toBe("qa-insights testrail import preview");
    expect(h.envelope.meta.preview_id).toBe(PREVIEW);
  });

  test("dry-run sends no request", async () => {
    const h = harness([]);
    await runTestrailImportPreview(
      PRODUCT,
      { sourceType: "REQUIREMENT", requirementId: REQUIREMENT, dryRun: true },
      h.deps,
    );
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.post_body?.source).toEqual({
      type: "REQUIREMENT",
      requirement_id: REQUIREMENT,
    });
  });

  test("reads --body-file for INLINE", async () => {
    const file = await tempJson("preview.json", {
      source: { type: "INLINE" },
      cases: [{ title: "登录验证", steps: [{ content: "打开页", expected: "ok" }] }],
    });
    const h = harness([ok({ preview_id: PREVIEW })]);
    await runTestrailImportPreview(PRODUCT, { bodyFile: file }, h.deps);
    expect((h.calls[0].body as { cases: unknown[] }).cases).toHaveLength(1);
  });

  test("TESTRAIL_UNAVAILABLE maps to testrail error type", async () => {
    const h = harness([
      { code: "TESTRAIL_UNAVAILABLE", msg: "TestRail is down", data: null },
    ]);
    await runTestrailImportPreview(
      PRODUCT,
      { sourceType: "REQUIREMENT", requirementId: REQUIREMENT },
      h.deps,
    );
    expect(h.envelope.outcome).toBe("FAILURE");
    expect(h.envelope.error?.type).toBe("testrail");
  });
});

describe("A1 TestRail import execute", () => {
  test("requires --confirm", async () => {
    const h = harness([]);
    await runTestrailImportExecute(PRODUCT, { previewId: PREVIEW }, h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.error?.api_code).toBe("CONFIRMATION_REQUIRED");
  });

  test("confirm posts execute body", async () => {
    const h = harness([
      ok({ job_id: JOB, status: "COMPLETED", summary: { created: 1, skipped: 0, failed: 0 } }),
    ]);
    await runTestrailImportExecute(PRODUCT, { previewId: PREVIEW, confirm: true }, h.deps);
    expect(h.calls[0].body).toEqual({ preview_id: PREVIEW, confirm: true });
    expect(h.envelope.meta.job_id).toBe(JOB);
  });
});

describe("A3 TestRail execution progress", () => {
  test("summary gets version execution with filters", async () => {
    const h = harness([
      ok({
        version_id: VERSION,
        statuses: [{ id: 1, name: "passed", label: "Passed" }],
        runs: [
          {
            run_id: 901,
            name: "Manual Regression",
            stats: {
              total: 10,
              executed: 8,
              passed: 7,
              failed: 1,
              blocked: 0,
              untested: 2,
              pass_rate: 0.875,
              status_counts: { retest: 1 },
            },
          },
        ],
        aggregated: { total: 10, executed: 8, passed: 7, failed: 1, blocked: 0, untested: 2 },
      }),
    ]);

    await runTestrailExecutionSummary(
      PRODUCT,
      VERSION,
      {
        refresh: true,
        ticketId: TICKET,
        planMappingIds: "pm_1, pm_2",
        includeZeroStatuses: true,
      },
      h.deps,
    );

    expect(h.calls[0]).toMatchObject({
      method: "GET",
      path: `/api/v1/product/${PRODUCT}/versions/${VERSION}/qa/testrail/execution/summary`,
      query: {
        refresh: "true",
        ticket_id: TICKET,
        plan_mapping_ids: "pm_1,pm_2",
        include_zero_statuses: "true",
      },
    });
    expect(h.envelope.command).toBe("qa-insights testrail execution summary");
    expect(h.envelope.meta.version_id).toBe(VERSION);
    expect(h.envelope.meta.ticket_id).toBe(TICKET);
    expect(h.envelope.meta.plan_mapping_ids).toEqual(["pm_1", "pm_2"]);
    expect((h.envelope.api?.data as { runs?: unknown[] }).runs).toHaveLength(1);
  });

  test("summary rejects plan mapping id and ids together", async () => {
    const h = harness([]);
    await runTestrailExecutionSummary(
      PRODUCT,
      VERSION,
      { planMappingId: "pm_1", planMappingIds: "pm_2" },
      h.deps,
    );

    expect(h.calls).toHaveLength(0);
    expect(h.envelope.outcome).toBe("FAILURE");
    expect(h.envelope.error?.type).toBe("validation");
  });

  test("failures gets run-scoped paginated results", async () => {
    const h = harness([
      ok({
        items: [{ result_id: RESULT, run_id: 901, status: "FAILED", case_title: "Login" }],
        total: 1,
        limit: 20,
        offset: 0,
      }),
    ]);

    await runTestrailExecutionFailures(
      PRODUCT,
      VERSION,
      { refresh: true, runId: 901, limit: 20, offset: 0 },
      h.deps,
    );

    expect(h.calls[0]).toMatchObject({
      method: "GET",
      path: `/api/v1/product/${PRODUCT}/versions/${VERSION}/qa/testrail/execution/failures`,
      query: { refresh: "true", run_id: "901", limit: "20", offset: "0" },
    });
    expect(h.envelope.command).toBe("qa-insights testrail execution failures");
    expect(h.envelope.meta.run_id).toBe(901);
    expect(h.envelope.meta.limit).toBe(20);
    expect(h.envelope.meta.offset).toBe(0);
  });

  test("failures supports test_id mode for A4 cold start", async () => {
    const TEST_ID = 43590750;
    const h = harness([
      ok({
        items: [
          {
            result_id: 70003,
            test_id: TEST_ID,
            status: "FAILED",
            created_on: "2026-08-14T08:15:00Z",
            case_title: "Login",
          },
          {
            result_id: 70001,
            test_id: TEST_ID,
            status: "FAILED",
            created_on: "2026-08-14T06:30:00Z",
            case_title: "Login",
          },
        ],
        total: 2,
        limit: 50,
        offset: 0,
      }),
    ]);

    await runTestrailExecutionFailures(
      PRODUCT,
      VERSION,
      { testId: TEST_ID, includeFlaky: true },
      h.deps,
    );

    expect(h.calls[0]).toMatchObject({
      method: "GET",
      path: `/api/v1/product/${PRODUCT}/versions/${VERSION}/qa/testrail/execution/failures`,
      query: { test_id: String(TEST_ID), include_flaky: "true" },
    });
    expect(h.envelope.meta.test_id).toBe(TEST_ID);
    const items = (h.envelope.api?.data as { items: { created_on: string }[] }).items;
    expect(items).toHaveLength(2);
    expect(items[0].created_on).toBe("2026-08-14T08:15:00Z");
  });

  test("resolve-url posts TestRail URL and captures version_id", async () => {
    const h = harness([
      ok({
        resource_type: "RUN",
        run_id: 901,
        version_id: VERSION,
        version_name: "2.18.0",
      }),
    ]);

    await runTestrailResolveUrl(PRODUCT, {
      url: "https://example.testrail.io/index.php?/runs/view/901",
    }, h.deps);

    expect(h.calls[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/product/${PRODUCT}/qa/testrail/resolve-url`,
      body: { url: "https://example.testrail.io/index.php?/runs/view/901" },
    });
    expect(h.envelope.command).toBe("qa-insights testrail resolve-url");
    expect(h.envelope.meta.version_id).toBe(VERSION);
    expect(h.envelope.meta.run_id).toBe(901);
  });
});

describe("A4 TestRail failure-to-defect", () => {
  test("draft posts result context and captures meta", async () => {
    const h = harness([
      ok({
        draft: {
          type: "BUGFIX",
          version_id: VERSION,
          description: "登录失败 — 进入错误 workspace",
          remarks: "## 失败现象\n进入错误 workspace",
        },
        recommendation: "CREATE_NEW",
      }),
    ]);
    await runTestrailDefectDraft(
      PRODUCT,
      RESULT,
      { versionId: VERSION, runId: 901, caseId: 12345, testId: 80001 },
      h.deps,
    );
    expect(h.calls[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/product/${PRODUCT}/qa/testrail/results/${RESULT}/defect-draft`,
      body: { version_id: VERSION, run_id: 901, case_id: 12345, test_id: 80001 },
    });
    expect(h.envelope.command).toBe("qa-insights testrail defects draft");
    expect(h.envelope.meta.result_id).toBe(RESULT);
    expect(h.envelope.meta.version_id).toBe(VERSION);
  });

  test("draft dry-run sends no request", async () => {
    const h = harness([]);
    await runTestrailDefectDraft(PRODUCT, RESULT, { caseId: 12345, dryRun: true }, h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.post_body).toEqual({ case_id: 12345 });
  });

  test("create-ticket requires --confirm", async () => {
    const h = harness([]);
    await runTestrailDefectCreateTicket(
      PRODUCT,
      RESULT,
      { body: JSON.stringify({ draft: { version_id: VERSION, description: "title" } }) },
      h.deps,
    );
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.error?.api_code).toBe("CONFIRMATION_REQUIRED");
  });

  test("create-ticket posts reviewed draft when confirmed", async () => {
    const h = harness([
      ok({
        ticket: {
          unique_id: TICKET,
          display_id: "CAWP-14460",
          url: "https://cawplan.example.com/product/p/versions/m/v/overview/content?ticket=t",
          path: "/product/p/versions/m/v/overview/content?ticket=t",
        },
        testrail: { result_id: RESULT, defects_written: "https://cawplan.example.com/..." },
      }),
    ]);
    const body = {
      draft: {
        type: "BUGFIX",
        version_id: VERSION,
        parent_id: TICKET,
        description: "登录失败 — 进入错误 workspace",
        remarks: "## 失败现象\n进入错误 workspace",
      },
    };
    await runTestrailDefectCreateTicket(
      PRODUCT,
      RESULT,
      { body: JSON.stringify(body), confirm: true },
      h.deps,
    );
    expect(h.calls[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/product/${PRODUCT}/qa/testrail/results/${RESULT}/create-ticket`,
      body,
    });
    expect(h.envelope.meta.version_id).toBe(VERSION);
  });

  test("link-ticket requires --confirm", async () => {
    const h = harness([]);
    await runTestrailDefectLinkTicket(PRODUCT, RESULT, { ticketId: TICKET }, h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.error?.api_code).toBe("CONFIRMATION_REQUIRED");
  });

  test("link-ticket posts existing ticket id when confirmed", async () => {
    const h = harness([ok({ ticket: null, mapping: { ticket_id: TICKET } })]);
    await runTestrailDefectLinkTicket(PRODUCT, RESULT, { ticketId: TICKET, confirm: true }, h.deps);
    expect(h.calls[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/product/${PRODUCT}/qa/testrail/results/${RESULT}/link-ticket`,
      body: { ticket_id: TICKET },
    });
    expect(h.envelope.meta.ticket_id).toBe(TICKET);
  });
});

describe("A1 TestRail jobs get", () => {
  test("GET job by id", async () => {
    const h = harness([ok({ job_id: JOB, status: "RUNNING", progress: { total: 10, processed: 3 } })]);
    await runTestrailJobGet(PRODUCT, JOB, h.deps);
    expect(h.calls[0].path).toContain(`/jobs/${JOB}`);
    expect(h.envelope.outcome).toBe("SUCCESS");
  });
});
