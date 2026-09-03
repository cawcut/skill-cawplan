import { describe, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runRiskAssessmentCompute,
  runRiskAssessmentGet,
  runRiskAssessmentSave,
  runRiskRulesGet,
  runRiskRulesSet,
} from "../src/commands/qa-insights";
import type { QAInsightsWriteEnvelope } from "../src/lib/qa-insights/types";

const PRODUCT = "019cf9b6-0840-7b04-929e-850f72a9e333";
const VERSION = "ver_2_18_0";
const TICKET = "ticket_14460";

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
  const dir = await mkdtemp(join(tmpdir(), "qa-insights-risk-"));
  const file = join(dir, name);
  await writeFile(file, JSON.stringify(value), "utf8");
  return file;
}

describe("A5 risk-rules get", () => {
  test("GET /qa/risk-rules", async () => {
    const h = harness([ok({ pass_rate_min: 0.95 })]);
    await runRiskRulesGet(PRODUCT, h.deps);
    expect(h.calls[0]).toMatchObject({
      method: "GET",
      path: `/api/v1/public/openapi/product/${PRODUCT}/qa/risk-rules`,
    });
    expect(h.envelope.command).toBe("qa-insights risk-rules get");
    expect(h.envelope.outcome).toBe("SUCCESS");
  });
});

describe("A5 risk-rules set", () => {
  test("PUT /qa/risk-rules", async () => {
    const h = harness([ok({ pass_rate_min: 0.9 })]);
    const bodyFile = await tempJson("risk-rules.json", { pass_rate_min: 0.9 });
    await runRiskRulesSet(PRODUCT, { bodyFile }, h.deps);
    expect(h.calls[0]).toMatchObject({
      method: "PUT",
      path: `/api/v1/public/openapi/product/${PRODUCT}/qa/risk-rules`,
      body: { pass_rate_min: 0.9 },
    });
    expect(h.envelope.outcome).toBe("SUCCESS");
  });

  test("dry-run sends no request", async () => {
    const h = harness([]);
    await runRiskRulesSet(
      PRODUCT,
      { body: JSON.stringify({ pass_rate_min: 0.9 }), dryRun: true },
      h.deps,
    );
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.post_body).toEqual({ pass_rate_min: 0.9 });
  });
});

describe("A5 risk-assessment compute", () => {
  test("POST /versions/{version_id}/qa/risk-assessment/compute with defaults", async () => {
    const h = harness([ok({ risk_level: "HIGH" })]);
    await runRiskAssessmentCompute(PRODUCT, VERSION, {}, h.deps);
    expect(h.calls[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/public/openapi/product/${PRODUCT}/versions/${VERSION}/qa/risk-assessment/compute`,
      body: {
        refresh_execution: true,
        ticket_id: null,
        plan_mapping_ids: null,
      },
    });
    expect(h.envelope.meta.version_id).toBe(VERSION);
    expect(h.envelope.outcome).toBe("SUCCESS");
  });

  test("scopes compute to ticket and plan mappings", async () => {
    const h = harness([ok({ risk_level: "MEDIUM" })]);
    await runRiskAssessmentCompute(
      PRODUCT,
      VERSION,
      { ticketId: TICKET, planMappingIds: "pm_1,pm_2", noRefreshExecution: true },
      h.deps,
    );
    expect(h.calls[0].body).toEqual({
      refresh_execution: false,
      ticket_id: TICKET,
      plan_mapping_ids: ["pm_1", "pm_2"],
    });
    expect(h.envelope.meta.ticket_id).toBe(TICKET);
    expect(h.envelope.meta.plan_mapping_ids).toEqual(["pm_1", "pm_2"]);
  });

  test("dry-run sends no request", async () => {
    const h = harness([]);
    await runRiskAssessmentCompute(PRODUCT, VERSION, { dryRun: true }, h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.post_body?.refresh_execution).toBe(true);
  });
});

describe("A5 risk-assessment get", () => {
  test("GET /versions/{version_id}/qa/risk-assessment", async () => {
    const h = harness([ok({ risk_level: "LOW", saved_at: "2026-08-04T08:20:00Z" })]);
    await runRiskAssessmentGet(PRODUCT, VERSION, h.deps);
    expect(h.calls[0]).toMatchObject({
      method: "GET",
      path: `/api/v1/public/openapi/product/${PRODUCT}/versions/${VERSION}/qa/risk-assessment`,
    });
    expect(h.envelope.command).toBe("qa-insights risk-assessment get");
    expect(h.envelope.outcome).toBe("SUCCESS");
  });
});

describe("A5 risk-assessment save", () => {
  test("requires --confirm", async () => {
    const h = harness([]);
    const bodyFile = await tempJson("save.json", {
      risk_level: "HIGH",
      note: "reviewed",
    });
    await runRiskAssessmentSave(PRODUCT, VERSION, { bodyFile }, h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.outcome).toBe("FAILURE");
    expect(h.envelope.error?.api_code).toBe("CONFIRMATION_REQUIRED");
  });

  test("POST /versions/{version_id}/qa/risk-assessment when confirmed", async () => {
    const h = harness([ok({ id: "qtra_001", risk_level: "HIGH" })]);
    const bodyFile = await tempJson("save.json", {
      risk_level: "HIGH",
      reasons: [],
      note: "known automation failures",
      override_rule_engine: false,
    });
    await runRiskAssessmentSave(
      PRODUCT,
      VERSION,
      { bodyFile, confirm: true },
      h.deps,
    );
    expect(h.calls[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/public/openapi/product/${PRODUCT}/versions/${VERSION}/qa/risk-assessment`,
      body: {
        risk_level: "HIGH",
        reasons: [],
        note: "known automation failures",
        override_rule_engine: false,
      },
    });
    expect(h.envelope.outcome).toBe("SUCCESS");
  });

  test("dry-run sends no request", async () => {
    const h = harness([]);
    await runRiskAssessmentSave(
      PRODUCT,
      VERSION,
      {
        body: JSON.stringify({ risk_level: "LOW", note: "ok" }),
        dryRun: true,
      },
      h.deps,
    );
    expect(h.calls).toHaveLength(0);
    expect(h.envelope.post_body).toEqual({ risk_level: "LOW", note: "ok" });
  });
});
