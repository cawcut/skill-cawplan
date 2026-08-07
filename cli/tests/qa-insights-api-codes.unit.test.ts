import { describe, expect, test } from "vitest";
import {
  parseApiEnvelope,
  isApiSuccess,
  isApiFailure,
  isFailureInvalidInput,
  describeEnvelope,
  batchReturnedCount,
} from "../src/lib/qa-insights/api-codes";

describe("§6 parseApiEnvelope — real SUCCESS shape (proto, 2026-08-06)", () => {
  const real = {
    code: "SUCCESS",
    data: { id: "019fcfa0-da13-78db-b552-323598ce1c38", summary: "视频导出参数配置" },
    msg: "success",
  };

  test("§6 parses code, msg and data from a live SUCCESS envelope", () => {
    const env = parseApiEnvelope(real);
    expect(env.code).toBe("SUCCESS");
    expect(env.msg).toBe("success");
    expect(env.wellFormed).toBe(true);
  });
  test("§6 data is passed through untouched", () => {
    expect(parseApiEnvelope(real).data).toEqual(real.data);
  });
  test("§6 SUCCESS is recognized", () => {
    expect(isApiSuccess(parseApiEnvelope(real).code)).toBe(true);
  });
});

/*
 * A1-MT-1 / P11 — module tree depth > 5 arrives as HTTP 200 + envelope
 * FAILURE_INVALID_INPUT, NOT as an HTTP 4xx. Trusting the HTTP status alone
 * would report this as success.
 */
describe("A1-MT-1 / P11 HTTP 200 + FAILURE_INVALID_INPUT (module tree depth > 5)", () => {
  const depthFailure = {
    code: "FAILURE_INVALID_INPUT",
    msg: "module tree depth exceeds limit (5)",
    data: null,
  };

  test("P11 200-with-FAILURE envelope is NOT success", () => {
    expect(isApiSuccess(parseApiEnvelope(depthFailure).code)).toBe(false);
  });
  test("A1-MT-1 depth failure is recognized as a business failure", () => {
    expect(isApiFailure(parseApiEnvelope(depthFailure).code)).toBe(true);
  });
  test("A1-MT-1 depth failure is recognized as validation-class", () => {
    expect(isFailureInvalidInput(parseApiEnvelope(depthFailure).code)).toBe(true);
  });
  test("A1-MT-1 message surfaces both code and msg", () => {
    expect(describeEnvelope(parseApiEnvelope(depthFailure)))
      .toBe("FAILURE_INVALID_INPUT: module tree depth exceeds limit (5)");
  });
});

describe("§6 business failure codes", () => {
  test("§6 other FAILURE_* codes are failures but not validation-class", () => {
    const env = parseApiEnvelope({ code: "FAILURE_NOT_FOUND", msg: "requirement not found" });
    expect(isApiFailure(env.code)).toBe(true);
    expect(isFailureInvalidInput(env.code)).toBe(false);
  });
  test("§6 bare FAILURE is a failure", () => {
    expect(isApiFailure("FAILURE")).toBe(true);
  });
  test("§6 SUCCESS is not a failure", () => {
    expect(isApiFailure("SUCCESS")).toBe(false);
  });
  test("§6 empty and nullish codes are not success", () => {
    expect(isApiSuccess("")).toBe(false);
    expect(isApiSuccess(undefined)).toBe(false);
    expect(isApiSuccess(null)).toBe(false);
  });
  test("§6 lowercase success is NOT treated as success (exact match only)", () => {
    expect(isApiSuccess("success")).toBe(false);
  });
});

describe("§6 parseApiEnvelope — malformed payloads", () => {
  test("§6 payload without a code is not well-formed", () => {
    expect(parseApiEnvelope({ data: {} }).wellFormed).toBe(false);
  });
  test("§6 string payload is not well-formed", () => {
    expect(parseApiEnvelope("plain text error page").wellFormed).toBe(false);
  });
  test("§6 null payload is not well-formed", () => {
    expect(parseApiEnvelope(null).wellFormed).toBe(false);
  });
  test("§6 array payload is not well-formed", () => {
    expect(parseApiEnvelope([]).wellFormed).toBe(false);
  });
  test("§6 malformed payload is never success", () => {
    expect(isApiSuccess(parseApiEnvelope("nonsense").code)).toBe(false);
  });
  test("§6 malformed payload is described explicitly", () => {
    expect(describeEnvelope(parseApiEnvelope("nonsense")))
      .toBe("unrecognized API response (no envelope code)");
  });
  test("§6 message field is accepted as an alias for msg", () => {
    expect(parseApiEnvelope({ code: "FAILURE", message: "boom" }).msg).toBe("boom");
  });
  test("§6 code without msg is described by code alone", () => {
    expect(describeEnvelope(parseApiEnvelope({ code: "FAILURE" }))).toBe("FAILURE");
  });
});

/*
 * A2-§9.5 — batch success requires SUCCESS *and* a returned array whose length
 * equals the posted length; the batch is all-or-nothing.
 */
describe("A2-§9.5 batchReturnedCount — length check for testpoints archive", () => {
  test("A2-§9.5 counts returned test_points", () => {
    expect(batchReturnedCount({ test_points: [{ id: "1" }, { id: "2" }, { id: "3" }] })).toBe(3);
  });
  test("A2-§9.5 empty array counts as 0", () => {
    expect(batchReturnedCount({ test_points: [] })).toBe(0);
  });
  test("A2-§9.5 missing test_points yields null (cannot confirm success)", () => {
    expect(batchReturnedCount({})).toBeNull();
  });
  test("A2-§9.5 non-array test_points yields null", () => {
    expect(batchReturnedCount({ test_points: "3" })).toBeNull();
  });
  test("A2-§9.5 null data yields null", () => {
    expect(batchReturnedCount(null)).toBeNull();
  });
  test("A2-§9.5 length mismatch is detectable by the caller", () => {
    const posted = 3;
    expect(batchReturnedCount({ test_points: [{ id: "1" }] })).not.toBe(posted);
  });
});
