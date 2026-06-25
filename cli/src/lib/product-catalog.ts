import {cawplanRequest} from "./http.js";
import {getCache, setCache, buildScopedCacheKey, buildQueryFromFlags} from "./cache.js";

const PRODUCT_LIST_QUERY_KEYS = ["search", "page_size", "page_num", "type_id", "product_line_id"];

export async function listCawplanProducts(opts: {
    search?: string;
    pageSize?: string;
    pageNum?: string;
    typeId?: string;
    productLineId?: string;
    refresh?: boolean;
} = {}): Promise<unknown> {
    const flags: Record<string, string> = {};
    if (opts.search) flags.search = opts.search;
    if (opts.pageSize) flags.page_size = opts.pageSize;
    if (opts.pageNum) flags.page_num = opts.pageNum;
    if (opts.typeId) flags.type_id = opts.typeId;
    if (opts.productLineId) flags.product_line_id = opts.productLineId;

    const query = buildQueryFromFlags(flags, PRODUCT_LIST_QUERY_KEYS);
    const key = await buildScopedCacheKey("products:list", query);
    const cached = getCache(key, Boolean(opts.refresh));
    if (cached) return cached;

    const result = await cawplanRequest({
        method: "GET",
        path: "/api/v1/public/openapi/products",
        query,
    });
    setCache(key, result);
    return result;
}
