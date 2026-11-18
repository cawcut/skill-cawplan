# CawPlan Capabilities

<!-- Generated from references/capabilities.json by scripts/capabilities.py render. Do not edit. -->

Skills name **capabilities** (for example `tickets.search`), not a transport. Resolve each capability to the `cawplan` CLI or to the CawPlan MCP server with these rules.

This copy lists only the capabilities that `cawplan-testcase-generate` names (5 of 85). Every capability a CawPlan skill can use is in the repository's root `references/CAPABILITIES.md`.

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
| `knowledge.documents.get` | read | `cawplan knowledge documents get` | `get_knowledge_document` | Get the raw content of one knowledge document (knowledge.search returns passages only). CLI-only options: outline (heading tree with per-heading preview, no content), section (complete content of the headings whose title contains the text), grep + context (matching lines with context), output (also save the full content to a file), refresh (bypass the local cache), no_interactive (plain JSON output even at a terminal). On MCP the full content is returned; find headings and sections in it yourself. |
| `qa.requirements.get` | read | `cawplan qa-insights requirements get` | `get_qa_requirement` | Get one QA requirement by its ID. CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.requirements.resolve` | read | `cawplan qa-insights requirements resolve` | `resolve_qa_requirement` | Get a QA requirement by its display ID (for example REQ-00115) without knowing the product. The CLI also accepts a Browse URL; on MCP pass the display ID (take it from the URL first). CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.requirements.testpoints.list` | read | `cawplan qa-insights testpoints list` | `list_requirement_test_points` | List the test points of one QA requirement. CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.testpoints.list` | read | - | `list_qa_test_points` | List a product's QA test points, optionally narrowed by requirement, module-tree node, approval status, priority, assignee or keyword. Paginated. MCP only: this is the product-level list; the CLI's per-requirement test point list returns a different shape and is not a capability. |

## Arguments

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

### `qa.requirements.get`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |
| `requirement_id` | `<requirement_id>` | `requirement_id` |

Example:

- CLI: `cawplan qa-insights requirements get <product_id> <requirement_id>`
- MCP: `get_qa_requirement {"product_id": "<product_id>", "requirement_id": "<requirement_id>"}`

### `qa.requirements.resolve`

| Argument | CLI | MCP |
|---|---|---|
| `display_id` | `<display_id_or_browse_url>` | `display_id` |

Example:

- CLI: `cawplan qa-insights requirements resolve REQ-00115`
- MCP: `resolve_qa_requirement {"display_id": "REQ-00115"}`

### `qa.requirements.testpoints.list`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |
| `requirement_id` | `<requirement_id>` | `requirement_id` |

Example:

- CLI: `cawplan qa-insights testpoints list <product_id> <requirement_id>`
- MCP: `list_requirement_test_points {"product_id": "<product_id>", "requirement_id": "<requirement_id>"}`

### `qa.testpoints.list`

| Argument | CLI | MCP |
|---|---|---|
| `approval_status` | - | `approval_status` |
| `assignee_user_id` | - | `assignee_user_id` |
| `module_tree_node_id` | - | `module_tree_node_id` |
| `page_num` | - | `page_num` |
| `page_size` | - | `page_size` |
| `priority` | - | `priority` |
| `product_id` | - | `product_id` |
| `requirement_id` | - | `requirement_id` |
| `search` | - | `search` |

Example:

- MCP: `list_qa_test_points {"product_id": "<product_id>", "requirement_id": "<requirement_id>"}`
