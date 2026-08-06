import { describe, expect, test } from "vitest";
import { ApiError } from "../src/lib/http";
import {
  mapCawplanRequestError,
  mapEnvelopeFailure,
  classifyFailureEnvelope,
} from "../src/lib/qa-insights/errors";
import { parseApiEnvelope } from "../src/lib/qa-insights/api-codes";

const WRITE = { isWrite: true };
const READ = { isWrite: false };

/*
 * OQ-A / OQ-B — measured live on proto 2026-08-06 against the all-zero UUID.
 * These are the VERBATIM payloads, so the tests fail if the mapping drifts
 * away from the real API shape.
 */
describe("§6 / OQ-A write not-found is HTTP 200 + FAILURE_INVALID_INPUT, NOT 404", () => {
  const oqA = {
    code: "FAILURE_INVALID_INPUT",
    data: {
      last_reviewed_at: null,
      out_of_scope: null,
      reviewer_group: null,
      summary: null,
      ticket_id: null,
      url: null,
    },
    msg: "requirement not found",
  };

  test("OQ-A PATCH not-found maps to FAILURE / not_found", () => {
    const result = mapEnvelopeFailure(oqA);
    expect(result?.outcome).toBe("FAILURE");
    expect(result?.error.type).toBe("not_found");
  });
  test("OQ-A not-found is NOT misclassified as validation", () => {
    expect(mapEnvelopeFailure(oqA)?.error.type).not.toBe("validation");
  });
  test("OQ-A api_code is preserved for the caller", () => {
    expect(mapEnvelopeFailure(oqA)?.error.api_code).toBe("FAILURE_INVALID_INPUT");
  });
  test("OQ-A non-empty data on a FAILURE envelope is still a failure (code wins over data)", () => {
    // The measured failure body carries a populated `data` object; treating a
    // non-empty data as success would report this write as having succeeded.
    expect(oqA.data).not.toEqual({});
    expect(mapEnvelopeFailure(oqA)).not.toBeNull();
  });
});

describe("§6 / OQ-B batch not-found shares the OQ-A shape", () => {
  const oqBNotFound = { code: "FAILURE_INVALID_INPUT", data: {}, msg: "requirement not found" };
  const oqBBodyFirst = { code: "FAILURE_INVALID_INPUT", data: {}, msg: "test_points are required" };

  test("OQ-B batch not-found maps to FAILURE / not_found", () => {
    expect(mapEnvelopeFailure(oqBNotFound)?.error.type).toBe("not_found");
  });
  test("OQ-B body validation fires BEFORE requirement lookup and stays validation", () => {
    // Measured: posting {"test_points":[]} answered "test_points are required",
    // never reaching the not-found check — same code, different meaning.
    expect(mapEnvelopeFailure(oqBBodyFirst)?.error.type).toBe("validation");
  });
  test("OQ-B the two share a code but must not share a classification", () => {
    expect(mapEnvelopeFailure(oqBNotFound)?.error.type)
      .not.toBe(mapEnvelopeFailure(oqBBodyFirst)?.error.type);
  });
});

describe("A1-MT-1 / P11 FAILURE_INVALID_INPUT is overloaded — msg drives classification", () => {
  test("A1-MT-1 depth>5 maps to validation (shape from §15 docs, NOT measured)", () => {
    const depth = {
      code: "FAILURE_INVALID_INPUT",
      msg: "module tree depth exceeds limit (5)",
      data: null,
    };
    expect(mapEnvelopeFailure(depth)?.error.type).toBe("validation");
  });
  test("P11 depth>5 is a FAILURE, never silently ignored", () => {
    const depth = { code: "FAILURE_INVALID_INPUT", msg: "module tree depth exceeds limit (5)" };
    expect(mapEnvelopeFailure(depth)?.outcome).toBe("FAILURE");
  });
  test("§6 unknown FAILURE_INVALID_INPUT msg falls back to validation (conservative)", () => {
    const vague = { code: "FAILURE_INVALID_INPUT", msg: "something else entirely" };
    expect(mapEnvelopeFailure(vague)?.error.type).toBe("validation");
  });
  test("§6 Chinese not-found wording is recognized", () => {
    const zh = { code: "FAILURE_INVALID_INPUT", msg: "该 requirement 不存在" };
    expect(mapEnvelopeFailure(zh)?.error.type).toBe("not_found");
  });
  test("§6 other FAILURE_* codes map to api", () => {
    const other = { code: "FAILURE_CONFLICT", msg: "conflict" };
    expect(mapEnvelopeFailure(other)?.error.type).toBe("api");
  });
  test("§6 classifyFailureEnvelope is msg-sensitive for the shared code", () => {
    const nf = classifyFailureEnvelope(parseApiEnvelope({ code: "FAILURE_INVALID_INPUT", msg: "requirement not found" }));
    const inv = classifyFailureEnvelope(parseApiEnvelope({ code: "FAILURE_INVALID_INPUT", msg: "bad field" }));
    expect([nf.type, inv.type]).toEqual(["not_found", "validation"]);
  });
});

describe("§6 mapEnvelopeFailure — success passes through", () => {
  test("§6 SUCCESS envelope returns null (caller continues)", () => {
    expect(mapEnvelopeFailure({ code: "SUCCESS", data: {}, msg: "success" })).toBeNull();
  });
  test("§6 malformed payload is a FAILURE / api", () => {
    const result = mapEnvelopeFailure("<html>gateway</html>");
    expect(result?.outcome).toBe("FAILURE");
    expect(result?.error.type).toBe("api");
  });
});

/*
 * OQ-C — 403 measured twice independently: PATCH on 019fb1ff before the grant,
 * and POST on 019fb201. Code is INSUFFICIENT_PERMISSIONS, a namespace separate
 * from FAILURE_*.
 */
describe("OQ-C / §6 HTTP 403 INSUFFICIENT_PERMISSIONS (measured twice)", () => {
  const body403 = {
    code: "INSUFFICIENT_PERMISSIONS",
    data: {
      details: "user has 'qa_insights.edit' but lacks access to product '019fb201-…'",
      required: "qa_insights.edit",
      resource_type: "product",
    },
    msg: "user has 'qa_insights.edit' but lacks access to product '019fb201-…'",
  };
  const err403 = new ApiError("API error 403: lacks access", 403, body403);

  test("OQ-C 403 ACL miss maps to FAILURE / auth", () => {
    const result = mapCawplanRequestError(err403, WRITE);
    expect(result.outcome).toBe("FAILURE");
    expect(result.error.type).toBe("auth");
  });
  test("OQ-C 403 preserves status and the INSUFFICIENT_PERMISSIONS code", () => {
    const result = mapCawplanRequestError(err403, WRITE);
    expect(result.error.status).toBe(403);
    expect(result.error.api_code).toBe("INSUFFICIENT_PERMISSIONS");
  });
  test("OQ-C 403 is a definite FAILURE, never UNKNOWN (nothing was written)", () => {
    expect(mapCawplanRequestError(err403, WRITE).outcome).toBe("FAILURE");
  });
  test("OQ-C-unverified feature-disabled wording routes to feature_disabled", () => {
    // UNVERIFIED: no flag-off product was reachable (step 8). The product the
    // user supplied returned SUCCESS on read, so this branch is inferred.
    const disabled = new ApiError("API error 403", 403, {
      code: "INSUFFICIENT_PERMISSIONS",
      msg: "qa insights feature is not enabled for this product",
    });
    expect(mapCawplanRequestError(disabled, READ).error.type).toBe("feature_disabled");
  });
});

describe("§6 HTTP 401 — auth", () => {
  test("§6 401 maps to FAILURE / auth", () => {
    const err = new ApiError("Session expired. Run: cawplan auth login", 401);
    const result = mapCawplanRequestError(err, WRITE);
    expect(result.outcome).toBe("FAILURE");
    expect(result.error.type).toBe("auth");
  });
  test("§6 401 is FAILURE, not UNKNOWN", () => {
    expect(mapCawplanRequestError(new ApiError("x", 401), WRITE).outcome).toBe("FAILURE");
  });
});

describe("§6 HTTP 404 — read-path not-found", () => {
  test("§6 404 maps to FAILURE / not_found", () => {
    const result = mapCawplanRequestError(new ApiError("API error 404", 404, {}), READ);
    expect(result.outcome).toBe("FAILURE");
    expect(result.error.type).toBe("not_found");
  });
});

/*
 * OQ#1 / P9 — write-path 5xx and transport failures are UNKNOWN, never FAILURE.
 * These endpoints have no idempotency key, so the write may already have landed;
 * calling it FAILURE would invite a duplicate retry.
 */
describe("OQ#1 / P9 write 5xx → UNKNOWN (no idempotency key)", () => {
  test("OQ#1 write 500 maps to UNKNOWN, not FAILURE", () => {
    const result = mapCawplanRequestError(new ApiError("API error 500", 500, {}), WRITE);
    expect(result.outcome).toBe("UNKNOWN");
  });
  test("OQ#1 write 502/503 also map to UNKNOWN", () => {
    expect(mapCawplanRequestError(new ApiError("x", 502, {}), WRITE).outcome).toBe("UNKNOWN");
    expect(mapCawplanRequestError(new ApiError("x", 503, {}), WRITE).outcome).toBe("UNKNOWN");
  });
  test("P9 write 5xx message tells the caller to reconcile rather than retry", () => {
    const result = mapCawplanRequestError(new ApiError("API error 500", 500, {}), WRITE);
    expect(result.error.message).toMatch(/reconcile/i);
  });
  test("OQ#1 GET 5xx is also UNKNOWN (pure transport)", () => {
    expect(mapCawplanRequestError(new ApiError("x", 500, {}), READ).outcome).toBe("UNKNOWN");
  });
  test("OQ#1 read 5xx does NOT carry the write-reconcile warning", () => {
    const result = mapCawplanRequestError(new ApiError("API error 500", 500, {}), READ);
    expect(result.error.message).not.toMatch(/reconcile/i);
  });
});

describe("OQ#1 / P9 transport failures → UNKNOWN", () => {
  test("P9 network error on a write maps to UNKNOWN", () => {
    const result = mapCawplanRequestError(new TypeError("fetch failed"), WRITE);
    expect(result.outcome).toBe("UNKNOWN");
    expect(result.error.type).toBe("transport");
  });
  test("P9 write transport failure warns to reconcile", () => {
    expect(mapCawplanRequestError(new Error("ECONNRESET"), WRITE).error.message)
      .toMatch(/reconcile/i);
  });
  test("P9 timeout on a read maps to UNKNOWN / transport", () => {
    const result = mapCawplanRequestError(new Error("ETIMEDOUT"), READ);
    expect(result.outcome).toBe("UNKNOWN");
    expect(result.error.type).toBe("transport");
  });
  test("P9 non-Error throwable is still handled", () => {
    expect(mapCawplanRequestError("boom", WRITE).outcome).toBe("UNKNOWN");
  });
  test("P9 transport failure carries no HTTP status", () => {
    expect(mapCawplanRequestError(new Error("fetch failed"), WRITE).error.status).toBeUndefined();
  });
});

describe("§6 non-2xx 4xx carrying a business envelope", () => {
  test("§6 400 with FAILURE_INVALID_INPUT not-found msg maps to not_found", () => {
    const err = new ApiError("API error 400", 400, {
      code: "FAILURE_INVALID_INPUT",
      msg: "requirement not found",
    });
    expect(mapCawplanRequestError(err, WRITE).error.type).toBe("not_found");
  });
  test("§6 400 without a usable envelope maps to api", () => {
    const err = new ApiError("API error 400: bad request", 400, "plain text");
    expect(mapCawplanRequestError(err, WRITE).error.type).toBe("api");
  });
  test("§6 4xx business failure is FAILURE, never UNKNOWN", () => {
    const err = new ApiError("API error 400", 400, { code: "FAILURE_INVALID_INPUT", msg: "bad" });
    expect(mapCawplanRequestError(err, WRITE).outcome).toBe("FAILURE");
  });
});
