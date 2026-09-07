import { describe, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runTestrailLinkCasesExecute,
  runTestrailLinkCasesPreview,
  runTestrailLinkPlansExecute,
  runTestrailLinkPlansPreview,
} from "../src/commands/qa-insights";
import type { QAInsightsWriteEnvelope } from "../src/lib/qa-insights/types";
import {
  buildTestrailLinkCasesPreviewBody,
  buildTestrailLinkExecuteBody,
  buildTestrailLinkPlansPreviewBody,
} from "../src/lib/qa-insights/body-builders";

const PRODUCT = "019cf9b6-0840-7b04-929e-850f72a9e333";
const REQUIREMENT = "req_a1b2c3";
const VERSION = "ver_2_18_0";
const TICKET = "ticket_14460";
const PREVIEW = "qtlink_prev_01";

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
  const dir = await mkdtemp(join(tmpdir(), "qa-insights-testrail-link-"));
  const file = join(dir, name);
  await writeFile(file, JSON.stringify(value), "utf8");
  return file;
}

describe("testrail link body builders", () => {
  test("buildTestrailLinkCasesPreviewBody", () => {
    expect(
      buildTestrailLinkCasesPreviewBody({
        suiteId: 335210,
        requirementId: REQUIREMENT,
        parentSectionId: 4377824,
      }),
    ).toEqual({
      suite_id: 335210,
      source: { type: "REQUIREMENT", requirement_id: REQUIREMENT },
      parent_section_id: 4377824,
    });
  });

  test("buildTestrailLinkPlansPreviewBody allows plan_id=0", () => {
    expect(
      buildTestrailLinkPlansPreviewBody({
        versionId: VERSION,
        ticketId: TICKET,
        planId: 0,
        runIds: "901,902",
      }),
    ).toEqual({
      version_id: VERSION,
      bindings: [{ ticket_id: TICKET, plan_id: 0, run_ids: [901, 902] }],
    });
  });

  test("buildTestrailLinkExecuteBody supports supersede", () => {
    expect(buildTestrailLinkExecuteBody(PREVIEW, true, true)).toEqual({
      preview_id: PREVIEW,
      confirm: true,
      supersede: true,
    });
  });
});

describe("A8 TestRail link cases", () => {
  test("POST /qa/testrail/link/cases/preview", async () => {
    const h = harness([
      ok({
        preview_id: PREVIEW,
        requirement_id: REQUIREMENT,
        summary: { total_candidates: 2, to_link: 2, already_linked: 0, conflict: 0 },
      }),
    ]);
    await runTestrailLinkCasesPreview(
      PRODUCT,
      { suiteId: 335210, requirementId: REQUIREMENT, parentSectionId: 4377824 },
      h.deps,
    );
    expect(h.calls[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/public/openapi/product/${PRODUCT}/qa/testrail/link/cases/preview`,
      body: {
        suite_id: 335210,
        source: { type: "REQUIREMENT", requirement_id: REQUIREMENT },
        parent_section_id: 4377824,
      },
    });
    expect(h.envelope.command).toBe("qa-insights testrail link cases preview");
    expect(h.envelope.meta.preview_id).toBe(PREVIEW);
    expect(h.envelope.meta.requirement_id).toBe(REQUIREMENT);
    expect(h.envelope.meta.suite_id).toBe(335210);
  });

  test("link cases preview dry-run sends no request", async () => {
    const h = harness([]);
    await runTestrailLinkCasesPreview(
      PRODUCT,
      { suiteId: 101, requirementId: REQUIREMENT, dryRun: true },
      h.deps,
    );
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.post_body).toEqual({
      suite_id: 101,
      source: { type: "REQUIREMENT", requirement_id: REQUIREMENT },
    });
  });

  test("link cases execute requires --confirm", async () => {
    const h = harness([]);
    await runTestrailLinkCasesExecute(PRODUCT, { previewId: PREVIEW }, h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.outcome).toBe("FAILURE");
    expect(h.envelope.error?.api_code).toBe("CONFIRMATION_REQUIRED");
  });

  test("POST /qa/testrail/link/cases/execute", async () => {
    const h = harness([
      ok({
        summary: { linked: 2, skipped: 0, failed: 0 },
        linked_cases: [{ test_point_id: "tp-1", case_id: 12345, mapping_id: "map-1" }],
      }),
    ]);
    await runTestrailLinkCasesExecute(PRODUCT, { previewId: PREVIEW, confirm: true }, h.deps);
    expect(h.calls[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/public/openapi/product/${PRODUCT}/qa/testrail/link/cases/execute`,
      body: { preview_id: PREVIEW, confirm: true },
    });
    expect(h.envelope.command).toBe("qa-insights testrail link cases execute");
  });
});

describe("A8 TestRail link plans", () => {
  test("POST /qa/testrail/link/plans/preview via flags", async () => {
    const h = harness([
      ok({
        preview_id: PREVIEW,
        version_id: VERSION,
        has_mapping: true,
        summary: { to_link: 1, supersede_required: 0 },
      }),
    ]);
    await runTestrailLinkPlansPreview(
      PRODUCT,
      { versionId: VERSION, ticketId: TICKET, planId: 501, runIds: "901" },
      h.deps,
    );
    expect(h.calls[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/public/openapi/product/${PRODUCT}/qa/testrail/link/plans/preview`,
      body: {
        version_id: VERSION,
        bindings: [{ ticket_id: TICKET, plan_id: 501, run_ids: [901] }],
      },
    });
    expect(h.envelope.command).toBe("qa-insights testrail link plans preview");
    expect(h.envelope.meta.preview_id).toBe(PREVIEW);
    expect(h.envelope.meta.version_id).toBe(VERSION);
  });

  test("link plans preview reads --body-file", async () => {
    const file = await tempJson("link-plans.json", {
      version_id: VERSION,
      bindings: [{ ticket_id: TICKET, plan_id: 0, run_ids: [901, 902] }],
    });
    const h = harness([ok({ preview_id: PREVIEW, version_id: VERSION })]);
    await runTestrailLinkPlansPreview(PRODUCT, { bodyFile: file }, h.deps);
    expect(h.calls[0].body).toEqual({
      version_id: VERSION,
      bindings: [{ ticket_id: TICKET, plan_id: 0, run_ids: [901, 902] }],
    });
  });

  test("MILESTONE_NOT_BOUND maps to api failure", async () => {
    const h = harness([
      {
        code: "MILESTONE_NOT_BOUND",
        msg: "Version milestone not bound",
        data: { version_id: VERSION, has_mapping: false },
      },
    ]);
    await runTestrailLinkPlansPreview(
      PRODUCT,
      { versionId: VERSION, ticketId: TICKET, planId: 501 },
      h.deps,
    );
    expect(h.envelope.outcome).toBe("FAILURE");
    expect(h.envelope.error?.api_code).toBe("MILESTONE_NOT_BOUND");
  });

  test("POST /qa/testrail/link/plans/execute with supersede", async () => {
    const h = harness([
      ok({
        version_id: VERSION,
        summary: { linked: 1, superseded: 1 },
        plan_mapping_ids: ["map-1"],
      }),
    ]);
    await runTestrailLinkPlansExecute(
      PRODUCT,
      { previewId: PREVIEW, confirm: true, supersede: true },
      h.deps,
    );
    expect(h.calls[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/public/openapi/product/${PRODUCT}/qa/testrail/link/plans/execute`,
      body: { preview_id: PREVIEW, confirm: true, supersede: true },
    });
    expect(h.envelope.meta.plan_mapping_ids).toEqual(["map-1"]);
    expect(h.envelope.command).toBe("qa-insights testrail link plans execute");
  });
});
