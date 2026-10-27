import type { ReviewState } from "./types.js";

export type ReviewPhase = "questions" | "review";

/**
 * The phase is fixed when a Round starts: any question whose `round_answer_baseline` is empty
 * (new this Round, or never answered) keeps the Review on the Questions page until AI consumes
 * the answers. It must not follow live answers, or refreshing after answering would skip Continue.
 */
export function reviewPhase(state: ReviewState): ReviewPhase {
  return (state.open_questions ?? []).some((question) => !question.round_answer_baseline) ? "questions" : "review";
}
