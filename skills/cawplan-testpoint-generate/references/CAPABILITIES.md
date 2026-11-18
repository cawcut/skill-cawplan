# CawPlan Capabilities

<!-- Generated from references/capabilities.json by scripts/capabilities.py render. Do not edit. -->

Skills name **capabilities** (for example `tickets.search`), not a transport. Resolve each capability to the `cawplan` CLI or to the CawPlan MCP server with these rules.

This copy lists only the capabilities that `cawplan-testpoint-generate` names (13 of 85). Every capability a CawPlan skill can use is in the repository's root `references/CAPABILITIES.md`.

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
| `qa.requirements.get` | read | `cawplan qa-insights requirements get` | `get_qa_requirement` | Get one QA requirement by its ID. CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.requirements.resolve` | read | `cawplan qa-insights requirements resolve` | `resolve_qa_requirement` | Get a QA requirement by its display ID (for example REQ-00115) without knowing the product. The CLI also accepts a Browse URL; on MCP pass the display ID (take it from the URL first). CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.requirements.testpoints.list` | read | `cawplan qa-insights testpoints list` | `list_requirement_test_points` | List the test points of one QA requirement. CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.testpoint_review.apply_optimization` | read | `cawplan qa-insights testpoint-review apply-optimization` | - | Apply the AI's {modified, added, questions} output to the review. Part of the local test point review page (served by the CLI on this machine). CLI only. |
| `qa.testpoint_review.open` | read | `cawplan qa-insights testpoint-review open` | - | Serve the review page and open it (no_browser prints the URL instead). Part of the local test point review page (served by the CLI on this machine). CLI only. |
| `qa.testpoint_review.request_optimize` | read | `cawplan qa-insights testpoint-review request-optimize` | - | Collect the reviewer's comments as an optimization request for the AI. Part of the local test point review page (served by the CLI on this machine). CLI only. |
| `qa.testpoint_review.save` | write | `cawplan qa-insights testpoint-review save` | - | Archive the reviewed test points to CawPlan for the requirement. dry_run prints the archive body without submitting. Part of the local test point review page (served by the CLI on this machine). CLI only. |
| `qa.testpoint_review.show` | read | `cawplan qa-insights testpoint-review show` | - | Show the current review state (test points, comments, decisions). Part of the local test point review page (served by the CLI on this machine). CLI only. |
| `qa.testpoint_review.start` | read | `cawplan qa-insights testpoint-review start` | - | Start a local test point review for a requirement from test points, the requirement snapshot and open questions (inline JSON or files); returns a review id. Part of the local test point review page (served by the CLI on this machine). CLI only. |
| `qa.testpoints.archive` | write | `cawplan qa-insights testpoints archive` | `batch_create_test_points` | Create several test points under one QA requirement (body: {test_points: [...]}). CLI route: the result is wrapped as {outcome, command, meta, api, post_body|patch_body}; read the Open API envelope from `api`. outcome is SUCCESS, FAILURE, NOOP (nothing to change) or UNKNOWN (the write may or may not have happened: do not retry it, check with a read first). CLI-only: body_file passes the same JSON from a file instead of body; prefer it for long JSON and where quoted arguments are rejected. |
| `qa.testpoints.list` | read | - | `list_qa_test_points` | List a product's QA test points, optionally narrowed by requirement, module-tree node, approval status, priority, assignee or keyword. Paginated. MCP only: this is the product-level list; the CLI's per-requirement test point list returns a different shape and is not a capability. |

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

### `qa.testpoint_review.apply_optimization`

| Argument | CLI | MCP |
|---|---|---|
| `output` | `--output <json>` | - |
| `output_file` | `--output-file <path>` | - |
| `review_id` | `--review-id <id>` | - |

Example:

- CLI: `cawplan qa-insights testpoint-review apply-optimization --review-id <review_id> --output-file /abs/path/out.json`

### `qa.testpoint_review.open`

| Argument | CLI | MCP |
|---|---|---|
| `no_browser` | `--no-browser` | - |
| `review_id` | `--review-id <id>` | - |

Example:

- CLI: `cawplan qa-insights testpoint-review open --review-id <review_id> --no-browser`

### `qa.testpoint_review.request_optimize`

| Argument | CLI | MCP |
|---|---|---|
| `review_id` | `--review-id <id>` | - |

Example:

- CLI: `cawplan qa-insights testpoint-review request-optimize --review-id <review_id>`

### `qa.testpoint_review.save`

| Argument | CLI | MCP |
|---|---|---|
| `dry_run` | `--dry-run` | - |
| `product_id` | `--product-id <id>` | - |
| `requirement_id` | `--requirement-id <id>` | - |
| `review_id` | `--review-id <id>` | - |

Example:

- CLI: `cawplan qa-insights testpoint-review save --review-id <review_id> --product-id <product_id> --requirement-id <requirement_id>`

### `qa.testpoint_review.show`

| Argument | CLI | MCP |
|---|---|---|
| `review_id` | `--review-id <id>` | - |

Example:

- CLI: `cawplan qa-insights testpoint-review show --review-id <review_id>`

### `qa.testpoint_review.start`

| Argument | CLI | MCP |
|---|---|---|
| `lang` | `--lang <lang>` | - |
| `open_questions` | `--open-questions <json>` | - |
| `open_questions_file` | `--open-questions-file <path>` | - |
| `product_id` | `--product-id <id>` | - |
| `requirement` | `--requirement <json>` | - |
| `requirement_file` | `--requirement-file <path>` | - |
| `requirement_id` | `--requirement-id <id>` | - |
| `test_points` | `--test-points <json>` | - |
| `test_points_file` | `--test-points-file <path>` | - |

Example:

- CLI: `cawplan qa-insights testpoint-review start --product-id <product_id> --requirement-id <requirement_id> --test-points-file ./tp.json --requirement-file ./req.json`

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
