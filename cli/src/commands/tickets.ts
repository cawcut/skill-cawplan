import path from "node:path";
import { Command } from "commander";
import { cawplanRequest } from "../lib/http.js";
import { getCache, setCache, buildScopedCacheKey, buildQueryFromFlags, csvToArray } from "../lib/cache.js";
import { resolveApiPath } from "../lib/products.js";
import { resolveProductId, resolveVersionId, resolveUserIds } from "../lib/resolve.js";
import { resolveTicketIdArg } from "../lib/resolve-ticket-id.js";
import { normalizeTicketDetailFieldsCsv } from "../lib/ticket-detail-fields.js";
import {
  TICKET_ATTACHMENT_TYPES,
  defaultAttachmentOutDir,
  downloadTicketAttachments,
  filterTicketAttachments,
  parseAttachmentTypesCsv,
  requestTicketAttachments,
  unwrapTicketAttachmentList,
  type TicketAttachmentScope,
} from "../lib/ticket-attachments.js";
import { checkUploadFile, uploadTicketAttachmentFiles } from "../lib/ticket-attachment-upload.js";
import { REPORT_FIELDS, REPORT_MODES, type ReportField, type ReportMode } from "../lib/ticket-html-report.js";
import { addTicketAttachments } from "../lib/ticket-attachment-add.js";
import type { ContentSource } from "../lib/ticket-attachment-source.js";
import {
  TICKET_CHANGE_FIELDS,
  TICKET_CHANGE_GROUP_DIMENSIONS,
  TICKET_FILTER_QUERY_KEYS,
  TICKET_STATS_DIMENSIONS,
  buildTicketChangesRequest,
  buildTicketFilterBody,
  buildTicketFilterQuery,
  buildTicketStatsRequest,
  fetchTicketChanges,
  requestTicketStats,
  validateTicketFilterWindow,
} from "../lib/ticket-insights.js";

export interface GetVersionTicketOptions {
  /** CSV sparse fieldset; omit for full enrich (labels, children, relations, …). */
  fields?: string;
}

/** GET version ticket detail via OpenAPI (full enrich when `fields` omitted). */
export async function getVersionTicket(
  productId: string,
  versionId: string,
  ticketId: string,
  options?: GetVersionTicketOptions,
): Promise<unknown> {
  const uniqueTicketId = await resolveTicketIdArg(ticketId, { productId, versionId });
  const flags: Record<string, string> = {};
  if (options?.fields !== undefined) {
    flags.fields = normalizeTicketDetailFieldsCsv(options.fields);
  }
  const query = buildQueryFromFlags(flags, ["fields"]);

  return cawplanRequest({
    method: "GET",
    path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/tickets/${uniqueTicketId}`,
    query,
  });
}

function collectRepeated(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/**
 * `<parent> attachments list|download` for files embedded in a ticket's rich-text
 * fields. Version tickets take `<product_id> <version_id> <ticket_id>`; backlog
 * tickets take `<product_id> <ticket_id>`.
 */
function registerAttachmentsCommands(parent: Command, opts: { backlog: boolean }): void {
  const args = opts.backlog ? "<product_id> <ticket_id>" : "<product_id> <version_id> <ticket_id>";
  const scopeFrom = (positional: string[], expiresIn?: string): TicketAttachmentScope =>
    opts.backlog
      ? { productId: positional[0]!, ticketId: positional[1]!, expiresIn }
      : { productId: positional[0]!, versionId: positional[1]!, ticketId: positional[2]!, expiresIn };
  const positionalCount = opts.backlog ? 2 : 3;

  const attachments = parent
    .command("attachments")
    .description(
      "List, download, upload or add files attached to a ticket (description, remarks, comment, ...). " +
        "upload/add are version tickets only.",
    );

  attachments
    .command(`list ${args}`)
    .description("List ticket attachments with short-lived presigned download URLs")
    .option("--expires_in <seconds>", "Presigned URL lifetime in seconds (default 900, max 3600)")
    .action(async (...actionArgs: unknown[]) => {
      const positional = actionArgs.slice(0, positionalCount) as string[];
      const cmdOpts = actionArgs[positionalCount] as { expires_in?: string };
      const result = await requestTicketAttachments(scopeFrom(positional, cmdOpts.expires_in));
      console.log(JSON.stringify(result, null, 2));
    });

  attachments
    .command(`download ${args}`)
    .description(
      "Download ticket attachments to a local directory and print a JSON summary (path, bytes, sha256). " +
        "Default directory: ./cawplan-attachments/<display_id>/",
    )
    .option("--key <key>", "Only download this attachment key (repeatable; see 'attachments list')", collectRepeated, [])
    .option("--type <csv>", `Only download these types: ${TICKET_ATTACHMENT_TYPES.join(",")}`)
    .option("--out <dir>", "Output directory")
    .option("--expires_in <seconds>", "Presigned URL lifetime in seconds (default 900, max 3600)")
    .action(async (...actionArgs: unknown[]) => {
      const positional = actionArgs.slice(0, positionalCount) as string[];
      const cmdOpts = actionArgs[positionalCount] as {
        key: string[];
        type?: string;
        out?: string;
        expires_in?: string;
      };

      let types: string[] | undefined;
      try {
        types = cmdOpts.type !== undefined ? parseAttachmentTypesCsv(cmdOpts.type) : undefined;
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }

      const list = unwrapTicketAttachmentList(
        await requestTicketAttachments(scopeFrom(positional, cmdOpts.expires_in)),
      );
      const selected = filterTicketAttachments(list.attachments, { keys: cmdOpts.key, types });
      const unknownKeys = cmdOpts.key.filter((k) => !list.attachments.some((a) => a.key === k));
      if (unknownKeys.length > 0) {
        console.error(`Error: attachment key not found on this ticket: ${unknownKeys.join(", ")}`);
        process.exit(1);
      }

      const outDir = cmdOpts.out ?? defaultAttachmentOutDir(list);
      if (selected.length === 0) {
        console.error(
          list.attachments.length === 0
            ? "No attachments on this ticket."
            : "No attachments match the given --key/--type filters.",
        );
      }
      const summary = await downloadTicketAttachments(list, selected, outDir, {
        onProgress: (msg) => console.error(msg),
      });
      console.log(JSON.stringify(summary, null, 2));
      if (summary.failed.length > 0) process.exit(1);
    });

  // Uploads need ticket-edit access and a ticket update to embed the file;
  // the Open API only offers that for version tickets.
  if (opts.backlog) return;

  attachments
    .command(`upload ${args}`)
    .description(
      "Upload local files to a ticket's attachment storage and print each file's URL and editor HTML snippet. " +
        "Nothing is written to the ticket: the files only show there once that HTML is saved into a field " +
        "(use 'attachments add' to do both in one step).",
    )
    .requiredOption("--file <path>", "Local file to upload (repeatable)", collectRepeated, [])
    .option("--concurrency <n>", "Parallel uploads", "4")
    .option("--dry-run", "Only list the files that would be uploaded and the ones refused; upload nothing")
    .action(async (...actionArgs: unknown[]) => {
      const positional = actionArgs.slice(0, positionalCount) as string[];
      const cmdOpts = actionArgs[positionalCount] as { file: string[]; concurrency: string; dryRun?: boolean };
      const [productId, versionId, ticketId] = positional as [string, string, string];
      if (cmdOpts.dryRun) {
        const files: Array<{ path: string; filename: string; bytes: number }> = [];
        const refused: Array<{ path: string; filename: string; error: string }> = [];
        for (const f of cmdOpts.file) {
          const abs = path.resolve(f);
          const filename = path.basename(abs);
          try {
            files.push({ path: abs, filename, bytes: await checkUploadFile(abs) });
          } catch (err) {
            refused.push({ path: abs, filename, error: err instanceof Error ? err.message : String(err) });
          }
        }
        console.log(JSON.stringify({ dry_run: true, files, refused }, null, 2));
        if (refused.length > 0) process.exit(1);
        return;
      }
      const uniqueTicketId = await resolveTicketIdArg(ticketId, { productId, versionId });
      const result = await uploadTicketAttachmentFiles(
        { productId, versionId, ticketId: uniqueTicketId },
        cmdOpts.file.map((f) => ({ path: path.resolve(f) })),
        { concurrency: parsePositiveInt(cmdOpts.concurrency, "--concurrency"), onProgress: (msg) => console.error(msg) },
      );
      console.log(JSON.stringify({ ticket_id: uniqueTicketId, ...result }, null, 2));
      if (result.failed.length > 0) process.exit(1);
    });

  attachments
    .command(`add ${args}`)
    .description(
      "Add local files to a ticket in one update: upload them, embed them as editor attachments " +
        "(image / video / PDF / file) and save the result into --field. Give exactly one content source: " +
        "--file (repeatable), --dir, --md-file or --html-file; --note adds Markdown text before it. " +
        "Nothing is written to the ticket if a file is missing or an upload fails.",
    )
    .option("--file <path>", "Local file to add (repeatable; embedded in the given order)", collectRepeated, [])
    .option(
      "--dir <path>",
      "Directory: optional README.md/index.md/summary.md intro, one section per subdirectory " +
        "(its *.md notes, then its other files in name order), loose root files listed at the end",
    )
    .option("--md-file <path>", "Markdown document (![](shots/a.png), [rec](rec/a.mp4)); references resolve relative to its directory")
    .option("--html-file <path>", "HTML document; local <img src>/<a href>/<video src>/data-src references resolve relative to its directory")
    .option("--note <markdown>", "Markdown text shown before the files (local references resolve against the current directory)")
    .option("--field <field>", `Ticket field to write: ${REPORT_FIELDS.join("|")}`, "progress_comment")
    .option(
      "--mode <mode>",
      "append: add a block (replacing an earlier block with the same --block-id); replace: overwrite the whole field",
      "append",
    )
    .option(
      "--block-id <id>",
      "Block id; re-adding with the same id replaces that block " +
        "(default: --dir/--md-file/--html-file name, so re-running syncs it; --file: attach-<timestamp>, so each run appends)",
    )
    .option("--base-dir <dir>", "Directory to resolve references against for --md-file/--html-file (default: the file's directory)")
    .option(
      "--allow-outside-base",
      "Allow --dir/--md-file/--html-file/--note references outside their base directory " +
        "(absolute paths, ../, file: URLs or symlinks leading out); credential files (~/.ssh, ~/.aws, ~/.cawplan, .env) are always refused",
    )
    .option("--concurrency <n>", "Parallel uploads", "4")
    .option("--html-out <path>", "Also write the final HTML to this local file")
    .option("--dry-run", "Only list the files and missing references; upload nothing and do not update the ticket")
    .action(async (...actionArgs: unknown[]) => {
      const positional = actionArgs.slice(0, positionalCount) as string[];
      const cmdOpts = actionArgs[positionalCount] as {
        file: string[];
        dir?: string;
        mdFile?: string;
        htmlFile?: string;
        note?: string;
        field: string;
        mode: string;
        blockId?: string;
        baseDir?: string;
        allowOutsideBase?: boolean;
        concurrency: string;
        htmlOut?: string;
        dryRun?: boolean;
      };
      const [productId, versionId, ticketId] = positional as [string, string, string];

      if (!(REPORT_FIELDS as readonly string[]).includes(cmdOpts.field)) {
        console.error(`Error: --field must be one of ${REPORT_FIELDS.join(", ")}`);
        process.exit(1);
      }
      if (!(REPORT_MODES as readonly string[]).includes(cmdOpts.mode)) {
        console.error(`Error: --mode must be one of ${REPORT_MODES.join(", ")}`);
        process.exit(1);
      }
      const sources: ContentSource[] = [
        ...(cmdOpts.file.length > 0 ? [{ kind: "files" as const, paths: cmdOpts.file }] : []),
        ...(cmdOpts.dir ? [{ kind: "dir" as const, path: cmdOpts.dir }] : []),
        ...(cmdOpts.mdFile ? [{ kind: "md" as const, path: cmdOpts.mdFile }] : []),
        ...(cmdOpts.htmlFile ? [{ kind: "html" as const, path: cmdOpts.htmlFile }] : []),
      ];
      if (sources.length !== 1) {
        console.error("Error: give exactly one of --file, --dir, --md-file or --html-file");
        process.exit(1);
      }
      if (cmdOpts.baseDir && !cmdOpts.mdFile && !cmdOpts.htmlFile) {
        console.error("Error: --base-dir only applies to --md-file/--html-file");
        process.exit(1);
      }

      const uniqueTicketId = await resolveTicketIdArg(ticketId, { productId, versionId });
      const summary = await addTicketAttachments(
        { productId, versionId, ticketId: uniqueTicketId },
        {
          source: sources[0]!,
          note: cmdOpts.note,
          field: cmdOpts.field as ReportField,
          mode: cmdOpts.mode as ReportMode,
          blockId: cmdOpts.blockId,
          baseDir: cmdOpts.baseDir,
          allowOutsideBase: Boolean(cmdOpts.allowOutsideBase),
          htmlOut: cmdOpts.htmlOut,
          dryRun: Boolean(cmdOpts.dryRun),
          concurrency: parsePositiveInt(cmdOpts.concurrency, "--concurrency"),
          onProgress: (msg) => console.error(msg),
        },
      );
      console.log(JSON.stringify(summary, null, 2));
      const outside = summary.blocked.filter((b) => b.reason === "outside_base");
      const sensitive = summary.blocked.filter((b) => b.reason === "sensitive");
      if (summary.missing.length > 0) {
        console.error(`Error: ${summary.missing.length} local file(s) not found: ${summary.missing.map((m) => m.ref).join(", ")}`);
      }
      if (sensitive.length > 0) {
        console.error(`Error: refused ${sensitive.length} credential file(s): ${sensitive.map((b) => b.path).join(", ")}`);
      }
      if (outside.length > 0) {
        console.error(
          `Error: ${outside.length} reference(s) point outside the base directory: ${outside.map((b) => b.path).join(", ")} ` +
            "(move them under it, or pass --allow-outside-base if they are meant to be attached)",
        );
      }
      if (summary.missing.length > 0 || summary.blocked.length > 0) process.exit(1);
      if (summary.failed.length > 0) {
        console.error(`Error: ${summary.failed.length} upload(s) failed; the ticket was not updated`);
        process.exit(1);
      }
    });
}

function parsePositiveInt(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`Error: ${flag} must be a positive integer`);
    process.exit(1);
  }
  return n;
}

/** Filter options shared by `tickets search` and `tickets stats`. */
function addTicketFilterOptions(command: Command): Command {
  return command
    .option("--time_range <range>", "Time range (e.g. 1m, 3m)")
    .option("--start_date <date>", "Start date YYYY-MM-DD (filters ticket creation time, not last-updated)")
    .option("--end_date <date>", "End date YYYY-MM-DD (filters ticket creation time, not last-updated)")
    .option("--updated_start_date <date>", "Start date YYYY-MM-DD for an independent filter on last-updated time; finds tickets changed in this window regardless of when created")
    .option("--updated_end_date <date>", "End date YYYY-MM-DD for the last-updated filter; must be paired with --updated_start_date")
    .option("--product_ids <csv>", "Product IDs")
    .option("--product_line_ids <csv>", "Product line IDs")
    .option("--version_ids <csv>", "Version IDs")
    .option("--unique_ids <csv>", "Ticket unique IDs")
    .option("--display_ids <csv>", "Ticket display IDs")
    .option("--parent_ids <csv>", "Parent ticket IDs")
    .option("--type <csv>", "Deprecated legacy ticket types; prefer --label_ids or --label_names")
    .option("--label_ids <csv>", "Label IDs")
    .option("--label_names <csv>", "Label names")
    .option("--status <csv>", "Ticket statuses")
    .option("--excluded_status <csv>", "Statuses to exclude")
    .option("--ux <csv>", "UX states: NOT_REQUIRED|PENDING|READY")
    .option("--status_categories <csv>", "Status categories: BACKLOG|UNSTARTED|STARTED|TESTING|COMPLETE|CANCELED|JIRA")
    .option("--excluded_status_categories <csv>", "Status categories to exclude")
    .option("--priority <csv>", "Priorities")
    .option("--platform <csv>", "Platforms")
    .option("--assignees <csv>", "Assignees")
    .option("--search <q>", "Search query");
}

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
    .description(
      "Get a version ticket with full detail (labels, children, parent, relations, product_line, ai_sessions, qa_reports)",
    )
    .option(
      "--fields <csv>",
      "Sparse fieldset: labels,children,relations,product_line,ai_sessions,qa_reports (default: all enrich groups)",
    )
    .action(async (productId: string, versionId: string, ticketId: string, opts) => {
      try {
        const result = await getVersionTicket(productId, versionId, ticketId, {
          fields: opts.fields,
        });
        console.log(JSON.stringify(result, null, 2));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.startsWith("invalid fields")) {
          console.error(`Error: ${message}`);
          process.exit(1);
        }
        throw err;
      }
    });

  tickets
    .command("history <product_id> <version_id> <ticket_id>")
    .description("Get version ticket history")
    .action(async (productId: string, versionId: string, ticketId: string) => {
      const uniqueTicketId = await resolveTicketIdArg(ticketId, { productId, versionId });
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/tickets/${uniqueTicketId}/history`,
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

  addTicketFilterOptions(tickets.command("search").description("Search tickets"))
    .option("--page_size <n>", "Page size")
    .option("--page_num <n>", "Page number")
    .action(async (opts) => {
      const windowError = validateTicketFilterWindow(opts, "tickets search");
      if (windowError) {
        console.error(windowError);
        process.exit(1);
      }

      const flags = buildTicketFilterQuery(opts);
      if (opts.page_size) flags.page_size = opts.page_size;
      if (opts.page_num) flags.page_num = opts.page_num;
      const query = buildQueryFromFlags(flags, [...TICKET_FILTER_QUERY_KEYS, "page_size", "page_num"]);
      const body = buildTicketFilterBody(opts);

      const result = await cawplanRequest({
        method: "POST",
        path: resolveApiPath("/api/v1/public/openapi/tickets/search"),
        query,
        body,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  addTicketFilterOptions(
    tickets
      .command("stats")
      .description(
        "Count tickets matching the tickets search filters, grouped by one or two dimensions (server-side aggregation)",
      ),
  )
    .option("--group_by <csv>", `Dimensions (max 2): ${TICKET_STATS_DIMENSIONS.join("|")}`)
    .action(async (opts) => {
      const { request, error } = buildTicketStatsRequest(opts);
      if (error || !request) {
        console.error(error);
        process.exit(1);
      }
      const result = await requestTicketStats(request);
      console.log(JSON.stringify(result, null, 2));
    });

  tickets
    .command("changes")
    .description(
      "List ticket field-change events (status/ux/priority/assignees) in a date window in bulk, or their server-side group counts",
    )
    .option("--start_date <date>", "First day YYYY-MM-DD of the change window (inclusive)")
    .option("--end_date <date>", "Last day YYYY-MM-DD of the change window (inclusive, window at most 90 days)")
    .option("--product_ids <csv>", "Product IDs")
    .option("--product_line_ids <csv>", "Product line IDs")
    .option("--version_ids <csv>", "Version IDs")
    .option("--parent_ids <csv>", "Parent ticket IDs")
    .option("--unique_ids <csv>", "Ticket unique IDs")
    .option("--fields <csv>", `Changed fields (default status): ${TICKET_CHANGE_FIELDS.join("|")}`)
    .option("--actor_ids <csv>", "Only changes made by these user IDs")
    .option("--new_status_categories <csv>", "Only status changes into these categories (e.g. COMPLETE,TESTING)")
    .option("--old_status_categories <csv>", "Only status changes out of these categories")
    .option("--group_by <csv>", `Return counts instead of events (max 2): ${TICKET_CHANGE_GROUP_DIMENSIONS.join("|")}`)
    .option("--page_size <n>", "Events per page (max 1000)")
    .option("--cursor <cursor>", "Resume from a previous next_cursor")
    .action(async (opts) => {
      const { request, error } = buildTicketChangesRequest(opts);
      if (error || !request) {
        console.error(error);
        process.exit(1);
      }
      const result = await fetchTicketChanges(request);
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
    .command("create-version [product_id] [version_id]")
    .description("Create a version ticket. Use --product/--version for name-based resolution (no prior lookup needed).")
    .option("--product <name>", "Product name (resolves to product_id automatically)")
    .option("--ver <name>", "Version name e.g. 4.3.1 (resolves to version_id automatically)")
    .requiredOption("--description <text>", "Ticket title/summary (server description field; not page body/remarks)")
    .option("--remarks <html>", "Ticket page body/remarks (HTML supported)")
    .option("--type <type>", "Ticket type: FEATURE|BUGFIX")
    .option("--priority <p>", "Priority: LOW|MEDIUM|HIGH|CRITICAL")
    .option("--status <key>", "Status key")
    .option("--assignees <csv>", "Assignee IDs (CSV)")
    .option("--assignee <csv>", "Assignee emails (CSV) — resolved to IDs automatically")
    .option("--parent_id <id>", "Parent ticket unique ID or display ID (e.g. CWP-14556) — creates a sub-ticket")
    .option("--label_ids <csv>", "Label IDs (CSV)")
    .option("--reporter_id <id>", "Reporter user ID")
    .option("--reporter <email>", "Reporter email — resolved to user ID automatically")
    .option("--due_date <date>", "Due date YYYY-MM-DD")
    .option("--comment <text>", "Comment")
    .action(async (productIdArg: string | undefined, versionIdArg: string | undefined, opts) => {
      // Resolve product: --product name takes precedence over positional arg
      const rawProduct = opts.product ?? productIdArg;
      if (!rawProduct) {
        console.error("Error: product required — use --product <name> or pass <product_id> as positional arg");
        process.exit(1);
      }
      const rawVersion = opts.ver ?? versionIdArg;
      if (!rawVersion) {
        console.error("Error: version required — use --version <name> or pass <version_id> as positional arg");
        process.exit(1);
      }

      // Resolve names → IDs in parallel where possible
      const [productId, reporterId] = await Promise.all([
        resolveProductId(rawProduct),
        opts.reporter ? resolveUserIds([opts.reporter]).then((ids) => ids[0]) : Promise.resolve(opts.reporter_id as string | undefined),
      ]);
      const versionId = await resolveVersionId(productId, rawVersion);
      const parentId = opts.parent_id ? await resolveTicketIdArg(opts.parent_id) : undefined;

      const body: Record<string, unknown> = { description: opts.description };
      if (opts.remarks !== undefined) body.remarks = opts.remarks;
      if (opts.type) body.type = opts.type;
      if (opts.priority) body.priority = opts.priority;
      if (opts.status) body.status = opts.status;
      if (parentId) body.parent_id = parentId;
      if (reporterId) body.reporter_id = reporterId;
      if (opts.due_date) body.due_date = opts.due_date;
      if (opts.comment) body.comment = opts.comment;

      // Assignees: email list or ID list
      const assigneeEmails = csvToArray(opts.assignee);
      const assigneeIds = csvToArray(opts.assignees);
      if (assigneeEmails) {
        body.assignee_ids = await resolveUserIds(assigneeEmails);
      } else if (assigneeIds) {
        body.assignee_ids = assigneeIds;
      }

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
    .command("create-backlog [product_id]")
    .description("Create a backlog ticket (not assigned to any version). Use --product for name-based resolution.")
    .option("--product <name>", "Product name (resolves to product_id automatically)")
    .requiredOption("--description <text>", "Ticket title/summary (server description field; not page body/remarks)")
    .option("--remarks <html>", "Ticket page body/remarks (HTML supported)")
    .option("--type <type>", "Ticket type: FEATURE|BUGFIX")
    .option("--priority <p>", "Priority: LOW|MEDIUM|HIGH|CRITICAL")
    .option("--status <key>", "Status key")
    .option("--assignees <csv>", "Assignee IDs (CSV)")
    .option("--assignee <csv>", "Assignee emails (CSV) — resolved to IDs automatically")
    .option("--parent_id <id>", "Parent ticket unique ID or display ID (e.g. CWP-14556) — creates a sub-ticket")
    .option("--label_ids <csv>", "Label IDs (CSV)")
    .option("--reporter_id <id>", "Reporter user ID")
    .option("--reporter <email>", "Reporter email — resolved to user ID automatically")
    .option("--due_date <date>", "Due date YYYY-MM-DD")
    .option("--comment <text>", "Comment")
    .action(async (productIdArg: string | undefined, opts) => {
      const rawProduct = opts.product ?? productIdArg;
      if (!rawProduct) {
        console.error("Error: product required — use --product <name> or pass <product_id> as positional arg");
        process.exit(1);
      }

      const [productId, reporterId] = await Promise.all([
        resolveProductId(rawProduct),
        opts.reporter ? resolveUserIds([opts.reporter]).then((ids) => ids[0]) : Promise.resolve(opts.reporter_id as string | undefined),
      ]);
      const parentId = opts.parent_id ? await resolveTicketIdArg(opts.parent_id) : undefined;

      const body: Record<string, unknown> = { description: opts.description };
      if (opts.remarks !== undefined) body.remarks = opts.remarks;
      if (opts.type) body.type = opts.type;
      if (opts.priority) body.priority = opts.priority;
      if (opts.status) body.status = opts.status;
      if (parentId) body.parent_id = parentId;
      if (reporterId) body.reporter_id = reporterId;
      if (opts.due_date) body.due_date = opts.due_date;
      if (opts.comment) body.comment = opts.comment;

      const assigneeEmails = csvToArray(opts.assignee);
      const assigneeIds = csvToArray(opts.assignees);
      if (assigneeEmails) {
        body.assignee_ids = await resolveUserIds(assigneeEmails);
      } else if (assigneeIds) {
        body.assignee_ids = assigneeIds;
      }

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
    .option("--target_version_id <id>", "Move ticket to target version ID")
    .option("--target-ver <name>", "Move ticket to target version name (resolves to version_id automatically)")
    .option("--description <text>", "Ticket title/summary (server description field; not page body/remarks)")
    .option("--remarks <html>", "Ticket page body/remarks (HTML supported)")
    .option("--comment <text>", "Comment")
    .option("--root_cause <text>", "Root cause analysis (BUGFIX type only)")
    .option("--solution <text>", "Solution description (BUGFIX type only)")
    .option("--parent_id <id>", "Parent ticket ID")
    .option("--due_date <date>", "Due date YYYY-MM-DD")
    .option("--assignees <csv>", "Assignee IDs (CSV)")
    .option("--label_ids <csv>", "Label IDs (CSV)")
    .option("--expected_version <n>", "Optimistic lock version")
    .action(async (productId: string, versionId: string, ticketId: string, opts) => {
      const uniqueTicketId = await resolveTicketIdArg(ticketId, { productId, versionId });
      const body: Record<string, unknown> = {};
      const targetVersionId = opts.target_version_id
        ?? (opts.targetVer ? await resolveVersionId(productId, opts.targetVer) : undefined);
      if (opts.status) body.status = opts.status;
      if (opts.progress_comment !== undefined) body.progress_comment = opts.progress_comment;
      if (opts.priority) body.priority = opts.priority;
      if (targetVersionId) body.version_id = targetVersionId;
      if (opts.description !== undefined) body.description = opts.description;
      if (opts.remarks !== undefined) body.remarks = opts.remarks;
      if (opts.comment !== undefined) body.comment = opts.comment;
      if (opts.root_cause !== undefined) body.root_cause = opts.root_cause;
      if (opts.solution !== undefined) body.solution = opts.solution;
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
          path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/tickets/${uniqueTicketId}`,
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
      const uniqueTicketId = await resolveTicketIdArg(ticketId, { productId, versionId });
      const result = await cawplanRequest({
        method: "POST",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/tickets/${uniqueTicketId}/relations`,
        body: { target_ticket_id: opts.target, relation_type: opts.type },
      });
      console.log(JSON.stringify(result, null, 2));
    });

  relate
    .command("update <product_id> <version_id> <ticket_id> <relation_id>")
    .description("Update a relation")
    .requiredOption("--type <type>", "Relation type")
    .action(async (productId: string, versionId: string, ticketId: string, relationId: string, opts) => {
      const uniqueTicketId = await resolveTicketIdArg(ticketId, { productId, versionId });
      const result = await cawplanRequest({
        method: "PUT",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/tickets/${uniqueTicketId}/relations/${relationId}`,
        body: { relation_type: opts.type },
      });
      console.log(JSON.stringify(result, null, 2));
    });

  relate
    .command("delete <product_id> <version_id> <ticket_id> <relation_id>")
    .description("Delete a relation")
    .action(async (productId: string, versionId: string, ticketId: string, relationId: string) => {
      const uniqueTicketId = await resolveTicketIdArg(ticketId, { productId, versionId });
      const result = await cawplanRequest({
        method: "DELETE",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/tickets/${uniqueTicketId}/relations/${relationId}`,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  relate
    .command("list <product_id> <version_id> <ticket_id>")
    .description("List relations for a ticket")
    .action(async (productId: string, versionId: string, ticketId: string) => {
      const uniqueTicketId = await resolveTicketIdArg(ticketId, { productId, versionId });
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/tickets/${uniqueTicketId}/relations`,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  registerAttachmentsCommands(tickets, { backlog: false });

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
      const uniqueTicketId = await resolveTicketIdArg(ticketId, { productId });
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/tickets/${uniqueTicketId}`,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  registerAttachmentsCommands(backlog, { backlog: true });

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
