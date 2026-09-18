import type { ReviewState, TestPoint } from "./types.js";

export type ArchiveSubmissionItem = {
  title: string;
  tags: string[];
  group: string;
  priority: string;
  is_edited: boolean;
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

export type UnresolvedFeedbackCheck = {
  hasUnresolvedFeedback: boolean;
  commentedTestPointCount: number;
  globalCommentCount: number;
};

/**
 * Design §4.2: submitting while comments/overall feedback are still unresolved must be
 * rejected. A comment remains pending until an AI optimization round consumes it; archived
 * rows are no longer part of the Review, but comments on a deleted row still need that AI pass.
 */
export function checkUnresolvedFeedback(reviewState: ReviewState): UnresolvedFeedbackCheck {
  const commentedTestPointCount = reviewState.test_points.filter((tp) => tp.archived !== true && tp.comments.length > 0).length;
  const globalCommentCount = reviewState.global_comments.length;
  return {
    hasUnresolvedFeedback: commentedTestPointCount > 0 || globalCommentCount > 0,
    commentedTestPointCount,
    globalCommentCount,
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
export function markTestPointsArchived(reviewState: ReviewState, ids: string[]): MarkArchivedResult {
  const idSet = new Set(ids);
  let archivedCount = 0;
  for (const testPoint of reviewState.test_points) {
    if (idSet.has(testPoint.id) && testPoint.archived !== true) {
      testPoint.archived = true;
      archivedCount += 1;
    }
  }
  reviewState.updated_at = new Date().toISOString();
  return { reviewState, archivedCount };
}
