import { cawplanRequest } from "./http.js";
import { buildQueryFromFlags, csvToArray } from "./cache.js";
import { resolveApiPath } from "./products.js";

/**
 * Flag/option shapes shared by `tickets search` and `tickets stats`. Both
 * commands send the same filters so the server applies one set of semantics.
 */
export interface TicketFilterOptions {
  time_range?: string;
  start_date?: string;
  end_date?: string;
  updated_start_date?: string;
  updated_end_date?: string;
  product_ids?: string;
  product_line_ids?: string;
  version_ids?: string;
  unique_ids?: string;
  display_ids?: string;
  parent_ids?: string;
  type?: string;
  label_ids?: string;
  label_names?: string;
  status?: string;
  excluded_status?: string;
  ux?: string;
  status_categories?: string;
  excluded_status_categories?: string;
  priority?: string;
  platform?: string;
  assignees?: string;
  search?: string;
}

export const TICKET_FILTER_QUERY_KEYS = [
  "time_range",
  "start_date",
  "end_date",
  "updated_start_date",
  "updated_end_date",
] as const;

const TICKET_FILTER_BODY_KEYS = [
  "product_ids",
  "product_line_ids",
  "version_ids",
  "unique_ids",
  "display_ids",
  "parent_ids",
  "type",
  "label_ids",
  "label_names",
  "status",
  "excluded_status",
  "ux",
  "status_categories",
  "excluded_status_categories",
  "priority",
  "platform",
  "assignees",
] as const;

export const TICKET_STATS_DIMENSIONS = [
  "priority",
  "status",
  "status_category",
  "ux",
  "assignee",
  "label",
  "type",
  "product",
  "version",
  "platform",
] as const;

export const TICKET_CHANGE_FIELDS = ["status", "ux", "priority", "assignees"] as const;

export const TICKET_CHANGE_GROUP_DIMENSIONS = [
  "actor",
  "field",
  "new_status_category",
  "new_value",
  "ticket",
] as const;

/** Maximum group_by dimensions accepted by both endpoints. */
export const MAX_GROUP_BY_DIMENSIONS = 2;

/** Pages `tickets changes` follows before stopping and reporting `truncated`. */
export const TICKET_CHANGES_MAX_PAGES = 20;

/** Returns an error message when a ticket filter request is unbounded. */
export function validateTicketFilterWindow(opts: TicketFilterOptions, command: string): string | undefined {
  const idLookup = Boolean(csvToArray(opts.unique_ids) || csvToArray(opts.display_ids) || csvToArray(opts.parent_ids));
  if (!idLookup && !opts.time_range && !(opts.start_date && opts.end_date)) {
    return `Error: ${command} requires --time_range or --start_date + --end_date (unless --unique_ids/--display_ids/--parent_ids is set)`;
  }
  if (opts.updated_end_date && !opts.updated_start_date) {
    return "Error: --updated_end_date requires --updated_start_date";
  }
  return undefined;
}

export function buildTicketFilterQuery(opts: TicketFilterOptions): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const key of TICKET_FILTER_QUERY_KEYS) {
    const value = opts[key];
    if (value) flags[key] = value;
  }
  return flags;
}

export function buildTicketFilterBody(opts: TicketFilterOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of TICKET_FILTER_BODY_KEYS) {
    const values = csvToArray(opts[key]);
    if (values) body[key] = values;
  }
  if (opts.search) body.search = opts.search;
  return body;
}

/**
 * Parses a `--group_by` CSV and checks it against the allowed dimensions.
 * Returns the dimensions or an error message.
 */
export function parseGroupBy(
  value: string | undefined,
  allowed: readonly string[],
): { dimensions?: string[]; error?: string } {
  const dimensions = csvToArray(value);
  if (!dimensions) return {};
  const unknown = dimensions.filter((dimension) => !allowed.includes(dimension));
  if (unknown.length) {
    return { error: `Error: unknown --group_by value(s): ${unknown.join(", ")}. Allowed: ${allowed.join(", ")}` };
  }
  if (new Set(dimensions).size !== dimensions.length) {
    return { error: "Error: --group_by must not repeat a dimension" };
  }
  if (dimensions.length > MAX_GROUP_BY_DIMENSIONS) {
    return { error: `Error: --group_by accepts at most ${MAX_GROUP_BY_DIMENSIONS} dimensions` };
  }
  return { dimensions };
}

export interface TicketStatsOptions extends TicketFilterOptions {
  group_by?: string;
}

/** Builds the POST /tickets/stats request, or returns a validation error. */
export function buildTicketStatsRequest(
  opts: TicketStatsOptions,
): { request?: { query?: Record<string, string>; body: Record<string, unknown> }; error?: string } {
  const windowError = validateTicketFilterWindow(opts, "tickets stats");
  if (windowError) return { error: windowError };
  const groupBy = parseGroupBy(opts.group_by, TICKET_STATS_DIMENSIONS);
  if (groupBy.error) return { error: groupBy.error };
  if (!groupBy.dimensions) {
    return { error: `Error: tickets stats requires --group_by (${TICKET_STATS_DIMENSIONS.join("|")})` };
  }
  const body = buildTicketFilterBody(opts);
  body.group_by = groupBy.dimensions;
  const query = buildQueryFromFlags(buildTicketFilterQuery(opts), [...TICKET_FILTER_QUERY_KEYS]);
  return { request: { query, body } };
}

export async function requestTicketStats(request: {
  query?: Record<string, string>;
  body: Record<string, unknown>;
}): Promise<unknown> {
  return cawplanRequest({
    method: "POST",
    path: resolveApiPath("/api/v1/public/openapi/tickets/stats"),
    query: request.query,
    body: request.body,
  });
}

export interface TicketChangesOptions {
  start_date?: string;
  end_date?: string;
  product_ids?: string;
  product_line_ids?: string;
  version_ids?: string;
  parent_ids?: string;
  unique_ids?: string;
  fields?: string;
  actor_ids?: string;
  new_status_categories?: string;
  old_status_categories?: string;
  group_by?: string;
  page_size?: string;
  cursor?: string;
}

export interface TicketChangesRequest {
  query: Record<string, string>;
  body: Record<string, unknown>;
  grouped: boolean;
}

const TICKET_CHANGES_SCOPE_KEYS = [
  "product_ids",
  "product_line_ids",
  "version_ids",
  "parent_ids",
  "unique_ids",
] as const;

const TICKET_CHANGES_EVENT_FILTER_KEYS = [
  "actor_ids",
  "new_status_categories",
  "old_status_categories",
] as const;

/** Builds the POST /tickets/changes request, or returns a validation error. */
export function buildTicketChangesRequest(opts: TicketChangesOptions): { request?: TicketChangesRequest; error?: string } {
  if (!opts.start_date || !opts.end_date) {
    return { error: "Error: tickets changes requires --start_date and --end_date (YYYY-MM-DD, at most 90 days)" };
  }
  const body: Record<string, unknown> = {};
  for (const key of TICKET_CHANGES_SCOPE_KEYS) {
    const values = csvToArray(opts[key]);
    if (values) body[key] = values;
  }
  if (!TICKET_CHANGES_SCOPE_KEYS.some((key) => body[key])) {
    return {
      error:
        "Error: tickets changes requires at least one of --product_ids, --product_line_ids, --version_ids, --parent_ids, --unique_ids",
    };
  }

  const fields = csvToArray(opts.fields);
  if (fields) {
    const unknown = fields.filter((field) => !(TICKET_CHANGE_FIELDS as readonly string[]).includes(field));
    if (unknown.length) {
      return { error: `Error: unknown --fields value(s): ${unknown.join(", ")}. Allowed: ${TICKET_CHANGE_FIELDS.join(", ")}` };
    }
    body.fields = fields;
  }
  for (const key of TICKET_CHANGES_EVENT_FILTER_KEYS) {
    const values = csvToArray(opts[key]);
    if (values) body[key] = values;
  }

  const groupBy = parseGroupBy(opts.group_by, TICKET_CHANGE_GROUP_DIMENSIONS);
  if (groupBy.error) return { error: groupBy.error };
  if (groupBy.dimensions) body.group_by = groupBy.dimensions;

  const query: Record<string, string> = { start_date: opts.start_date, end_date: opts.end_date };
  if (opts.page_size) query.page_size = opts.page_size;
  if (opts.cursor) query.cursor = opts.cursor;
  return { request: { query, body, grouped: Boolean(groupBy.dimensions) } };
}

interface Envelope {
  code?: string;
  msg?: string;
  data?: Record<string, unknown> | null;
}

function isSuccess(result: unknown): result is Envelope {
  return Boolean(result) && typeof result === "object" && (result as Envelope).code === "SUCCESS";
}

type ChangesRequester = (query: Record<string, string>, body: Record<string, unknown>) => Promise<unknown>;

const defaultChangesRequester: ChangesRequester = (query, body) =>
  cawplanRequest({
    method: "POST",
    path: resolveApiPath("/api/v1/public/openapi/tickets/changes"),
    query,
    body,
  });

/**
 * Fetches ticket changes. Grouped requests are a single call. Event requests
 * follow `next_cursor` for up to `maxPages` pages and merge `events` and the
 * `tickets` map; the CLI does no counting or filtering of its own. When pages
 * remain after `maxPages`, the result carries `truncated: true` and the
 * `next_cursor` to resume with `--cursor`. A non-SUCCESS page is returned as-is.
 */
export async function fetchTicketChanges(
  request: TicketChangesRequest,
  options: { maxPages?: number; requester?: ChangesRequester } = {},
): Promise<unknown> {
  const requester = options.requester ?? defaultChangesRequester;
  if (request.grouped) {
    return requester(request.query, request.body);
  }

  const maxPages = options.maxPages ?? TICKET_CHANGES_MAX_PAGES;
  const events: unknown[] = [];
  const tickets: Record<string, unknown> = {};
  let cursor: string | undefined = request.query.cursor;
  let pages = 0;
  let last: Envelope | undefined;

  while (pages < maxPages) {
    const query = { ...request.query };
    if (cursor) query.cursor = cursor;
    else delete query.cursor;
    const result = await requester(query, request.body);
    if (!isSuccess(result)) return result;
    last = result;
    pages += 1;
    const data = result.data ?? {};
    if (Array.isArray(data.events)) events.push(...data.events);
    if (data.tickets && typeof data.tickets === "object") {
      Object.assign(tickets, data.tickets as Record<string, unknown>);
    }
    cursor = typeof data.next_cursor === "string" && data.next_cursor ? data.next_cursor : undefined;
    if (!cursor) break;
  }

  return {
    code: last?.code ?? "SUCCESS",
    msg: last?.msg ?? "success",
    data: {
      events,
      tickets,
      next_cursor: cursor ?? null,
      truncated: Boolean(cursor),
      pages,
    },
  };
}
