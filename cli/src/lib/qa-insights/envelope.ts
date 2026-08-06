/**
 * stdout envelope printing and exit-code mapping.
 *
 * Every qa-insights write/reconcile command prints exactly one JSON object.
 * Skills consume the `outcome` FIELD — the exit code is only a coarse
 * success/attention split (Phase 1a collapses it to 0/1), because a shell
 * status cannot express the difference between RECONCILED and NOOP in any way
 * the caller could act on.
 */

import type {
  QAInsightsError,
  QAInsightsMeta,
  QAInsightsOutcome,
  QAInsightsReconcileInfo,
  QAInsightsWriteEnvelope,
} from "./types.js";

/** Outcomes that need no follow-up: the caller may proceed. */
const ZERO_EXIT_OUTCOMES: readonly QAInsightsOutcome[] = ["SUCCESS", "RECONCILED", "NOOP"];

/**
 * 0 = nothing to act on; 1 = needs attention (FAILURE or UNKNOWN).
 * Read `outcome` from stdout to distinguish them — notably UNKNOWN, which must
 * trigger reconcile rather than a retry.
 */
export function exitCodeForOutcome(outcome: QAInsightsOutcome): 0 | 1 {
  return ZERO_EXIT_OUTCOMES.includes(outcome) ? 0 : 1;
}

export interface BuildEnvelopeInput {
  outcome: QAInsightsOutcome;
  command: string;
  meta: QAInsightsMeta;
  api?: { code: string; msg: string; data?: unknown };
  reconcile?: QAInsightsReconcileInfo;
  patch_body?: Record<string, unknown>;
  post_body?: Record<string, unknown>;
  error?: QAInsightsError;
}

/** Assemble an envelope, omitting absent optional sections entirely. */
export function buildEnvelope(input: BuildEnvelopeInput): QAInsightsWriteEnvelope {
  const envelope: QAInsightsWriteEnvelope = {
    outcome: input.outcome,
    command: input.command,
    meta: input.meta,
  };
  if (input.api) envelope.api = input.api;
  if (input.reconcile) envelope.reconcile = input.reconcile;
  if (input.patch_body) envelope.patch_body = input.patch_body;
  if (input.post_body) envelope.post_body = input.post_body;
  if (input.error) envelope.error = input.error;
  return envelope;
}

/** Print the envelope as pretty JSON on stdout (matches other cawplan commands). */
export function printEnvelope(envelope: QAInsightsWriteEnvelope): void {
  console.log(JSON.stringify(envelope, null, 2));
}

/**
 * Print and terminate with the mapped exit code. Kept as the single exit point
 * so no command can print an envelope and then exit with an unrelated status.
 */
export function emitEnvelopeAndExit(envelope: QAInsightsWriteEnvelope): never {
  printEnvelope(envelope);
  process.exit(exitCodeForOutcome(envelope.outcome));
}
