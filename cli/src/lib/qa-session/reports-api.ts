import {cawplanRequest} from "../http.js";
import {extractDataObject, extractList} from "../ai-session/helpers.js";
import type {QaDailyApiJson} from "../collect/qa-types.js";
import {toQaUploadPayload} from "../collect/aggregators/qa-daily.js";
import type {QaSessionReportItem} from "./types.js";

const QA_REPORTS_PATH = "/api/v1/public/openapi/qa-session-usage/reports";

export async function uploadQaDailyReport(payload: QaDailyApiJson): Promise<unknown> {
    return cawplanRequest({
        method: "POST",
        path: QA_REPORTS_PATH,
        body: toQaUploadPayload(payload),
    });
}

function reportItemsFromResponse(payload: unknown): QaSessionReportItem[] {
    const data = extractDataObject(payload);
    if (Array.isArray(data.items)) return data.items as QaSessionReportItem[];
    return extractList<QaSessionReportItem>(payload);
}

function totalFromReportsResponse(payload: unknown): number | undefined {
    const total = extractDataObject(payload).total;
    return typeof total === "number" ? total : undefined;
}

export async function listMonthlyReportItems(
    dateFrom: string,
    dateTo: string,
    userId?: string,
): Promise<QaSessionReportItem[]> {
    const items: QaSessionReportItem[] = [];
    const limit = 100;
    for (let offset = 0; ; offset += limit) {
        const query: Record<string, string> = {
            date_from: dateFrom,
            date_to: dateTo,
            limit: String(limit),
            offset: String(offset),
        };
        if (userId) query.user_id = userId;
        const result = await cawplanRequest({
            method: "GET",
            path: QA_REPORTS_PATH,
            query,
        });
        const pageItems = reportItemsFromResponse(result);
        items.push(...pageItems);
        const total = totalFromReportsResponse(result);
        if (pageItems.length < limit || (total != null && items.length >= total)) break;
    }
    return items;
}
