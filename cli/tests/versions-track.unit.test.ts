import { describe, expect, test } from "vitest";
import { fetchVersionTicketProgress, trackVersion } from "../src/commands/versions";

const PRODUCT = "prod_1";
const VERSION = "ver_1";

const group = (value: string, count: number) => ({ count, values: [{ dimension: "status_category", value }] });
const statsOk = (groups: unknown[]) => async () => ({ code: "SUCCESS", data: { groups } });

describe("fetchVersionTicketProgress", () => {
  test("sums sub-issues from tickets stats and recomputes the percent", async () => {
    const calls: unknown[] = [];
    const stats = async (req: unknown) => {
      calls.push(req);
      return { code: "SUCCESS", data: { groups: [group("UNSTARTED", 155), group("COMPLETE", 53), group("STARTED", 14), group("TESTING", 10), group("CANCELED", 3)] } };
    };
    const out = await fetchVersionTicketProgress(PRODUCT, VERSION, stats as never, new Date("2026-11-06T00:00:00Z"));
    expect(calls[0]).toEqual({
      query: { start_date: "2000-01-01", end_date: "2026-11-06" },
      body: { product_ids: [PRODUCT], version_ids: [VERSION], group_by: ["status_category"] },
    });
    expect(out).toEqual({
      includes_sub_issues: true,
      total: 235,
      status_counts: { UNSTARTED: 155, COMPLETE: 53, STARTED: 14, TESTING: 10, CANCELED: 3 },
      complete_percent: 22.8,
    });
  });

  test("reports the error instead of failing when stats is unavailable", async () => {
    const stats = async () => {
      throw new Error("boom");
    };
    expect(await fetchVersionTicketProgress(PRODUCT, VERSION, stats as never)).toEqual({ error: "boom" });
  });
});

describe("trackVersion", () => {
  test("keeps detail/release untouched and adds ticket_progress", async () => {
    const paths: string[] = [];
    const request = async (o: { path: string }) => {
      paths.push(o.path);
      return { code: "SUCCESS", data: { path: o.path } };
    };
    const out = await trackVersion(PRODUCT, VERSION, { request: request as never, stats: statsOk([group("COMPLETE", 1)]) as never });
    expect(paths.sort()).toEqual([
      `/api/v1/public/openapi/product/${PRODUCT}/versions/${VERSION}`,
      `/api/v1/public/openapi/product/${PRODUCT}/versions/${VERSION}/release`,
    ]);
    expect(out.ticket_progress).toMatchObject({ includes_sub_issues: true, total: 1, complete_percent: 100 });
    expect(Object.keys(out)).toEqual(["detail", "release", "ticket_progress"]);
  });
});
