# CawPlan Capabilities

<!-- Generated from references/capabilities.json by scripts/capabilities.py render. Do not edit. -->

Skills name **capabilities** (for example `tickets.search`), not a transport. Resolve each capability to the `cawplan` CLI or to the CawPlan MCP server with these rules.

This copy lists only the capabilities that `cawplan-requirement-analyze` names (15 of 85). Every capability a CawPlan skill can use is in the repository's root `references/CAPABILITIES.md`.

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
| `knowledge.documents.get` | read | `cawplan knowledge documents get` | `get_knowledge_document` | Get the raw content of one knowledge document (knowledge.search returns passages only). CLI-only options: outline (heading tree with per-heading preview, no content), section (complete content of the headings whose title contains the text), grep + context (matching lines with context), output (also save the full content to a file), refresh (bypass the local cache), no_interactive (plain JSON output even at a terminal). On MCP the full content is returned; find headings and sections in it yourself. |
| `knowledge.documents.update` | write | `cawplan knowledge documents update` | `update_knowledge_document` | Replace an existing document's content. CLI route: from a local file (file) or local text file (text_file). MCP route: from inline text (text); the document is re-indexed. |
| `products.list` | read | `cawplan products list` | `list_products` | List products visible to the caller; resolve a product name to product_id. MCP only: view=compact drops description, icon, links, knowledge datasets and member rosters; use it whenever you list more than a few products, and read one product's members (members.qas, members.designers, ...) with the default full view. |
| `products.overview` | read | `cawplan products overview` | `get_product_overview` | Get one product's overview (name and description background). |
| `qa.module_tree.get` | read | `cawplan qa-insights module-tree get` | `get_product_module_tree` | Get a product's module tree; its node IDs scope QA requirements and test points. MCP only: expand = requirements or approvers adds that data to each node. CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.requirements.create` | write | `cawplan qa-insights requirements create` | `create_qa_requirement` | Create a structured QA requirement under a module-tree node (body: module_tree_node_id, summary, entry_trigger, function_description, normal_expectation, constraints, out_of_scope, related_tickets, ...). CLI route: the result is wrapped as {outcome, command, meta, api, post_body|patch_body}; read the Open API envelope from `api`. outcome is SUCCESS, FAILURE, NOOP (nothing to change) or UNKNOWN (the write may or may not have happened: do not retry it, check with a read first). CLI-only: dry_run prints the body without sending it. CLI-only: body_file passes the same JSON from a file instead of body; prefer it for long JSON and where quoted arguments are rejected. |
| `qa.requirements.get` | read | `cawplan qa-insights requirements get` | `get_qa_requirement` | Get one QA requirement by its ID. CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.requirements.list` | read | `cawplan qa-insights requirements list` | `list_qa_requirements` | List QA requirements under a module-tree node (module_tree_node_id; the CLI requires it). MCP only: version_id, review_status, search and paging narrow the list, and module_tree_node_id may be omitted. CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.requirements.reconcile` | read | `cawplan qa-insights requirements reconcile` | - | Read-only check after a requirement create or update returned outcome UNKNOWN: finds whether the write landed, from local probe files. CLI only. On MCP no write returns UNKNOWN; if a call fails without a clear answer, look for the record with qa.requirements.list or qa.requirements.get before retrying. |
| `qa.requirements.resolve` | read | `cawplan qa-insights requirements resolve` | `resolve_qa_requirement` | Get a QA requirement by its display ID (for example REQ-00115) without knowing the product. The CLI also accepts a Browse URL; on MCP pass the display ID (take it from the URL first). CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.requirements.update` | write | `cawplan qa-insights requirements update` | `update_qa_requirement` | Update a QA requirement's structured fields. CLI route: pass desired (the full desired state) and snapshot (the values last written to CawPlan); the CLI sends only the keys that changed, outcome NOOP means nothing changed. MCP route: get the requirement first, stop and ask the user if a key you are changing differs from your snapshot, then send only the changed keys as desired. CLI route: the result is wrapped as {outcome, command, meta, api, post_body|patch_body}; read the Open API envelope from `api`. outcome is SUCCESS, FAILURE, NOOP (nothing to change) or UNKNOWN (the write may or may not have happened: do not retry it, check with a read first). CLI-only: dry_run prints the patch body without sending it. CLI-only: desired_file and snapshot_file pass the same JSON from files. |
| `qa.testpoints.archive` | write | `cawplan qa-insights testpoints archive` | `batch_create_test_points` | Create several test points under one QA requirement (body: {test_points: [...]}). CLI route: the result is wrapped as {outcome, command, meta, api, post_body|patch_body}; read the Open API envelope from `api`. outcome is SUCCESS, FAILURE, NOOP (nothing to change) or UNKNOWN (the write may or may not have happened: do not retry it, check with a read first). CLI-only: body_file passes the same JSON from a file instead of body; prefer it for long JSON and where quoted arguments are rejected. |
| `session.temp_dir` | read | `cawplan session temp-dir` | - | Print the CLI's scratch directory for temporary files. It is a fixed directory shared by CLI sessions, so create a uniquely named subdirectory or file in it. CLI only. |
| `tickets.search` | read | `cawplan tickets search` | `search_tickets` | Find tickets by display ID, unique ID or filters. Returns full ticket fields, including description (title), remarks (body), progress_comment and links. A created-at window (time_range, or start_date + end_date) is required unless display_ids, unique_ids or parent_ids is set; updated_start_date/updated_end_date filter by last update. Paginated: page through using total. view=compact returns list fields only (IDs, description, status and status_display, priority, ux, product/version, parent, labels (name, behavior), assignees (user_id and name), qa_assignee_ids, module, dates) without rich text, links, relations or avatars; use tickets.get for one ticket's details. Use it whenever you list more than a few tickets: full rows are large enough to overflow a tool result. On the CLI it also prints one line per page and defaults page_size to 50; CLI releases before this change printed a reduced row without IDs. |

## Arguments

### `config.env`


Example:

- CLI: `cawplan config env`

### `knowledge.documents.get`

| Argument | CLI | MCP |
|---|---|---|
| `context` | `--context <n>` | - |
| `dataset_id` | `--dataset <id>` | `dataset_id` |
| `document_id` | `--document <id>` | `document_id` |
| `grep` | `--grep <pattern>` | - |
| `no_interactive` | `--no-interactive` | - |
| `outline` | `--outline` | - |
| `output` | `--output <path>` | - |
| `refresh` | `--refresh` | - |
| `section` | `--section <heading>` | - |

Example:

- CLI: `cawplan knowledge documents get --dataset <dataset_id> --document <document_id>`
- MCP: `get_knowledge_document {"dataset_id": "<dataset_id>", "document_id": "<document_id>"}`

### `knowledge.documents.update`

| Argument | CLI | MCP |
|---|---|---|
| `dataset_id` | `--dataset <id>` | `dataset_id` |
| `document_id` | `--document <id>` | `document_id` |
| `file` | `--file <path>` | - |
| `text` | - | `body.text` |
| `text_file` | `--text-file <path>` | - |

Example:

- CLI: `cawplan knowledge documents update --dataset <dataset_id> --document <document_id> --text-file ./api.md`
- MCP: `update_knowledge_document {"dataset_id": "<dataset_id>", "document_id": "<document_id>", "body": {"text": "# API\n..."}}`

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

### `products.overview`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |

Example:

- CLI: `cawplan products overview <product_id>`
- MCP: `get_product_overview {"product_id": "<product_id>"}`

### `qa.module_tree.get`

| Argument | CLI | MCP |
|---|---|---|
| `expand` | - | `expand` |
| `product_id` | `<product_id>` | `product_id` |

Example:

- CLI: `cawplan qa-insights module-tree get <product_id>`
- MCP: `get_product_module_tree {"product_id": "<product_id>"}`

### `qa.requirements.create`

| Argument | CLI | MCP |
|---|---|---|
| `body` | `--body <json>` | `body (object)` |
| `body_file` | `--body-file <path>` | - |
| `dry_run` | `--dry-run` | - |
| `product_id` | `<product_id>` | `product_id` |

Example:

- CLI: `cawplan qa-insights requirements create <product_id> --body '{"module_tree_node_id":"<node_id>","summary":"Login with SSO"}'`
- MCP: `create_qa_requirement {"product_id": "<product_id>", "body": {"module_tree_node_id": "<node_id>", "summary": "Login with SSO"}}`

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

### `qa.requirements.reconcile`

| Argument | CLI | MCP |
|---|---|---|
| `intended_patch_file` | `--intended-patch-file <path>` | - |
| `module_tree_node_id` | `--module-tree-node-id <id>` | - |
| `operation` | `--operation <op>` | - |
| `probe_file` | `--probe-file <path>` | - |
| `product_id` | `<product_id>` | - |
| `target_requirement_id` | `--target-requirement-id <id>` | - |

Example:

- CLI: `cawplan qa-insights requirements reconcile <product_id> --module-tree-node-id <node_id> --probe-file ./probe.json --operation POST`

### `qa.requirements.resolve`

| Argument | CLI | MCP |
|---|---|---|
| `display_id` | `<display_id_or_browse_url>` | `display_id` |

Example:

- CLI: `cawplan qa-insights requirements resolve REQ-00115`
- MCP: `resolve_qa_requirement {"display_id": "REQ-00115"}`

### `qa.requirements.update`

| Argument | CLI | MCP |
|---|---|---|
| `desired` | `--desired <json>` | `body (object)` |
| `desired_file` | `--desired-file <path>` | - |
| `dry_run` | `--dry-run` | - |
| `product_id` | `<product_id>` | `product_id` |
| `requirement_id` | `<requirement_id>` | `requirement_id` |
| `snapshot` | `--snapshot <json>` | - |
| `snapshot_file` | `--snapshot-file <path>` | - |

Example:

- CLI: `cawplan qa-insights requirements update <product_id> <requirement_id> --desired '{"summary":"Login with SSO and MFA"}' --snapshot '{"summary":"Login with SSO"}'`
- MCP: `update_qa_requirement {"product_id": "<product_id>", "requirement_id": "<requirement_id>", "body": {"summary": "Login with SSO and MFA"}}`

### `qa.testpoints.archive`

| Argument | CLI | MCP |
|---|---|---|
| `body` | `--body <json>` | `body (object)` |
| `body_file` | `--body-file <path>` | - |
| `dry_run` | `--dry-run` | - |
| `product_id` | `<product_id>` | `product_id` |
| `requirement_id` | `<requirement_id>` | `requirement_id` |

Example:

- CLI: `cawplan qa-insights testpoints archive <product_id> <requirement_id> --body '{"test_points":[{"title":"SSO login succeeds"}]}'`
- MCP: `batch_create_test_points {"product_id": "<product_id>", "requirement_id": "<requirement_id>", "body": {"test_points": [{"title": "SSO login succeeds"}]}}`

### `session.temp_dir`


Example:

- CLI: `cawplan session temp-dir`

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
