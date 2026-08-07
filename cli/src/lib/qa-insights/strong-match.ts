/**
 * Five-field strong match — the A1 reconcile dedup criterion.
 *
 * Authoritative source: skills/cawplan-requirement-analyze/SKILL.md §10
 * "Field comparison — Strong match": after normalize, all five fields must be
 * string-equal field-by-field. No fuzzy or semantic matching. `summary` does
 * NOT participate (A1-FC-5).
 *
 * Used by `requirements reconcile` only — `requirements create` never calls this
 * on its happy path (A1 step 11 Gate → Table B → 11a POST with no prior GET).
 */

import { extractFiveFields } from "./normalize.js";
import {
  FIVE_FIELD_KEYS,
  type FiveFieldKey,
  type RequirementFiveFields,
  type RequirementRow,
} from "./types.js";

/** True when all five normalized fields are string-equal. */
export function isStrongMatch(a: unknown, b: unknown): boolean {
  const left = extractFiveFields(a);
  const right = extractFiveFields(b);
  return FIVE_FIELD_KEYS.every((key) => left[key] === right[key]);
}

/** Field keys that differ between two requirement-shaped objects. */
export function differingFields(a: unknown, b: unknown): FiveFieldKey[] {
  const left = extractFiveFields(a);
  const right = extractFiveFields(b);
  return FIVE_FIELD_KEYS.filter((key) => left[key] !== right[key]);
}

/**
 * All rows strong-matching the probe. Callers must not auto-bind when more than
 * one row matches — Table A row 2 requires listing ids for SQA to choose
 * (no --bind-id flag exists by design).
 */
export function findStrongMatches<T extends RequirementRow>(
  probe: Partial<RequirementFiveFields> | unknown,
  rows: readonly T[],
): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => isStrongMatch(probe, row));
}

/** Convenience: ids of all strong-matching rows, in list order. */
export function strongMatchIds(
  probe: Partial<RequirementFiveFields> | unknown,
  rows: readonly RequirementRow[],
): string[] {
  return findStrongMatches(probe, rows).map((row) => row.id);
}
