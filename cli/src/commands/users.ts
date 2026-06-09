import { Command } from "commander";
import { cawplanRequest } from "../lib/http.js";
import { getCache, setCache, buildCacheKey, buildQueryFromFlags } from "../lib/cache.js";

export function registerUsersCommand(program: Command): void {
  const users = program.command("users").description("Manage users");

  users
    .command("list")
    .description("List users")
    .option("--search <q>", "Search query")
    .option("--page_size <n>", "Page size")
    .option("--page_num <n>", "Page number")
    .option("--refresh", "Bypass cache")
    .action(async (opts) => {
      const flags: Record<string, string> = {};
      if (opts.search) flags.search = opts.search;
      if (opts.page_size) flags.page_size = opts.page_size;
      if (opts.page_num) flags.page_num = opts.page_num;

      const refresh = Boolean(opts.refresh);
      const query = buildQueryFromFlags(flags, ["search", "page_size", "page_num"]);
      const key = buildCacheKey("users:list", query);
      const cached = getCache(key, refresh);
      if (cached) {
        console.log(JSON.stringify(cached, null, 2));
        return;
      }
      const result = await cawplanRequest({
        method: "GET",
        path: "/api/v1/public/openapi/users",
        query,
      });
      setCache(key, result);
      console.log(JSON.stringify(result, null, 2));
    });

  users
    .command("query")
    .description("Query users by email or keyword")
    .option("--email <email>", "User email")
    .option("--keyword <q>", "Search keyword")
    .option("--page_size <n>", "Page size")
    .option("--page_num <n>", "Page number")
    .option("--refresh", "Bypass cache")
    .action(async (opts) => {
      if (!opts.email && !opts.keyword) {
        console.error("Error: users query requires --email or --keyword");
        process.exit(1);
      }

      const refresh = Boolean(opts.refresh);
      const key = buildCacheKey("users:query", {
        email: opts.email || "",
        keyword: opts.keyword || "",
        page_num: opts.page_num || "",
        page_size: opts.page_size || "",
      });
      const cached = getCache(key, refresh);
      if (cached) {
        console.log(JSON.stringify(cached, null, 2));
        return;
      }

      const body: Record<string, string> = {};
      if (opts.email) {
        body.email = opts.email;
      } else if (opts.keyword) {
        body.keyword = opts.keyword;
        if (opts.page_num) body.page_num = opts.page_num;
        if (opts.page_size) body.page_size = opts.page_size;
      }

      const result = await cawplanRequest({
        method: "POST",
        path: "/api/v1/public/openapi/users/query",
        body,
      });
      setCache(key, result);
      console.log(JSON.stringify(result, null, 2));
    });
}
