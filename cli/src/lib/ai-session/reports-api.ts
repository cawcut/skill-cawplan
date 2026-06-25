import {cawplanRequest} from "../http.js";
import {extractDataObject, extractList} from "../ai-session/helpers.js";
import type {AiSessionReportItem} from "../ai-session/types.js";
import type {DailyApiJson} from "../collect/types.js";

export async function uploadDailyReport(payload: DailyApiJson): Promise<unknown> {
    return cawplanRequest({
        method: "POST",
        path: "/api/v1/public/openapi/ai-session-usage/reports",
        body: payload,
    });
}

function reportItemsFromResponse(payload: unknown): AiSessionReportItem[] {
    const data = extractDataObject(payload);
    if (Array.isArray(data.items)) return data.items as AiSessionReportItem[];
    return extractList<AiSessionReportItem>(payload);
}

function totalFromReportsResponse(payload: unknown): number | undefined {
    const total = extractDataObject(payload).total;
    return typeof total === "number" ? total : undefined;
}

export async function listMonthlyReportItems(
    dateFrom: string,
    dateTo: string,
    userId?: string
): Promise<AiSessionReportItem[]> {
    const items: AiSessionReportItem[] = [];
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
            path: "/api/v1/public/openapi/ai-session-usage/reports",
            query,
        });
        const pageItems = reportItemsFromResponse(result);
        items.push(...pageItems);
        const total = totalFromReportsResponse(result);
        if (pageItems.length < limit || (total != null && items.length >= total)) break;
    }
    return items;
}
