/**
 * Compact projection for `tickets search --view compact`.
 *
 * A full search row carries detail-only fields (remarks, root_cause, solution,
 * progress comments, avatar-bearing user objects), so a 50-row page is ~150KB.
 * Hosted agents read search pages under a 64KB tool budget; the compact row keeps
 * only what a ticket list needs and leaves details to `tickets get`.
 */

type JsonObject = Record<string, unknown>;

export const TICKET_SEARCH_VIEWS = ["full", "compact"] as const;

export type TicketSearchView = (typeof TICKET_SEARCH_VIEWS)[number];

export function isTicketSearchView(value: string): value is TicketSearchView {
  return (TICKET_SEARCH_VIEWS as readonly string[]).includes(value);
}

/** Compact rows are ~0.5KB, so a 50-row page stays well under the hosted budget. */
export const COMPACT_TICKET_PAGE_SIZE = 50;

// Same field set as the server's `view=compact` (example-backend), so a
// compact row reads the same on the CLI and MCP routes and against servers
// that ignore the parameter. Duplicates are left out: assignee IDs are in
// assignees[].user_id, and label IDs are only needed to filter, which the
// server does from label_ids.
const PASSTHROUGH_FIELDS = [
  "unique_id",
  "display_id",
  "description",
  "status",
  "priority",
  "ux",
  "product_id",
  "version_id",
  "version_name",
  "parent_id",
  "is_backlog",
  "created_at",
  "updated_at",
  "due_date",
  "qa_assignee_ids",
  "reporter_id",
  "module_id",
  "module_name",
  "sub_issue_count",
] as const;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick(source: JsonObject, keys: readonly string[]): JsonObject {
  const out: JsonObject = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

export function compactTicketRow(ticket: unknown): unknown {
  if (!isObject(ticket)) return ticket;
  const row = pick(ticket, PASSTHROUGH_FIELDS);
  if (isObject(ticket.status_display)) {
    row.status_display = pick(ticket.status_display, ["category", "display_name"]);
  }
  if (Array.isArray(ticket.labels)) {
    row.labels = ticket.labels.filter(isObject).map((label) => pick(label, ["name", "behavior"]));
  }
  if (Array.isArray(ticket.assignees)) {
    row.assignees = ticket.assignees
      .filter(isObject)
      .map((user) => pick(user, ["user_id", "first_name", "last_name"]));
  }
  return row;
}

/** Projects every row of a search envelope; envelope and paging fields stay intact. */
export function compactTicketSearchResult(result: unknown): unknown {
  if (!isObject(result) || !Array.isArray(result.data)) return result;
  return { ...result, data: result.data.map(compactTicketRow) };
}
