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
] as const;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function userName(user: unknown): string | undefined {
  if (!isObject(user)) return undefined;
  const name = [user.first_name, user.last_name]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(" ")
    .trim();
  return name || undefined;
}

export function compactTicketRow(ticket: unknown): unknown {
  if (!isObject(ticket)) return ticket;
  const row: JsonObject = {};
  for (const field of PASSTHROUGH_FIELDS) {
    if (ticket[field] !== undefined) row[field] = ticket[field];
  }
  if (isObject(ticket.status_display) && typeof ticket.status_display.category === "string") {
    row.status_category = ticket.status_display.category;
  }
  if (Array.isArray(ticket.labels)) {
    row.labels = ticket.labels
      .map((label) => (isObject(label) ? label.name : undefined))
      .filter((name): name is string => typeof name === "string");
  }
  const reporter = userName(ticket.reporter);
  if (reporter !== undefined) row.reporter = reporter;
  if (Array.isArray(ticket.assignees)) {
    row.assignees = ticket.assignees
      .map(userName)
      .filter((name): name is string => name !== undefined);
  }
  return row;
}

/** Projects every row of a search envelope; envelope and paging fields stay intact. */
export function compactTicketSearchResult(result: unknown): unknown {
  if (!isObject(result) || !Array.isArray(result.data)) return result;
  return { ...result, data: result.data.map(compactTicketRow) };
}
