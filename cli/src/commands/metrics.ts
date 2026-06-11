import { Command } from "commander";
import { cawplanRequest } from "../lib/http.js";
import { buildQueryFromFlags } from "../lib/cache.js";

export function registerMetricsCommand(program: Command): void {
  const metrics = program.command("metrics").description("Product metrics");

  metrics
    .command("get <product_id>")
    .description("Get metrics for a product")
    .option("--time_range <range>", "Time range (e.g. 1m)")
    .option("--start <date>", "Start date YYYY-MM-DD")
    .option("--end <date>", "End date YYYY-MM-DD")
    .action(async (productId: string, opts) => {
      const flags: Record<string, string> = {};
      if (opts.time_range) flags.time_range = opts.time_range;
      if (opts.start) flags.start = opts.start;
      if (opts.end) flags.end = opts.end;

      const query = buildQueryFromFlags(flags, ["time_range", "start", "end"]);
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/metrics`,
        query,
      });
      console.log(JSON.stringify(result, null, 2));
    });
}
