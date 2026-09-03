import { describe, expect, test } from "vitest";
import {
  buildRiskAssessmentComputeBody,
  buildRiskAssessmentSaveBody,
  buildRiskRulesBody,
  mergeRiskAssessmentComputeBody,
} from "../src/lib/qa-insights/body-builders";

describe("buildRiskAssessmentComputeBody", () => {
  test("defaults refresh_execution to true with null scopes", () => {
    expect(buildRiskAssessmentComputeBody()).toEqual({
      refresh_execution: true,
      ticket_id: null,
      plan_mapping_ids: null,
    });
  });

  test("honors --no-refresh-execution", () => {
    expect(buildRiskAssessmentComputeBody({ noRefreshExecution: true })).toEqual({
      refresh_execution: false,
      ticket_id: null,
      plan_mapping_ids: null,
    });
  });

  test("scopes to ticket and plan mappings", () => {
    expect(
      buildRiskAssessmentComputeBody({
        ticketId: "ticket_14460",
        planMappingIds: "pm_1,pm_2",
      }),
    ).toEqual({
      refresh_execution: true,
      ticket_id: "ticket_14460",
      plan_mapping_ids: ["pm_1", "pm_2"],
    });
  });
});

describe("mergeRiskAssessmentComputeBody", () => {
  test("flags override body file fields", () => {
    const body = mergeRiskAssessmentComputeBody(
      {
        refresh_execution: false,
        ticket_id: "ticket_old",
        plan_mapping_ids: ["pm_old"],
      },
      {
        noRefreshExecution: false,
        refreshExecution: true,
        ticketId: "ticket_new",
        planMappingIds: ["pm_new"],
      },
    );
    expect(body).toEqual({
      refresh_execution: true,
      ticket_id: "ticket_new",
      plan_mapping_ids: ["pm_new"],
    });
  });

  test("passes through deprecated plan_mapping_id from body file", () => {
    const body = mergeRiskAssessmentComputeBody(
      { plan_mapping_id: "pm_legacy" },
      {},
    );
    expect(body.plan_mapping_id).toBe("pm_legacy");
  });
});

describe("buildRiskRulesBody", () => {
  test("accepts threshold updates", () => {
    expect(
      buildRiskRulesBody({
        pass_rate_min: 0.9,
        p1_open_failures_max: 1,
      }),
    ).toEqual({
      pass_rate_min: 0.9,
      p1_open_failures_max: 1,
    });
  });

  test("rejects empty body", () => {
    expect(() => buildRiskRulesBody({})).toThrow(/requires at least one/);
  });

  test("validates pass_rate_min range", () => {
    expect(() => buildRiskRulesBody({ pass_rate_min: 1.2 })).toThrow(/between 0 and 1/);
  });
});

describe("buildRiskAssessmentSaveBody", () => {
  test("accepts reviewed save payload", () => {
    expect(
      buildRiskAssessmentSaveBody({
        risk_level: "HIGH",
        reasons: [],
        note: "known automation failures",
        override_rule_engine: false,
      }),
    ).toEqual({
      risk_level: "HIGH",
      reasons: [],
      note: "known automation failures",
      override_rule_engine: false,
    });
  });

  test("rejects unknown keys", () => {
    expect(() =>
      buildRiskAssessmentSaveBody({
        risk_level: "LOW",
        product_id: "should-not-be-here",
      }),
    ).toThrow(/remove product_id/);
  });

  test("rejects invalid risk_level", () => {
    expect(() => buildRiskAssessmentSaveBody({ risk_level: "BLOCKER" })).toThrow(/risk_level/);
  });

  test("rejects empty body", () => {
    expect(() => buildRiskAssessmentSaveBody({})).toThrow(/must not be empty/);
  });
});
