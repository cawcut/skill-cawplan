import { Command } from "commander";
import { cawplanRequest } from "../lib/http.js";
import { buildQueryFromFlags } from "../lib/cache.js";

export function registerTodosCommand(program: Command): void {
  const todos = program.command("todos").description("Manage todos");

  todos
    .command("user <user_id>")
    .description("Get todos for a user")
    .option("--ticket_status <csv>", "Ticket status filter (CSV)")
    .option("--issue_status <csv>", "Issue status filter (CSV)")
    .action(async (userId: string, opts) => {
      const flags: Record<string, string> = {};
      if (opts.ticket_status) flags.ticket_status = opts.ticket_status;
      if (opts.issue_status) flags.issue_status = opts.issue_status;

      const query = buildQueryFromFlags(flags, ["ticket_status", "issue_status"]);
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/todos/users/${userId}`,
        query,
      });
      console.log(JSON.stringify(result, null, 2));
    });
}
