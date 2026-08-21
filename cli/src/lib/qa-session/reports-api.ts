import {cawplanRequest} from "../http.js";
import type {QaDailyApiJson} from "../collect/qa-types.js";

export async function uploadQaDailyReport(payload: QaDailyApiJson): Promise<unknown> {
    return cawplanRequest({
        method: "POST",
        path: "/api/v1/public/openapi/qa-session-usage/reports",
        body: payload,
    });
}
