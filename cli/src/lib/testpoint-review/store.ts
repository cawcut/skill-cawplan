import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTestPointReviewDir } from "./paths.js";
import { atomicWriteFileSync } from "./atomic-write.js";
import type { ReviewState } from "./types.js";

const VALID_REVIEW_ID = /^rv_[A-Za-z0-9-]+$/;

export function reviewFilePath(reviewId: string): string {
  if (!VALID_REVIEW_ID.test(reviewId)) {
    throw new Error(`invalid review id: ${reviewId}`);
  }
  return join(getTestPointReviewDir(), `${reviewId}.json`);
}

export function saveReviewState(state: ReviewState): string {
  mkdirSync(getTestPointReviewDir(), { recursive: true });
  const filePath = reviewFilePath(state.review_id);
  atomicWriteFileSync(filePath, JSON.stringify(state, null, 2));
  return filePath;
}

export function loadReviewState(reviewId: string): ReviewState {
  const filePath = reviewFilePath(reviewId);
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as ReviewState;
}
