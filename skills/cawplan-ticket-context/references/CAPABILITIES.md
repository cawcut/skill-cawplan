# CawPlan Capabilities

<!-- Generated from references/capabilities.json by scripts/capabilities.py render. Do not edit. -->

Skills name **capabilities** (for example `tickets.search`), not a transport. Resolve each capability to the `cawplan` CLI or to the CawPlan MCP server with these rules.

## Choose a route (required, before the first capability call)

Check the routes in this order and use the first one that works. Keep the order even when CawPlan MCP tools are available in the session: the CLI is checked first.

1. **CLI**: if you have a shell tool (for example Bash), run `cawplan skill check` before any CawPlan MCP call (it verifies the CLI version and sign-in; checking PATH alone is not enough). If it exits 0, use the CLI route for the rest of the session and do not call CawPlan MCP tools.
2. **MCP**: only if you have no shell tool or the CLI check fails, and the session has CawPlan MCP tools (the tool name ends with the MCP tool below, for example `mcp__cawplan__search_tickets`), use the MCP route.
3. **Neither**: tell the user to either install and sign in to the CLI (`npm install -g cawplan`, then `cawplan auth login`) or connect the CawPlan MCP server, then stop.

If the chosen route has no implementation for a capability (`-` below), use the other route when it is available; otherwise tell the user the capability is not available in this environment. Never fall back to raw HTTP requests.

## Call a capability

- Use the exact argument spelling below (for example `--display_ids`, not `--display-ids`); each capability has a complete example for both routes.
- MCP route: path and query arguments are top-level; request-body fields go inside `body`.
- Both routes return the CawPlan Open API envelope `{"code", "msg", "data"}`. Any `code` other than `SUCCESS` is an error. Read results the same way on either route.
- A capability marked **write** changes data: confirm the target and content with the user before calling it, on either route.

## Capabilities

| Capability | Write | CLI | MCP tool | Summary |
|---|---|---|---|---|
| `backlog.create` | write | `cawplan tickets create-backlog` | `create_backlog_ticket` | Create a ticket in a product's backlog. description is the title; remarks is the HTML body. |
| `backlog.get` | read | `cawplan backlog get` | `get_backlog_ticket` | Get one backlog ticket's full detail. ticket_id is the ticket unique ID (resolve a display ID with tickets.search first). |
| `backlog.list` | read | `cawplan backlog list` | `list_backlog_tickets` | List a product's backlog tickets (tickets not planned into a version). Paginated. |
| `knowledge.datasets.list` | read | `cawplan knowledge datasets list` | `list_knowledge_datasets` | List knowledge datasets visible to the caller, optionally narrowed to one product. |
| `knowledge.documents.get` | read | `cawplan knowledge documents get` | `get_knowledge_document` | Get the full content of one knowledge document (knowledge search returns passages only). |
| `knowledge.documents.list` | read | `cawplan knowledge documents list` | `list_knowledge_documents` | List the documents in one knowledge dataset. |
| `labels.list` | read | `cawplan labels list` | `list_labels` | List ticket labels; resolve label names to label IDs. |
| `metrics.domains` | read | - | `list_key_metric_domains` | List key-metric domains and their metrics. MCP only: on the CLI route pick the domain from the metrics skill instead. |
| `metrics.query` | read | `cawplan metrics query` | `query_key_metrics` | Query business key metrics for one domain over a time window (RFC3339 start inclusive, end exclusive). |
| `product_lines.list` | read | `cawplan product-lines list` | `list_product_lines` | List product lines; resolve a product line name to product_line_id. |
| `products.analytics` | read | `cawplan analytics get` | `get_product_analytics` | Get one product's AI-categorized feedback analytics over a time range, optionally for one version. |
| `products.list` | read | `cawplan products list` | `list_products` | List products visible to the caller; resolve a product name to product_id. |
| `products.report` | read | `cawplan product-activity get` | `get_product_report` | Get a product's activity report for a date range (YYYY-MM-DD), optionally for one version. |
| `ticket_statuses.list` | read | `cawplan product-lines statuses` | `list_ticket_statuses` | List one product line's ticket workflow statuses in order, including custom statuses. |
| `tickets.search` | read | `cawplan tickets search` | `search_tickets` | Find tickets by display ID, unique ID or filters. Returns full ticket fields, including description (title), remarks (body) and progress_comment. |
| `todos.list` | read | `cawplan todos user` | `list_user_todos` | List one user's open work: assigned tickets and critical issues. |
| `users.me` | read | - | `get_current_user` | Get the signed-in user (resolve "me" to user_id). MCP only: on the CLI route read the `User ID:` line of the CLI auth status command instead. |
| `users.search` | read | `cawplan users query` | `search_users` | Find users by exact email or by keyword over name and email; resolve a person to user_id. |
| `versions.create` | write | `cawplan versions create` | `create_version` | Create a version in a product. |
| `versions.get` | read | `cawplan versions get` | `get_version` | Get one version's detail (status, dates, completion, risk). |
| `versions.list` | read | `cawplan versions list` | `list_versions` | List one product's versions; resolve a version name to version_id. |
| `versions.releases` | read | `cawplan releases list` | `get_version_releases` | Get a version's release history. |

## Arguments

### `backlog.create`

| Argument | CLI | MCP |
|---|---|---|
| `assignee_ids` | `--assignees <csv>` | `body.assignee_ids (array of strings)` |
| `description` | `--description <text>` | `body.description` |
| `label_ids` | `--label_ids <csv>` | `body.label_ids (array of strings)` |
| `parent_id` | `--parent_id <id>` | `body.parent_id` |
| `priority` | `--priority <p>` | `body.priority` |
| `product_id` | `<product_id>` | `product_id` |
| `remarks` | `--remarks <html>` | `body.remarks` |
| `type` | `--type <type>` | `body.type` |

Example:

- CLI: `cawplan tickets create-backlog <product_id> --description 'Login fails on Safari' --type BUGFIX`
- MCP: `create_backlog_ticket {"product_id": "<product_id>", "body": {"description": "Login fails on Safari", "type": "BUGFIX"}}`

### `backlog.get`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |
| `ticket_id` | `<ticket_id>` | `ticket_id` |

Example:

- CLI: `cawplan backlog get <product_id> <ticket_unique_id>`
- MCP: `get_backlog_ticket {"product_id": "<product_id>", "ticket_id": "<ticket_unique_id>"}`

### `backlog.list`

| Argument | CLI | MCP |
|---|---|---|
| `page_num` | `--page_num <n>` | `page_num` |
| `page_size` | `--page_size <n>` | `page_size` |
| `product_id` | `<product_id>` | `product_id` |

Example:

- CLI: `cawplan backlog list <product_id> --page_size 20`
- MCP: `list_backlog_tickets {"product_id": "<product_id>", "page_size": 20}`

### `knowledge.datasets.list`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `--product <id>` | `product_id` |

Example:

- CLI: `cawplan knowledge datasets list --product <product_id>`
- MCP: `list_knowledge_datasets {"product_id": "<product_id>"}`

### `knowledge.documents.get`

| Argument | CLI | MCP |
|---|---|---|
| `dataset_id` | `--dataset <id>` | `dataset_id` |
| `document_id` | `--document <id>` | `document_id` |

Example:

- CLI: `cawplan knowledge documents get --dataset <dataset_id> --document <document_id>`
- MCP: `get_knowledge_document {"dataset_id": "<dataset_id>", "document_id": "<document_id>"}`

### `knowledge.documents.list`

| Argument | CLI | MCP |
|---|---|---|
| `dataset_id` | `--dataset <id>` | `dataset_id` |
| `keyword` | `--keyword <text>` | `keyword` |

Example:

- CLI: `cawplan knowledge documents list --dataset <dataset_id>`
- MCP: `list_knowledge_documents {"dataset_id": "<dataset_id>"}`

### `labels.list`

| Argument | CLI | MCP |
|---|---|---|
| `page_num` | `--page_num <n>` | `page_num` |
| `page_size` | `--page_size <n>` | `page_size` |
| `product_id` | `--product_id <id>` | `product_id` |
| `search` | `--search <q>` | `search` |

Example:

- CLI: `cawplan labels list --search Bugfix`
- MCP: `list_labels {"search": "Bugfix"}`

### `metrics.domains`

| Argument | CLI | MCP |
|---|---|---|
| `end` | - | `end` |
| `start` | - | `start` |

Example:

- MCP: `list_key_metric_domains {}`

### `metrics.query`

| Argument | CLI | MCP |
|---|---|---|
| `domain` | `--domain <domain>` | `domain` |
| `end` | `--end <iso>` | `end` |
| `granularity` | `--granularity <g>` | `granularity` |
| `group_by` | `--group_by <keys>` | `group_by (array of strings)` |
| `limit` | `--limit <n>` | `limit` |
| `metric` | `--metric <metric>` | `metric` |
| `product_id` | `--product_id <id>` | `product_id` |
| `start` | `--start <iso>` | `start` |

Example:

- CLI: `cawplan metrics query --domain cawplan_ticket --start 2026-10-28T00:00:00Z --end 2026-11-04T00:00:00Z --granularity day`
- MCP: `query_key_metrics {"domain": "cawplan_ticket", "start": "2026-10-28T00:00:00Z", "end": "2026-11-04T00:00:00Z", "granularity": "day"}`

### `product_lines.list`

| Argument | CLI | MCP |
|---|---|---|
| `page_num` | `--page_num <n>` | `page_num` |
| `page_size` | `--page_size <n>` | `page_size` |

Example:

- CLI: `cawplan product-lines list --page_size 50`
- MCP: `list_product_lines {"page_size": 50}`

### `products.analytics`

| Argument | CLI | MCP |
|---|---|---|
| `end` | `--end <date>` | `end` |
| `product_id` | `<product_id>` | `product_id` |
| `start` | `--start <date>` | `start` |
| `time_range` | `--time_range <range>` | `time_range` |
| `version` | `--version <v>` | `version` |

Example:

- CLI: `cawplan analytics get <product_id> --time_range 1m`
- MCP: `get_product_analytics {"product_id": "<product_id>", "time_range": "1m"}`

### `products.list`

| Argument | CLI | MCP |
|---|---|---|
| `page_num` | `--page_num <n>` | `page_num` |
| `page_size` | `--page_size <n>` | `page_size` |
| `product_line_id` | `--product_line_id <id>` | `product_line_id` |
| `search` | `--search <q>` | `search` |

Example:

- CLI: `cawplan products list --search Access`
- MCP: `list_products {"search": "Access"}`

### `products.report`

| Argument | CLI | MCP |
|---|---|---|
| `end_date` | `--end <date>` | `end_date` |
| `product_id` | `--product_id <id>` | `product_id` |
| `start_date` | `--start <date>` | `start_date` |
| `version_id` | `--version_id <id>` | `version_id` |

Example:

- CLI: `cawplan product-activity get --product_id <product_id> --start 2026-10-28 --end 2026-11-04`
- MCP: `get_product_report {"product_id": "<product_id>", "start_date": "2026-10-28", "end_date": "2026-11-04"}`

### `ticket_statuses.list`

| Argument | CLI | MCP |
|---|---|---|
| `product_line_id` | `<product_line_id>` | `product_line_id` |

Example:

- CLI: `cawplan product-lines statuses <product_line_id>`
- MCP: `list_ticket_statuses {"product_line_id": "<product_line_id>"}`

### `tickets.search`

| Argument | CLI | MCP |
|---|---|---|
| `display_ids` | `--display_ids <csv>` | `body.display_ids (array of strings)` |
| `unique_ids` | `--unique_ids <csv>` | `body.unique_ids (array of strings)` |

Example:

- CLI: `cawplan tickets search --display_ids CWP-123,CAW-456`
- MCP: `search_tickets {"body": {"display_ids": ["CWP-123", "CAW-456"]}}`

### `todos.list`

| Argument | CLI | MCP |
|---|---|---|
| `issue_status` | `--issue_status <csv>` | `issue_status (comma-separated)` |
| `ticket_status` | `--ticket_status <csv>` | `ticket_status (comma-separated)` |
| `user_id` | `<user_id>` | `user_id` |

Example:

- CLI: `cawplan todos user <user_id>`
- MCP: `list_user_todos {"user_id": "<user_id>"}`

### `users.me`


Example:

- MCP: `get_current_user {}`

### `users.search`

| Argument | CLI | MCP |
|---|---|---|
| `email` | `--email <email>` | `body.email` |
| `keyword` | `--keyword <q>` | `body.keyword` |
| `page_num` | `--page_num <n>` | `body.page_num` |
| `page_size` | `--page_size <n>` | `body.page_size` |

Example:

- CLI: `cawplan users query --keyword alice`
- MCP: `search_users {"body": {"keyword": "alice"}}`

### `versions.create`

| Argument | CLI | MCP |
|---|---|---|
| `description` | `--description <text>` | `body.description` |
| `major_id` | `--major_id <id>` | `body.major_id` |
| `name` | `--name <version>` | `body.name` |
| `product_id` | `<product_id>` | `product_id` |

Example:

- CLI: `cawplan versions create <product_id> --name 1.2.0`
- MCP: `create_version {"product_id": "<product_id>", "body": {"name": "1.2.0"}}`

### `versions.get`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |
| `version_id` | `<version_id>` | `version_id` |

Example:

- CLI: `cawplan versions get <product_id> <version_id>`
- MCP: `get_version {"product_id": "<product_id>", "version_id": "<version_id>"}`

### `versions.list`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |

Example:

- CLI: `cawplan versions list <product_id>`
- MCP: `list_versions {"product_id": "<product_id>"}`

### `versions.releases`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |
| `version_id` | `<version_id>` | `version_id` |

Example:

- CLI: `cawplan releases list <product_id> <version_id>`
- MCP: `get_version_releases {"product_id": "<product_id>", "version_id": "<version_id>"}`
