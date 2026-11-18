# CawPlan Capabilities

<!-- Generated from references/capabilities.json by scripts/capabilities.py render. Do not edit. -->

Skills name **capabilities** (for example `tickets.search`), not a transport. Resolve each capability to the `cawplan` CLI or to the CawPlan MCP server with these rules.

This copy lists only the capabilities that `cawplan-ticket-report-generate` names (16 of 85). Every capability a CawPlan skill can use is in the repository's root `references/CAPABILITIES.md`.

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
| `config.env` | read | `cawplan config env` | - | Show the CLI's current CawPlan environment as plain text lines (Environment, API, Portal); the Portal line is the host used to build links. CLI only. |
| `products.list` | read | `cawplan products list` | `list_products` | List products visible to the caller; resolve a product name to product_id. MCP only: view=compact drops description, icon, links, knowledge datasets and member rosters; use it whenever you list more than a few products, and read one product's members (members.qas, members.designers, ...) with the default full view. |
| `qa.module_tree.get` | read | `cawplan qa-insights module-tree get` | `get_product_module_tree` | Get a product's module tree; its node IDs scope QA requirements and test points. MCP only: expand = requirements or approvers adds that data to each node. CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.requirements.get` | read | `cawplan qa-insights requirements get` | `get_qa_requirement` | Get one QA requirement by its ID. CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.requirements.list` | read | `cawplan qa-insights requirements list` | `list_qa_requirements` | List QA requirements under a module-tree node (module_tree_node_id; the CLI requires it). MCP only: version_id, review_status, search and paging narrow the list, and module_tree_node_id may be omitted. CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.requirements.testpoints.list` | read | `cawplan qa-insights testpoints list` | `list_requirement_test_points` | List the test points of one QA requirement. CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.testrail.execution.summary` | read | `cawplan qa-insights testrail execution summary` | `get_testrail_execution_summary` | Get the TestRail execution summary of a version, optionally scoped to one ticket or to plan mappings. refresh bypasses the execution cache and refreshes TestRail status metadata. CLI route: the result is wrapped as {outcome, command, meta, api}; read the Open API envelope {code, msg, data} from `api` (outcome is SUCCESS or FAILURE). |
| `qa_reports.create` | write | `cawplan qa-reports create` | `create_qa_report` | Create a QA report for a product version (body: topic, type, result, status, date_start, date_end, details, ticket_id, module_id, links, ...). CLI-only: body_file passes the same JSON from a file instead of body; prefer it for long JSON and where quoted arguments are rejected. |
| `qa_reports.list` | read | `cawplan qa-reports list-version` | `list_qa_reports` | List the QA reports of one product version, optionally filtered by type (sqa, aqa, stress, performance, smoke), result (pass, pass_with_issues, failed) or status. Paginated. |
| `qa_reports.update` | write | `cawplan qa-reports update` | `update_qa_report` | Update an existing QA report (same body fields as qa_reports.create). CLI-only: body_file passes the same JSON from a file instead of body; prefer it for long JSON and where quoted arguments are rejected. |
| `tickets.get` | read | `cawplan tickets get` | `get_ticket` | Get one version ticket's full detail (labels, children, parent, relations, product line, AI sessions, QA reports). ticket_id is the ticket unique ID (resolve a display ID with tickets.search first). |
| `tickets.history` | read | `cawplan tickets history` | `get_ticket_history` | Get one version ticket's change history. |
| `tickets.relations` | read | `cawplan tickets relate list` | `get_ticket_relations` | List a ticket's relations grouped by type (blocking, blocked_by, related, duplicate), from that ticket's point of view. ticket_id is the ticket unique ID (resolve a display ID with tickets.search first). |
| `tickets.search` | read | `cawplan tickets search` | `search_tickets` | Find tickets by display ID, unique ID or filters. Returns full ticket fields, including description (title), remarks (body), progress_comment and links. A created-at window (time_range, or start_date + end_date) is required unless display_ids, unique_ids or parent_ids is set; updated_start_date/updated_end_date filter by last update. Paginated: page through using total. view=compact returns list fields only (IDs, description, status and status_display, priority, ux, product/version, parent, labels (name, behavior), assignees (user_id and name), qa_assignee_ids, module, dates) without rich text, links, relations or avatars; use tickets.get for one ticket's details. Use it whenever you list more than a few tickets: full rows are large enough to overflow a tool result. On the CLI it also prints one line per page and defaults page_size to 50; CLI releases before this change printed a reduced row without IDs. |
| `versions.get` | read | `cawplan versions get` | `get_version` | Get one version's detail (status, dates, completion, risk). |
| `versions.list` | read | `cawplan versions list` | `list_versions` | List one product's versions; resolve a version name to version_id. |

## Arguments

### `config.env`


Example:

- CLI: `cawplan config env`

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

### `qa.requirements.get`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |
| `requirement_id` | `<requirement_id>` | `requirement_id` |

Example:

- CLI: `cawplan qa-insights requirements get <product_id> <requirement_id>`
- MCP: `get_qa_requirement {"product_id": "<product_id>", "requirement_id": "<requirement_id>"}`

### `qa.requirements.list`

| Argument | CLI | MCP |
|---|---|---|
| `module_tree_node_id` | `--module-tree-node-id <id>` | `module_tree_node_id` |
| `page_num` | - | `page_num` |
| `page_size` | - | `page_size` |
| `product_id` | `<product_id>` | `product_id` |
| `review_status` | - | `review_status` |
| `search` | - | `search` |
| `version_id` | - | `version_id` |

Example:

- CLI: `cawplan qa-insights requirements list <product_id> --module-tree-node-id <module_tree_node_id>`
- MCP: `list_qa_requirements {"product_id": "<product_id>", "module_tree_node_id": "<module_tree_node_id>"}`

### `qa.requirements.testpoints.list`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |
| `requirement_id` | `<requirement_id>` | `requirement_id` |

Example:

- CLI: `cawplan qa-insights testpoints list <product_id> <requirement_id>`
- MCP: `list_requirement_test_points {"product_id": "<product_id>", "requirement_id": "<requirement_id>"}`

### `qa.testrail.execution.summary`

| Argument | CLI | MCP |
|---|---|---|
| `include_zero_statuses` | `--include-zero-statuses` | `include_zero_statuses (boolean)` |
| `plan_mapping_id` | `--plan-mapping-id <id>` | `plan_mapping_id` |
| `plan_mapping_ids` | `--plan-mapping-ids <ids>` | `plan_mapping_ids (array of strings)` |
| `product_id` | `<product_id>` | `product_id` |
| `refresh` | `--refresh` | `refresh (boolean)` |
| `ticket_id` | `--ticket-id <id>` | `ticket_id` |
| `version_id` | `<version_id>` | `version_id` |

Example:

- CLI: `cawplan qa-insights testrail execution summary <product_id> <version_id> --refresh`
- MCP: `get_testrail_execution_summary {"product_id": "<product_id>", "version_id": "<version_id>", "refresh": true}`

### `qa_reports.create`

| Argument | CLI | MCP |
|---|---|---|
| `body` | `--body <json>` | `body (object)` |
| `body_file` | `--body-file <path>` | - |
| `product_id` | `<product_id>` | `product_id` |
| `version_id` | `<version_id>` | `version_id` |

Example:

- CLI: `cawplan qa-reports create <product_id> <version_id> --body '{"topic":"Login SQA","type":"sqa","result":"pass"}'`
- MCP: `create_qa_report {"product_id": "<product_id>", "version_id": "<version_id>", "body": {"topic": "Login SQA", "type": "sqa", "result": "pass"}}`

### `qa_reports.list`

| Argument | CLI | MCP |
|---|---|---|
| `page_num` | `--page_num <n>` | `page_num` |
| `page_size` | `--page_size <n>` | `page_size` |
| `product_id` | `<product_id>` | `product_id` |
| `result` | `--result <r>` | `result` |
| `status` | `--status <s>` | `status` |
| `type` | `--type <type>` | `type` |
| `version_id` | `<version_id>` | `version_id` |

Example:

- CLI: `cawplan qa-reports list-version <product_id> <version_id> --type sqa`
- MCP: `list_qa_reports {"product_id": "<product_id>", "version_id": "<version_id>", "type": "sqa"}`

### `qa_reports.update`

| Argument | CLI | MCP |
|---|---|---|
| `body` | `--body <json>` | `body (object)` |
| `body_file` | `--body-file <path>` | - |
| `product_id` | `<product_id>` | `product_id` |
| `qa_report_id` | `<qa_report_id>` | `qa_report_id` |
| `version_id` | `<version_id>` | `version_id` |

Example:

- CLI: `cawplan qa-reports update <product_id> <version_id> <qa_report_id> --body '{"result":"pass_with_issues"}'`
- MCP: `update_qa_report {"product_id": "<product_id>", "version_id": "<version_id>", "qa_report_id": "<qa_report_id>", "body": {"result": "pass_with_issues"}}`

### `tickets.get`

| Argument | CLI | MCP |
|---|---|---|
| `fields` | `--fields <csv>` | `fields` |
| `product_id` | `<product_id>` | `product_id` |
| `ticket_id` | `<ticket_id>` | `ticket_id` |
| `version_id` | `<version_id>` | `version_id` |

Example:

- CLI: `cawplan tickets get <product_id> <version_id> <ticket_unique_id>`
- MCP: `get_ticket {"product_id": "<product_id>", "version_id": "<version_id>", "ticket_id": "<ticket_unique_id>"}`

### `tickets.history`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |
| `ticket_id` | `<ticket_id>` | `ticket_id` |
| `version_id` | `<version_id>` | `version_id` |

Example:

- CLI: `cawplan tickets history <product_id> <version_id> <ticket_id>`
- MCP: `get_ticket_history {"product_id": "<product_id>", "version_id": "<version_id>", "ticket_id": "<ticket_id>"}`

### `tickets.relations`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |
| `ticket_id` | `<ticket_id>` | `ticket_id` |
| `version_id` | `<version_id>` | `version_id` |

Example:

- CLI: `cawplan tickets relate list <product_id> <version_id> <ticket_unique_id>`
- MCP: `get_ticket_relations {"product_id": "<product_id>", "version_id": "<version_id>", "ticket_id": "<ticket_unique_id>"}`

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
