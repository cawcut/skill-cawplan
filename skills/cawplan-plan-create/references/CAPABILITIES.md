# CawPlan Capabilities

<!-- Generated from references/capabilities.json by scripts/capabilities.py render. Do not edit. -->

Skills name **capabilities** (for example `tickets.search`), not a transport. Resolve each capability to the `cawplan` CLI or to the CawPlan MCP server with these rules.

This copy lists only the capabilities that `cawplan-plan-create` names (7 of 102). Every capability a CawPlan skill can use is in the repository's root `references/CAPABILITIES.md`.

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
| `backlog.list` | read | `cawplan backlog list` | `list_backlog_tickets` | List a product's backlog tickets (tickets not planned into a version). Paginated. |
| `products.list` | read | `cawplan products list` | `list_products` | List products visible to the caller; resolve a product name to product_id. MCP only: view=compact drops description, icon, links, knowledge datasets and member rosters; use it whenever you list more than a few products, and read one product's members (members.qas, members.designers, ...) with the default full view. |
| `tickets.create` | write | `cawplan tickets create-version` | `create_ticket` | Create a ticket in a product version. description is the title; remarks is the HTML body. For a ticket outside any version use backlog.create. module_id: the CLI takes a module name, full path "Parent / Child" or id and resolves it; on MCP pass the module id (resolve a name with qa.module_tree.get first). |
| `tickets.update` | write | `cawplan tickets update` | `update_ticket` | Update a version ticket's fields (status, progress_comment, priority, assignees, labels, parent, due date, title/body, BUGFIX root_cause and solution), or move it with target_version_id. ticket_id is the ticket unique ID. Pass the ticket's current version as expected_version to use the optimistic lock (0 or omitted skips the check). module_id: the CLI takes a module name, full path "Parent / Child" or id and resolves it; on MCP pass the module id (resolve a name with qa.module_tree.get first). On MCP, null or an empty string clears the module; omitting it keeps the module. |
| `users.search` | read | `cawplan users query` | `search_users` | Find users by exact email or by keyword over name and email; resolve a person to user_id. CLI route: do not pass page_size or page_num (the CLI sends them as strings and the server answers BAD_REQUEST); use email or keyword only. |
| `versions.create` | write | `cawplan versions create` | `create_version` | Create a version in a product. |
| `versions.list` | read | `cawplan versions list` | `list_versions` | List one product's versions; resolve a version name to version_id. |

## Arguments

### `backlog.list`

| Argument | CLI | MCP |
|---|---|---|
| `page_num` | `--page_num <n>` | `page_num` |
| `page_size` | `--page_size <n>` | `page_size` |
| `product_id` | `<product_id>` | `product_id` |

Example:

- CLI: `cawplan backlog list <product_id> --page_size 20`
- MCP: `list_backlog_tickets {"product_id": "<product_id>", "page_size": 20}`

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

### `versions.list`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |

Example:

- CLI: `cawplan versions list <product_id>`
- MCP: `list_versions {"product_id": "<product_id>"}`
