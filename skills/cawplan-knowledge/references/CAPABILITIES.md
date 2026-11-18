# CawPlan Capabilities

<!-- Generated from references/capabilities.json by scripts/capabilities.py render. Do not edit. -->

Skills name **capabilities** (for example `tickets.search`), not a transport. Resolve each capability to the `cawplan` CLI or to the CawPlan MCP server with these rules.

This copy lists only the capabilities that `cawplan-knowledge` names (12 of 85). Every capability a CawPlan skill can use is in the repository's root `references/CAPABILITIES.md`.

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

## Arguments

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
