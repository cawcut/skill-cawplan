# CawPlan Capabilities

<!-- Generated from references/capabilities.json by scripts/capabilities.py render. Do not edit. -->

Skills name **capabilities** (for example `tickets.search`), not a transport. Resolve each capability to the `cawplan` CLI or to the CawPlan MCP server with these rules.

This copy lists only the capabilities that `cawplan-test-execution-progress` names (5 of 102). Every capability a CawPlan skill can use is in the repository's root `references/CAPABILITIES.md`.

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
| `products.list` | read | `cawplan products list` | `list_products` | List products visible to the caller; resolve a product name to product_id. MCP only: view=compact drops description, icon, links, knowledge datasets and member rosters; use it whenever you list more than a few products, and read one product's members (members.qas, members.designers, ...) with the default full view. |
| `qa.testrail.execution.failures` | read | `cawplan qa-insights testrail execution failures` | `get_testrail_execution_failures` | List the failed and blocked TestRail execution results of a version, optionally for one run. Paginated with limit and offset. include_flaky computes is_flaky and consecutive_failures from TestRail history (slower). CLI route: the result is wrapped as {outcome, command, meta, api}; read the Open API envelope {code, msg, data} from `api` (outcome is SUCCESS or FAILURE). |
| `qa.testrail.execution.summary` | read | `cawplan qa-insights testrail execution summary` | `get_testrail_execution_summary` | Get the TestRail execution summary of a version, optionally scoped to one ticket or to plan mappings. refresh bypasses the execution cache and refreshes TestRail status metadata. CLI route: the result is wrapped as {outcome, command, meta, api}; read the Open API envelope {code, msg, data} from `api` (outcome is SUCCESS or FAILURE). |
| `qa.testrail.mappings.get` | read | `cawplan qa-insights testrail mappings get` | `get_testrail_mappings` | Get a product's TestRail mappings. CLI route: the result is wrapped as {outcome, command, meta, api}; read the Open API envelope {code, msg, data} from `api` (outcome is SUCCESS or FAILURE). |
| `versions.list` | read | `cawplan versions list` | `list_versions` | List one product's versions; resolve a version name to version_id. |

## Arguments

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

### `qa.testrail.execution.failures`

| Argument | CLI | MCP |
|---|---|---|
| `include_flaky` | `--include-flaky` | `include_flaky (boolean)` |
| `limit` | `--limit <n>` | `limit (integer)` |
| `offset` | `--offset <n>` | `offset (integer)` |
| `product_id` | `<product_id>` | `product_id` |
| `run_id` | `--run-id <n>` | `run_id (integer)` |
| `version_id` | `<version_id>` | `version_id` |

Example:

- CLI: `cawplan qa-insights testrail execution failures <product_id> <version_id> --run-id 1234`
- MCP: `get_testrail_execution_failures {"product_id": "<product_id>", "version_id": "<version_id>", "run_id": 1234}`

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

### `qa.testrail.mappings.get`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |

Example:

- CLI: `cawplan qa-insights testrail mappings get <product_id>`
- MCP: `get_testrail_mappings {"product_id": "<product_id>"}`

### `versions.list`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |

Example:

- CLI: `cawplan versions list <product_id>`
- MCP: `list_versions {"product_id": "<product_id>"}`
