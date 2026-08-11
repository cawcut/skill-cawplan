/**
 * Envelope parsing for QA Insights responses.
 *
 * cawplanRequest returns 2xx payloads verbatim, so HTTP 200 is NOT sufficient
 * to conclude success: PRM Open API commonly answers 200 with an envelope
 * `code` of FAILURE_* (see cli/tests/src-lib.unit.test.ts "HTTP 200 business
 * error"). Every write command must read the envelope code before declaring
 * SUCCESS.
 *
 * Verified live on 2026-08-06 (step 1): a successful GET returns
 * `{ code: "SUCCESS", data: {...}, msg: "success" }`.
 */

export const API_CODE_SUCCESS = "SUCCESS";
export const API_CODE_FAILURE_INVALID_INPUT = "FAILURE_INVALID_INPUT";

/** QA Testing / TestRail business codes (see qa-testing-api.md §3). */
export const API_CODE_TESTRAIL_UNAVAILABLE = "TESTRAIL_UNAVAILABLE";
export const API_CODE_TESTRAIL_NOT_CONFIGURED = "TESTRAIL_NOT_CONFIGURED";
export const API_CODE_PRODUCT_TESTRAIL_URL_MISSING = "PRODUCT_TESTRAIL_URL_MISSING";
export const API_CODE_SUITE_NOT_IN_PROJECT = "SUITE_NOT_IN_PROJECT";
export const API_CODE_PREVIEW_EXPIRED = "PREVIEW_EXPIRED";
export const API_CODE_CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED";
export const API_CODE_JOB_NOT_CANCELLABLE = "JOB_NOT_CANCELLABLE";

const TESTRAIL_CODES = new Set([
  API_CODE_TESTRAIL_UNAVAILABLE,
  API_CODE_TESTRAIL_NOT_CONFIGURED,
  API_CODE_PRODUCT_TESTRAIL_URL_MISSING,
  API_CODE_SUITE_NOT_IN_PROJECT,
]);

export function isTestrailBusinessCode(code: string | undefined | null): boolean {
  return typeof code === "string" && TESTRAIL_CODES.has(code);
}

export interface ParsedEnvelope {
  code: string;
  msg: string;
  data?: unknown;
  /** False when the payload was not a recognizable { code, msg, data } envelope. */
  wellFormed: boolean;
}

/** Parse any 2xx payload into a normalized envelope view. */
export function parseApiEnvelope(payload: unknown): ParsedEnvelope {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { code: "", msg: "", data: undefined, wellFormed: false };
  }
  const body = payload as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code : "";
  const msg = typeof body.msg === "string"
    ? body.msg
    : typeof body.message === "string"
      ? body.message
      : "";
  return { code, msg, data: body.data, wellFormed: code !== "" };
}

/** True only for an exact SUCCESS code. */
export function isApiSuccess(code: string | undefined | null): boolean {
  return code === API_CODE_SUCCESS;
}

/** True for any FAILURE_* business code. */
export function isApiFailure(code: string | undefined | null): boolean {
  return typeof code === "string" && code.startsWith("FAILURE");
}

/** True for the validation-class failure (e.g. module tree depth > 5). */
export function isFailureInvalidInput(code: string | undefined | null): boolean {
  return code === API_CODE_FAILURE_INVALID_INPUT;
}

/**
 * Human-readable summary for error envelopes, used in stdout `error.message`.
 */
export function describeEnvelope(envelope: ParsedEnvelope): string {
  if (!envelope.wellFormed) return "unrecognized API response (no envelope code)";
  return envelope.msg ? `${envelope.code}: ${envelope.msg}` : envelope.code;
}

/**
 * Batch success check for `testpoints archive` (A2 §9.5): SUCCESS alone is not
 * enough — the returned test_points array must be exactly as long as the
 * request, because the batch is all-or-nothing.
 */
export function batchReturnedCount(data: unknown): number | null {
  if (data === null || typeof data !== "object") return null;
  const points = (data as Record<string, unknown>).test_points;
  return Array.isArray(points) ? points.length : null;
}
