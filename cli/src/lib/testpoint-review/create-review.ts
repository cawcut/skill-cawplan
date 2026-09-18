import { randomUUID } from "node:crypto";
import { formatTestPointId } from "./test-point-id.js";
import type { ReviewState, TestPoint, TestPointFields } from "./types.js";

export type CreateReviewInputTestPoint = {
  /** CawPlan test-point id. Required only for an already-archived item. */
  id?: string;
  title: string;
  group?: string;
  tags?: string[];
  priority?: string;
  /** True when this item already exists in CawPlan and must never be submitted again. */
  archived?: boolean;
};

export type CreateReviewInput = {
  productId: string;
  requirementId: string;
  language?: "zh" | "en";
  testPoints: CreateReviewInputTestPoint[];
  requirement?: Record<string, unknown>;
};

function toFields(input: CreateReviewInputTestPoint): TestPointFields {
  if (typeof input.title !== "string") {
    throw new Error("each test point requires a string title");
  }
  const title = input.title.trim();
  if (!title) {
    throw new Error("each test point requires a non-empty title");
  }
  return {
    title,
    group: input.group ?? "",
    tags: input.tags ?? [],
    priority: input.priority ?? "",
  };
}

function archivedId(input: CreateReviewInputTestPoint, index: number): string | undefined {
  if (input.archived !== undefined && typeof input.archived !== "boolean") {
    throw new Error(`test_points[${index}].archived must be a boolean when provided`);
  }

  if (input.archived === true) {
    if (typeof input.id !== "string" || input.id.trim() === "") {
      throw new Error(`test_points[${index}] is archived and requires a non-empty id`);
    }
    return input.id.trim();
  }

  if (input.id !== undefined) {
    throw new Error(`test_points[${index}].id is only allowed when archived is true`);
  }
  return undefined;
}

function firstAvailableLocalSequence(ids: Iterable<string>): number {
  let nextSeq = 1;
  for (const id of ids) {
    const match = /^tp_(\d+)$/.exec(id);
    if (match) nextSeq = Math.max(nextSeq, Number(match[1]) + 1);
  }
  return nextSeq;
}

export type ReviewStartCounts = {
  draft_count: number;
  archived_count: number;
  group_count: number;
  count_before: number;
};

/** Counts returned by `testpoint-review start`; group_count covers draft rows only. */
export function reviewStartCounts(reviewState: ReviewState): ReviewStartCounts {
  const drafts = reviewState.test_points.filter((testPoint) => testPoint.archived !== true);
  return {
    draft_count: drafts.length,
    archived_count: reviewState.test_points.length - drafts.length,
    group_count: new Set(drafts.map((testPoint) => testPoint.current.group)).size,
    count_before: reviewState.count_before,
  };
}

/**
 * Builds a review state from the test points a caller (e.g. cawplan-testpoint-generate's
 * Step 5 output) already synthesized — as opposed to fixtures.ts's createFixtureReviewState,
 * which seeds hardcoded sample data for manual/local testing of the review page itself.
 */
export function createReviewStateFromInput(input: CreateReviewInput): ReviewState {
  if (!Array.isArray(input.testPoints)) {
    throw new Error("test points must be an array");
  }
  if (input.testPoints.length === 0) {
    throw new Error("at least one test point is required to start a review");
  }

  const now = new Date().toISOString();
  const existingIdsByIndex = input.testPoints.map(archivedId);
  const archivedIds = existingIdsByIndex.filter((id): id is string => id !== undefined);
  if (new Set(archivedIds).size !== archivedIds.length) {
    throw new Error("archived test point ids must be unique");
  }

  let nextSeq = firstAvailableLocalSequence(archivedIds);
  const testPoints: TestPoint[] = input.testPoints.map((tp, index) => {
    const fields = toFields(tp);
    const existingId = existingIdsByIndex[index];
    const id = existingId ?? formatTestPointId(nextSeq++);
    return {
      id,
      original: { ...fields },
      current: { ...fields },
      status: "unchanged",
      source: "ai",
      ai_status: "none",
      comments: [],
      ...(existingId ? { archived: true } : {}),
    };
  });

  return {
    schema_version: 1,
    review_id: `rv_${randomUUID()}`,
    round: 1,
    review_status: "reviewing",
    product_id: input.productId,
    requirement_id: input.requirementId,
    requirement: input.requirement ?? {},
    count_before: archivedIds.length,
    next_seq: nextSeq,
    language: input.language ?? "zh",
    updated_at: now,
    test_points: testPoints,
    global_comments: [],
    deleted_tombstones: [],
  };
}
