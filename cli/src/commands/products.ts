import { Command } from "commander";
import { cawplanRequest } from "../lib/http.js";
import { getCache, setCache, buildCacheKey, buildQueryFromFlags } from "../lib/cache.js";

export function registerProductsCommand(program: Command): void {
  const products = program.command("products").description("Manage products");

  products
    .command("list")
    .description("List all products")
    .option("--search <q>", "Search query")
    .option("--page_size <n>", "Page size")
    .option("--page_num <n>", "Page number")
    .option("--type_id <id>", "Filter by type ID")
    .option("--product_line_id <id>", "Filter by product line ID")
    .option("--refresh", "Bypass cache")
    .action(async (opts) => {
      const flags: Record<string, string> = {};
      if (opts.search) flags.search = opts.search;
      if (opts.page_size) flags.page_size = opts.page_size;
      if (opts.page_num) flags.page_num = opts.page_num;
      if (opts.type_id) flags.type_id = opts.type_id;
      if (opts.product_line_id) flags.product_line_id = opts.product_line_id;

      const refresh = Boolean(opts.refresh);
      const query = buildQueryFromFlags(flags, ["search", "page_size", "page_num", "type_id", "product_line_id"]);
      const key = buildCacheKey("products:list", query);
      const cached = getCache(key, refresh);
      if (cached) {
        console.log(JSON.stringify(cached, null, 2));
        return;
      }
      const result = await cawplanRequest({
        method: "GET",
        path: "/api/v1/public/openapi/products",
        query,
      });
      setCache(key, result);
      console.log(JSON.stringify(result, null, 2));
    });

  const productLines = program.command("product-lines").description("Manage product lines");

  productLines
    .command("list")
    .description("List all product lines")
    .option("--page_size <n>", "Page size")
    .option("--page_num <n>", "Page number")
    .option("--refresh", "Bypass cache")
    .action(async (opts) => {
      const flags: Record<string, string> = {};
      if (opts.page_size) flags.page_size = opts.page_size;
      if (opts.page_num) flags.page_num = opts.page_num;

      const refresh = Boolean(opts.refresh);
      const query = buildQueryFromFlags(flags, ["page_size", "page_num"]);
      const key = buildCacheKey("product-lines:list", query);
      const cached = getCache(key, refresh);
      if (cached) {
        console.log(JSON.stringify(cached, null, 2));
        return;
      }
      const result = await cawplanRequest({
        method: "GET",
        path: "/api/v1/public/openapi/product_lines",
        query,
      });
      setCache(key, result);
      console.log(JSON.stringify(result, null, 2));
    });

  productLines
    .command("get <product_line_id>")
    .description("Get product line details")
    .option("--refresh", "Bypass cache")
    .action(async (productLineId: string, opts) => {
      const refresh = Boolean(opts.refresh);
      const key = `product-lines:detail:${productLineId}`;
      const cached = getCache(key, refresh);
      if (cached) {
        console.log(JSON.stringify(cached, null, 2));
        return;
      }
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product_lines/${productLineId}`,
      });
      setCache(key, result);
      console.log(JSON.stringify(result, null, 2));
    });

  productLines
    .command("statuses <product_line_id>")
    .description("Get ticket statuses for a product line")
    .action(async (productLineId: string) => {
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product_lines/${productLineId}/ticket_statuses`,
      });
      console.log(JSON.stringify(result, null, 2));
    });
}
