/**
 * Two-layer error mapping: HTTP layer (cawplanRequest throws) + envelope layer
 * (HTTP 200 with a business FAILURE_* code).
 *
 * Written against LIVE probes on proto, 2026-08-06 (PHASE1_EXECUTION_PLAN.md
 * step 8 "OQ-A/B/C 实测表") — not against assumptions:
 *
 *   - OQ-A/OQ-B: a missing requirement on a WRITE path answers
 *     HTTP 200 + { code: "FAILURE_INVALID_INPUT", msg: "requirement not found" }.
 *     It is NOT an HTTP 404. The 404 documented in CAWPLAN_OPEN_API.md §15
 *     applies to the READ path (single GET) only.
 *   - FAILURE_INVALID_INPUT is overloaded: not-found, missing body fields, and
 *     module-tree depth>5 all share it, so classification must consult `msg`
 *     and fall back to `validation` when uncertain.
 *   - A failure envelope may carry a non-empty `data` (OQ-A returned an object
 *     of null fields), so `code` must be checked before `data`.
 *   - 403 arrives as ApiError with body { code: "INSUFFICIENT_PERMISSIONS", … }
 *     — a namespace distinct from FAILURE_*. Reproduced twice independently
 *     (PATCH on 019fb1ff pre-grant, POST on 019fb201).
 *
 * Write-path 5xx and transport failures map to UNKNOWN, never FAILURE: these
 * endpoints have no idempotency key, so the server may already have committed
 * the write (OQ#1). The caller must reconcile rather than retry blindly.
 */

import { ApiError } from "../http.js";
import {
  isApiSuccess,
  isFailureInvalidInput,
  parseApiEnvelope,
  type ParsedEnvelope,
} from "./api-codes.js";
import type { QAInsightsError, QAInsightsOutcome } from "./types.js";

export const API_CODE_INSUFFICIENT_PERMISSIONS = "INSUFFICIENT_PERMISSIONS";

/** Substrings that mark an overloaded FAILURE_INVALID_INPUT as a not-found. */
const NOT_FOUND_MSG_PATTERNS = ["not found", "not exist", "不存在", "已删除"];

/** Substrings that mark a 403 as a disabled feature rather than a plain ACL miss. */
const FEATURE_DISABLED_MSG_PATTERNS = ["not enabled", "disabled", "feature", "未开通", "未启用"];

export interface ErrorMappingResult {
  outcome: QAInsightsOutcome;
  error: QAInsightsError;
}

export interface MapErrorContext {
  /**
   * True for POST/PATCH calls that may have mutated state. Drives the
   * 5xx/transport → UNKNOWN decision (no idempotency key ⇒ may have landed).
   */
  isWrite: boolean;
}

function messageMatches(msg: string, patterns: readonly string[]): boolean {
  const lowered = msg.toLowerCase();
  return patterns.some((pattern) => lowered.includes(pattern.toLowerCase()));
}

/** Read the envelope `code` out of an ApiError body, when there is one. */
function envelopeFromErrorBody(body: unknown): ParsedEnvelope {
  return parseApiEnvelope(body);
}

/**
 * Classify a business-failure envelope (HTTP 200 + FAILURE_*).
 *
 * `FAILURE_INVALID_INPUT` is deliberately msg-sensitive: the same code covers
 * "requirement not found" (a genuinely missing target) and "test_points are
 * required" (a malformed body). Anything we cannot positively identify as a
 * not-found stays `validation`, which is the conservative reading.
 */
export function classifyFailureEnvelope(envelope: ParsedEnvelope): QAInsightsError {
  const { code, msg } = envelope;

  if (isFailureInvalidInput(code) && messageMatches(msg, NOT_FOUND_MSG_PATTERNS)) {
    return {
      type: "not_found",
      message: msg || "target not found",
      api_code: code,
    };
  }

  if (isFailureInvalidInput(code)) {
    // Includes module-tree depth>5. That specific shape is documented in
    // CAWPLAN_OPEN_API.md §15 but was NOT reproduced live: the depth probe was
    // blocked by product-level permissions before reaching the depth check.
    return {
      type: "validation",
      message: msg || "invalid input",
      api_code: code,
    };
  }

  return {
    type: "api",
    message: msg || code || "API business failure",
    api_code: code,
  };
}

/** Map a thrown cawplanRequest error (non-2xx or transport failure). */
export function mapCawplanRequestError(
  err: unknown,
  context: MapErrorContext,
): ErrorMappingResult {
  if (err instanceof ApiError) {
    const status = err.status;
    const envelope = envelopeFromErrorBody(err.body);
    const apiCode = envelope.code || undefined;

    if (status === 401) {
      return {
        outcome: "FAILURE",
        error: { type: "auth", message: err.message, status, api_code: apiCode },
      };
    }

    if (status === 403) {
      // Measured: code INSUFFICIENT_PERMISSIONS with data.required /
      // data.resource_type naming a product-scoped access miss.
      // NOTE: whether a *disabled feature* reports the same code is UNVERIFIED —
      // no flag-off product was reachable (step 8 OQ-C). Both are handled here.
      const isFeatureDisabled = messageMatches(envelope.msg || err.message, FEATURE_DISABLED_MSG_PATTERNS);
      return {
        outcome: "FAILURE",
        error: {
          type: isFeatureDisabled ? "feature_disabled" : "auth",
          message: envelope.msg || err.message,
          status,
          api_code: apiCode,
        },
      };
    }

    if (status === 404) {
      // Read paths (single GET) answer 404; write paths use the envelope form.
      return {
        outcome: "FAILURE",
        error: {
          type: "not_found",
          message: envelope.msg || err.message,
          status,
          api_code: apiCode,
        },
      };
    }

    if (status >= 500) {
      // No idempotency key on these endpoints: a write may already have landed.
      return {
        outcome: "UNKNOWN",
        error: {
          type: "transport",
          message: context.isWrite
            ? `${err.message} — write outcome is indeterminate; reconcile before retrying`
            : err.message,
          status,
          api_code: apiCode,
        },
      };
    }

    if (envelope.wellFormed) {
      return { outcome: "FAILURE", error: { ...classifyFailureEnvelope(envelope), status } };
    }

    return {
      outcome: "FAILURE",
      error: { type: "api", message: err.message, status, api_code: apiCode },
    };
  }

  // Network error, timeout, aborted socket — never observed a response.
  const message = err instanceof Error ? err.message : String(err);
  return {
    outcome: "UNKNOWN",
    error: {
      type: "transport",
      message: context.isWrite
        ? `${message} — write outcome is indeterminate; reconcile before retrying`
        : message,
    },
  };
}

/**
 * Classify a 2xx payload. Returns null when the envelope is a success, so the
 * caller can proceed to command-specific checks (e.g. batch length).
 */
export function mapEnvelopeFailure(payload: unknown): ErrorMappingResult | null {
  const envelope = parseApiEnvelope(payload);

  if (isApiSuccess(envelope.code)) return null;

  if (!envelope.wellFormed) {
    return {
      outcome: "FAILURE",
      error: {
        type: "api",
        message: "unrecognized API response (no envelope code)",
      },
    };
  }

  return { outcome: "FAILURE", error: classifyFailureEnvelope(envelope) };
}
