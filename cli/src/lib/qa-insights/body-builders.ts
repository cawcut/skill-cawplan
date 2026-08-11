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
  type ImportStepDraft,
  type ImportPreviewSource,
  type ImportSourceType,
  type InlineCaseDraft,
  type SectionStrategy,
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

export interface BuildTestrailImportPreviewBodyInput {
  sourceType: ImportSourceType;
  requirementId?: string;
  versionId?: string;
  suiteId?: number;
  versionName?: string;
  sectionStrategy?: SectionStrategy;
  fixedSectionId?: number;
  cases?: InlineCaseDraft[];
}

function valueByNames<T>(body: Record<string, unknown>, snakeKey: string, camelKey: string): T | undefined {
  return (body[snakeKey] ?? body[camelKey]) as T | undefined;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "number" ? String(value) : normalizeField(value);
}

function normalizePriority(value: unknown): string | undefined {
  const priority = optionalString(value)?.toUpperCase();
  if (!priority) return undefined;

  const t1Match = priority.match(/^P(\d+)$/);
  if (t1Match) {
    const level = Number(t1Match[1]);
    if (level === 0) return "CRITICAL";
    if (level === 1) return "HIGH";
    if (level === 2) return "MEDIUM";
    return "LOW";
  }

  if (["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(priority)) {
    return priority;
  }

  throw new BodyValidationError(
    `Unsupported priority "${String(value)}"; use LOW/MEDIUM/HIGH/CRITICAL or T1 P0/P1/P2/P3+`,
  );
}

function normalizeTags(raw: Record<string, unknown>, index: number): string[] | undefined {
  const tags = raw.tags ?? raw.tag;
  if (tags === undefined || tags === null) return undefined;

  const values = Array.isArray(tags) ? tags : [tags];
  return values.map((tag, tagIndex) => {
    const normalized = optionalString(tag);
    if (!normalized) {
      throw new BodyValidationError(`cases[${index}].tags[${tagIndex}] must be a non-empty string`);
    }
    return normalized;
  });
}

function normalizeSteps(raw: Record<string, unknown>, index: number): ImportStepDraft[] | undefined {
  const steps = raw.steps;
  if (!Array.isArray(steps)) return undefined;

  const expected = raw.expected;
  const expectedItems = Array.isArray(expected) ? expected : undefined;

  return steps.map((step, stepIndex) => {
    if (typeof step === "string") {
      return {
        content: normalizeField(step),
        expected: expectedItems ? normalizeField(expectedItems[stepIndex]) : "",
      };
    }

    if (step !== null && typeof step === "object" && !Array.isArray(step)) {
      const item = step as Record<string, unknown>;
      return {
        content: normalizeField(item.content),
        expected: normalizeField(item.expected),
      };
    }

    throw new BodyValidationError(
      `cases[${index}].steps[${stepIndex}] must be a string or { content, expected } object`,
    );
  });
}

function normalizeInlineCaseItem(item: unknown, index: number): InlineCaseDraft {
  const raw = assertPlainObject(item, `cases[${index}]`);
  const title = normalizeField(raw.title);
  if (!title) {
    throw new BodyValidationError(`cases[${index}] requires a non-empty title`);
  }
  return {
    test_point_id: valueByNames<string>(raw, "test_point_id", "testPointId"),
    requirement_id: valueByNames<string>(raw, "requirement_id", "requirementId"),
    title,
    group: normalizeField(raw.group),
    module_tree_node_id: valueByNames<string>(raw, "module_tree_node_id", "moduleTreeNodeId"),
    tags: normalizeTags(raw, index),
    priority: normalizePriority(valueByNames<unknown>(raw, "priority", "priority")),
    importance: optionalString(valueByNames<unknown>(raw, "importance", "importance")),
    version_name: valueByNames<string>(raw, "version_name", "versionName"),
    preconditions: valueByNames<string>(raw, "preconditions", "preconditions"),
    steps: normalizeSteps(raw, index),
    automation_type: valueByNames<string | null>(raw, "automation_type", "automationType"),
    automation_result: valueByNames<string | null>(raw, "automation_result", "automationResult"),
    source_case_key: valueByNames<string>(raw, "source_case_key", "sourceCaseKey"),
    content_hash: valueByNames<string>(raw, "content_hash", "contentHash"),
  };
}

export function buildTestrailImportPreviewBody(
  input: BuildTestrailImportPreviewBodyInput,
): Record<string, unknown> {
  const source: ImportPreviewSource = { type: input.sourceType };
  if (input.sourceType === "REQUIREMENT") {
    if (!input.requirementId?.trim()) {
      throw new BodyValidationError("REQUIREMENT source requires --requirement-id");
    }
    source.requirement_id = input.requirementId.trim();
  } else if (input.sourceType === "VERSION") {
    if (!input.versionId?.trim()) {
      throw new BodyValidationError("VERSION source requires --version-id (BE: not implemented yet)");
    }
    source.version_id = input.versionId.trim();
  } else if (input.sourceType === "INLINE") {
    if (!input.cases?.length) {
      throw new BodyValidationError("INLINE source requires cases in --body/--body-file");
    }
  }

  const body: Record<string, unknown> = { source };
  if (input.suiteId !== undefined) body.suite_id = input.suiteId;
  if (input.versionName) body.version_name = input.versionName;
  if (input.sectionStrategy) body.section_strategy = input.sectionStrategy;
  if (input.fixedSectionId !== undefined) body.fixed_section_id = input.fixedSectionId;
  if (input.sourceType === "INLINE" && input.cases) {
    body.cases = input.cases.map((item, index) => normalizeInlineCaseItem(item, index));
  }
  return body;
}

export function buildTestrailImportExecuteBody(
  previewId: string,
  confirm: boolean,
): Record<string, unknown> {
  const id = previewId.trim();
  if (!id) throw new BodyValidationError("--preview-id is required");
  return { preview_id: id, confirm };
}

/** Merge a parsed JSON body over CLI flags (flags win when set). */
export function mergeTestrailImportPreviewBody(
  parsed: unknown,
  flags: Partial<BuildTestrailImportPreviewBodyInput>,
): Record<string, unknown> {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BodyValidationError("testrail import preview body must be a JSON object");
  }
  const fromFile = parsed as Record<string, unknown>;
  const source = (fromFile.source as Record<string, unknown> | undefined) ?? {};
  const sourceType = (flags.sourceType ?? source.type) as ImportSourceType | undefined;
  if (!sourceType) {
    throw new BodyValidationError("source.type is required (--source-type or body.source.type)");
  }

  const casesFromBody = Array.isArray(fromFile.cases)
    ? (fromFile.cases as InlineCaseDraft[])
    : undefined;

  return buildTestrailImportPreviewBody({
    sourceType,
    requirementId:
      flags.requirementId ?? valueByNames<string>(source, "requirement_id", "requirementId"),
    versionId: flags.versionId ?? valueByNames<string>(source, "version_id", "versionId"),
    suiteId: flags.suiteId ?? valueByNames<number>(fromFile, "suite_id", "suiteId"),
    versionName: flags.versionName ?? valueByNames<string>(fromFile, "version_name", "versionName"),
    sectionStrategy:
      flags.sectionStrategy ??
      valueByNames<SectionStrategy>(fromFile, "section_strategy", "sectionStrategy"),
    fixedSectionId:
      flags.fixedSectionId ?? valueByNames<number>(fromFile, "fixed_section_id", "fixedSectionId"),
    cases: flags.cases ?? casesFromBody,
  });
}
