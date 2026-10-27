import {afterEach, describe, expect, test, vi} from "vitest";
import * as http from "../src/lib/http.js";
import {listMonthlyReportItems} from "../src/lib/qa-session/reports-api.js";

const QA_REPORTS_PATH = "/api/v1/public/openapi/qa-session-usage/reports";
const CODING_REPORTS_PATH = "/api/v1/public/openapi/ai-session-usage/reports";

describe("qa-session listMonthlyReportItems", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("requests qa-session-usage/reports with date range and user_id", async () => {
        const request = vi.spyOn(http, "cawplanRequest").mockResolvedValue({
            code: "SUCCESS",
            data: {
                items: [{date: "2026-08-04", user_id: "user-1"}],
                total: 1,
            },
        });

        const items = await listMonthlyReportItems("2026-08-01", "2026-08-31", "user-1");

        expect(items).toEqual([{date: "2026-08-04", user_id: "user-1"}]);
        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith({
            method: "GET",
            path: QA_REPORTS_PATH,
            query: {
                date_from: "2026-08-01",
                date_to: "2026-08-31",
                limit: "100",
                offset: "0",
                user_id: "user-1",
            },
        });
        expect(request.mock.calls.some((call) => call[0]?.path === CODING_REPORTS_PATH)).toBe(false);
    });

    test("paginates until all items are fetched", async () => {
        const pageOne = Array.from({length: 100}, (_, index) => ({
            date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
            user_id: "user-1",
        }));
        const request = vi.spyOn(http, "cawplanRequest")
            .mockResolvedValueOnce({
                code: "SUCCESS",
                data: {items: pageOne, total: 101},
            })
            .mockResolvedValueOnce({
                code: "SUCCESS",
                data: {
                    items: [{date: "2026-08-31", user_id: "user-1"}],
                    total: 101,
                },
            });

        const items = await listMonthlyReportItems("2026-08-01", "2026-08-31");

        expect(items).toHaveLength(101);
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls[1]?.[0]).toEqual({
            method: "GET",
            path: QA_REPORTS_PATH,
            query: {
                date_from: "2026-08-01",
                date_to: "2026-08-31",
                limit: "100",
                offset: "100",
            },
        });
    });

    test("omits user_id from query when not provided", async () => {
        const request = vi.spyOn(http, "cawplanRequest").mockResolvedValue({
            code: "SUCCESS",
            data: {items: [], total: 0},
        });

        await listMonthlyReportItems("2026-08-01", "2026-08-10");

        expect(request.mock.calls[0]?.[0]?.query).toEqual({
            date_from: "2026-08-01",
            date_to: "2026-08-10",
            limit: "100",
            offset: "0",
        });
    });
});
