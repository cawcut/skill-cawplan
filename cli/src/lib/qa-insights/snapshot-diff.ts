/**
 * Snapshot diff — produces the PATCH body containing ONLY changed keys.
 *
 * Authoritative source: skills/cawplan-requirement-analyze/SKILL.md
 * "Write body rules" (PATCH: send only keys that changed) and §10
 * "Field comparison — Snapshot diff": five fields vs five_field_snapshot,
 * `summary` vs summary_snapshot separately.
 *
 * Sending the full body instead of changed keys would silently clobber
 * concurrent edits, so this is correctness-critical (A1-WB-4 / P4).
 */

import { normalizeField, normalizeFieldByKey } from "./normalize.js";
import { FIVE_FIELD_KEYS, type FiveFieldKey } from "./types.js";

export interface DesiredRequirement {
  function_description?: unknown;
  entry_trigger?: unknown;
  normal_expectation?: unknown;
  constraints?: unknown;
  out_of_scope?: unknown;
  /** Compared against summary_snapshot only — never part of strong match. */
  summary?: unknown;
  [key: string]: unknown;
}

export interface SnapshotForDiff {
  function_description?: unknown;
  entry_trigger?: unknown;
  normal_expectation?: unknown;
  constraints?: unknown;
  out_of_scope?: unknown;
  summary?: unknown;
  [key: string]: unknown;
}

export type PatchBody = Record<string, unknown>;

/**
 * Build a PATCH body from desired vs snapshot.
 *
 * - Only keys whose normalized values differ are included.
 * - A key absent from `desired` is treated as "not being changed" and is never
 *   emitted — omission means leave-as-is, not clear-to-empty.
 * - Emitted values are the trimmed desired values (not the raw input).
 * - An empty result means NOOP: the caller must not issue a PATCH.
 */
export function computePatchBody(
  desired: DesiredRequirement,
  snapshot: SnapshotForDiff,
): PatchBody {
  const body: PatchBody = {};
  const from = desired ?? {};
  const base = snapshot ?? {};

  for (const key of FIVE_FIELD_KEYS) {
    if (!(key in from)) continue;
    const next = normalizeFieldByKey(key, from[key]);
    const prev = normalizeFieldByKey(key, base[key]);
    if (next !== prev) body[key] = next;
  }

  if ("summary" in from) {
    const next = normalizeField(from.summary);
    const prev = normalizeField(base.summary);
    if (next !== prev) body.summary = next;
  }

  return body;
}

/** Changed five-field keys only (summary excluded) — for read-back wording. */
export function changedFiveFieldKeys(
  desired: DesiredRequirement,
  snapshot: SnapshotForDiff,
): FiveFieldKey[] {
  const body = computePatchBody(desired, snapshot);
  return FIVE_FIELD_KEYS.filter((key) => key in body);
}

/** True when the diff is empty — caller should emit NOOP and skip the PATCH. */
export function isEmptyDiff(body: PatchBody): boolean {
  return Object.keys(body).length === 0;
}

/**
 * True when the五字段 are unchanged but `summary` changed — Table B row 3
 * routes this to a summary-only PATCH.
 */
export function isSummaryOnlyChange(body: PatchBody): boolean {
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === "summary";
}
