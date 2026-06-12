import { Command } from "commander";
import { cawplanRequest } from "../lib/http.js";
import { buildQueryFromFlags, csvToArray } from "../lib/cache.js";

export function registerCommunityCommand(program: Command): void {
  const community = program.command("community").description("Community data");

  community
    .command("timeline")
    .description("Get community release timeline across all products")
    .option("--time_range <range>", "Time range (e.g. 1w, 1m, 3m, 1y)")
    .option("--start <date>", "Start date YYYY-MM-DD")
    .option("--end <date>", "End date YYYY-MM-DD")
    .option("--channels <csv>", "Release channels: GA,EA,Alpha")
    .action(async (opts) => {
      const flags: Record<string, string> = {};
      if (opts.time_range) flags.time_range = opts.time_range;
      if (opts.start) flags.start = opts.start;
      if (opts.end) flags.end = opts.end;

      const channels = csvToArray(opts.channels);
      if (channels) flags.channels = channels.join(",");

      const query = buildQueryFromFlags(flags, ["time_range", "start", "end", "channels"]);
      const result = await cawplanRequest({
        method: "GET",
        path: "/api/v1/public/openapi/community/timeline",
        query,
      });
      console.log(JSON.stringify(result, null, 2));
    });
}
