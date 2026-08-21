import {dateRangeInclusive, requireCurrentUserId} from "../ai-session/helpers.js";
import {listMonthlyReportItems} from "./reports-api.js";

export interface QaBackfillResult {
    checked_dates: string[];
    missing_dates: string[];
    uploaded_dates: string[];
    skipped_dates: string[];
    dry_run: boolean;
}

export async function qaBackfillMissingReports(
    dateFrom: string,
    dateTo: string,
    options: {dryRun?: boolean} = {},
): Promise<QaBackfillResult> {
    const expectedDates = dateRangeInclusive(dateFrom, dateTo);
    if (expectedDates.length === 0) throw new Error("--from must be earlier than or equal to --to");
    const userId = await requireCurrentUserId();
    console.error(
        `Checking missing QA daily session reports for user_id ${userId} from ${dateFrom} to ${dateTo}...`,
    );
    const reports = await listMonthlyReportItems(dateFrom, dateTo, userId);
    const existingDates = new Set(
        reports
            .filter((item) => item.user_id === userId)
            .map((item) => item.date)
            .filter((date): date is string => Boolean(date)),
    );

    const missingDates = expectedDates.filter((date) => !existingDates.has(date));
    const uploadedDates: string[] = [];
    const skippedDates: string[] = [];
    console.error(
        `Missing QA daily session report dates: ${missingDates.length > 0 ? missingDates.join(", ") : "none"}`,
    );

    if (options.dryRun) {
        return {
            checked_dates: expectedDates,
            missing_dates: missingDates,
            uploaded_dates: uploadedDates,
            skipped_dates: skippedDates,
            dry_run: true,
        };
    }

    // Reserved for a future confirmed batch upload path (collect + assign + qa-upload).
    throw new Error("QA backfill upload is not implemented yet; re-run with --dry-run");
}
