# CawPlan Capabilities

<!-- Generated from references/capabilities.json by scripts/capabilities.py render. Do not edit. -->

Skills name **capabilities** (for example `tickets.search`), not a transport. Resolve each capability to the `cawplan` CLI or to the CawPlan MCP server with these rules.

This copy lists only the capabilities that `cawplan-product-insights` names (3 of 102). Every capability a CawPlan skill can use is in the repository's root `references/CAPABILITIES.md`.

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
| `critical.search` | read | `cawplan critical search` | `search_critical_issues` | Search critical issues across products. Give a time window (time_range, or start_date with end_date); the other filters narrow it. Paginated. |
| `products.analytics` | read | `cawplan analytics get` | `get_product_analytics` | Get one product's AI-categorized feedback analytics over a time range, optionally for one version. |
| `products.list` | read | `cawplan products list` | `list_products` | List products visible to the caller; resolve a product name to product_id. MCP only: view=compact drops description, icon, links, knowledge datasets and member rosters; use it whenever you list more than a few products, and read one product's members (members.qas, members.designers, ...) with the default full view. |

## Arguments

### `critical.search`

| Argument | CLI | MCP |
|---|---|---|
| `end_date` | `--end_date <date>` | `end_date` |
| `issue_types` | `--issue_types <csv>` | `body.issue_types (array of strings)` |
| `page_num` | `--page_num <n>` | `page_num` |
| `page_size` | `--page_size <n>` | `page_size` |
| `product_ids` | `--product_ids <csv>` | `body.product_ids (array of strings)` |
| `product_line_ids` | `--product_line_ids <csv>` | `body.product_line_ids (array of strings)` |
| `search` | `--search <q>` | `body.search` |
| `start_date` | `--start_date <date>` | `start_date` |
| `status` | `--status <csv>` | `body.status (array of strings)` |
| `time_range` | `--time_range <range>` | `time_range` |

Example:

- CLI: `cawplan critical search --time_range 3m --status INVESTIGATING --product_ids <product_id>`
- MCP: `search_critical_issues {"body": {"product_ids": ["<product_id>"], "status": ["INVESTIGATING"]}, "time_range": "3m"}`

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
| `view` | - | `view` |

Example:

- CLI: `cawplan products list --search Access`
- MCP: `list_products {"search": "Access"}`
