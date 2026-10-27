import {existsSync} from "node:fs";
import {collect} from "../collect/index.js";
import {requireCurrentUserId, dateRangeInclusive} from "./helpers.js";
import {listMonthlyReportItems, uploadDailyReport} from "./reports-api.js";
import {autoAssignProjectsFromCloudMappings} from "../assign/auto-assign.js";
import {readDailyReport, writeDailyReport} from "../assign/report-io.js";
import {warnMissingProductAssignment} from "../assign/session-checks.js";
import type {DailyApiJson} from "../collect/types.js";

export async function collectOrReadDailyReport(date: string): Promise<{
    daily: DailyApiJson;
    file: string;
    created: boolean;
}> {
    const file = `ai-daily-${date}.json`;
    if (existsSync(file)) {
        return {
            daily: readDailyReport(file),
            file,
            created: false,
        };
    }

    const daily = await collect({date});
    writeDailyReport(file, daily);
    return {
        daily,
        file,
        created: true,
    };
}

export async function backfillMissingReports(
    dateFrom: string,
    dateTo: string,
    options: { dryRun?: boolean } = {}
): Promise<{
    checked_dates: string[];
    missing_dates: string[];
    uploaded_dates: string[];
    skipped_dates: string[];
    dry_run: boolean;
}> {
    const expectedDates = dateRangeInclusive(dateFrom, dateTo);
    if (expectedDates.length === 0) throw new Error("--from must be earlier than or equal to --to");
    const userId = await requireCurrentUserId();
    console.error(`Checking missing daily session reports for user_id ${userId} from ${dateFrom} to ${dateTo}...`);
    const reports = await listMonthlyReportItems(dateFrom, dateTo, userId);
    const existingDates = new Set(
        reports
            .filter((item) => item.user_id === userId)
            .map((item) => item.date)
            .filter((date): date is string => Boolean(date))
    );

    const missingDates = expectedDates.filter((date) => !existingDates.has(date));
    const uploadedDates: string[] = [];
    const skippedDates: string[] = [];
    console.error(`Missing daily session report dates: ${missingDates.length > 0 ? missingDates.join(", ") : "none"}`);

    if (options.dryRun) {
        return {
            checked_dates: expectedDates,
            missing_dates: missingDates,
            uploaded_dates: uploadedDates,
            skipped_dates: skippedDates,
            dry_run: true,
        };
    }

    for (const date of missingDates) {
        try {
            console.error(`Backfilling missing daily session report for ${date}...`);
            const {daily, file, created} = await collectOrReadDailyReport(date);
            if (!daily.author || !daily.date) {
                throw new Error(`${file} must contain author and date`);
            }
            const assigned = await autoAssignProjectsFromCloudMappings(daily);
            if (assigned > 0 || created) {
                writeDailyReport(file, daily);
            }
            if (warnMissingProductAssignment(file, daily)) {
                console.error(`Skipping upload for ${date} until product assignment is complete.`);
                skippedDates.push(date);
                continue;
            }
            await uploadDailyReport(daily);
            uploadedDates.push(date);
            console.error(`Backfilled ${date} from ${file}.`);
        } catch (e) {
            skippedDates.push(date);
            console.error(`Failed to backfill ${date}: ${(e as Error).message}`);
        }
    }

    return {
        checked_dates: expectedDates,
        missing_dates: missingDates,
        uploaded_dates: uploadedDates,
        skipped_dates: skippedDates,
        dry_run: false,
    };
}
