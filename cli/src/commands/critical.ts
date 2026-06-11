import { Command } from "commander";
import { cawplanRequest } from "../lib/http.js";
import { getCache, setCache, buildCacheKey, buildScopedCacheKey, buildQueryFromFlags, csvToArray, stableStringify } from "../lib/cache.js";
import { resolveApiPath } from "../lib/products.js";

function parseJsonBody(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    console.error("Error: --body must be valid JSON");
    process.exit(1);
  }
}

export function registerCriticalCommand(program: Command): void {
  const critical = program.command("critical").description("Manage critical issues");

  critical
    .command("list <product_id>")
    .description("List critical issues for a product")
    .option("--time_range <range>", "Time range (e.g. 1m)")
    .option("--start <date>", "Start date YYYY-MM-DD")
    .option("--end <date>", "End date YYYY-MM-DD")
    .option("--status <csv>", "Status filter (CSV)")
    .option("--search <q>", "Search query")
    .option("--page_size <n>", "Page size")
    .option("--page_num <n>", "Page number")
    .action(async (productId: string, opts) => {
      const flags: Record<string, string> = {};
      if (opts.time_range) flags.time_range = opts.time_range;
      if (opts.start) flags.start = opts.start;
      if (opts.end) flags.end = opts.end;
      if (opts.status) flags.status = opts.status;
      if (opts.search) flags.search = opts.search;
      if (opts.page_size) flags.page_size = opts.page_size;
      if (opts.page_num) flags.page_num = opts.page_num;

      const query = buildQueryFromFlags(flags, ["time_range", "start", "end", "status", "search", "page_size", "page_num"]);
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/critical_issues`,
        query,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  critical
    .command("line <product_line_id>")
    .alias("product-line")
    .description("List critical issues for a product line")
    .option("--time_range <range>", "Time range")
    .option("--start <date>", "Start date YYYY-MM-DD")
    .option("--end <date>", "End date YYYY-MM-DD")
    .option("--status <csv>", "Status filter (CSV)")
    .option("--search <q>", "Search query")
    .option("--page_size <n>", "Page size")
    .option("--page_num <n>", "Page number")
    .action(async (productLineId: string, opts) => {
      const flags: Record<string, string> = {};
      if (opts.time_range) flags.time_range = opts.time_range;
      if (opts.start) flags.start = opts.start;
      if (opts.end) flags.end = opts.end;
      if (opts.status) flags.status = opts.status;
      if (opts.search) flags.search = opts.search;
      if (opts.page_size) flags.page_size = opts.page_size;
      if (opts.page_num) flags.page_num = opts.page_num;

      const query = buildQueryFromFlags(flags, ["time_range", "start", "end", "status", "search", "page_size", "page_num"]);
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product_line/${productLineId}/critical_issues`,
        query,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  critical
    .command("search")
    .description("Search critical issues across products")
    .option("--time_range <range>", "Time range")
    .option("--days <n>", "Days (deprecated, use --time_range)")
    .option("--start_date <date>", "Start date YYYY-MM-DD")
    .option("--end_date <date>", "End date YYYY-MM-DD")
    .option("--status <csv>", "Status filter (CSV)")
    .option("--issue_types <csv>", "Issue types (CSV)")
    .option("--product_line_ids <csv>", "Product line IDs (CSV)")
    .option("--product_type_ids <csv>", "Product type IDs (CSV)")
    .option("--product_ids <csv>", "Product IDs (CSV)")
    .option("--tech_owners <csv>", "Tech owner IDs (CSV)")
    .option("--search <q>", "Search query")
    .option("--page_size <n>", "Page size")
    .option("--page_num <n>", "Page number")
    .option("--refresh", "Bypass cache")
    .action(async (opts) => {
      if (!opts.time_range && !opts.days && !(opts.start_date && opts.end_date)) {
        console.error("Error: critical search requires --time_range, --days, or --start_date + --end_date");
        process.exit(1);
      }

      const refresh = Boolean(opts.refresh);
      const flagsMap: Record<string, string> = {};
      if (opts.time_range) flagsMap.time_range = opts.time_range;
      if (opts.days) flagsMap.days = opts.days;
      if (opts.start_date) flagsMap.start_date = opts.start_date;
      if (opts.end_date) flagsMap.end_date = opts.end_date;
      if (opts.page_size) flagsMap.page_size = opts.page_size;
      if (opts.page_num) flagsMap.page_num = opts.page_num;

      const query = buildQueryFromFlags(flagsMap, ["time_range", "days", "start_date", "end_date", "page_size", "page_num"]);
      const body: Record<string, unknown> = {};
      const status = csvToArray(opts.status);
      const issueTypes = csvToArray(opts.issue_types);
      const productLineIds = csvToArray(opts.product_line_ids);
      const productTypeIds = csvToArray(opts.product_type_ids);
      const productIds = csvToArray(opts.product_ids);
      const techOwners = csvToArray(opts.tech_owners);
      if (status) body.status = status;
      if (issueTypes) body.issue_types = issueTypes;
      if (productLineIds) body.product_line_ids = productLineIds;
      if (productTypeIds) body.product_type_ids = productTypeIds;
      if (productIds) body.product_ids = productIds;
      if (techOwners) body.tech_owners = techOwners;
      if (opts.search) body.search = opts.search;

      const key = await buildScopedCacheKey(
        `critical:search:${buildCacheKey("query", query)}|body=${stableStringify(body)}`,
        undefined,
      );
      const cached = getCache(key, refresh);
      if (cached) {
        console.log(JSON.stringify(cached, null, 2));
        return;
      }

      const result = await cawplanRequest({
        method: "POST",
        path: resolveApiPath("/api/v1/public/openapi/critical_issues/search"),
        query,
        body,
      });
      setCache(key, result);
      console.log(JSON.stringify(result, null, 2));
    });

  critical
    .command("get <product_id> <critical_issue_id>")
    .description("Get critical issue details")
    .action(async (productId: string, criticalId: string) => {
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/critical_issues/${criticalId}`,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  critical
    .command("create <product_id>")
    .description("Create a critical issue")
    .requiredOption("--body <json>", "JSON body")
    .action(async (productId: string, opts) => {
      const body = parseJsonBody(opts.body);
      const result = await cawplanRequest({
        method: "POST",
        path: `/api/v1/public/openapi/product/${productId}/critical_issues`,
        body,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  critical
    .command("update <product_id> <critical_issue_id>")
    .description("Update a critical issue")
    .requiredOption("--body <json>", "JSON body")
    .action(async (productId: string, criticalId: string, opts) => {
      const body = parseJsonBody(opts.body);
      const result = await cawplanRequest({
        method: "PUT",
        path: `/api/v1/public/openapi/product/${productId}/critical_issues/${criticalId}`,
        body,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  critical
    .command("delete <product_id> <critical_issue_id>")
    .description("Delete a critical issue")
    .action(async (productId: string, criticalId: string) => {
      const result = await cawplanRequest({
        method: "DELETE",
        path: `/api/v1/public/openapi/product/${productId}/critical_issues/${criticalId}`,
      });
      console.log(JSON.stringify(result, null, 2));
    });
}
