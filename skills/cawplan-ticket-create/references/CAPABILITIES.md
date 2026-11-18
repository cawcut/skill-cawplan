# CawPlan Capabilities

<!-- Generated from references/capabilities.json by scripts/capabilities.py render. Do not edit. -->

Skills name **capabilities** (for example `tickets.search`), not a transport. Resolve each capability to the `cawplan` CLI or to the CawPlan MCP server with these rules.

This copy lists only the capabilities that `cawplan-ticket-create` names (11 of 85). Every capability a CawPlan skill can use is in the repository's root `references/CAPABILITIES.md`.

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
| `backlog.create` | write | `cawplan tickets create-backlog` | `create_backlog_ticket` | Create a ticket in a product's backlog. description is the title; remarks is the HTML body. module_id: the CLI takes a module name, full path "Parent / Child" or id and resolves it; on MCP pass the module id (resolve a name with qa.module_tree.get first). |
| `labels.list` | read | `cawplan labels list` | `list_labels` | List ticket labels; resolve label names to label IDs. |
| `product_lines.list` | read | `cawplan product-lines list` | `list_product_lines` | List product lines; resolve a product line name to product_line_id. |
| `products.list` | read | `cawplan products list` | `list_products` | List products visible to the caller; resolve a product name to product_id. MCP only: view=compact drops description, icon, links, knowledge datasets and member rosters; use it whenever you list more than a few products, and read one product's members (members.qas, members.designers, ...) with the default full view. |
| `qa.module_tree.get` | read | `cawplan qa-insights module-tree get` | `get_product_module_tree` | Get a product's module tree; its node IDs scope QA requirements and test points. MCP only: expand = requirements or approvers adds that data to each node. CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `tickets.create` | write | `cawplan tickets create-version` | `create_ticket` | Create a ticket in a product version. description is the title; remarks is the HTML body. For a ticket outside any version use backlog.create. module_id: the CLI takes a module name, full path "Parent / Child" or id and resolves it; on MCP pass the module id (resolve a name with qa.module_tree.get first). |
| `tickets.search` | read | `cawplan tickets search` | `search_tickets` | Find tickets by display ID, unique ID or filters. Returns full ticket fields, including description (title), remarks (body), progress_comment and links. A created-at window (time_range, or start_date + end_date) is required unless display_ids, unique_ids or parent_ids is set; updated_start_date/updated_end_date filter by last update. Paginated: page through using total. view=compact returns list fields only (IDs, description, status and status_display, priority, ux, product/version, parent, labels (name, behavior), assignees (user_id and name), qa_assignee_ids, module, dates) without rich text, links, relations or avatars; use tickets.get for one ticket's details. Use it whenever you list more than a few tickets: full rows are large enough to overflow a tool result. On the CLI it also prints one line per page and defaults page_size to 50; CLI releases before this change printed a reduced row without IDs. |
| `tickets.update` | write | `cawplan tickets update` | `update_ticket` | Update a version ticket's fields (status, progress_comment, priority, assignees, labels, parent, due date, title/body, BUGFIX root_cause and solution), or move it with target_version_id. ticket_id is the ticket unique ID. Pass the ticket's current version as expected_version to use the optimistic lock (0 or omitted skips the check). module_id: the CLI takes a module name, full path "Parent / Child" or id and resolves it; on MCP pass the module id (resolve a name with qa.module_tree.get first). On MCP, null or an empty string clears the module; omitting it keeps the module. |
| `users.me` | read | `cawplan users me` | `get_current_user` | Get the signed-in user (resolve "me" to user_id): data.unique_id is the user_id, with email and name. A not-signed-in error means the route is not usable: follow "Neither" above instead of looking the user up by email. |
| `users.search` | read | `cawplan users query` | `search_users` | Find users by exact email or by keyword over name and email; resolve a person to user_id. CLI route: do not pass page_size or page_num (the CLI sends them as strings and the server answers BAD_REQUEST); use email or keyword only. |
| `versions.list` | read | `cawplan versions list` | `list_versions` | List one product's versions; resolve a version name to version_id. |

## Arguments

### `backlog.create`

| Argument | CLI | MCP |
|---|---|---|
| `assignee_ids` | `--assignees <csv>` | `body.assignee_ids (array of strings)` |
| `description` | `--description <text>` | `body.description` |
| `label_ids` | `--label_ids <csv>` | `body.label_ids (array of strings)` |
| `module_id` | `--module <name_or_id>` | `body.module_id` |
| `parent_id` | `--parent_id <id>` | `body.parent_id` |
| `priority` | `--priority <p>` | `body.priority` |
| `product_id` | `<product_id>` | `product_id` |
| `remarks` | `--remarks <html>` | `body.remarks` |
| `reporter_id` | `--reporter_id <id>` | `body.reporter_id` |
| `type` | `--type <type>` | `body.type` |

Example:

- CLI: `cawplan tickets create-backlog <product_id> --description 'Login fails on Safari' --type BUGFIX`
- MCP: `create_backlog_ticket {"product_id": "<product_id>", "body": {"description": "Login fails on Safari", "type": "BUGFIX"}}`

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

### `qa.module_tree.get`

| Argument | CLI | MCP |
|---|---|---|
| `expand` | - | `expand` |
| `product_id` | `<product_id>` | `product_id` |

Example:

- CLI: `cawplan qa-insights module-tree get <product_id>`
- MCP: `get_product_module_tree {"product_id": "<product_id>"}`

### `tickets.create`

| Argument | CLI | MCP |
|---|---|---|
| `assignee_ids` | `--assignees <csv>` | `body.assignee_ids (array of strings)` |
| `comment` | `--comment <text>` | `body.comment` |
| `description` | `--description <text>` | `body.description` |
| `due_date` | `--due_date <date>` | `body.due_date` |
| `label_ids` | `--label_ids <csv>` | `body.label_ids (array of strings)` |
| `module_id` | `--module <name_or_id>` | `body.module_id` |
| `parent_id` | `--parent_id <id>` | `body.parent_id` |
| `priority` | `--priority <p>` | `body.priority` |
| `product_id` | `<product_id>` | `product_id` |
| `remarks` | `--remarks <html>` | `body.remarks` |
| `reporter_id` | `--reporter_id <id>` | `body.reporter_id` |
| `status` | `--status <key>` | `body.status` |
| `type` | `--type <type>` | `body.type` |
| `version_id` | `<version_id>` | `version_id` |

Example:

- CLI: `cawplan tickets create-version <product_id> <version_id> --description 'Login fails on Safari' --type BUGFIX`
- MCP: `create_ticket {"product_id": "<product_id>", "version_id": "<version_id>", "body": {"description": "Login fails on Safari", "type": "BUGFIX"}}`

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

### `tickets.update`

| Argument | CLI | MCP |
|---|---|---|
| `assignee_ids` | `--assignees <csv>` | `body.assignee_ids (array of strings)` |
| `comment` | `--comment <text>` | `body.comment` |
| `description` | `--description <text>` | `body.description` |
| `due_date` | `--due_date <date>` | `body.due_date` |
| `expected_version` | `--expected_version <n>` | `body.version (integer)` |
| `label_ids` | `--label_ids <csv>` | `body.label_ids (array of strings)` |
| `module_id` | `--module <name_or_id>` | `body.module_id` |
| `parent_id` | `--parent_id <id>` | `body.parent_id` |
| `priority` | `--priority <p>` | `body.priority` |
| `product_id` | `<product_id>` | `product_id` |
| `progress_comment` | `--progress_comment <text>` | `body.progress_comment` |
| `remarks` | `--remarks <html>` | `body.remarks` |
| `root_cause` | `--root_cause <text>` | `body.root_cause` |
| `solution` | `--solution <text>` | `body.solution` |
| `status` | `--status <key>` | `body.status` |
| `target_version_id` | `--target_version_id <id>` | `body.version_id` |
| `ticket_id` | `<ticket_id>` | `ticket_id` |
| `version_id` | `<version_id>` | `version_id` |

Example:

- CLI: `cawplan tickets update <product_id> <version_id> <ticket_unique_id> --status IN_PROGRESS --progress_comment 'Started the fix'`
- MCP: `update_ticket {"product_id": "<product_id>", "version_id": "<version_id>", "ticket_id": "<ticket_unique_id>", "body": {"status": "IN_PROGRESS", "progress_comment": "Started the fix"}}`

### `users.me`


Example:

- CLI: `cawplan users me`
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

### `versions.list`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |

Example:

- CLI: `cawplan versions list <product_id>`
- MCP: `list_versions {"product_id": "<product_id>"}`
