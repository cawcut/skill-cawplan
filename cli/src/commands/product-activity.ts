import { Command } from "commander";
import { cawplanRequest } from "../lib/http.js";

export function registerProductActivityCommand(program: Command): void {
  const productActivity = program.command("product-activity").description("Product activity reports");

  productActivity
    .command("get")
    .description("Get a product activity report")
    .requiredOption("--product_id <id>", "Product ID")
    .requiredOption("--start <date>", "Start date YYYY-MM-DD")
    .requiredOption("--end <date>", "End date YYYY-MM-DD")
    .option("--version_id <id>", "Optional version ID")
    .action(async (opts) => {
      const query: Record<string, string> = {
        product_id: opts.product_id,
        start_date: opts.start,
        end_date: opts.end,
      };
      if (opts.version_id) query.version_id = opts.version_id;

      const result = await cawplanRequest({
        method: "GET",
        path: "/api/v1/public/openapi/product-report",
        query,
      });
      console.log(JSON.stringify(result, null, 2));
    });
}
