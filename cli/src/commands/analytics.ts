import { Command } from "commander";
import { cawplanRequest } from "../lib/http.js";
import { buildQueryFromFlags } from "../lib/cache.js";

export function registerAnalyticsCommand(program: Command): void {
  const analytics = program.command("analytics").description("Product analytics (AI-categorized feedback)");

  analytics
    .command("get <product_id>")
    .description("Get AI-categorized feedback analytics for a product")
    .option("--time_range <range>", "Time range (e.g. 1w, 1m, 3m, 1y)")
    .option("--start <date>", "Start date YYYY-MM-DD")
    .option("--end <date>", "End date YYYY-MM-DD")
    .option("--version <v>", "Filter by version (major.minor, e.g. 3.4)")
    .action(async (productId: string, opts) => {
      const flags: Record<string, string> = {};
      if (opts.time_range) flags.time_range = opts.time_range;
      if (opts.start) flags.start = opts.start;
      if (opts.end) flags.end = opts.end;
      if (opts.version) flags.version = opts.version;

      const query = buildQueryFromFlags(flags, ["time_range", "start", "end", "version"]);
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/analytics`,
        query,
      });
      console.log(JSON.stringify(result, null, 2));
    });
}
