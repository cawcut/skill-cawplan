import { formatTestPointId } from "./test-point-id.js";
import type { DeletedTombstone, ReviewState, TestPoint, TestPointFields } from "./types.js";

export type AiModifiedEntry = {
  id: string;
  fields: TestPointFields;
};

export type AiRoundOutput = {
  modified: AiModifiedEntry[];
  added: TestPointFields[];
  questions?: {
    retainedIds: string[];
    added: string[];
  };
};

function mergeAiStatus(
  prev: TestPoint["ai_status"],
  thisRound: "modified" | "none",
  accumulate: boolean,
): TestPoint["ai_status"] {
  if (!accumulate) return thisRound;
  if (prev === "added") return "added";
  return prev === "modified" || thisRound === "modified" ? "modified" : "none";
}

export function advanceReviewRound(reviewState: ReviewState, aiOutput: AiRoundOutput): ReviewState {
  const archived: TestPoint[] = [];
  const active: TestPoint[] = [];
  for (const testPoint of reviewState.test_points) {
    (testPoint.archived ? archived : active).push(testPoint);
  }

  const modifiedById = new Map(aiOutput.modified.map((entry) => [entry.id, entry.fields]));

  // Tags are cleared only once the user has seen a Review-phase page for this round;
  // rounds the user never saw (consecutive Questions rounds) accumulate instead.
  const lastViewed = reviewState.last_viewed_review_round;
  const accumulate = lastViewed !== undefined && lastViewed !== reviewState.round;

  const newTombstones: DeletedTombstone[] = [];
  const survivors: TestPoint[] = [];
  for (const testPoint of active) {
    if (testPoint.status === "deleted") {
      newTombstones.push({ title: testPoint.original.title, deleted_in_round: reviewState.round });
      continue;
    }

    const modifiedFields = modifiedById.get(testPoint.id);
    const current = modifiedFields ? { ...modifiedFields, tags: [...modifiedFields.tags] } : testPoint.current;
    survivors.push({
      ...testPoint,
      current,
      round_baseline: {...current, tags: [...current.tags]},
      status: "unchanged",
      ai_status: mergeAiStatus(testPoint.ai_status, modifiedFields ? "modified" : "none", accumulate),
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
      round_baseline: {...fields, tags: [...fields.tags]},
      status: "added",
      source: "ai",
      ai_status: "added",
      comments: [],
    };
  });

  if (reviewState.open_questions !== undefined && aiOutput.questions) {
    const byId = new Map(reviewState.open_questions.map((question) => [question.id, question]));
    const retained = aiOutput.questions.retainedIds.map((id) => {
      const question = byId.get(id)!;
      return {...question, round_answer_baseline: question.answer};
    });
    let nextQuestionSeq = reviewState.next_question_seq ?? reviewState.open_questions.reduce((next, question) => {
      const match = /^oq_(\d+)$/.exec(question.id);
      return match ? Math.max(next, Number(match[1]) + 1) : next;
    }, 1);
    const addedQuestions = aiOutput.questions.added.map((text) => ({
      id: `oq_${String(nextQuestionSeq++).padStart(3, "0")}`,
      text,
      answer: null,
      round_answer_baseline: null,
    }));
    reviewState.open_questions = [...retained, ...addedQuestions];
    reviewState.next_question_seq = nextQuestionSeq;
  }

  reviewState.round += 1;
  reviewState.test_points = [...survivors, ...added, ...archived];
  reviewState.deleted_tombstones = [...reviewState.deleted_tombstones, ...newTombstones];
  reviewState.updated_at = new Date().toISOString();

  return reviewState;
}
