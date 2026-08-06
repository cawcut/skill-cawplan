/**
 * Field normalization for reconcile dedup and snapshot diff.
 *
 * Authoritative source: skills/cawplan-requirement-analyze/SKILL.md §10
 * "Field comparison". Deliberately mechanical — no fuzzy or semantic matching.
 */

import {
  FIVE_FIELD_KEYS,
  type FiveFieldKey,
  type RequirementFiveFields,
} from "./types.js";

/**
 * Placeholders meaning "material did not mention this". For `out_of_scope`,
 * these are equivalent to null/empty (A1-FC-2).
 */
const OUT_OF_SCOPE_EMPTY_PLACEHOLDERS = ["（素材未提及）", "(素材未提及)"];

/** Trim only. Inference markers（惯例推断）/（界面推断）are deliberately preserved (A1-FC-3). */
export function normalizeField(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * `out_of_scope` normalization: null / empty / （素材未提及） all collapse to "".
 * Any other content is compared literally after trim.
 */
export function normalizeOutOfScope(value: unknown): string {
  const trimmed = normalizeField(value);
  if (trimmed === "") return "";
  return OUT_OF_SCOPE_EMPTY_PLACEHOLDERS.includes(trimmed) ? "" : trimmed;
}

/** Normalize one field, applying the out_of_scope special case by key. */
export function normalizeFieldByKey(key: FiveFieldKey, value: unknown): string {
  return key === "out_of_scope" ? normalizeOutOfScope(value) : normalizeField(value);
}

/**
 * Extract and normalize the five fields from any requirement-shaped object
 * (draft, list row, or single GET `data` — all flat top-level per step 1 field map).
 * `summary` is never included: it does not participate in strong match.
 */
export function extractFiveFields(source: unknown): RequirementFiveFields {
  const row = (source ?? {}) as Record<string, unknown>;
  const out = {} as RequirementFiveFields;
  for (const key of FIVE_FIELD_KEYS) {
    out[key] = normalizeFieldByKey(key, row[key]);
  }
  return out;
}

/** True when both values are equivalent for the given field's comparison rules. */
export function fieldsEqual(key: FiveFieldKey, a: unknown, b: unknown): boolean {
  return normalizeFieldByKey(key, a) === normalizeFieldByKey(key, b);
}
