import { formatTestPointId } from "./test-point-id.js";
import type { DeletedTombstone, ReviewState, TestPoint, TestPointFields } from "./types.js";

export type AiModifiedEntry = {
  id: string;
  fields: TestPointFields;
};

export type AiRoundOutput = {
  modified: AiModifiedEntry[];
  added: TestPointFields[];
};

export function advanceReviewRound(reviewState: ReviewState, aiOutput: AiRoundOutput): ReviewState {
  const archived: TestPoint[] = [];
  const active: TestPoint[] = [];
  for (const testPoint of reviewState.test_points) {
    (testPoint.archived ? archived : active).push(testPoint);
  }

  const modifiedById = new Map(aiOutput.modified.map((entry) => [entry.id, entry.fields]));

  const newTombstones: DeletedTombstone[] = [];
  const survivors: TestPoint[] = [];
  for (const testPoint of active) {
    if (testPoint.status === "deleted") {
      newTombstones.push({ title: testPoint.original.title, deleted_in_round: reviewState.round });
      continue;
    }

    const modifiedFields = modifiedById.get(testPoint.id);
    survivors.push({
      ...testPoint,
      current: modifiedFields ? { ...modifiedFields } : testPoint.current,
      status: "unchanged",
      ai_status: modifiedFields ? "modified" : "none",
      comments: [],
    });
    delete survivors[survivors.length - 1].pre_delete_status;
  }

  const added: TestPoint[] = aiOutput.added.map((fields) => {
    const id = formatTestPointId(reviewState.next_seq);
    reviewState.next_seq += 1;
    return {
      id,
      original: { ...fields },
      current: { ...fields },
      status: "added",
      source: "ai",
      ai_status: "added",
      comments: [],
    };
  });

  reviewState.round += 1;
  reviewState.test_points = [...survivors, ...added, ...archived];
  reviewState.global_comments = [];
  reviewState.deleted_tombstones = [...reviewState.deleted_tombstones, ...newTombstones];
  reviewState.updated_at = new Date().toISOString();

  return reviewState;
}
