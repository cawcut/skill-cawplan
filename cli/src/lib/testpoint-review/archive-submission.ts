import { reviewPhase } from "./review-phase.js";
import { normalizeField } from "../qa-insights/normalize.js";
import type { ReviewState, TestPoint } from "./types.js";

export type ArchiveSubmissionItem = {
  title: string;
  tags: string[];
  group: string;
  priority: string;
  is_edited: boolean;
  group_order?: number;
};

function isEligible(testPoint: TestPoint): boolean {
  return testPoint.status !== "deleted" && testPoint.archived !== true;
}

/**
 * Design §4/§4.1: on each "Save to CawPlan" click, only the currently-visible,
 * not-yet-archived, not-deleted test points are submitted. `is_edited` reflects
 * whether QA touched the row this session (SKILL.md §9's "SQA touched" rule) —
 * both QA edits and QA-added rows count; an AI-added row nobody touched does not.
 */
export function testPointsPendingArchive(reviewState: ReviewState): TestPoint[] {
  return reviewState.test_points.filter(isEligible);
}

export function toArchiveSubmissionItem(testPoint: TestPoint): ArchiveSubmissionItem {
  return {
    title: testPoint.current.title,
    tags: testPoint.current.tags,
    group: testPoint.current.group,
    priority: testPoint.current.priority,
    is_edited: testPoint.status !== "unchanged",
  };
}

/** Build relative group ordering, including positions established by deleted rows
 * that remain visible for Undo. Entirely deleted/archived groups are not numbered.
 * testpoints archive resolves these positions against a fresh BE list before POST.
 * Row order is deliberately unchanged so backend sort_order retains its semantics.
 */
export function toArchiveSubmissionItems(reviewState: ReviewState): ArchiveSubmissionItem[] {
  const pending = testPointsPendingArchive(reviewState);
  const activeGroups = new Set(pending.map((tp) => normalizeField(tp.current.group)));
  const orders = new Map<string, number>();
  for (const tp of reviewState.test_points) {
    if (tp.archived) continue;
    const group = normalizeField(tp.current.group);
    if (activeGroups.has(group) && !orders.has(group)) orders.set(group, orders.size + 1);
  }
  return pending.map((tp) => ({
    ...toArchiveSubmissionItem(tp),
    group_order: orders.get(normalizeField(tp.current.group))!,
  }));
}

export type UnresolvedFeedbackCheck = {
  hasUnresolvedFeedback: boolean;
  commentedTestPointCount: number;
  answeredQuestionCount: number;
  /** The Review is still on the Questions page, so there are no test points to save yet. */
  questionsPending: boolean;
};

/**
 * Design §4.2: submitting while comments/answered questions are still
 * unresolved must be rejected. A human input remains pending until an AI optimization round
 * consumes it; archived rows are no longer part of the Review, but comments on a deleted row
 * still need that AI pass. An unanswered question, a cleared answer, or an answer already used
 * as the current round baseline does not block submission. While the Review is in the Questions
 * phase nothing can be saved at all.
 */
export function checkUnresolvedFeedback(reviewState: ReviewState): UnresolvedFeedbackCheck {
  const commentedTestPointCount = reviewState.test_points.filter((tp) => tp.archived !== true && tp.comments.length > 0).length;
  const answeredQuestionCount = (reviewState.open_questions ?? []).filter(
    (question) => Boolean(question.answer) && question.answer !== question.round_answer_baseline,
  ).length;
  const questionsPending = reviewPhase(reviewState) === "questions";
  return {
    hasUnresolvedFeedback: commentedTestPointCount > 0 || answeredQuestionCount > 0 || questionsPending,
    commentedTestPointCount,
    answeredQuestionCount,
    questionsPending,
  };
}

export type MarkArchivedResult = {
  reviewState: ReviewState;
  archivedCount: number;
};

/**
 * Design §4.1: after a successful archive POST, mark the submitted rows archived:true
 * (persists across Round switches per plan step 16.5) so they disappear from the page —
 * not shown, not locked, just gone. Everything else keeps reviewing normally.
 */
export function markTestPointsArchived(reviewState: ReviewState, ids: string[], apiData?: unknown): MarkArchivedResult {
  const idSet = new Set(ids);
  const returned = (apiData as {test_points?: unknown} | undefined)?.test_points;
  const returnedById = new Map(Array.isArray(returned) && returned.length === ids.length
    ? ids.map((id, index) => [id, returned[index]]) : []);
  let archivedCount = 0;
  for (const testPoint of reviewState.test_points) {
    if (idSet.has(testPoint.id) && testPoint.archived !== true) {
      testPoint.archived = true;
      const order = returnedById.get(testPoint.id)?.group_order;
      if (Number.isSafeInteger(order) && order >= 0) testPoint.group_order = order;
      archivedCount += 1;
    }
  }
  reviewState.updated_at = new Date().toISOString();
  return { reviewState, archivedCount };
}
