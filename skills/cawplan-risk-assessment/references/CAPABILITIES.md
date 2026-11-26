# CawPlan Capabilities

<!-- Generated from references/capabilities.json by scripts/capabilities.py render. Do not edit. -->

Skills name **capabilities** (for example `tickets.search`), not a transport. Resolve each capability to the `cawplan` CLI or to the CawPlan MCP server with these rules.

This copy lists only the capabilities that `cawplan-risk-assessment` names (14 of 102). Every capability a CawPlan skill can use is in the repository's root `references/CAPABILITIES.md`.

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
| `qa.risk_assessment.compute` | read | `cawplan qa-insights risk-assessment compute` | `compute_qa_risk_assessment` | Compute a version's QA release risk assessment with the rule engine, without saving it; optionally scoped to one ticket or plan mappings. refresh_execution refreshes TestRail execution data first: the CLI does this by default (no_refresh_execution turns it off), on MCP pass refresh_execution=true. Needs QA Insights edit permission. CLI route: the result is wrapped as {outcome, command, meta, api}; read the Open API envelope {code, msg, data} from `api` (outcome is SUCCESS or FAILURE). |
| `qa.risk_assessment.get` | read | `cawplan qa-insights risk-assessment get` | `get_qa_risk_assessment` | Get the saved QA release risk assessment of a version. It reads the stored result and does not recompute it. CLI route: the result is wrapped as {outcome, command, meta, api}; read the Open API envelope {code, msg, data} from `api` (outcome is SUCCESS or FAILURE). |
| `qa.risk_assessment.save` | write | `cawplan qa-insights risk-assessment save` | `save_qa_risk_assessment` | Save a reviewed QA release risk assessment as the version's latest one (body: risk_level, reasons, note, ai_summary, override_rule_engine); each call adds a record, and the server writes an AI summary when ai_summary is omitted. CLI route: run it first with dry_run (prints the body, writes nothing), show the result to the user, and only after their confirmation run it again with confirm, the CLI's safety switch; never pass confirm on the first call. CLI route: the result is wrapped as {outcome, command, meta, api}; read the Open API envelope {code, msg, data} from `api` (outcome is SUCCESS or FAILURE). CLI-only: body_file passes the same JSON from a file instead of body; prefer it for long JSON and where quoted arguments are rejected. A dry_run call does not reach the server: it returns {outcome, command, meta, post_body} with no api. |
| `qa.risk_rules.get` | read | `cawplan qa-insights risk-rules get` | `get_qa_risk_rules` | Get a product's QA risk rules. CLI route: the result is wrapped as {outcome, command, meta, api}; read the Open API envelope {code, msg, data} from `api` (outcome is SUCCESS or FAILURE). |
| `qa.testrail.execution.failures` | read | `cawplan qa-insights testrail execution failures` | `get_testrail_execution_failures` | List the failed and blocked TestRail execution results of a version, optionally for one run. Paginated with limit and offset. include_flaky computes is_flaky and consecutive_failures from TestRail history (slower). CLI route: the result is wrapped as {outcome, command, meta, api}; read the Open API envelope {code, msg, data} from `api` (outcome is SUCCESS or FAILURE). |
| `qa.testrail.execution.summary` | read | `cawplan qa-insights testrail execution summary` | `get_testrail_execution_summary` | Get the TestRail execution summary of a version, optionally scoped to one ticket or to plan mappings. refresh bypasses the execution cache and refreshes TestRail status metadata. CLI route: the result is wrapped as {outcome, command, meta, api}; read the Open API envelope {code, msg, data} from `api` (outcome is SUCCESS or FAILURE). |
| `session.temp_dir` | read | `cawplan session temp-dir` | - | Print the CLI's scratch directory for temporary files. It is a fixed directory shared by CLI sessions, so create a uniquely named subdirectory or file in it. CLI only. |
| `tickets.search` | read | `cawplan tickets search` | `search_tickets` | Find tickets by display ID, unique ID or filters. Returns full ticket fields, including description (title), remarks (body), progress_comment and links. A created-at window (time_range, or start_date + end_date) is required unless display_ids, unique_ids or parent_ids is set; updated_start_date/updated_end_date filter by last update. Paginated: page through using total. view=compact returns list fields only (IDs, description, status and status_display, priority, ux, product/version, parent, labels (name, behavior), assignees (user_id and name), qa_assignee_ids, module, dates) without rich text, links, relations or avatars; use tickets.get for one ticket's details. Use it whenever you list more than a few tickets: full rows are large enough to overflow a tool result. On the CLI it also prints one line per page and defaults page_size to 50; CLI releases before this change printed a reduced row without IDs. |
| `tickets.stats` | read | `cawplan tickets stats` | `ticket_stats` | Count tickets grouped server-side (priority, status, status_category, ux, assignee, label, type, product, version, platform; at most 2 dimensions), with the same filters as tickets.search. Result: data.total, and data.groups[] where each group has count and values[] (one {dimension, value} per group_by dimension). |
| `versions.get` | read | `cawplan versions get` | `get_version` | Get one version's detail (status, dates, completion, risk). |
| `versions.list` | read | `cawplan versions list` | `list_versions` | List one product's versions; resolve a version name to version_id. |
| `versions.releases` | read | `cawplan releases list` | `get_version_releases` | Get a version's release history. data is a list of version entries; the events are in each entry's release_history[]. |

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

### `qa.risk_assessment.compute`

| Argument | CLI | MCP |
|---|---|---|
| `no_refresh_execution` | `--no-refresh-execution` | - |
| `plan_mapping_ids` | `--plan-mapping-ids <ids>` | `body.plan_mapping_ids (array of strings)` |
| `product_id` | `<product_id>` | `product_id` |
| `refresh_execution` | `--refresh-execution` | `body.refresh_execution (boolean)` |
| `ticket_id` | `--ticket-id <id>` | `body.ticket_id` |
| `version_id` | `<version_id>` | `version_id` |

Example:

- CLI: `cawplan qa-insights risk-assessment compute <product_id> <version_id> --refresh-execution`
- MCP: `compute_qa_risk_assessment {"product_id": "<product_id>", "version_id": "<version_id>", "body": {"refresh_execution": true}}`

### `qa.risk_assessment.get`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |
| `version_id` | `<version_id>` | `version_id` |

Example:

- CLI: `cawplan qa-insights risk-assessment get <product_id> <version_id>`
- MCP: `get_qa_risk_assessment {"product_id": "<product_id>", "version_id": "<version_id>"}`

### `qa.risk_assessment.save`

| Argument | CLI | MCP |
|---|---|---|
| `body` | `--body <json>` | `body (object)` |
| `body_file` | `--body-file <path>` | - |
| `confirm` | `--confirm` | - |
| `dry_run` | `--dry-run` | - |
| `product_id` | `<product_id>` | `product_id` |
| `version_id` | `<version_id>` | `version_id` |

Example:

- CLI: `cawplan qa-insights risk-assessment save <product_id> <version_id> --body '{"risk_level":"MEDIUM","reasons":[{"code":"HIGH_PLUS_TICKETS_OPEN","severity":"HIGH","message":"2 High+ tickets still open"}],"note":"Reviewed with QA"}' --dry-run`
- MCP: `save_qa_risk_assessment {"product_id": "<product_id>", "version_id": "<version_id>", "body": {"risk_level": "MEDIUM", "reasons": [{"code": "HIGH_PLUS_TICKETS_OPEN", "severity": "HIGH", "message": "2 High+ tickets still open"}], "note": "Reviewed with QA"}}`

### `qa.risk_rules.get`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |

Example:

- CLI: `cawplan qa-insights risk-rules get <product_id>`
- MCP: `get_qa_risk_rules {"product_id": "<product_id>"}`

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

### `tickets.stats`

| Argument | CLI | MCP |
|---|---|---|
| `assignees` | `--assignees <csv>` | `body.assignees (array of strings)` |
| `display_ids` | `--display_ids <csv>` | `body.display_ids (array of strings)` |
| `end_date` | `--end_date <date>` | `end_date` |
| `excluded_status` | `--excluded_status <csv>` | `body.excluded_status (array of strings)` |
| `excluded_status_categories` | `--excluded_status_categories <csv>` | `body.excluded_status_categories (array of strings)` |
| `group_by` | `--group_by <csv>` | `body.group_by (array of strings, at most 2)` |
| `label_ids` | `--label_ids <csv>` | `body.label_ids (array of strings)` |
| `label_names` | `--label_names <csv>` | `body.label_names (array of strings)` |
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

Example:

- CLI: `cawplan tickets stats --start_date 2000-01-01 --end_date 2026-11-04 --version_ids <version_id> --group_by assignee`
- MCP: `ticket_stats {"body": {"version_ids": ["<version_id>"], "group_by": ["assignee"]}, "start_date": "2000-01-01", "end_date": "2026-11-04"}`

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
