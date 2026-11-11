# CawPlan Capabilities

<!-- Generated from references/capabilities.json by scripts/capabilities.py render. Do not edit. -->

Skills name **capabilities** (for example `tickets.search`), not a transport. Resolve each capability to the `cawplan` CLI or to the CawPlan MCP server with these rules.

## Choose a route (required, before the first capability call)

Check the routes in this order and use the first one that works. Keep the order even when CawPlan MCP tools are available in the session: the CLI is checked first.

1. **CLI**: if you have a shell tool (for example Bash), run `cawplan skill check` before any CawPlan MCP call (it verifies the CLI version and sign-in; checking PATH alone is not enough). If it exits 0, use the CLI route for the rest of the session and do not call CawPlan MCP tools.
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
| `activities.query` | read | `cawplan activities query` | `query_activities` | Query the CawPlan activity feed (release, issue, ticket, version, product and user events), filtered by actor user_id and/or product_id over a relative time_range such as 1d, 1w, 1m, 3m, 6m or 1y. Paginated (page_size at most 100). |
| `backlog.attachments.download` | read | `cawplan backlog attachments download` | - | Download a backlog ticket's attachments to a local directory, optionally only some types or keys. CLI only (writes local files); on MCP, list the attachments and give the user the download URLs. |
| `backlog.attachments.list` | read | `cawplan backlog attachments list` | `list_backlog_ticket_attachments` | List the files attached to a backlog ticket's rich-text fields, each with a short-lived presigned download URL (expires_in seconds, default 900, max 3600). |
| `backlog.create` | write | `cawplan tickets create-backlog` | `create_backlog_ticket` | Create a ticket in a product's backlog. description is the title; remarks is the HTML body. module_id: the CLI takes a module name, full path "Parent / Child" or id and resolves it; on MCP pass the module id (resolve a name with qa.module_tree.get first). |
| `backlog.get` | read | `cawplan backlog get` | `get_backlog_ticket` | Get one backlog ticket's full detail. ticket_id is the ticket unique ID (resolve a display ID with tickets.search first). |
| `backlog.list` | read | `cawplan backlog list` | `list_backlog_tickets` | List a product's backlog tickets (tickets not planned into a version). Paginated. |
| `config.env` | read | `cawplan config env` | - | Show the CLI's current CawPlan environment as plain text lines (Environment, API, Portal); the Portal line is the host used to build links. CLI only. |
| `critical.search` | read | `cawplan critical search` | `search_critical_issues` | Search critical issues across products. Give a time window (time_range, or start_date with end_date); the other filters narrow it. Paginated. |
| `knowledge.browse` | read | `cawplan knowledge browse` | - | Interactive terminal browser (dataset, document, heading tree). Never run it as an agent: it needs a real terminal. Give the user the CLI example to run themselves. CLI only. |
| `knowledge.datasets.create` | write | `cawplan knowledge datasets create` | - | Create a knowledge dataset. owner_product_id makes that product the owner (required for its modules); product_ids only links the dataset for product-scoped search (CLI: repeat --product). CLI only. |
| `knowledge.datasets.list` | read | `cawplan knowledge datasets list` | `list_knowledge_datasets` | List knowledge datasets visible to the caller ({id, name, document_count}). With product_id: the datasets that product owns plus those linked to it. With product_id and module_id: only the product's owned datasets with at least one document under that module. |
| `knowledge.documents.get` | read | `cawplan knowledge documents get` | `get_knowledge_document` | Get the raw content of one knowledge document (knowledge.search returns passages only). CLI-only options: outline (heading tree with per-heading preview, no content), section (complete content of the headings whose title contains the text), grep + context (matching lines with context), output (also save the full content to a file), refresh (bypass the local cache), no_interactive (plain JSON output even at a terminal). On MCP the full content is returned; find headings and sections in it yourself. |
| `knowledge.documents.job_status` | read | `cawplan knowledge documents job-status` | - | Check an asynchronous upload or update job. CLI only. |
| `knowledge.documents.list` | read | `cawplan knowledge documents list` | `list_knowledge_documents` | List the documents in one knowledge dataset. |
| `knowledge.documents.set_module` | write | `cawplan knowledge documents set-module` | - | Move a document under a module (module_id) or out of its module (clear); pass exactly one. CLI only. |
| `knowledge.documents.update` | write | `cawplan knowledge documents update` | `update_knowledge_document` | Replace an existing document's content. CLI route: from a local file (file) or local text file (text_file). MCP route: from inline text (text); the document is re-indexed. |
| `knowledge.documents.upload` | write | `cawplan knowledge documents upload` | - | Upload local files (files, repeat --file) or local text files (text_files, repeat --text-file) into a dataset, optionally under a module of the dataset's owner product. Do not mix files and text_files in one call. File uploads are asynchronous; the CLI waits unless no_wait is set. CLI only (needs local files). |
| `knowledge.modules.create` | write | `cawplan knowledge modules create` | - | Create a module (parent_id for a sub-module; at most 5 levels) in a product's module tree. CLI only. |
| `knowledge.modules.list` | read | `cawplan knowledge datasets modules` | - | List a product's module tree; each node's knowledge lists the datasets with at least one document under it. CLI only for now. |
| `knowledge.search` | read | `cawplan knowledge search` | `search_knowledge` | Semantic search over knowledge datasets; returns ranked passages, not whole documents. Searches every accessible dataset unless dataset_ids narrows it (CLI: repeat --dataset per id). |
| `labels.list` | read | `cawplan labels list` | `list_labels` | List ticket labels; resolve label names to label IDs. |
| `metrics.domains` | read | - | `list_key_metric_domains` | List key-metric domains and their metrics. MCP only: on the CLI route pick the domain from the metrics skill instead. |
| `metrics.ingest` | write | `cawplan metrics ingest` | `ingest_key_metrics` | Record business key-metric events (all or nothing: one invalid item rejects the batch). Each item: domain (default `default`), metric, at least one of value/count/cost/credit, dimensions.product (the product unique id), optional tags and timestamp. CLI-only: product_id fills dimensions.product on every item; on MCP set it on each item yourself. |
| `metrics.query` | read | `cawplan metrics query` | `query_key_metrics` | Query business key metrics for one domain over a time window (RFC3339 start inclusive, end exclusive). tag filters by key:value (repeat the CLI option once per tag); include_descendants needs module_id and product_id. CLI-only: chart and png write an SVG/PNG chart file (chart_field picks the plotted field); preview prints a terminal image and is for people running the CLI themselves. |
| `product_lines.list` | read | `cawplan product-lines list` | `list_product_lines` | List product lines; resolve a product line name to product_line_id. |
| `products.analytics` | read | `cawplan analytics get` | `get_product_analytics` | Get one product's AI-categorized feedback analytics over a time range, optionally for one version. |
| `products.list` | read | `cawplan products list` | `list_products` | List products visible to the caller; resolve a product name to product_id. MCP only: view=compact drops description, icon, links, knowledge datasets and member rosters; use it whenever you list more than a few products, and read one product's members (members.qas, members.designers, ...) with the default full view. |
| `products.overview` | read | `cawplan products overview` | `get_product_overview` | Get one product's overview (name and description background). |
| `products.report` | read | `cawplan product-activity get` | `get_product_report` | Get a product's activity report for a date range (YYYY-MM-DD), optionally for one version. |
| `qa.module_tree.get` | read | `cawplan qa-insights module-tree get` | `get_product_module_tree` | Get a product's module tree; its node IDs scope QA requirements and test points. MCP only: expand = requirements or approvers adds that data to each node. CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.requirements.create` | write | `cawplan qa-insights requirements create` | `create_qa_requirement` | Create a structured QA requirement under a module-tree node (body: module_tree_node_id, summary, entry_trigger, function_description, normal_expectation, constraints, out_of_scope, related_tickets, ...). CLI route: the result is wrapped as {outcome, command, meta, api, post_body|patch_body}; read the Open API envelope from `api`. outcome is SUCCESS, FAILURE, NOOP (nothing to change) or UNKNOWN (the write may or may not have happened: do not retry it, check with a read first). CLI-only: dry_run prints the body without sending it. CLI-only: body_file passes the same JSON from a file instead of body; prefer it for long JSON and where quoted arguments are rejected. |
| `qa.requirements.get` | read | `cawplan qa-insights requirements get` | `get_qa_requirement` | Get one QA requirement by its ID. CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.requirements.list` | read | `cawplan qa-insights requirements list` | `list_qa_requirements` | List QA requirements under a module-tree node (module_tree_node_id; the CLI requires it). MCP only: version_id, review_status, search and paging narrow the list, and module_tree_node_id may be omitted. CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.requirements.reconcile` | read | `cawplan qa-insights requirements reconcile` | - | Read-only check after a requirement create or update returned outcome UNKNOWN: finds whether the write landed, from local probe files. CLI only. On MCP no write returns UNKNOWN; if a call fails without a clear answer, look for the record with qa.requirements.list or qa.requirements.get before retrying. |
| `qa.requirements.resolve` | read | `cawplan qa-insights requirements resolve` | `resolve_qa_requirement` | Get a QA requirement by its display ID (for example REQ-00115) without knowing the product. The CLI also accepts a Browse URL; on MCP pass the display ID (take it from the URL first). CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.requirements.testpoints.list` | read | `cawplan qa-insights testpoints list` | `list_requirement_test_points` | List the test points of one QA requirement. CLI route: the result is wrapped as {outcome, command, meta, data}; read the payload from `data` (outcome is SUCCESS or FAILURE). |
| `qa.requirements.update` | write | `cawplan qa-insights requirements update` | `update_qa_requirement` | Update a QA requirement's structured fields. CLI route: pass desired (the full desired state) and snapshot (the values last written to CawPlan); the CLI sends only the keys that changed, outcome NOOP means nothing changed. MCP route: get the requirement first, stop and ask the user if a key you are changing differs from your snapshot, then send only the changed keys as desired. CLI route: the result is wrapped as {outcome, command, meta, api, post_body|patch_body}; read the Open API envelope from `api`. outcome is SUCCESS, FAILURE, NOOP (nothing to change) or UNKNOWN (the write may or may not have happened: do not retry it, check with a read first). CLI-only: dry_run prints the patch body without sending it. CLI-only: desired_file and snapshot_file pass the same JSON from files. |
| `qa.risk_assessment.compute` | read | `cawplan qa-insights risk-assessment compute` | `compute_qa_risk_assessment` | Compute a version's QA release risk assessment with the rule engine, without saving it; optionally scoped to one ticket or plan mappings. refresh_execution refreshes TestRail execution data first: the CLI does this by default (no_refresh_execution turns it off), on MCP pass refresh_execution=true. Needs QA Insights edit permission. CLI route: the result is wrapped as {outcome, command, meta, api}; read the Open API envelope {code, msg, data} from `api` (outcome is SUCCESS or FAILURE). |
| `qa.risk_assessment.get` | read | `cawplan qa-insights risk-assessment get` | `get_qa_risk_assessment` | Get the saved QA release risk assessment of a version. It reads the stored result and does not recompute it. CLI route: the result is wrapped as {outcome, command, meta, api}; read the Open API envelope {code, msg, data} from `api` (outcome is SUCCESS or FAILURE). |
| `qa.risk_assessment.save` | write | `cawplan qa-insights risk-assessment save` | `save_qa_risk_assessment` | Save a reviewed QA release risk assessment as the version's latest one (body: risk_level, reasons, note, ai_summary, override_rule_engine); each call adds a record, and the server writes an AI summary when ai_summary is omitted. CLI route: run it first with dry_run (prints the body, writes nothing), show the result to the user, and only after their confirmation run it again with confirm, the CLI's safety switch; never pass confirm on the first call. CLI route: the result is wrapped as {outcome, command, meta, api}; read the Open API envelope {code, msg, data} from `api` (outcome is SUCCESS or FAILURE). CLI-only: body_file passes the same JSON from a file instead of body; prefer it for long JSON and where quoted arguments are rejected. A dry_run call does not reach the server: it returns {outcome, command, meta, post_body} with no api. |
| `qa.risk_rules.get` | read | `cawplan qa-insights risk-rules get` | `get_qa_risk_rules` | Get a product's QA risk rules. CLI route: the result is wrapped as {outcome, command, meta, api}; read the Open API envelope {code, msg, data} from `api` (outcome is SUCCESS or FAILURE). |
| `qa.testpoint_review.apply_optimization` | read | `cawplan qa-insights testpoint-review apply-optimization` | - | Apply the AI's {modified, added, questions} output to the review. Part of the local test point review page (served by the CLI on this machine). CLI only. |
| `qa.testpoint_review.open` | read | `cawplan qa-insights testpoint-review open` | - | Serve the review page and open it (no_browser prints the URL instead). Part of the local test point review page (served by the CLI on this machine). CLI only. |
| `qa.testpoint_review.request_optimize` | read | `cawplan qa-insights testpoint-review request-optimize` | - | Collect the reviewer's comments as an optimization request for the AI. Part of the local test point review page (served by the CLI on this machine). CLI only. |
| `qa.testpoint_review.save` | write | `cawplan qa-insights testpoint-review save` | - | Archive the reviewed test points to CawPlan for the requirement. dry_run prints the archive body without submitting. Part of the local test point review page (served by the CLI on this machine). CLI only. |
| `qa.testpoint_review.show` | read | `cawplan qa-insights testpoint-review show` | - | Show the current review state (test points, comments, decisions). Part of the local test point review page (served by the CLI on this machine). CLI only. |
| `qa.testpoint_review.start` | read | `cawplan qa-insights testpoint-review start` | - | Start a local test point review for a requirement from test points, the requirement snapshot and open questions (inline JSON or files); returns a review id. Part of the local test point review page (served by the CLI on this machine). CLI only. |
| `qa.testpoints.archive` | write | `cawplan qa-insights testpoints archive` | `batch_create_test_points` | Create several test points under one QA requirement (body: {test_points: [...]}). CLI route: the result is wrapped as {outcome, command, meta, api, post_body|patch_body}; read the Open API envelope from `api`. outcome is SUCCESS, FAILURE, NOOP (nothing to change) or UNKNOWN (the write may or may not have happened: do not retry it, check with a read first). CLI-only: body_file passes the same JSON from a file instead of body; prefer it for long JSON and where quoted arguments are rejected. |
| `qa.testpoints.list` | read | - | `list_qa_test_points` | List a product's QA test points, optionally narrowed by requirement, module-tree node, approval status, priority, assignee or keyword. Paginated. MCP only: this is the product-level list; the CLI's per-requirement test point list returns a different shape and is not a capability. |
| `qa.testrail.execution.failures` | read | `cawplan qa-insights testrail execution failures` | `get_testrail_execution_failures` | List the failed and blocked TestRail execution results of a version, optionally for one run. Paginated with limit and offset. include_flaky computes is_flaky and consecutive_failures from TestRail history (slower). CLI route: the result is wrapped as {outcome, command, meta, api}; read the Open API envelope {code, msg, data} from `api` (outcome is SUCCESS or FAILURE). |
| `qa.testrail.execution.summary` | read | `cawplan qa-insights testrail execution summary` | `get_testrail_execution_summary` | Get the TestRail execution summary of a version, optionally scoped to one ticket or to plan mappings. refresh bypasses the execution cache and refreshes TestRail status metadata. CLI route: the result is wrapped as {outcome, command, meta, api}; read the Open API envelope {code, msg, data} from `api` (outcome is SUCCESS or FAILURE). |
| `qa.testrail.mappings.get` | read | `cawplan qa-insights testrail mappings get` | `get_testrail_mappings` | Get a product's TestRail mappings. CLI route: the result is wrapped as {outcome, command, meta, api}; read the Open API envelope {code, msg, data} from `api` (outcome is SUCCESS or FAILURE). |
| `qa_reports.create` | write | `cawplan qa-reports create` | `create_qa_report` | Create a QA report for a product version (body: topic, type, result, status, date_start, date_end, details, ticket_id, module_id, links, ...). CLI-only: body_file passes the same JSON from a file instead of body; prefer it for long JSON and where quoted arguments are rejected. |
| `qa_reports.get` | read | `cawplan qa-reports get` | `get_qa_report` | Get one QA report of a version by its ID. |
| `qa_reports.list` | read | `cawplan qa-reports list-version` | `list_qa_reports` | List the QA reports of one product version, optionally filtered by type (sqa, aqa, stress, performance, smoke), result (pass, pass_with_issues, failed) or status. Paginated. |
| `qa_reports.update` | write | `cawplan qa-reports update` | `update_qa_report` | Update an existing QA report (same body fields as qa_reports.create). CLI-only: body_file passes the same JSON from a file instead of body; prefer it for long JSON and where quoted arguments are rejected. |
| `session.temp_dir` | read | `cawplan session temp-dir` | - | Print the CLI's scratch directory for temporary files. It is a fixed directory shared by CLI sessions, so create a uniquely named subdirectory or file in it. CLI only. |
| `ticket_statuses.list` | read | `cawplan product-lines statuses` | `list_ticket_statuses` | List one product line's ticket workflow statuses in order, including custom statuses. |
| `tickets.attachments.add` | write | `cawplan tickets attachments add` | - | Upload local files (file, dir, md_file or html_file) and embed them, with an optional note, into one field of a version ticket (field, default progress_comment) in a single update. CLI only (reads local files). dry_run lists the files and missing references without uploading or updating. mode is append (default) or replace; block_id picks the report block to replace; base_dir, allow_outside_base and allow_outside_cwd control which local files may be referenced. |
| `tickets.attachments.download` | read | `cawplan tickets attachments download` | - | Download a version ticket's attachments to a local directory, optionally only some types or keys. CLI only (writes local files); on MCP, list the attachments and give the user the download URLs. |
| `tickets.attachments.list` | read | `cawplan tickets attachments list` | `list_ticket_attachments` | List the files attached to a version ticket's rich-text fields, each with a short-lived presigned download URL; fetch the URLs promptly. ticket_id is the ticket unique ID. Download, upload and add are separate CLI-only capabilities (tickets.attachments.download, .upload, .add). |
| `tickets.attachments.upload` | write | `cawplan tickets attachments upload` | - | Upload local files as a version ticket's attachments and return their keys and URLs (does not change the ticket text). CLI only (reads local files). dry_run lists what would be uploaded. |
| `tickets.changes` | read | `cawplan tickets changes` | `ticket_changes` | List ticket change events (status, ux, priority, assignees) in a window of at most 90 days for a scope (at least one of unique_ids, product_ids, product_line_ids, version_ids, parent_ids); at most 50 unique_ids per call. The CLI follows next_cursor for up to 20 pages; on MCP each call returns one page, so call again with cursor = next_cursor until there is none. truncated: true means the result is incomplete. |
| `tickets.create` | write | `cawplan tickets create-version` | `create_ticket` | Create a ticket in a product version. description is the title; remarks is the HTML body. For a ticket outside any version use backlog.create. module_id: the CLI takes a module name, full path "Parent / Child" or id and resolves it; on MCP pass the module id (resolve a name with qa.module_tree.get first). |
| `tickets.get` | read | `cawplan tickets get` | `get_ticket` | Get one version ticket's full detail (labels, children, parent, relations, product line, AI sessions, QA reports). ticket_id is the ticket unique ID (resolve a display ID with tickets.search first). |
| `tickets.history` | read | `cawplan tickets history` | `get_ticket_history` | Get one version ticket's change history. |
| `tickets.relations` | read | `cawplan tickets relate list` | `get_ticket_relations` | List a ticket's relations grouped by type (blocking, blocked_by, related, duplicate), from that ticket's point of view. ticket_id is the ticket unique ID (resolve a display ID with tickets.search first). |
| `tickets.search` | read | `cawplan tickets search` | `search_tickets` | Find tickets by display ID, unique ID or filters. Returns full ticket fields, including description (title), remarks (body), progress_comment and links. A created-at window (time_range, or start_date + end_date) is required unless display_ids, unique_ids or parent_ids is set; updated_start_date/updated_end_date filter by last update. Paginated: page through using total. view=compact returns list fields only (IDs, description, status and status_display, priority, ux, product/version, parent, labels (name, behavior), assignees (user_id and name), qa_assignee_ids, module, dates) without rich text, links, relations or avatars; use tickets.get for one ticket's details. Use it whenever you list more than a few tickets: full rows are large enough to overflow a tool result. On the CLI it also prints one line per page and defaults page_size to 50; CLI releases before this change printed a reduced row without IDs. |
| `tickets.stats` | read | `cawplan tickets stats` | `ticket_stats` | Count tickets grouped server-side (priority, status, status_category, ux, assignee, label, type, product, version, platform; at most 2 dimensions), with the same filters as tickets.search. Result: data.total, and data.groups[] where each group has count and values[] (one {dimension, value} per group_by dimension). |
| `tickets.update` | write | `cawplan tickets update` | `update_ticket` | Update a version ticket's fields (status, progress_comment, priority, assignees, labels, parent, due date, title/body, BUGFIX root_cause and solution), or move it with target_version_id. ticket_id is the ticket unique ID. Pass the ticket's current version as expected_version to use the optimistic lock (0 or omitted skips the check). module_id: the CLI takes a module name, full path "Parent / Child" or id and resolves it; on MCP pass the module id (resolve a name with qa.module_tree.get first). On MCP, null or an empty string clears the module; omitting it keeps the module. |
| `todos.list` | read | `cawplan todos user` | `list_user_todos` | List one user's open work: assigned tickets and critical issues. |
| `users.me` | read | `cawplan users me` | `get_current_user` | Get the signed-in user (resolve "me" to user_id): data.unique_id is the user_id, with email and name. A not-signed-in error means the route is not usable: follow "Neither" above instead of looking the user up by email. |
| `users.search` | read | `cawplan users query` | `search_users` | Find users by exact email or by keyword over name and email; resolve a person to user_id. CLI route: do not pass page_size or page_num (the CLI sends them as strings and the server answers BAD_REQUEST); use email or keyword only. |
| `versions.create` | write | `cawplan versions create` | `create_version` | Create a version in a product. |
| `versions.get` | read | `cawplan versions get` | `get_version` | Get one version's detail (status, dates, completion, risk). |
| `versions.list` | read | `cawplan versions list` | `list_versions` | List one product's versions; resolve a version name to version_id. |
| `versions.releases` | read | `cawplan releases list` | `get_version_releases` | Get a version's release history. data is a list of version entries; the events are in each entry's release_history[]. |

## Arguments

### `activities.query`

| Argument | CLI | MCP |
|---|---|---|
| `activity_types` | `--activity_types <csv>` | `body.activity_types (array of RELEASE, ISSUE, TICKET, VERSION, PRODUCT, USER)` |
| `page_num` | `--page_num <n>` | `page_num` |
| `page_size` | `--page_size <n>` | `page_size` |
| `product_id` | `--product_id <id>` | `body.product_id` |
| `time_range` | `--time_range <range>` | `time_range` |
| `user_id` | `--user_id <id>` | `body.user_id` |

Example:

- CLI: `cawplan activities query --time_range 1w --product_id <product_id> --activity_types TICKET --page_size 50`
- MCP: `query_activities {"body": {"product_id": "<product_id>", "activity_types": ["TICKET"]}, "time_range": "1w", "page_size": 50}`

### `backlog.attachments.download`

| Argument | CLI | MCP |
|---|---|---|
| `expires_in` | `--expires_in <seconds>` | - |
| `key` | `--key <key>` | - |
| `out` | `--out <dir>` | - |
| `product_id` | `<product_id>` | - |
| `ticket_id` | `<ticket_id>` | - |
| `type` | `--type <csv>` | - |

Example:

- CLI: `cawplan backlog attachments download <product_id> <ticket_id> --type image`

### `backlog.attachments.list`

| Argument | CLI | MCP |
|---|---|---|
| `expires_in` | `--expires_in <seconds>` | `expires_in` |
| `product_id` | `<product_id>` | `product_id` |
| `ticket_id` | `<ticket_id>` | `ticket_id` |

Example:

- CLI: `cawplan backlog attachments list <product_id> <ticket_id>`
- MCP: `list_backlog_ticket_attachments {"product_id": "<product_id>", "ticket_id": "<ticket_id>"}`

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

### `backlog.get`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |
| `ticket_id` | `<ticket_id>` | `ticket_id` |

Example:

- CLI: `cawplan backlog get <product_id> <ticket_unique_id>`
- MCP: `get_backlog_ticket {"product_id": "<product_id>", "ticket_id": "<ticket_unique_id>"}`

### `backlog.list`

| Argument | CLI | MCP |
|---|---|---|
| `page_num` | `--page_num <n>` | `page_num` |
| `page_size` | `--page_size <n>` | `page_size` |
| `product_id` | `<product_id>` | `product_id` |

Example:

- CLI: `cawplan backlog list <product_id> --page_size 20`
- MCP: `list_backlog_tickets {"product_id": "<product_id>", "page_size": 20}`

### `config.env`


Example:

- CLI: `cawplan config env`

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

### `knowledge.browse`


Example:

- CLI: `cawplan knowledge browse`

### `knowledge.datasets.create`

| Argument | CLI | MCP |
|---|---|---|
| `description` | `--description <text>` | - |
| `name` | `--name <name>` | - |
| `owner_product_id` | `--owner-product <id>` | - |
| `permission` | `--permission <level>` | - |
| `product_ids` | `--product <id> (repeat per product)` | - |

Example:

- CLI: `cawplan knowledge datasets create --name 'Access Card API'`

### `knowledge.datasets.list`

| Argument | CLI | MCP |
|---|---|---|
| `module_id` | `--module <id>` | `module_id` |
| `product_id` | `--product <id>` | `product_id` |

Example:

- CLI: `cawplan knowledge datasets list --product <product_id>`
- MCP: `list_knowledge_datasets {"product_id": "<product_id>"}`

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

### `knowledge.documents.job_status`

| Argument | CLI | MCP |
|---|---|---|
| `dataset_id` | `--dataset <id>` | - |
| `job_id` | `--job <id>` | - |

Example:

- CLI: `cawplan knowledge documents job-status --dataset <dataset_id> --job <job_id>`

### `knowledge.documents.list`

| Argument | CLI | MCP |
|---|---|---|
| `dataset_id` | `--dataset <id>` | `dataset_id` |
| `keyword` | `--keyword <text>` | `keyword` |
| `limit` | `--limit <n>` | `limit` |
| `page` | `--page <n>` | `page` |

Example:

- CLI: `cawplan knowledge documents list --dataset <dataset_id>`
- MCP: `list_knowledge_documents {"dataset_id": "<dataset_id>"}`

### `knowledge.documents.set_module`

| Argument | CLI | MCP |
|---|---|---|
| `clear` | `--clear` | - |
| `dataset_id` | `--dataset <id>` | - |
| `document_id` | `--document <id>` | - |
| `module_id` | `--module <id>` | - |

Example:

- CLI: `cawplan knowledge documents set-module --dataset <dataset_id> --document <document_id> --module <module_id>`

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

### `knowledge.documents.upload`

| Argument | CLI | MCP |
|---|---|---|
| `dataset_id` | `--dataset <id>` | - |
| `files` | `--file <path>` | - |
| `module_id` | `--module <id>` | - |
| `no_wait` | `--no-wait` | - |
| `text_files` | `--text-file <path>` | - |

Example:

- CLI: `cawplan knowledge documents upload --dataset <dataset_id> --file ./api.md`

### `knowledge.modules.create`

| Argument | CLI | MCP |
|---|---|---|
| `name` | `--name <name>` | - |
| `parent_id` | `--parent <id>` | - |
| `product_id` | `--product <id>` | - |

Example:

- CLI: `cawplan knowledge modules create --product <product_id> --name 'Card APIs'`

### `knowledge.modules.list`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `--product <id>` | - |

Example:

- CLI: `cawplan knowledge datasets modules --product <product_id>`

### `knowledge.search`

| Argument | CLI | MCP |
|---|---|---|
| `dataset_ids` | `--dataset <id> (repeat per dataset)` | `body.dataset_ids (array of strings)` |
| `product_id` | `--product_id <id>` | `body.product_id` |
| `query` | `--query <text>` | `body.query` |

Example:

- CLI: `cawplan knowledge search --query 'NFC card fetch API'`
- MCP: `search_knowledge {"body": {"query": "NFC card fetch API"}}`

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

### `metrics.domains`

| Argument | CLI | MCP |
|---|---|---|
| `end` | - | `end` |
| `start` | - | `start` |

Example:

- MCP: `list_key_metric_domains {}`

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

### `product_lines.list`

| Argument | CLI | MCP |
|---|---|---|
| `page_num` | `--page_num <n>` | `page_num` |
| `page_size` | `--page_size <n>` | `page_size` |

Example:

- CLI: `cawplan product-lines list --page_size 50`
- MCP: `list_product_lines {"page_size": 50}`

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

### `products.overview`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |

Example:

- CLI: `cawplan products overview <product_id>`
- MCP: `get_product_overview {"product_id": "<product_id>"}`

### `products.report`

| Argument | CLI | MCP |
|---|---|---|
| `end_date` | `--end <date>` | `end_date` |
| `product_id` | `--product_id <id>` | `product_id` |
| `start_date` | `--start <date>` | `start_date` |
| `version_id` | `--version_id <id>` | `version_id` |

Example:

- CLI: `cawplan product-activity get --product_id <product_id> --start 2026-10-28 --end 2026-11-04`
- MCP: `get_product_report {"product_id": "<product_id>", "start_date": "2026-10-28", "end_date": "2026-11-04"}`

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

### `qa.requirements.testpoints.list`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |
| `requirement_id` | `<requirement_id>` | `requirement_id` |

Example:

- CLI: `cawplan qa-insights testpoints list <product_id> <requirement_id>`
- MCP: `list_requirement_test_points {"product_id": "<product_id>", "requirement_id": "<requirement_id>"}`

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

### `qa_reports.get`

| Argument | CLI | MCP |
|---|---|---|
| `product_id` | `<product_id>` | `product_id` |
| `qa_report_id` | `<qa_report_id>` | `qa_report_id` |
| `version_id` | `<version_id>` | `version_id` |

Example:

- CLI: `cawplan qa-reports get <product_id> <version_id> <qa_report_id>`
- MCP: `get_qa_report {"product_id": "<product_id>", "version_id": "<version_id>", "qa_report_id": "<qa_report_id>"}`

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

### `session.temp_dir`


Example:

- CLI: `cawplan session temp-dir`

### `ticket_statuses.list`

| Argument | CLI | MCP |
|---|---|---|
| `product_line_id` | `<product_line_id>` | `product_line_id` |

Example:

- CLI: `cawplan product-lines statuses <product_line_id>`
- MCP: `list_ticket_statuses {"product_line_id": "<product_line_id>"}`

### `tickets.attachments.add`

| Argument | CLI | MCP |
|---|---|---|
| `allow_outside_base` | `--allow-outside-base` | - |
| `allow_outside_cwd` | `--allow-outside-cwd` | - |
| `base_dir` | `--base-dir <dir>` | - |
| `block_id` | `--block-id <id>` | - |
| `dir` | `--dir <path>` | - |
| `dry_run` | `--dry-run` | - |
| `field` | `--field <field>` | - |
| `file` | `--file <path>` | - |
| `html_file` | `--html-file <path>` | - |
| `md_file` | `--md-file <path>` | - |
| `mode` | `--mode <mode>` | - |
| `note` | `--note <markdown>` | - |
| `product_id` | `<product_id>` | - |
| `ticket_id` | `<ticket_id>` | - |
| `version_id` | `<version_id>` | - |

Example:

- CLI: `cawplan tickets attachments add <product_id> <version_id> <ticket_id> --dir ./qa-results --dry-run`

### `tickets.attachments.download`

| Argument | CLI | MCP |
|---|---|---|
| `expires_in` | `--expires_in <seconds>` | - |
| `key` | `--key <key>` | - |
| `out` | `--out <dir>` | - |
| `product_id` | `<product_id>` | - |
| `ticket_id` | `<ticket_id>` | - |
| `type` | `--type <csv>` | - |
| `version_id` | `<version_id>` | - |

Example:

- CLI: `cawplan tickets attachments download <product_id> <version_id> <ticket_id> --type image,pdf`

### `tickets.attachments.list`

| Argument | CLI | MCP |
|---|---|---|
| `expires_in` | `--expires_in <seconds>` | `expires_in (integer seconds)` |
| `product_id` | `<product_id>` | `product_id` |
| `ticket_id` | `<ticket_id>` | `ticket_id` |
| `version_id` | `<version_id>` | `version_id` |

Example:

- CLI: `cawplan tickets attachments list <product_id> <version_id> <ticket_unique_id>`
- MCP: `list_ticket_attachments {"product_id": "<product_id>", "version_id": "<version_id>", "ticket_id": "<ticket_unique_id>"}`

### `tickets.attachments.upload`

| Argument | CLI | MCP |
|---|---|---|
| `dry_run` | `--dry-run` | - |
| `file` | `--file <path>` | - |
| `product_id` | `<product_id>` | - |
| `ticket_id` | `<ticket_id>` | - |
| `version_id` | `<version_id>` | - |

Example:

- CLI: `cawplan tickets attachments upload <product_id> <version_id> <ticket_id> --file ./a.png`

### `tickets.changes`

| Argument | CLI | MCP |
|---|---|---|
| `actor_ids` | `--actor_ids <csv>` | `body.actor_ids (array of strings)` |
| `cursor` | `--cursor <cursor>` | `cursor` |
| `end_date` | `--end_date <date>` | `end_date` |
| `fields` | `--fields <csv>` | `body.fields (array of strings)` |
| `group_by` | `--group_by <csv>` | `body.group_by (array of strings)` |
| `new_status_categories` | `--new_status_categories <csv>` | `body.new_status_categories (array of strings)` |
| `old_status_categories` | `--old_status_categories <csv>` | `body.old_status_categories (array of strings)` |
| `page_size` | `--page_size <n>` | `page_size` |
| `parent_ids` | `--parent_ids <csv>` | `body.parent_ids (array of strings)` |
| `product_ids` | `--product_ids <csv>` | `body.product_ids (array of strings)` |
| `product_line_ids` | `--product_line_ids <csv>` | `body.product_line_ids (array of strings)` |
| `start_date` | `--start_date <date>` | `start_date` |
| `unique_ids` | `--unique_ids <csv>` | `body.unique_ids (array of strings)` |
| `version_ids` | `--version_ids <csv>` | `body.version_ids (array of strings)` |

Example:

- CLI: `cawplan tickets changes --start_date 2026-11-01 --end_date 2026-11-04 --unique_ids <ticket_id> --fields status`
- MCP: `ticket_changes {"body": {"unique_ids": ["<ticket_id>"], "fields": ["status"]}, "start_date": "2026-11-01", "end_date": "2026-11-04"}`

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

### `todos.list`

| Argument | CLI | MCP |
|---|---|---|
| `issue_status` | `--issue_status <csv>` | `issue_status (comma-separated)` |
| `ticket_status` | `--ticket_status <csv>` | `ticket_status (comma-separated)` |
| `user_id` | `<user_id>` | `user_id` |

Example:

- CLI: `cawplan todos user <user_id>`
- MCP: `list_user_todos {"user_id": "<user_id>"}`

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
