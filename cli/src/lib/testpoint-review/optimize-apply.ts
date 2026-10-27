import { advanceReviewRound, type AiModifiedEntry, type AiRoundOutput } from "./round-switch.js";
import type { ReviewState, TestPointFields } from "./types.js";

/**
 * Raw shape the AI is asked to return — untrusted until validated (design §8.5).
 * Ids reference test points from the *current* round (before this round switch).
 */
export type RawAiOptimizeOutput = {
  modified?: Array<{ id?: unknown; fields?: Partial<TestPointFields> }>;
  added?: Array<Partial<TestPointFields>>;
  questions?: unknown;
};

export type OptimizeValidationResult = {
  output: AiRoundOutput;
  skippedCount: number;
  errors: string[];
};

export class AiOptimizationValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`Invalid AI optimization output: ${errors.join("; ")}`);
    this.name = "AiOptimizationValidationError";
    this.errors = errors;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toValidFields(raw: unknown, path: string, errors: string[]): TestPointFields | undefined {
  if (!isRecord(raw)) {
    errors.push(`${path} is required`);
    return undefined;
  }
  if (!isNonEmptyString(raw.title)) {
    errors.push(`${path}.title must be a non-empty string`);
    return undefined;
  }
  if (typeof raw.group !== "string") {
    errors.push(`${path}.group must be a string`);
    return undefined;
  }
  if (typeof raw.priority !== "string") {
    errors.push(`${path}.priority must be a string`);
    return undefined;
  }
  if (!Array.isArray(raw.tags) || !raw.tags.every((t) => typeof t === "string")) {
    errors.push(`${path}.tags must be a string array`);
    return undefined;
  }

  return { title: raw.title.trim(), group: raw.group, tags: raw.tags, priority: raw.priority };
}

/**
 * Validates the AI's raw round output against design §8.5: referenced ids must exist in the
 * previous round's active (non-archived, non-deleted) test points, and new entries must have
 * complete fields. Invalid entries are dropped entirely — never partially applied.
 */
export function validateAiOptimizeOutput(
  reviewState: ReviewState,
  raw: RawAiOptimizeOutput,
): OptimizeValidationResult {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return { output: { modified: [], added: [] }, skippedCount: 1, errors: ["output must be an object"] };
  }

  const rawModified = raw.modified === undefined ? [] : raw.modified;
  const rawAdded = raw.added === undefined ? [] : raw.added;
  if (!Array.isArray(rawModified)) errors.push("modified must be an array");
  if (!Array.isArray(rawAdded)) errors.push("added must be an array");

  const validIds = new Set(
    reviewState.test_points
      .filter((tp) => !tp.archived && tp.status !== "deleted")
      .map((tp) => tp.id),
  );

  const modified: AiModifiedEntry[] = [];
  for (const [index, rawEntry] of (Array.isArray(rawModified) ? rawModified : []).entries()) {
    const path = `modified[${index}]`;
    if (!isRecord(rawEntry)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    const id = rawEntry.id;
    if (!isNonEmptyString(id)) {
      errors.push(`${path}.id must be a non-empty string`);
      continue;
    }
    if (!validIds.has(id)) {
      errors.push(`${path}.id ${JSON.stringify(id)} does not reference an active test point`);
      continue;
    }
    const fields = toValidFields(rawEntry.fields, `${path}.fields`, errors);
    if (!fields) continue;
    modified.push({ id, fields });
  }

  const added: TestPointFields[] = [];
  for (const [index, rawFields] of (Array.isArray(rawAdded) ? rawAdded : []).entries()) {
    const fields = toValidFields(rawFields, `added[${index}]`, errors);
    if (!fields) continue;
    added.push(fields);
  }

  let questions: AiRoundOutput["questions"];
  if (reviewState.open_questions !== undefined) {
    if (!isRecord(raw.questions)) {
      errors.push("questions is required");
    } else {
      const rawRetainedIds = raw.questions.retained_ids;
      const rawQuestionAdds = raw.questions.added;
      if (!Array.isArray(rawRetainedIds)) errors.push("questions.retained_ids must be an array");
      if (!Array.isArray(rawQuestionAdds)) errors.push("questions.added must be an array");

      const activeIds = new Set(reviewState.open_questions.map((question) => question.id));
      const retainedIds: string[] = [];
      const seenIds = new Set<string>();
      for (const [index, value] of (Array.isArray(rawRetainedIds) ? rawRetainedIds : []).entries()) {
        const path = `questions.retained_ids[${index}]`;
        if (!isNonEmptyString(value)) {
          errors.push(`${path} must be a non-empty string`);
        } else if (!activeIds.has(value)) {
          errors.push(`${path} ${JSON.stringify(value)} does not reference an active question`);
        } else if (seenIds.has(value)) {
          errors.push(`${path} duplicates ${JSON.stringify(value)}`);
        } else {
          seenIds.add(value);
          retainedIds.push(value);
        }
      }

      const questionAdds: string[] = [];
      for (const [index, value] of (Array.isArray(rawQuestionAdds) ? rawQuestionAdds : []).entries()) {
        if (!isNonEmptyString(value)) {
          errors.push(`questions.added[${index}] must be a non-empty string`);
        } else {
          questionAdds.push(value.trim());
        }
      }
      if (Array.isArray(rawRetainedIds) && Array.isArray(rawQuestionAdds)) {
        questions = {retainedIds, added: questionAdds};
      }
    }
  }

  return { output: { modified, added, ...(questions ? {questions} : {}) }, skippedCount: errors.length, errors };
}

export type ApplyAiOptimizationResult = {
  reviewState: ReviewState;
  skippedCount: number;
};

/**
 * Validates the AI's raw output, then advances the review to the next round (design §3.4/§3.7,
 * plan step 16.5's advanceReviewRound). Does not persist — callers save the returned state.
 */
export function applyAiOptimization(
  reviewState: ReviewState,
  raw: RawAiOptimizeOutput,
): ApplyAiOptimizationResult {
  const { output, skippedCount, errors } = validateAiOptimizeOutput(reviewState, raw);
  if (errors.length > 0) throw new AiOptimizationValidationError(errors);
  const nextState = advanceReviewRound(reviewState, output);
  nextState.review_status = "reviewing";
  delete nextState.optimize_requested_at;
  return { reviewState: nextState, skippedCount };
}
