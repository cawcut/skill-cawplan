# CawPlan Capabilities

<!-- Generated from references/capabilities.json by scripts/capabilities.py render. Do not edit. -->

Skills name **capabilities** (for example `tickets.search`), not a transport. Resolve each capability to the `cawplan` CLI or to the CawPlan MCP server with these rules.

This copy lists only the capabilities that `cawplan-ux-tracking` names (7 of 102). Every capability a CawPlan skill can use is in the repository's root `references/CAPABILITIES.md`.

## Choose a route (required, before the first capability call)

Check the routes in this order and use the first one that works. Keep the order even when CawPlan MCP tools are available in the session: the CLI is checked first.

1. **CLI**: if you have a shell tool (for example Bash), run `cawplan skill check` before any CawPlan MCP call (it verifies the CLI version and sign-in; checking PATH alone is not enough). If it exits 0, use the CLI route for the rest of the session and do not call CawPlan MCP tools. If it exits 3 (`CLI too old`: the installed skills need a newer CLI), do not switch routes silently: tell the user the required version and ask whether to run `cawplan upgrade`. If they agree, run it and then `cawplan skill check` again; if they decline or the upgrade fails, tell them the CLI stays out of date and go to step 2.
2. **MCP**: only if you have no shell tool or the CLI check fails, and the session has CawPlan MCP tools (the tool name ends with the MCP tool below, for example `mcp__cawplan__search_tickets`), use the MCP route.
3. **Neither**: tell the user to either install and sign in to the CLI (`npm install -g cawplan`, then `cawplan auth login`) or connect the CawPlan MCP server, then stop.

If the chosen route has no implementation for a capability (`-` below), use the other route when it is available; otherwise tell the user the capability is not available in this environment. Never fall back to raw HTTP requests.

## Call a capability

- Use the exact argument spelling below; some CLI options use underscores (`--display_ids`) and others hyphens (`--body-file`), so copy them as listed. Each capability has an example for both routes that shows the argument shapes; the skill's own preview and confirmation steps still apply before any write.
- MCP route: path and query arguments are top-level; request-body fields go inside `body`.
- Both routes return the CawPlan Open API envelope `{"code", "msg", "data"}` (list results also carry `total`, `page_num`, `page_size`). Any `code` other than `SUCCESS` is an error; on MCP an error may come back as a tool error carrying that envelope. Read results the same way on either route, except where a capability's summary says the CLI wraps the result (the `qa.*` capabilities) or prints plain text (`config.env`).
- A capability marked **write** changes data: confirm the target and content with the user before calling it, on either route.

## Capabilities

| Capability | Write | CLI | MCP tool | Summary |
|---|---|---|---|---|
| `product_lines.list` | read | `cawplan product-lines list` | `list_product_lines` | List product lines; resolve a product line name to product_line_id. |
| `products.list` | read | `cawplan products list` | `list_products` | List products visible to the caller; resolve a product name to product_id. MCP only: view=compact drops description, icon, links, knowledge datasets and member rosters; use it whenever you list more than a few products, and read one product's members (members.qas, members.designers, ...) with the default full view. |
| `tickets.changes` | read | `cawplan tickets changes` | `ticket_changes` | List ticket change events (status, ux, priority, assignees) in a window of at most 90 days for a scope (at least one of unique_ids, product_ids, product_line_ids, version_ids, parent_ids); at most 50 unique_ids per call. The CLI follows next_cursor for up to 20 pages; on MCP each call returns one page, so call again with cursor = next_cursor until there is none. truncated: true means the result is incomplete. |
| `tickets.history` | read | `cawplan tickets history` | `get_ticket_history` | Get one version ticket's change history. |
| `tickets.search` | read | `cawplan tickets search` | `search_tickets` | Find tickets by display ID, unique ID or filters. Returns full ticket fields, including description (title), remarks (body), progress_comment and links. A created-at window (time_range, or start_date + end_date) is required unless display_ids, unique_ids or parent_ids is set; updated_start_date/updated_end_date filter by last update. Paginated: page through using total. view=compact returns list fields only (IDs, description, status and status_display, priority, ux, product/version, parent, labels (name, behavior), assignees (user_id and name), qa_assignee_ids, module, dates) without rich text, links, relations or avatars; use tickets.get for one ticket's details. Use it whenever you list more than a few tickets: full rows are large enough to overflow a tool result. On the CLI it also prints one line per page and defaults page_size to 50; CLI releases before this change printed a reduced row without IDs. |
| `tickets.stats` | read | `cawplan tickets stats` | `ticket_stats` | Count tickets grouped server-side (priority, status, status_category, ux, assignee, label, type, product, version, platform; at most 2 dimensions), with the same filters as tickets.search. Result: data.total, and data.groups[] where each group has count and values[] (one {dimension, value} per group_by dimension). |
| `versions.list` | read | `cawplan versions list` | `list_versions` | List one product's versions; resolve a version name to version_id. |

## Arguments

### `product_lines.list`

| Argument | CLI | MCP |
|---|---|---|
| `page_num` | `--page_num <n>` | `page_num` |
| `page_size` | `--page_size <n>` | `page_size` |

Example:

- CLI: `cawplan product-lines list --page_size 50`
- MCP: `list_product_lines {"page_size": 50}`

### `products.list`

| Argument | CLI | MCP |
|---|---|---|
| `page_num` | `--page_num <n>` | `page_num` |
| `page_size` | `--page_size <n>` | `page_size` |
| `product_line_id` | `--product_line_id <id>` | `product_line_id` |
| `search` | `--search <q>` | `search` |
| `view` | - | `view` |

Example:

- CLI: `cawplan products list --search Access`
- MCP: `list_products {"search": "Access"}`

### `tickets.changes`

| Argument | CLI | MCP |
|---|---|---|
| `actor_ids` | `--actor_ids <csv>` | `body.actor_ids (array of strings)` |
| `cursor` | `--cursor <cursor>` | `cursor` |
| `end_date` | `--end_date <date>` | `end_date` |
| `fields` | `--fields <csv>` | `body.fields (array of strings)` |
| `group_by` | `--group_by <csv>` | `body.group_by (array of strings)` |
| `new_status_categories` | `--new_status_categories <csv>` | `body.new_status_categories (array of strings)` |
| `old_status_categories` | `--old_status_categories <csv>` | `body.old_status_categories (array of strings)` |
| `page_size` | `--page_size <n>` | `page_size` |
| `parent_ids` | `--parent_ids <csv>` | `body.parent_ids (array of strings)` |
| `product_ids` | `--product_ids <csv>` | `body.product_ids (array of strings)` |
| `product_line_ids` | `--product_line_ids <csv>` | `body.product_line_ids (array of strings)` |
| `start_date` | `--start_date <date>` | `start_date` |
| `unique_ids` | `--unique_ids <csv>` | `body.unique_ids (array of strings)` |
| `version_ids` | `--version_ids <csv>` | `body.version_ids (array of strings)` |

Example:

- CLI: `cawplan tickets changes --start_date 2026-11-01 --end_date 2026-11-04 --unique_ids <ticket_id> --fields status`
- MCP: `ticket_changes {"body": {"unique_ids": ["<ticket_id>"], "fields": ["status"]}, "start_date": "2026-11-01", "end_date": "2026-11-04"}`

### `tickets.history`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |
| `ticket_id` | `<ticket_id>` | `ticket_id` |
| `version_id` | `<version_id>` | `version_id` |

Example:

- CLI: `cawplan tickets history <product_id> <version_id> <ticket_id>`
- MCP: `get_ticket_history {"product_id": "<product_id>", "version_id": "<version_id>", "ticket_id": "<ticket_id>"}`

### `tickets.search`

| Argument | CLI | MCP |
|---|---|---|
| `assignees` | `--assignees <csv>` | `body.assignees (array of strings)` |
| `display_ids` | `--display_ids <csv>` | `body.display_ids (array of strings)` |
| `end_date` | `--end_date <date>` | `end_date` |
| `excluded_status` | `--excluded_status <csv>` | `body.excluded_status (array of strings)` |
| `excluded_status_categories` | `--excluded_status_categories <csv>` | `body.excluded_status_categories (array of strings)` |
| `label_ids` | `--label_ids <csv>` | `body.label_ids (array of strings)` |
| `label_names` | `--label_names <csv>` | `body.label_names (array of strings)` |
| `page_num` | `--page_num <n>` | `page_num` |
| `page_size` | `--page_size <n>` | `page_size` |
| `parent_ids` | `--parent_ids <csv>` | `body.parent_ids (array of strings)` |
| `platform` | `--platform <csv>` | `body.platform (array of strings)` |
| `priority` | `--priority <csv>` | `body.priority (array of strings)` |
| `product_ids` | `--product_ids <csv>` | `body.product_ids (array of strings)` |
| `product_line_ids` | `--product_line_ids <csv>` | `body.product_line_ids (array of strings)` |
| `search` | `--search <q>` | `body.search` |
| `start_date` | `--start_date <date>` | `start_date` |
| `status` | `--status <csv>` | `body.status (array of strings)` |
| `status_categories` | `--status_categories <csv>` | `body.status_categories (array of strings)` |
| `time_range` | `--time_range <range>` | `time_range` |
| `type` | `--type <csv>` | `body.type (array of strings)` |
| `unique_ids` | `--unique_ids <csv>` | `body.unique_ids (array of strings)` |
| `updated_end_date` | `--updated_end_date <date>` | `updated_end_date` |
| `updated_start_date` | `--updated_start_date <date>` | `updated_start_date` |
| `ux` | `--ux <csv>` | `body.ux (array of strings)` |
| `version_ids` | `--version_ids <csv>` | `body.version_ids (array of strings)` |
| `view` | `--view <mode>` | `view` |

Example:

- CLI: `cawplan tickets search --display_ids CWP-123,CAW-456`
- MCP: `search_tickets {"body": {"display_ids": ["CWP-123", "CAW-456"]}}`

### `tickets.stats`

| Argument | CLI | MCP |
|---|---|---|
| `assignees` | `--assignees <csv>` | `body.assignees (array of strings)` |
| `display_ids` | `--display_ids <csv>` | `body.display_ids (array of strings)` |
| `end_date` | `--end_date <date>` | `end_date` |
| `excluded_status` | `--excluded_status <csv>` | `body.excluded_status (array of strings)` |
| `excluded_status_categories` | `--excluded_status_categories <csv>` | `body.excluded_status_categories (array of strings)` |
| `group_by` | `--group_by <csv>` | `body.group_by (array of strings, at most 2)` |
| `label_ids` | `--label_ids <csv>` | `body.label_ids (array of strings)` |
| `label_names` | `--label_names <csv>` | `body.label_names (array of strings)` |
| `parent_ids` | `--parent_ids <csv>` | `body.parent_ids (array of strings)` |
| `platform` | `--platform <csv>` | `body.platform (array of strings)` |
| `priority` | `--priority <csv>` | `body.priority (array of strings)` |
| `product_ids` | `--product_ids <csv>` | `body.product_ids (array of strings)` |
| `product_line_ids` | `--product_line_ids <csv>` | `body.product_line_ids (array of strings)` |
| `search` | `--search <q>` | `body.search` |
| `start_date` | `--start_date <date>` | `start_date` |
| `status` | `--status <csv>` | `body.status (array of strings)` |
| `status_categories` | `--status_categories <csv>` | `body.status_categories (array of strings)` |
| `time_range` | `--time_range <range>` | `time_range` |
| `type` | `--type <csv>` | `body.type (array of strings)` |
| `unique_ids` | `--unique_ids <csv>` | `body.unique_ids (array of strings)` |
| `updated_end_date` | `--updated_end_date <date>` | `updated_end_date` |
| `updated_start_date` | `--updated_start_date <date>` | `updated_start_date` |
| `ux` | `--ux <csv>` | `body.ux (array of strings)` |
| `version_ids` | `--version_ids <csv>` | `body.version_ids (array of strings)` |

Example:

- CLI: `cawplan tickets stats --start_date 2000-01-01 --end_date 2026-11-04 --version_ids <version_id> --group_by assignee`
- MCP: `ticket_stats {"body": {"version_ids": ["<version_id>"], "group_by": ["assignee"]}, "start_date": "2000-01-01", "end_date": "2026-11-04"}`

### `versions.list`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |

Example:

- CLI: `cawplan versions list <product_id>`
- MCP: `list_versions {"product_id": "<product_id>"}`
