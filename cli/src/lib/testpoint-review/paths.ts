import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Persistent (non-tmp) directory for test point review data.
 * Not under os.tmpdir() because review sessions must survive across days/reboots.
 */
export function getTestPointReviewDir(): string {
  return process.env.CAWPLAN_TESTPOINT_REVIEW_PATH ?? resolve(homedir(), ".cawplan", "test-point-review");
}
