# CawPlan Capabilities

<!-- Generated from references/capabilities.json by scripts/capabilities.py render. Do not edit. -->

Skills name **capabilities** (for example `tickets.search`), not a transport. Resolve each capability to the `cawplan` CLI or to the CawPlan MCP server with these rules.

This copy lists only the capabilities that `cawplan-ticket-attachments` names (9 of 85). Every capability a CawPlan skill can use is in the repository's root `references/CAPABILITIES.md`.

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
| `backlog.attachments.download` | read | `cawplan backlog attachments download` | - | Download a backlog ticket's attachments to a local directory, optionally only some types or keys. CLI only (writes local files); on MCP, list the attachments and give the user the download URLs. |
| `backlog.attachments.list` | read | `cawplan backlog attachments list` | `list_backlog_ticket_attachments` | List the files attached to a backlog ticket's rich-text fields, each with a short-lived presigned download URL (expires_in seconds, default 900, max 3600). |
| `session.temp_dir` | read | `cawplan session temp-dir` | - | Print the CLI's scratch directory for temporary files. It is a fixed directory shared by CLI sessions, so create a uniquely named subdirectory or file in it. CLI only. |
| `tickets.attachments.add` | write | `cawplan tickets attachments add` | - | Upload local files (file, dir, md_file or html_file) and embed them, with an optional note, into one field of a version ticket (field, default progress_comment) in a single update. CLI only (reads local files). dry_run lists the files and missing references without uploading or updating. mode is append (default) or replace; block_id picks the report block to replace; base_dir, allow_outside_base and allow_outside_cwd control which local files may be referenced. |
| `tickets.attachments.download` | read | `cawplan tickets attachments download` | - | Download a version ticket's attachments to a local directory, optionally only some types or keys. CLI only (writes local files); on MCP, list the attachments and give the user the download URLs. |
| `tickets.attachments.list` | read | `cawplan tickets attachments list` | `list_ticket_attachments` | List the files attached to a version ticket's rich-text fields, each with a short-lived presigned download URL; fetch the URLs promptly. ticket_id is the ticket unique ID. Download, upload and add are separate CLI-only capabilities (tickets.attachments.download, .upload, .add). |
| `tickets.attachments.upload` | write | `cawplan tickets attachments upload` | - | Upload local files as a version ticket's attachments and return their keys and URLs (does not change the ticket text). CLI only (reads local files). dry_run lists what would be uploaded. |
| `tickets.search` | read | `cawplan tickets search` | `search_tickets` | Find tickets by display ID, unique ID or filters. Returns full ticket fields, including description (title), remarks (body), progress_comment and links. A created-at window (time_range, or start_date + end_date) is required unless display_ids, unique_ids or parent_ids is set; updated_start_date/updated_end_date filter by last update. Paginated: page through using total. view=compact returns list fields only (IDs, description, status and status_display, priority, ux, product/version, parent, labels (name, behavior), assignees (user_id and name), qa_assignee_ids, module, dates) without rich text, links, relations or avatars; use tickets.get for one ticket's details. Use it whenever you list more than a few tickets: full rows are large enough to overflow a tool result. On the CLI it also prints one line per page and defaults page_size to 50; CLI releases before this change printed a reduced row without IDs. |
| `tickets.update` | write | `cawplan tickets update` | `update_ticket` | Update a version ticket's fields (status, progress_comment, priority, assignees, labels, parent, due date, title/body, BUGFIX root_cause and solution), or move it with target_version_id. ticket_id is the ticket unique ID. Pass the ticket's current version as expected_version to use the optimistic lock (0 or omitted skips the check). module_id: the CLI takes a module name, full path "Parent / Child" or id and resolves it; on MCP pass the module id (resolve a name with qa.module_tree.get first). On MCP, null or an empty string clears the module; omitting it keeps the module. |

## Arguments

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

### `session.temp_dir`


Example:

- CLI: `cawplan session temp-dir`

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
