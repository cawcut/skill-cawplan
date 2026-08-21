import {QaAssetChange} from "./qa-types.js";
import {tracesFromToolResultStdout} from "./qa-trace-extract.js";

/**
 * Counts test points landed via a direct "testpoints archive" success — the
 * archive endpoint is all-or-nothing, so every entry in api.data.test_points
 * on a SUCCESS, non-dry-run call actually made it into CawPlan.
 */
function countArchivedTestPoints(jsonlPath: string, date?: string): number {
    const traces = tracesFromToolResultStdout(jsonlPath, date);
    let count = 0;
    for (const t of traces) {
        if (t.command !== "testpoints archive") continue;
        if (t.outcome === "SUCCESS" && t.dryRun !== true) {
            count += t.landedCount ?? 0;
        }
    }
    return count;
}

/**
 * Counts test points landed via an UNKNOWN archive write that a later
 * "testpoints reconcile" call resolved as count_matched — the reconcile
 * step exists precisely because an UNKNOWN outcome means the archive call's
 * own response didn't confirm success, so the batch_size (not landedCount,
 * which is unavailable on this path) is the number that actually landed.
 */
function countReconciledTestPoints(jsonlPath: string, date?: string): number {
    const traces = tracesFromToolResultStdout(jsonlPath, date);
    let count = 0;
    for (const t of traces) {
        if (t.command !== "testpoints reconcile") continue;
        if (t.reconcileDecision === "count_matched") {
            count += t.batchSize ?? 0;
        }
    }
    return count;
}

// V1 always returns 0 for these — there is no data source for them yet in
// the local session traces. Second-phase data sources are noted per slot so
// wiring one up later doesn't require touching the caller or the upload
// payload shape, only replacing the function body.

/** V1: always 0. No PATCH/UPDATE path exists for archived test points yet — archiving only appends. */
function countModifiedTestPoints(): number {
    return 0;
}

/** V1: always 0. No delete path exists for archived test points yet. */
function countDeletedTestPoints(): number {
    return 0;
}

/** V1: always 0. Test case generation never writes to CawPlan, so there is nothing to count here. */
function countArchivedTestCases(): number {
    return 0;
}

/** V1: always 0. Same reasoning as countArchivedTestCases — no write path exists yet. */
function countModifiedTestCases(): number {
    return 0;
}

/** V1: always 0. Same reasoning as countArchivedTestCases — no write path exists yet. */
function countDeletedTestCases(): number {
    return 0;
}

export interface QaAssetChanges {
    testpoint: QaAssetChange;
    testcase: QaAssetChange;
}

/**
 * Single outlet for all six asset-change numbers a QA session report
 * carries. Every caller must go through this function instead of writing
 * literals — that keeps the six slots (three of which have no real data
 * source yet) visible and auditable in one place instead of scattered as
 * ad-hoc zeros across the builder.
 */
export function collectQaAssetChanges(jsonlPath: string, date?: string): QaAssetChanges {
    return {
        testpoint: {
            added: countArchivedTestPoints(jsonlPath, date) + countReconciledTestPoints(jsonlPath, date),
            modified: countModifiedTestPoints(),
            deleted: countDeletedTestPoints(),
        },
        testcase: {
            added: countArchivedTestCases(),
            modified: countModifiedTestCases(),
            deleted: countDeletedTestCases(),
        },
    };
}
