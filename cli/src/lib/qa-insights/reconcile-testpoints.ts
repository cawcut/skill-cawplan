/**
 * A2 count reconcile (SKILL.md §9.4 / §10).
 *
 * A2 uses a fundamentally different strategy from A1: test points have no
 * natural identity to strong-match on, so after an UNKNOWN batch write the only
 * available signal is the row COUNT before vs after.
 *
 *   count_after === count_before + batch_size  → the batch landed  → RECONCILED
 *   count_after === count_before               → it did not        → retry same batch
 *   anything else                              → count_unexpected  → human check
 *
 * Phase 1a merges the former count_mismatch_partial / count_mismatch_high into a
 * single `count_unexpected`: the batch is all-or-nothing, so a partial count is
 * not supposed to be reachable, and both cases warrant the identical response
 * (stop, tell a human, never auto-POST).
 *
 * `count_before` MUST come from the caller — the baseline captured by the
 * refresh GET before the batch. Re-deriving it here would be racy: a concurrent
 * append between the two GETs would silently corrupt the comparison.
 */

import type { QAInsightsOutcome, QAInsightsReconcileInfo } from "./types.js";

export interface ReconcileTestPointsInput {
  countBefore: number;
  countAfter: number;
  batchSize: number;
}

export interface ReconcileTestPointsResult {
  outcome: QAInsightsOutcome;
  reconcile: QAInsightsReconcileInfo;
  message: string;
}

export class CountReconcileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CountReconcileValidationError";
  }
}

const STRATEGY = "testpoint_count" as const;

function assertCount(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new CountReconcileValidationError(
      `${label} must be a non-negative integer — ` +
        `pass the baseline captured by the refresh GET taken BEFORE the batch`,
    );
  }
  return value;
}

export function reconcileTestPoints(
  input: ReconcileTestPointsInput,
): ReconcileTestPointsResult {
  const countBefore = assertCount(input?.countBefore, "--count-before");
  const countAfter = assertCount(input?.countAfter, "count_after");
  const batchSize = assertCount(input?.batchSize, "--batch-size");

  if (batchSize === 0) {
    throw new CountReconcileValidationError("--batch-size must be greater than zero");
  }

  const base: QAInsightsReconcileInfo = {
    strategy: STRATEGY,
    decision: "count_matched",
    count_before: countBefore,
    count_after: countAfter,
    batch_size: batchSize,
  };

  if (countAfter === countBefore + batchSize) {
    return {
      outcome: "RECONCILED",
      reconcile: { ...base, decision: "count_matched" },
      message:
        `test point count went ${countBefore} → ${countAfter} (+${batchSize}) — ` +
        "the previous batch likely succeeded; do NOT archive it again",
    };
  }

  if (countAfter === countBefore) {
    return {
      outcome: "FAILURE",
      reconcile: { ...base, decision: "retry_same_batch" },
      message:
        `test point count is unchanged at ${countBefore} — the batch did not land; ` +
        "read back and archive the SAME batch again",
    };
  }

  return {
    outcome: "FAILURE",
    reconcile: { ...base, decision: "count_unexpected" },
    message:
      `test point count went ${countBefore} → ${countAfter}, which is neither ` +
      `unchanged nor +${batchSize} (the batch is all-or-nothing). ` +
      "Someone may have appended concurrently, or the data is inconsistent — " +
      "inspect the requirement manually; the CLI will not re-POST.",
  };
}
