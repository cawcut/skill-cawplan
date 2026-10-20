import { afterEach, describe, expect, test, vi } from "vitest";
import * as http from "../src/lib/http.js";
import {
  buildTicketChangesRequest,
  buildTicketFilterBody,
  buildTicketStatsRequest,
  fetchTicketChanges,
  requestTicketStats,
} from "../src/lib/ticket-insights.js";

describe("tickets stats request", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("maps search filters and group_by without client-side computation", async () => {
    const { request, error } = buildTicketStatsRequest({
      start_date: "2000-01-01",
      end_date: "2026-10-20",
      product_ids: "p1",
      version_ids: "v1,v2",
      priority: "CRITICAL,HIGH",
      excluded_status_categories: "COMPLETE,CANCELED",
      ux: "PENDING",
      group_by: "priority,status_category",
    });
    expect(error).toBeUndefined();
    expect(request).toEqual({
      query: { start_date: "2000-01-01", end_date: "2026-10-20" },
      body: {
        product_ids: ["p1"],
        version_ids: ["v1", "v2"],
        priority: ["CRITICAL", "HIGH"],
        excluded_status_categories: ["COMPLETE", "CANCELED"],
        ux: ["PENDING"],
        group_by: ["priority", "status_category"],
      },
    });

    const payload = { code: "SUCCESS", msg: "success", data: { total: 3, groups: [] } };
    const spy = vi.spyOn(http, "cawplanRequest").mockResolvedValue(payload);
    await expect(requestTicketStats(request!)).resolves.toEqual(payload);
    expect(spy).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/public/openapi/tickets/stats",
      query: request!.query,
      body: request!.body,
    });
  });

  test("requires group_by and rejects unknown, repeated or too many dimensions", () => {
    const base = { time_range: "1m" };
    expect(buildTicketStatsRequest(base).error).toMatch(/requires --group_by/);
    expect(buildTicketStatsRequest({ ...base, group_by: "owner" }).error).toMatch(/unknown --group_by/);
    expect(buildTicketStatsRequest({ ...base, group_by: "priority,priority" }).error).toMatch(/must not repeat/);
    expect(buildTicketStatsRequest({ ...base, group_by: "priority,status,ux" }).error).toMatch(/at most 2/);
  });

  test("applies the same unbounded-window rule as tickets search", () => {
    expect(buildTicketStatsRequest({ group_by: "priority" }).error).toMatch(/--time_range or --start_date/);
    expect(buildTicketStatsRequest({ group_by: "priority", display_ids: "CAWP-1" }).error).toBeUndefined();
  });

  test("search and stats share one body mapping", () => {
    expect(buildTicketFilterBody({ assignees: "u1, u2", search: "login" })).toEqual({
      assignees: ["u1", "u2"],
      search: "login",
    });
  });
});

describe("tickets changes request", () => {
  test("requires a window and a ticket scope", () => {
    expect(buildTicketChangesRequest({ product_ids: "p1" }).error).toMatch(/--start_date and --end_date/);
    expect(buildTicketChangesRequest({ start_date: "2026-10-01", end_date: "2026-10-07" }).error).toMatch(
      /at least one of --product_ids/,
    );
  });

  test("maps scope, event filters and group_by", () => {
    const { request } = buildTicketChangesRequest({
      start_date: "2026-10-01",
      end_date: "2026-10-07",
      product_ids: "p1",
      fields: "status,ux",
      actor_ids: "u1",
      new_status_categories: "COMPLETE",
      group_by: "actor",
      page_size: "500",
    });
    expect(request).toEqual({
      query: { start_date: "2026-10-01", end_date: "2026-10-07", page_size: "500" },
      body: {
        product_ids: ["p1"],
        fields: ["status", "ux"],
        actor_ids: ["u1"],
        new_status_categories: ["COMPLETE"],
        group_by: ["actor"],
      },
      grouped: true,
    });
  });

  test("rejects unknown fields", () => {
    expect(
      buildTicketChangesRequest({ start_date: "2026-10-01", end_date: "2026-10-07", product_ids: "p1", fields: "title" })
        .error,
    ).toMatch(/unknown --fields/);
  });
});

describe("fetchTicketChanges", () => {
  const request = {
    query: { start_date: "2026-10-01", end_date: "2026-10-07" },
    body: { product_ids: ["p1"] },
    grouped: false,
  };

  test("follows next_cursor and merges events and tickets", async () => {
    const requester = vi
      .fn()
      .mockResolvedValueOnce({
        code: "SUCCESS",
        msg: "success",
        data: { events: [{ event_id: "e1" }], tickets: { t1: { display_id: "A-1" } }, next_cursor: "c1" },
      })
      .mockResolvedValueOnce({
        code: "SUCCESS",
        msg: "success",
        data: { events: [{ event_id: "e2" }], tickets: { t2: { display_id: "A-2" } }, next_cursor: null },
      });

    const result = await fetchTicketChanges(request, { requester });
    expect(requester).toHaveBeenNthCalledWith(1, request.query, request.body);
    expect(requester).toHaveBeenNthCalledWith(2, { ...request.query, cursor: "c1" }, request.body);
    expect(result).toEqual({
      code: "SUCCESS",
      msg: "success",
      data: {
        events: [{ event_id: "e1" }, { event_id: "e2" }],
        tickets: { t1: { display_id: "A-1" }, t2: { display_id: "A-2" } },
        next_cursor: null,
        truncated: false,
        pages: 2,
      },
    });
  });

  test("stops at the page cap and reports truncation with a resumable cursor", async () => {
    const requester = vi.fn().mockResolvedValue({
      code: "SUCCESS",
      msg: "success",
      data: { events: [{ event_id: "e" }], tickets: {}, next_cursor: "more" },
    });
    const result = (await fetchTicketChanges(request, { requester, maxPages: 3 })) as {
      data: { events: unknown[]; next_cursor: string; truncated: boolean; pages: number };
    };
    expect(requester).toHaveBeenCalledTimes(3);
    expect(result.data.events).toHaveLength(3);
    expect(result.data.truncated).toBe(true);
    expect(result.data.next_cursor).toBe("more");
  });

  test("returns a failing page as-is", async () => {
    const failure = { code: "FAILURE_INVALID_INPUT", msg: "Date range cannot exceed 90 days", data: null };
    const requester = vi.fn().mockResolvedValue(failure);
    await expect(fetchTicketChanges(request, { requester })).resolves.toEqual(failure);
  });

  test("grouped requests are a single call returned unchanged", async () => {
    const grouped = { code: "SUCCESS", msg: "success", data: { groups: [{ count: 2 }], truncated: false } };
    const requester = vi.fn().mockResolvedValue(grouped);
    await expect(fetchTicketChanges({ ...request, grouped: true }, { requester })).resolves.toEqual(grouped);
    expect(requester).toHaveBeenCalledTimes(1);
  });
});
