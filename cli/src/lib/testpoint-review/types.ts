export type TestPointFields = {
  title: string;
  group: string;
  tags: string[];
  priority: string;
};

export type TestPointComment = {
  id: string;
  text: string;
  author: "qa" | "ai";
  resolved: boolean;
};

export type TestPoint = {
  id: string;
  original: TestPointFields;
  current: TestPointFields;
  // QA-facing edit state for the CURRENT round (independent of ai_status — a
  // point can be "edited" by QA while ai_status is still "none" from a prior
  // round, or vice versa after an AI round touches a point QA never edited).
  status: "unchanged" | "edited" | "deleted" | "added";
  // Snapshot of `status` taken at delete time, restored verbatim if QA undoes
  // the delete — this preserves "this was edited before I deleted it" instead
  // of recomputing from `original`/`current`, which would silently forget any
  // edit that happened to leave the fields equal to `original` again.
  pre_delete_status?: "unchanged" | "edited" | "added";
  source: "ai" | "qa";
  // Whether the AI touched this point in the most recent optimize round —
  // orthogonal to `status`: this tracks AI provenance, `status` tracks QA's
  // current-round edit action.
  ai_status: "none" | "modified" | "added";
  comments: TestPointComment[];
  archived?: boolean;
};

export type DeletedTombstone = {
  title: string;
  deleted_in_round: number;
};

// NOTE: tombstones are recorded on every delete but not yet consumed anywhere
// (no code currently blocks AI from re-adding a title that was deleted). This
// is a placeholder for that guard, not a finished feature — see
// apply-optimization if/when re-add prevention is implemented.

export type ReviewStatus = "reviewing" | "pending_optimize" | "optimizing" | "optimized" | "failed";

export type ReviewState = {
  schema_version: 1;
  review_id: string;
  round: number;
  review_status: ReviewStatus;
  product_id: string;
  requirement_id: string;
  requirement: Record<string, unknown>;
  count_before: number;
  next_seq: number;
  language?: "zh" | "en";
  optimize_requested_at?: string;
  updated_at: string;
  test_points: TestPoint[];
  global_comments: TestPointComment[];
  deleted_tombstones: DeletedTombstone[];
};
