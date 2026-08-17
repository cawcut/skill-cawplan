import { describe, expect, test } from "vitest";
import {
  buildTestrailExecutionFailuresQuery,
  buildTestrailExecutionSummaryQuery,
  buildTestrailResolveUrlBody,
} from "../src/lib/qa-insights/testrail-execution";

describe("buildTestrailExecutionSummaryQuery", () => {
  test("builds sparse summary query", () => {
    expect(
      buildTestrailExecutionSummaryQuery({
        refresh: true,
        ticketId: "ticket_1",
        planMappingIds: "pm_1, pm_2",
        includeZeroStatuses: true,
      }),
    ).toEqual({
      refresh: "true",
      ticket_id: "ticket_1",
      plan_mapping_ids: "pm_1,pm_2",
      include_zero_statuses: "true",
    });
  });

  test("rejects plan mapping id and ids together", () => {
    expect(() =>
      buildTestrailExecutionSummaryQuery({
        planMappingId: "pm_1",
        planMappingIds: ["pm_2"],
      }),
    ).toThrow(/either --plan-mapping-id or --plan-mapping-ids/);
  });

  test("rejects empty plan mapping ids", () => {
    expect(() => buildTestrailExecutionSummaryQuery({ planMappingIds: "pm_1, " })).toThrow(
      /plan_mapping_ids/,
    );
  });
});

describe("buildTestrailExecutionFailuresQuery", () => {
  test("builds list-mode failures query", () => {
    expect(
      buildTestrailExecutionFailuresQuery({
        refresh: true,
        runId: "901",
        limit: 20,
        offset: 0,
      }),
    ).toEqual({
      refresh: "true",
      run_id: "901",
      limit: "20",
      offset: "0",
    });
  });

  test("builds test_id mode query with include_flaky", () => {
    expect(
      buildTestrailExecutionFailuresQuery({
        testId: 43590750,
        includeFlaky: true,
        limit: 10,
      }),
    ).toEqual({
      test_id: "43590750",
      include_flaky: "true",
      limit: "10",
    });
  });

  test("allows test_id and run_id together for BE validation", () => {
    expect(
      buildTestrailExecutionFailuresQuery({
        testId: 43590750,
        runId: 901,
      }),
    ).toEqual({
      test_id: "43590750",
      run_id: "901",
    });
  });

  test("rejects non-positive run id, test id, and limit", () => {
    expect(() => buildTestrailExecutionFailuresQuery({ runId: 0 })).toThrow(/run_id/);
    expect(() => buildTestrailExecutionFailuresQuery({ testId: 0 })).toThrow(/test_id/);
    expect(() => buildTestrailExecutionFailuresQuery({ limit: -1 })).toThrow(/limit/);
  });

  test("allows zero offset but rejects negative offset", () => {
    expect(buildTestrailExecutionFailuresQuery({ offset: 0 })).toEqual({ offset: "0" });
    expect(() => buildTestrailExecutionFailuresQuery({ offset: -1 })).toThrow(/offset/);
  });
});

describe("buildTestrailResolveUrlBody", () => {
  test("builds resolve-url body", () => {
    expect(
      buildTestrailResolveUrlBody({
        url: "https://example.testrail.io/index.php?/runs/view/901",
      }),
    ).toEqual({
      url: "https://example.testrail.io/index.php?/runs/view/901",
    });
  });

  test("rejects empty url", () => {
    expect(() => buildTestrailResolveUrlBody({ url: "  " })).toThrow(/url/);
    expect(() => buildTestrailResolveUrlBody({})).toThrow(/url/);
  });
});
