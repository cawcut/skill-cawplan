import { describe, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runTestrailImportExecute,
  runTestrailImportPreview,
  runTestrailJobGet,
  runTestrailMappingsGet,
} from "../src/commands/qa-insights";
import type { QAInsightsWriteEnvelope } from "../src/lib/qa-insights/types";

const PRODUCT = "019cf9b6-0840-7b04-929e-850f72a9e333";
const REQUIREMENT = "req_a1b2c3";
const PREVIEW = "qtip_prev_01";
const JOB = "qtij_abc123";

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

describe("A1 TestRail jobs get", () => {
  test("GET job by id", async () => {
    const h = harness([ok({ job_id: JOB, status: "RUNNING", progress: { total: 10, processed: 3 } })]);
    await runTestrailJobGet(PRODUCT, JOB, h.deps);
    expect(h.calls[0].path).toContain(`/jobs/${JOB}`);
    expect(h.envelope.outcome).toBe("SUCCESS");
  });
});
