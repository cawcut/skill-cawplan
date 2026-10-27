import {Command} from "commander";
import {cawplanRequest} from "../lib/http.js";
import {getCache, setCache, buildScopedCacheKey, buildQueryFromFlags} from "../lib/cache.js";
import {listCawplanProducts} from "../lib/product-catalog.js";

export {listCawplanProducts as listProducts} from "../lib/product-catalog.js";

export async function getProductOverview(
    productId: string,
    opts: { refresh?: boolean } = {},
): Promise<unknown> {
    const refresh = Boolean(opts.refresh);
    const key = await buildScopedCacheKey(`products:overview:${productId}`, undefined);
    const cached = getCache(key, refresh);
    if (cached) return cached;

    const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/overview`,
    });
    setCache(key, result);
    return result;
}

export function registerProductsCommand(program: Command): void {
    const products = program.command("products").description("Manage products");

    products
        .command("overview <product_id>")
        .description("Get product overview (name + description background)")
        .option("--refresh", "Bypass cache")
        .action(async (productId: string, opts) => {
            const result = await getProductOverview(productId, { refresh: opts.refresh });
            console.log(JSON.stringify(result, null, 2));
        });

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
            const result = await listCawplanProducts({
                search: opts.search,
                pageSize: opts.page_size,
                pageNum: opts.page_num,
                typeId: opts.type_id,
                productLineId: opts.product_line_id,
                refresh: opts.refresh,
            });
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
            const key = await buildScopedCacheKey("product-lines:list", query);
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
            const key = await buildScopedCacheKey(`product-lines:detail:${productLineId}`, undefined);
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
