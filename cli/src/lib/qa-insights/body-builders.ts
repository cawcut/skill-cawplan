/**
 * Write-body validation and assembly.
 *
 * Authoritative sources:
 * - A1: skills/cawplan-requirement-analyze/SKILL.md "Write body rules"
 *   (product_id only in URL; never send review_status / is_edited;
 *   POST = five fields + non-empty summary + module_tree_node_id).
 * - A2: skills/cawplan-testpoint-generate/SKILL.md §9 (each item carries ONLY
 *   title, tags, group, is_edited).
 *
 * Forbidden keys are HARD-REJECTED, never silently stripped (OQ#2): silently
 * dropping a caller-supplied review_status would hide a real bug in the caller.
 *
 * Read/write asymmetry: GET responses legitimately contain product_id and
 * review_status. These rules constrain WRITE BODIES only.
 */

import { normalizeField, normalizeOutOfScope } from "./normalize.js";
import {
  FIVE_FIELD_KEYS,
  FORBIDDEN_WRITE_BODY_KEYS,
  TESTPOINT_BODY_KEYS,
  type TestPointDraft,
} from "./types.js";

/** Thrown for any body that violates the write rules; maps to FAILURE/validation. */
export class BodyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BodyValidationError";
  }
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BodyValidationError(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Hard-reject the three keys that must never appear in a Requirement write body.
 * `product_id` belongs in the URL; `review_status` defaults server-side;
 * `is_edited` is a TestPoint-only field.
 */
export function assertNoForbiddenKeys(body: Record<string, unknown>, label: string): void {
  const present = FORBIDDEN_WRITE_BODY_KEYS.filter((key) => key in body);
  if (present.length > 0) {
    throw new BodyValidationError(
      `${label} must not contain ${present.join(", ")} — ` +
        `product_id belongs in the URL; review_status and is_edited are not accepted on requirement writes. ` +
        `Remove the key(s) and retry (values are not stripped automatically).`,
    );
  }
}

/**
 * Build the POST body for `requirements create`.
 *
 * Optional API fields the caller supplies (e.g. reviewer_user_ids,
 * reviewer_group) are passed through untouched — only the three forbidden keys
 * are rejected.
 */
export function buildRequirementCreateBody(input: unknown): Record<string, unknown> {
  const body = assertPlainObject(input, "requirement create body");
  assertNoForbiddenKeys(body, "requirement create body");

  const moduleTreeNodeId = normalizeField(body.module_tree_node_id);
  if (!moduleTreeNodeId) {
    throw new BodyValidationError("requirement create body requires a non-empty module_tree_node_id");
  }

  const missing = FIVE_FIELD_KEYS.filter(
    (key) => key !== "out_of_scope" && !normalizeField(body[key]),
  );
  if (missing.length > 0) {
    throw new BodyValidationError(
      `requirement create body requires non-empty ${missing.join(", ")}`,
    );
  }

  // A1 always sends a non-empty summary on POST, even though the API allows null.
  const summary = normalizeField(body.summary);
  if (!summary) {
    throw new BodyValidationError("requirement create body requires a non-empty summary");
  }

  const out: Record<string, unknown> = { ...body };
  out.module_tree_node_id = moduleTreeNodeId;
  out.summary = summary;
  for (const key of FIVE_FIELD_KEYS) {
    out[key] = key === "out_of_scope" ? normalizeOutOfScope(body[key]) : normalizeField(body[key]);
  }
  return out;
}

/**
 * Validate an already-diffed PATCH body. The changed-key computation lives in
 * snapshot-diff.ts; this only enforces the write rules and non-emptiness.
 */
export function validateRequirementPatchBody(input: unknown): Record<string, unknown> {
  const body = assertPlainObject(input, "requirement update body");
  assertNoForbiddenKeys(body, "requirement update body");
  if (Object.keys(body).length === 0) {
    throw new BodyValidationError("requirement update body is empty — caller should emit NOOP instead of PATCHing");
  }
  return body;
}

/**
 * Build the batch body for `testpoints archive`.
 *
 * Each item must carry exactly the four allowed keys. Extra keys (id,
 * sort_order, requirement_id, …) are a hard failure rather than being stripped:
 * an `id` in a create batch usually means the caller is re-posting an
 * already-archived row, which is a real bug worth surfacing (A2 §9 / P10).
 */
export function buildTestPointBatchBody(input: unknown): { test_points: TestPointDraft[] } {
  const body = assertPlainObject(input, "testpoint batch body");
  const raw = body.test_points;
  if (!Array.isArray(raw)) {
    throw new BodyValidationError("testpoint batch body requires a test_points array");
  }
  if (raw.length === 0) {
    throw new BodyValidationError("testpoint batch body requires at least one test point");
  }

  const allowed = new Set<string>(TESTPOINT_BODY_KEYS);
  const testPoints = raw.map((item, index) => {
    const point = assertPlainObject(item, `test_points[${index}]`);

    const extra = Object.keys(point).filter((key) => !allowed.has(key));
    if (extra.length > 0) {
      throw new BodyValidationError(
        `test_points[${index}] must contain only ${TESTPOINT_BODY_KEYS.join(", ")} — ` +
          `remove ${extra.join(", ")} (keys are not stripped automatically; ` +
          `an "id" here usually means an already-archived row is being re-posted)`,
      );
    }

    const title = normalizeField(point.title);
    if (!title) {
      throw new BodyValidationError(`test_points[${index}] requires a non-empty title`);
    }

    const tagsRaw = point.tags ?? [];
    if (!Array.isArray(tagsRaw)) {
      throw new BodyValidationError(`test_points[${index}].tags must be an array`);
    }
    const tags = tagsRaw.map((tag, tagIndex) => {
      if (typeof tag !== "string") {
        throw new BodyValidationError(`test_points[${index}].tags[${tagIndex}] must be a string`);
      }
      return tag.trim();
    });

    // is_edited is tracked by the skill across the session; the command never infers it.
    if (point.is_edited !== undefined && typeof point.is_edited !== "boolean") {
      throw new BodyValidationError(`test_points[${index}].is_edited must be a boolean`);
    }

    return {
      title,
      tags,
      group: normalizeField(point.group),
      is_edited: point.is_edited === true,
    } satisfies TestPointDraft;
  });

  return { test_points: testPoints };
}

/** Build the module-tree node create body. `parent_id` null means a root node. */
export function buildModuleTreeNodeBody(input: {
  parentId?: string | null;
  name?: unknown;
}): { parent_id: string | null; name: string } {
  const name = normalizeField(input?.name);
  if (!name) {
    throw new BodyValidationError("module tree node create requires a non-empty --name");
  }
  const rawParent = input?.parentId;
  const parentId =
    rawParent === undefined || rawParent === null || normalizeField(rawParent) === "" ||
    normalizeField(rawParent).toLowerCase() === "null"
      ? null
      : normalizeField(rawParent);
  return { parent_id: parentId, name };
}
