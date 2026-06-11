import { Command } from "commander";
import { cawplanRequest } from "../lib/http.js";

export function registerKnowledgeCommand(program: Command): void {
  const knowledge = program.command("knowledge").description("Knowledge base operations");

  knowledge
    .command("search")
    .description("Search the knowledge base")
    .requiredOption("--query <text>", "Search query text")
    .option("--product_id <id>", "Optional product ID to scope the search")
    .option("--limit <n>", "Result limit (default 10)", "10")
    .action(async (opts) => {
      const body: Record<string, unknown> = {
        query: opts.query,
        limit: Number(opts.limit),
      };
      if (opts.product_id) body.product_id = opts.product_id;

      const result = await cawplanRequest({
        method: "POST",
        path: "/api/v1/public/openapi/knowledge/search",
        body,
      });
      console.log(JSON.stringify(result, null, 2));
    });
}
