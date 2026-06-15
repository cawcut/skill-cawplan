import { Command } from "commander";
import { cawplanRequest } from "../lib/http.js";
import { getCache, setCache, buildCacheKey, buildScopedCacheKey, buildQueryFromFlags, csvToArray, stableStringify } from "../lib/cache.js";
import { resolveApiPath } from "../lib/products.js";


export function registerTicketsCommand(program: Command): void {
  const tickets = program.command("tickets").description("Manage tickets");

  tickets
    .command("list <product_id> <version_id>")
    .description("List tickets for a version")
    .requiredOption("--type <type>", "Ticket type: FEATURE|BUGFIX")
    .option("--page_size <n>", "Page size")
    .option("--page_num <n>", "Page number")
    .action(async (productId: string, versionId: string, opts) => {
      const flags: Record<string, string> = { type: opts.type };
      if (opts.page_size) flags.page_size = opts.page_size;
      if (opts.page_num) flags.page_num = opts.page_num;

      const query = buildQueryFromFlags(flags, ["type", "page_size", "page_num"]);
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/tickets`,
        query,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  tickets
    .command("get <product_id> <version_id> <ticket_id>")
    .description("Get a single version ticket")
    .action(async (productId: string, versionId: string, ticketId: string) => {
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/tickets/${ticketId}`,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  tickets
    .command("poll")
    .description("Poll tickets by status across products")
    .requiredOption("--status <csv>", "Ticket statuses (CSV)")
    .option("--product_ids <csv>", "Product IDs (CSV)")
    .option("--product_line_ids <csv>", "Product line IDs (CSV)")
    .option("--since_updated_at <ts>", "Unix timestamp filter")
    .option("--page_size <n>", "Page size")
    .option("--page_num <n>", "Page number")
    .action(async (opts) => {
      const status = csvToArray(opts.status);
      if (!status) {
        console.error("Error: tickets poll requires --status CSV");
        process.exit(1);
      }
      const body: Record<string, unknown> = { status };
      const productIds = csvToArray(opts.product_ids);
      const productLineIds = csvToArray(opts.product_line_ids);
      if (productIds) body.product_ids = productIds;
      if (productLineIds) body.product_line_ids = productLineIds;
      if (opts.since_updated_at !== undefined) body.since_updated_at = Number(opts.since_updated_at);
      if (opts.page_num !== undefined) body.page_num = Number(opts.page_num);
      if (opts.page_size !== undefined) body.page_size = Number(opts.page_size);

      const result = await cawplanRequest({
        method: "POST",
        path: resolveApiPath("/api/v1/public/openapi/tickets/poll"),
        body,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  tickets
    .command("search")
    .description("Search tickets")
    .option("--time_range <range>", "Time range (e.g. 1m, 3m)")
    .option("--start_date <date>", "Start date YYYY-MM-DD")
    .option("--end_date <date>", "End date YYYY-MM-DD")
    .option("--product_ids <csv>", "Product IDs")
    .option("--product_line_ids <csv>", "Product line IDs")
    .option("--version_ids <csv>", "Version IDs")
    .option("--unique_ids <csv>", "Ticket unique IDs")
    .option("--display_ids <csv>", "Ticket display IDs")
    .option("--parent_ids <csv>", "Parent ticket IDs")
    .option("--type <csv>", "Ticket types")
    .option("--status <csv>", "Ticket statuses")
    .option("--priority <csv>", "Priorities")
    .option("--platform <csv>", "Platforms")
    .option("--assignees <csv>", "Assignees")
    .option("--search <q>", "Search query")
    .option("--page_size <n>", "Page size")
    .option("--page_num <n>", "Page number")
    .option("--refresh", "Bypass cache")
    .action(async (opts) => {
      const uniqueIds = csvToArray(opts.unique_ids);
      const displayIds = csvToArray(opts.display_ids);
      const parentIds = csvToArray(opts.parent_ids);
      const idLookup = Boolean(uniqueIds || displayIds || parentIds);

      if (!idLookup && !opts.time_range && !(opts.start_date && opts.end_date)) {
        console.error("Error: tickets search requires --time_range or --start_date + --end_date (unless --unique_ids/--display_ids/--parent_ids is set)");
        process.exit(1);
      }

      const refresh = Boolean(opts.refresh);
      const flags: Record<string, string> = {};
      if (opts.time_range) flags.time_range = opts.time_range;
      if (opts.start_date) flags.start_date = opts.start_date;
      if (opts.end_date) flags.end_date = opts.end_date;
      if (opts.page_size) flags.page_size = opts.page_size;
      if (opts.page_num) flags.page_num = opts.page_num;
      const query = buildQueryFromFlags(flags, ["time_range", "start_date", "end_date", "page_size", "page_num"]);

      const body: Record<string, unknown> = {};
      const productIds = csvToArray(opts.product_ids);
      const productLineIds = csvToArray(opts.product_line_ids);
      const versionIds = csvToArray(opts.version_ids);
      const type = csvToArray(opts.type);
      const status = csvToArray(opts.status);
      const priority = csvToArray(opts.priority);
      const platform = csvToArray(opts.platform);
      const assignees = csvToArray(opts.assignees);
      if (productIds) body.product_ids = productIds;
      if (productLineIds) body.product_line_ids = productLineIds;
      if (versionIds) body.version_ids = versionIds;
      if (uniqueIds) body.unique_ids = uniqueIds;
      if (displayIds) body.display_ids = displayIds;
      if (parentIds) body.parent_ids = parentIds;
      if (type) body.type = type;
      if (status) body.status = status;
      if (priority) body.priority = priority;
      if (platform) body.platform = platform;
      if (assignees) body.assignees = assignees;
      if (opts.search) body.search = opts.search;

      const key = await buildScopedCacheKey(
        `tickets:search:${buildCacheKey("query", query)}|body=${stableStringify(body)}`,
        undefined,
      );
      const cached = getCache(key, refresh);
      if (cached) {
        console.log(JSON.stringify(cached, null, 2));
        return;
      }

      const result = await cawplanRequest({
        method: "POST",
        path: resolveApiPath("/api/v1/public/openapi/tickets/search"),
        query,
        body,
      });
      setCache(key, result);
      console.log(JSON.stringify(result, null, 2));
    });

  tickets
    .command("batch-create <product_id>")
    .description("Batch-create tickets under a product")
    .requiredOption("--tickets <json>", "JSON array of ticket objects")
    .action(async (productId: string, opts) => {
      let tickets: unknown[];
      try {
        tickets = JSON.parse(opts.tickets);
        if (!Array.isArray(tickets)) throw new Error("must be an array");
      } catch (e) {
        console.error(`Error: --tickets must be a valid JSON array: ${(e as Error).message}`);
        process.exit(1);
      }
      const result = await cawplanRequest({
        method: "POST",
        path: `/api/v1/public/openapi/product/${productId}/tickets/batch`,
        body: { tickets },
      });
      console.log(JSON.stringify(result, null, 2));
    });

  tickets
    .command("create-version <product_id> <version_id>")
    .description("Create a version ticket")
    .requiredOption("--description <text>", "Ticket description")
    .option("--type <type>", "Ticket type: FEATURE|BUGFIX")
    .option("--priority <p>", "Priority: LOW|MEDIUM|HIGH|CRITICAL")
    .option("--status <key>", "Status key")
    .option("--assignees <csv>", "Assignee IDs (CSV)")
    .option("--parent_id <id>", "Parent ticket ID")
    .option("--label_ids <csv>", "Label IDs (CSV)")
    .option("--reporter_id <id>", "Reporter user ID")
    .option("--due_date <date>", "Due date YYYY-MM-DD")
    .option("--comment <text>", "Comment")
    .action(async (productId: string, versionId: string, opts) => {
      const body: Record<string, unknown> = { description: opts.description };
      if (opts.type) body.type = opts.type;
      if (opts.priority) body.priority = opts.priority;
      if (opts.status) body.status = opts.status;
      if (opts.parent_id) body.parent_id = opts.parent_id;
      if (opts.reporter_id) body.reporter_id = opts.reporter_id;
      if (opts.due_date) body.due_date = opts.due_date;
      if (opts.comment) body.comment = opts.comment;
      const assignees = csvToArray(opts.assignees);
      if (assignees) body.assignee_ids = assignees;
      const labelIds = csvToArray(opts.label_ids);
      if (labelIds) body.label_ids = labelIds;

      const result = await cawplanRequest({
        method: "POST",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/tickets`,
        body,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  tickets
    .command("create-backlog <product_id>")
    .description("Create a backlog ticket (not assigned to any version)")
    .requiredOption("--description <text>", "Ticket description")
    .option("--type <type>", "Ticket type: FEATURE|BUGFIX")
    .option("--priority <p>", "Priority: LOW|MEDIUM|HIGH|CRITICAL")
    .option("--status <key>", "Status key")
    .option("--assignees <csv>", "Assignee IDs (CSV)")
    .option("--parent_id <id>", "Parent ticket ID")
    .option("--label_ids <csv>", "Label IDs (CSV)")
    .option("--reporter_id <id>", "Reporter user ID")
    .option("--due_date <date>", "Due date YYYY-MM-DD")
    .option("--comment <text>", "Comment")
    .action(async (productId: string, opts) => {
      const body: Record<string, unknown> = { description: opts.description };
      if (opts.type) body.type = opts.type;
      if (opts.priority) body.priority = opts.priority;
      if (opts.status) body.status = opts.status;
      if (opts.parent_id) body.parent_id = opts.parent_id;
      if (opts.reporter_id) body.reporter_id = opts.reporter_id;
      if (opts.due_date) body.due_date = opts.due_date;
      if (opts.comment) body.comment = opts.comment;
      const assignees = csvToArray(opts.assignees);
      if (assignees) body.assignee_ids = assignees;
      const labelIds = csvToArray(opts.label_ids);
      if (labelIds) body.label_ids = labelIds;

      const result = await cawplanRequest({
        method: "POST",
        path: `/api/v1/public/openapi/product/${productId}/tickets`,
        body,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  tickets
    .command("update <product_id> <version_id> <ticket_id>")
    .description("Update a ticket")
    .option("--status <key>", "Status key")
    .option("--progress_comment <text>", "Progress comment")
    .option("--priority <p>", "Priority")
    .option("--description <text>", "Description")
    .option("--comment <text>", "Comment")
    .option("--parent_id <id>", "Parent ticket ID")
    .option("--due_date <date>", "Due date YYYY-MM-DD")
    .option("--assignees <csv>", "Assignee IDs (CSV)")
    .option("--label_ids <csv>", "Label IDs (CSV)")
    .option("--expected_version <n>", "Optimistic lock version")
    .action(async (productId: string, versionId: string, ticketId: string, opts) => {
      const body: Record<string, unknown> = {};
      if (opts.status) body.status = opts.status;
      if (opts.progress_comment !== undefined) body.progress_comment = opts.progress_comment;
      if (opts.priority) body.priority = opts.priority;
      if (opts.description !== undefined) body.description = opts.description;
      if (opts.comment !== undefined) body.comment = opts.comment;
      if (opts.parent_id) body.parent_id = opts.parent_id;
      if (opts.due_date) body.due_date = opts.due_date;
      const assignees = csvToArray(opts.assignees);
      if (assignees) body.assignee_ids = assignees;
      const labelIds = csvToArray(opts.label_ids);
      if (labelIds) body.label_ids = labelIds;
      const hasExpectedVersion = opts.expected_version !== undefined;
      if (hasExpectedVersion) body.version = Number(opts.expected_version);

      if (Object.keys(body).length === 0) {
        console.error("Error: tickets update requires at least one updatable flag");
        process.exit(1);
      }

      try {
        const result = await cawplanRequest({
          method: "PUT",
          path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/tickets/${ticketId}`,
          body,
        });
        console.log(JSON.stringify(result, null, 2));
      } catch (err: unknown) {
        const apiErr = err as { status?: number };
        if (hasExpectedVersion && apiErr?.status === 409) {
          console.error(`Conflict: ticket was modified since version ${opts.expected_version}. Re-read and retry with the latest --expected_version.`);
          process.exit(1);
        }
        throw err;
      }
    });

  // Ticket relations sub-commands
  const relate = tickets.command("relate").description("Manage ticket relations");

  relate
    .command("create <product_id> <version_id> <ticket_id>")
    .description("Create a relation")
    .requiredOption("--target <ticket_uid>", "Target ticket UID")
    .requiredOption("--type <type>", "Relation type: RELATED|BLOCKING|BLOCKED_BY|DUPLICATE")
    .action(async (productId: string, versionId: string, ticketId: string, opts) => {
      const result = await cawplanRequest({
        method: "POST",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/tickets/${ticketId}/relations`,
        body: { target_ticket_id: opts.target, relation_type: opts.type },
      });
      console.log(JSON.stringify(result, null, 2));
    });

  relate
    .command("update <product_id> <version_id> <ticket_id> <relation_id>")
    .description("Update a relation")
    .requiredOption("--type <type>", "Relation type")
    .action(async (productId: string, versionId: string, ticketId: string, relationId: string, opts) => {
      const result = await cawplanRequest({
        method: "PUT",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/tickets/${ticketId}/relations/${relationId}`,
        body: { relation_type: opts.type },
      });
      console.log(JSON.stringify(result, null, 2));
    });

  relate
    .command("delete <product_id> <version_id> <ticket_id> <relation_id>")
    .description("Delete a relation")
    .action(async (productId: string, versionId: string, ticketId: string, relationId: string) => {
      const result = await cawplanRequest({
        method: "DELETE",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/tickets/${ticketId}/relations/${relationId}`,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  relate
    .command("list <product_id> <version_id> <ticket_id>")
    .description("List relations for a ticket")
    .action(async (productId: string, versionId: string, ticketId: string) => {
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/tickets/${ticketId}/relations`,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  // Backlog commands
  const backlog = program.command("backlog").description("Manage product backlog");

  backlog
    .command("list <product_id>")
    .description("List backlog tickets")
    .option("--page_size <n>", "Page size")
    .option("--page_num <n>", "Page number")
    .action(async (productId: string, opts) => {
      const flags: Record<string, string> = {};
      if (opts.page_size) flags.page_size = opts.page_size;
      if (opts.page_num) flags.page_num = opts.page_num;
      const query = buildQueryFromFlags(flags, ["page_size", "page_num"]);
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/tickets`,
        query,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  backlog
    .command("get <product_id> <ticket_id>")
    .description("Get a backlog ticket")
    .action(async (productId: string, ticketId: string) => {
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/tickets/${ticketId}`,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  // Labels
  const labels = program.command("labels").description("Manage labels");

  labels
    .command("list")
    .description("List labels")
    .option("--search <q>", "Search query")
    .option("--product_id <id>", "Filter by product ID")
    .option("--page_size <n>", "Page size")
    .option("--page_num <n>", "Page number")
    .option("--refresh", "Bypass cache")
    .action(async (opts) => {
      const flags: Record<string, string> = {};
      if (opts.search) flags.search = opts.search;
      if (opts.product_id) flags.product_id = opts.product_id;
      if (opts.page_size) flags.page_size = opts.page_size;
      if (opts.page_num) flags.page_num = opts.page_num;

      const refresh = Boolean(opts.refresh);
      const query = buildQueryFromFlags(flags, ["search", "product_id", "page_size", "page_num"]);
      const key = await buildScopedCacheKey("labels:list", query);
      const cached = getCache(key, refresh);
      if (cached) {
        console.log(JSON.stringify(cached, null, 2));
        return;
      }
      const result = await cawplanRequest({
        method: "GET",
        path: "/api/v1/public/openapi/labels",
        query,
      });
      setCache(key, result);
      console.log(JSON.stringify(result, null, 2));
    });
}
