import { Command } from "commander";
import { cawplanRequest } from "../lib/http.js";
import { buildQueryFromFlags } from "../lib/cache.js";
import { requestTicketStats } from "../lib/ticket-insights.js";

type Request = typeof cawplanRequest;
type StatsRequest = typeof requestTicketStats;

interface StatsGroup {
  count?: number;
  values?: { value?: string }[];
}

/**
 * Version-wide ticket counts by status category. Unlike `detail.data.progress`
 * (top-level tickets only), `tickets stats` counts sub-issues too, so these
 * numbers are the real workload of the version.
 */
export async function fetchVersionTicketProgress(
  productId: string,
  versionId: string,
  stats: StatsRequest = requestTicketStats,
  today: Date = new Date(),
): Promise<Record<string, unknown>> {
  const endDate = today.toISOString().slice(0, 10);
  try {
    const result = (await stats({
      query: { start_date: "2000-01-01", end_date: endDate },
      body: { product_ids: [productId], version_ids: [versionId], group_by: ["status_category"] },
    })) as { data?: { groups?: StatsGroup[] } };
    const statusCounts: Record<string, number> = {};
    let total = 0;
    for (const group of result?.data?.groups ?? []) {
      const category = group.values?.[0]?.value ?? "UNKNOWN";
      const count = group.count ?? 0;
      statusCounts[category] = (statusCounts[category] ?? 0) + count;
      total += count;
    }
    const open = total - (statusCounts.CANCELED ?? 0);
    const complete = statusCounts.COMPLETE ?? 0;
    return {
      includes_sub_issues: true,
      total,
      status_counts: statusCounts,
      complete_percent: open > 0 ? Math.round((complete / open) * 1000) / 10 : 0,
    };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function trackVersion(
  productId: string,
  versionId: string,
  deps: { request?: Request; stats?: StatsRequest } = {},
): Promise<Record<string, unknown>> {
  const request = deps.request ?? cawplanRequest;
  const [detail, release, ticketProgress] = await Promise.all([
    request({
      method: "GET",
      path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}`,
    }),
    request({
      method: "GET",
      path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/release`,
    }),
    fetchVersionTicketProgress(productId, versionId, deps.stats),
  ]);
  return { detail, release, ticket_progress: ticketProgress };
}

export function registerVersionsCommand(program: Command): void {
  const versions = program.command("versions").description("Manage versions");

  versions
    .command("list <product_id>")
    .description("List versions for a product")
    .option("--page_size <n>", "Page size")
    .option("--page_num <n>", "Page number")
    .action(async (productId: string, opts) => {
      const flags: Record<string, string> = {};
      if (opts.page_size) flags.page_size = opts.page_size;
      if (opts.page_num) flags.page_num = opts.page_num;

      const query = buildQueryFromFlags(flags, ["page_size", "page_num"]);
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/versions`,
        query,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  versions
    .command("get <product_id> <version_id>")
    .description("Get version details")
    .action(async (productId: string, versionId: string) => {
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}`,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  versions
    .command("create <product_id>")
    .description("Create a new version")
    .requiredOption("--name <version>", "Version name (e.g. X.Y.Z)")
    .option("--major_id <id>", "Major version unique_id")
    .option("--description <text>", "Description")
    .action(async (productId: string, opts) => {
      const body: Record<string, unknown> = { name: opts.name };
      if (opts.major_id) body.major_id = opts.major_id;
      if (opts.description !== undefined) body.description = opts.description;

      const result = await cawplanRequest({
        method: "POST",
        path: `/api/v1/public/openapi/product/${productId}/versions`,
        body,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  versions
    .command("track <product_id> <version_id>")
    .description(
      "Show release progress: ticket completion, risk, target release dates (ticket_progress counts sub-issues)",
    )
    .action(async (productId: string, versionId: string) => {
      const result = await trackVersion(productId, versionId);
      console.log(JSON.stringify(result, null, 2));
    });

  // Releases subcommand lives naturally alongside versions
  const releases = program.command("releases").description("Manage releases");

  releases
    .command("list <product_id> <version_id>")
    .description("List releases for a version")
    .action(async (productId: string, versionId: string) => {
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/release`,
      });
      console.log(JSON.stringify(result, null, 2));
    });
}
