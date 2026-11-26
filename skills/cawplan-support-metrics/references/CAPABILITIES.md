# CawPlan Capabilities

<!-- Generated from references/capabilities.json by scripts/capabilities.py render. Do not edit. -->

Skills name **capabilities** (for example `tickets.search`), not a transport. Resolve each capability to the `cawplan` CLI or to the CawPlan MCP server with these rules.

This copy lists only the capabilities that `cawplan-support-metrics` names (2 of 102). Every capability a CawPlan skill can use is in the repository's root `references/CAPABILITIES.md`.

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
| `metrics.ingest` | write | `cawplan metrics ingest` | `ingest_key_metrics` | Record business key-metric events (all or nothing: one invalid item rejects the batch). Each item: domain (default `default`), metric, at least one of value/count/cost/credit, dimensions.product (the product unique id), optional tags and timestamp. CLI-only: product_id fills dimensions.product on every item; on MCP set it on each item yourself. |
| `metrics.query` | read | `cawplan metrics query` | `query_key_metrics` | Query business key metrics for one domain over a time window (RFC3339 start inclusive, end exclusive). tag filters by key:value (repeat the CLI option once per tag); include_descendants needs module_id and product_id. CLI-only: chart and png write an SVG/PNG chart file (chart_field picks the plotted field); preview prints a terminal image and is for people running the CLI themselves. |

## Arguments

### `metrics.ingest`

| Argument | CLI | MCP |
|---|---|---|
| `items` | `--items <json>` | `body.items (array of objects)` |
| `product_id` | `--product_id <id>` | - |

Example:

- CLI: `cawplan metrics ingest --items '[{"domain":"support","metric":"ticket_closed","count":1,"dimensions":{"product":"<product_id>"}}]'`
- MCP: `ingest_key_metrics {"body": {"items": [{"domain": "support", "metric": "ticket_closed", "count": 1, "dimensions": {"product": "<product_id>"}}]}}`

### `metrics.query`

| Argument | CLI | MCP |
|---|---|---|
| `chart` | `--chart <path>` | - |
| `chart_field` | `--chart-field <field>` | - |
| `domain` | `--domain <domain>` | `domain` |
| `end` | `--end <iso>` | `end` |
| `fields` | `--fields <keys>` | `fields (array of strings)` |
| `granularity` | `--granularity <g>` | `granularity` |
| `group_by` | `--group_by <keys>` | `group_by (array of strings)` |
| `include_descendants` | `--include_descendants` | `include_descendants (boolean)` |
| `limit` | `--limit <n>` | `limit` |
| `metric` | `--metric <metric>` | `metric` |
| `module_id` | `--module_id <id>` | `module_id` |
| `png` | `--png <path>` | - |
| `preview` | `--preview` | - |
| `product_id` | `--product_id <id>` | `product_id` |
| `start` | `--start <iso>` | `start` |
| `tag` | `--tag <key:value>` | `tag (array of strings, each key:value)` |

Example:

- CLI: `cawplan metrics query --domain cawplan_ticket --start 2026-10-28T00:00:00Z --end 2026-11-04T00:00:00Z --granularity day`
- MCP: `query_key_metrics {"domain": "cawplan_ticket", "start": "2026-10-28T00:00:00Z", "end": "2026-11-04T00:00:00Z", "granularity": "day"}`
