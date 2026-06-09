import { Command } from "commander";
import { cawplanRequest } from "../lib/http.js";
import { buildQueryFromFlags } from "../lib/cache.js";

export function registerActivitiesCommand(program: Command): void {
  const activities = program.command("activities").description("Query activity logs");

  activities
    .command("query")
    .description("Query activities")
    .option("--time_range <range>", "Time range (e.g. 1m)")
    .option("--page_size <n>", "Page size")
    .option("--page_num <n>", "Page number")
    .option("--user_id <id>", "Filter by user ID")
    .option("--product_id <id>", "Filter by product ID")
    .option("--activity_types <csv>", "Activity types (CSV)")
    .action(async (opts) => {
      const flags: Record<string, string> = {};
      if (opts.time_range) flags.time_range = opts.time_range;
      if (opts.page_size) flags.page_size = opts.page_size;
      if (opts.page_num) flags.page_num = opts.page_num;
      const query = buildQueryFromFlags(flags, ["time_range", "page_size", "page_num"]);

      const body: Record<string, unknown> = {};
      if (opts.user_id) body.user_id = opts.user_id;
      if (opts.product_id) body.product_id = opts.product_id;
      if (opts.activity_types) {
        body.activity_types = opts.activity_types
          .split(",")
          .map((t: string) => t.trim())
          .filter(Boolean);
      }

      const result = await cawplanRequest({
        method: "POST",
        path: "/api/v1/public/openapi/activities/query",
        query,
        body: Object.keys(body).length ? body : undefined,
      });
      console.log(JSON.stringify(result, null, 2));
    });
}
