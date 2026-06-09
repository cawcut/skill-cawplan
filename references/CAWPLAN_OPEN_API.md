# CawPlan Open API

## Base
- Default CLI environment: `prd`; use `CAWPLAN_ENV=proto` for proto/dev.
- Base URL can be overridden with `CAWPLAN_BASE_URL`.
- Auth:
    - Interactive CLI: `Authorization: Bearer <accessToken>` from `cawplan auth login`.
    - CI/headless integration: API key from `cawplan auth configure` or `CAWPLAN_API_KEY`.
- Notes:
    - `cawplan-cli` OAuth access tokens are identified by token source and checked against the user's RBAC scope on supported OpenAPI routes.
    - API-key callers keep the external integration permission model.
### Local Caching (CLI)
- Cache file: `~/.cawplan/cache.json` (override with `CAWPLAN_CACHE_PATH`)
- TTL: `CAWPLAN_CACHE_TTL_HOURS` (default 12)
- Commands with cache: users list/query, products list, product-lines list/get, tickets search, critical search
- Bypass cache: add `--refresh`
- Clear cache: `cawplan cache clear`

## 1) User APIs
### List Users
- Endpoint: `GET /api/v1/public/openapi/users`
- Query params: `page_size` (default 20, max 100), `page_num` (default 1), `search`

### Query User
- Endpoint: `POST /api/v1/public/openapi/users/query`
- Body: `{ "email": "user@ui.com" }` OR `{ "keyword": "john", "page_num": 1, "page_size": 20 }`
- Notes: either email or keyword required; email takes precedence when both provided
- Response fields: `unique_id`, `email`, `first_name`, `last_name`, `avatar`, `status`, `created_at`, `updated_at`

## 1.1) Todo APIs
### Get User Todos
- Endpoint: `GET /api/v1/public/openapi/todos/users/{user_id}`
- Path params: `user_id` (user `unique_id`)
- Query params: `ticket_status` (CSV), `issue_status` (CSV)
- Response: `tickets` (grouped by product_line → product → version), `critical_issues` (grouped by product_line → product), `summary`

## 2) Product APIs
### List Products
- Endpoint: `GET /api/v1/public/openapi/products`
- Query params: `page_size` (default 10), `page_num` (default 1), `search`, `type_id`, `product_line_id`
- Response: list of products with `unique_id`, `name`, `description`, `product_type`, `product_line`, plus paging

## 2.1) Product Line APIs
### List Product Lines
- Endpoint: `GET /api/v1/public/openapi/product_lines`
- Query params: `page_size` (default 20), `page_num` (default 1)
- Response: list of product lines with `unique_id`, `name`, `description`, plus paging

### Get Product Line
- Endpoint: `GET /api/v1/public/openapi/product_lines/{product_line_id}`
- Path params: `product_line_id` (product line `unique_id`)

### Get Product Line Ticket Statuses (workflow states)
- Endpoint: `GET /api/v1/public/openapi/product_lines/{product_line_id}/ticket_statuses`
- Response items: `key`, `display_name`, `color`, `category` (`UNSTARTED` / `STARTED` / `DONE` / ...), `is_default`, `order`
- Notes: ticket `status` values are **per product line**. Build the adapter `stateMap` (Linear `IssueState` → PRM `key`) from this at init time. Maps to Linear `getWorkflowStates`.
- Maps to skill-prm CLI: `cawplan product-lines statuses <product_line_id>`.

## 2.2) Label APIs
### List Labels (name → id resolution)
- Endpoint: `GET /api/v1/public/openapi/labels`
- Query params: `search` (case-insensitive substring on name), `product_id` (scope to a product's visible labels; omit for workspace-wide), `page_size`, `page_num`
- Response items: `unique_id`, `name`, `color`, `behavior` (`FEATURE` / `BUGFIX` / `null`), `is_system`, `product_id` (`null` = workspace-wide), `created_at`
- Notes: read-only. Adapters that receive label **names** (e.g. Linear) build a `name → unique_id` cache from this, then pass `label_ids[]` to create/update. No label write API is exposed.
- Maps to skill-prm CLI: `cawplan labels list`.

## 3) Version APIs
### List Versions
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/versions`
- Path params: `product_id` (product `unique_id`)

### Get Version Detail
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/versions/{version_id}`

### Create Version (Version Plan)
- Endpoint: `POST /api/v1/public/openapi/product/{product_id}/versions`
- Body: `name` (required, e.g. `1.3.2`), `major_id` (**optional**, the major version `unique_id`), `description?`, `extra?` (optional `target_release[]`, `monitor_link`, `hotfix`)
- Notes:
    - `major_id` is **optional** — when omitted the server auto-resolves the major from `name`: a major-format name (e.g. `5.0`) anchors itself; a minor (e.g. `5.0.1`) looks up / creates the `5.0` major under the same product. Pass `major_id` only when you need to force a specific anchor. Discover IDs via `cawplan versions list <product_id>`.
    - Major versions cannot be marked `hotfix`; minor versions may.
    - API-key requests use the integration actor fallback. CLI Bearer requests use the authenticated user and RBAC scope.
- Maps to skill-prm CLI: `cawplan versions create`.

### Get Release History
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/versions/{version_id}/release`
- Response items: `unique_id`, `version`, `status`, `release_date`

## 4) Ticket APIs
### List Version Tickets
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets`
- Query params: `type` (required: `FEATURE` or `BUGFIX`), `page_size`, `page_num`

### Search Version Tickets
- Endpoint: `POST /api/v1/public/openapi/tickets/search`
- Query params: `time_range` or (`start_date` + `end_date`), `page_size`, `page_num`
- Body: `product_ids[]`, `product_line_ids[]`, `version_ids[]`, `unique_ids[]`, `display_ids[]`, `parent_ids[]`, `type[]`, `status[]`, `priority[]`, `platform[]`, `assignees[]`, `search`
- Notes:
    - OR within same field; AND across fields.
    - `unique_ids[]` / `display_ids[]` are exact-match lookups (Linear `fetchIssuesByIds` / global `getIssue`). When either is set, **the time window is not required** (no `time_range` / date range needed).
    - `parent_ids[]` returns **all** sub-issues of the given parents (Linear `getChildIssues`). It is a bounded relationship lookup, so it also **exempts the time window** — the full child set is returned regardless of age (a dependency-aware scheduler must not lose old children). `time_range` is therefore not required when `parent_ids[]` is set.

### Poll Tickets (daemon-friendly, no time window)
- Endpoint: `POST /api/v1/public/openapi/tickets/poll`
- Body: `status[]` (**required**), `product_ids[]?`, `product_line_ids[]?`, `since_updated_at?` (epoch seconds — only return tickets with `updated_at >` this), `page_num?`, `page_size?` (max 200)
- Notes:
    - No `time_range` — this is the difference from `tickets/search`. Use it for daemon reconcile loops that must see all open tickets regardless of age.
    - Ordered by `updated_at desc`; pass `since_updated_at` for incremental polling.
    - Response items are lightweight: `unique_id`, `display_id`, `status`, `priority`, `type`, `version_id`, `product_id`, `product_line_id`, `parent_id`, `assignees`, `updated_at`, `is_backlog`. For full detail call Get Version Ticket.
- Maps to skill-prm CLI: `cawplan tickets poll`.

### Get Version Ticket
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}`
- Returns the same `VersionTicket` shape as the internal API minus per-user `permissions`.

### Create Version Ticket (Issue / Sub-issue)
- Endpoint: `POST /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets`
- Body (required): `description` (HTML or plain text)
- Body (optional): `type` (`FEATURE`/`BUGFIX` — legacy; when omitted it is derived from `label_ids`), `priority` (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`), `status` (per-product-line status key), `assignee_ids[]`, `parent_id` (set this to make the ticket a sub-issue), `label_ids[]`, `reporter_id`, `due_date` (`YYYY-MM-DD`), `comment`
- Notes:
    - **`priority` and `status` are optional and defaulted server-side**: when omitted (or empty) the backend stores `priority = MEDIUM` and `status =` the product line's configured default status (or its first active status). An adapter that only carries a "todo" intent (Clawcode/Linear `createIssue`) can leave both unset and still get a well-formed ticket — no empty-string fields are persisted. A provided `status` is still validated against the product line.
    - When `parent_id` is set the new ticket becomes a sub-issue. Sub-issues must share the same `product_line` as the parent and the parent chain depth is capped at 5.
    - Activity is recorded with actor resolved from product owner / PM / first assignee (or `public-api-user` fallback).
- Maps to skill-prm CLI: `cawplan tickets create`.

### Update Version Ticket (transition / progress / fields)
- Endpoint: `PUT /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}`
- Body (all optional, sparse update): `status`, `priority`, `description`, `comment`, `progress_comment`, `assignee_ids[]`, `parent_id`, `label_ids[]`, `due_date`, `manual_progress`, `links[]`, `fix_versions[]`, `api_status`, `notifiers`
- Notes:
    - This is the primary "transition" + "comment" surface for adapters: change `status` to transition, set `progress_comment` (HTML) to record narrative work. `progress_comment` is a single string field — adapters that need multi-message threads should embed marker blocks (e.g. `<!-- clawcode-workpad-{runId} -->...<!-- /clawcode-workpad-{runId} -->`) and find/replace.
    - `status` must be a valid status key for the ticket's `product_line`. Read the ticket detail or list with `include=available_statuses` to discover the legal values; otherwise the call may fail with `invalid ticket status '...' for this product line`.
    - Externally synced tickets (Jira) reject status / priority edits.
    - Response includes `version_promoted: true` when the version status was auto-bumped to INPROGRESS.
    - **Optimistic lock (optional)**: the response carries the current `version` (integer). To guard against lost updates when multiple writers touch `progress_comment`, read the ticket, then PUT with `version` set to the value you read. If it no longer matches, the server returns **409 CONFLICT** with the current version — re-read and retry. Omitting `version` (or `0`) keeps the legacy last-writer-wins behaviour.
- Maps to skill-prm CLI: `cawplan tickets update` (`--expected_version N` to opt into the lock).

### Create / Get Product-Level (Backlog) Tickets
- Endpoints:
    - `POST /api/v1/public/openapi/product/{product_id}/tickets` (single)
    - `POST /api/v1/public/openapi/product/{product_id}/tickets/batch`
    - `GET  /api/v1/public/openapi/product/{product_id}/tickets` (list backlog)
    - `GET  /api/v1/public/openapi/product/{product_id}/tickets/{ticket_id}`
- Body (single): same as Create Version Ticket plus an **optional `version_id`**.
    - `version_id` omitted/null → **product-level (backlog)** ticket. Stored with `version_id = product_id`; response carries `is_backlog: true`.
    - `version_id` present → behaves like a version-level create under that version (`is_backlog: false`).
    - `parent_id` is validated for product-line / product / version compatibility.
    - `priority`/`status` defaulting (MEDIUM + product-line default status) applies here too — for both the single and the `/batch` endpoint — so omitting them never persists empty fields.
- This is the **canonical** create route for adapters (a single endpoint covers both backlog and version-level). The older `.../versions/{version_id}/tickets` route still works.
- Maps to skill-prm CLI: `cawplan tickets create <product_id> [--version_id VID | --backlog]`, `cawplan backlog list/get`.

## 4.1) Issue Relation APIs (Blocking / Blocked-by / Related / Duplicate)
> PRM stores **one row per relation pair** with a perspective-aware `relation_type`; reading from the other ticket inverts the type automatically. Adapters MUST NOT create the inverse row themselves — call once from either side.

### List Issue Relations
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}/relations`
- Returns `{ blocking[], blocked_by[], related[], duplicate[] }` from the perspective of `ticket_id`.
- Each entry contains `relation_id` and a `ticket` summary (display_id, status, priority, version, product, assignees).
- Maps to skill-prm CLI: `cawplan tickets relate list`.

### Create Issue Relation
- Endpoint: `POST /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}/relations`
- Body: `target_ticket_id` (the *other* ticket's `unique_id`), `relation_type` (`RELATED` | `BLOCKING` | `BLOCKED_BY` | `DUPLICATE`)
- Notes: only one relation may exist between two tickets (enforced by a `LEAST/GREATEST` unique index regardless of direction). Re-creating returns `relation already exists`; call `list` first if you need to overwrite.
- Maps to skill-prm CLI: `cawplan tickets relate create`.

### Update Issue Relation Type
- Endpoint: `PUT /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}/relations/{relation_id}`
- Body: `relation_type`
- Maps to skill-prm CLI: `cawplan tickets relate update`.

### Delete Issue Relation
- Endpoint: `DELETE /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}/relations/{relation_id}`
- Maps to skill-prm CLI: `cawplan tickets relate delete`.

## 5) Critical Issue APIs
### List Critical Issues
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/critical_issues`
- Query params: `time_range` (e.g. `1w`, `2w`, `1m`, `3m`, `1y`), `start`, `end`, `status` (CSV), `search`
- Response: `critical_issues.tickets` and `critical_issues.counts` (status counts)

### Search Critical Issues
- Endpoint: `POST /api/v1/public/openapi/critical_issues/search`
- Query params: `time_range` or `days` or (`start_date` + `end_date`), `page_size`, `page_num`
- Body: `status[]`, `issue_types[]`, `product_line_ids[]`, `product_type_ids[]`, `product_ids[]`, `tech_owners[]`, `search`
- Notes: OR within same field; AND across fields

### List Critical Issues by Product Line
- Endpoint: `GET /api/v1/public/openapi/product_line/{product_line_id}/critical_issues`
- Path params: `product_line_id` (product line `unique_id`)
- Query params: `time_range` OR (`start` + `end`), `status` (CSV), `search`
- Response: map keyed by product_id, each with `critical_issues` (tickets + counts)

### Get Critical Issue Detail
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/critical_issues/{critical_issue_id}`

### Create Critical Issue
- Endpoint: `POST /api/v1/public/openapi/product/{product_id}/critical_issues`
- Body fields (selected): `description` (HTML), `status`, `scope`, `issue_type`, `root_cause`, `solution`,
  `lesson_learned`, `fix_teams`, `tech_owners`, `jira_link`, `slack_link`, `zendesk_link`, `event_at`,
  `linked_cases`, `action_items`

### Update Critical Issue
- Endpoint: `PUT /api/v1/public/openapi/product/{product_id}/critical_issues/{critical_issue_id}`
- Body fields (all optional): `status`, `description`, `root_cause`, `solution`, `lesson_learned`,
  `progress_comment`, `tech_owners`, `linked_cases`

### Delete Critical Issue
- Endpoint: `DELETE /api/v1/public/openapi/product/{product_id}/critical_issues/{critical_issue_id}`

### Critical Issue Status Values
- `INVESTIGATING`, `MONITORING`, `IN_PROGRESS`, `QA_TESTING`, `RESOLVED`

### Linked Cases URL Whitelist
- `https://ubiquiti.atlassian.net/`
- `https://ui.slack.com/`
- `https://ubnt.zendesk.com/`
- `https://community.ui.com/`

## 6) Metrics APIs
### Get Product Metrics
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/metrics`
- Query params: `time_range` OR (`start` + `end`) required
- Response: `summary` (installations, crash_rate, offline_rate, update_success_rate),
  plus time series in `installations`, `crash_rate`, `offline_rate`

## Error Responses
- `401` Unauthorized
- `404` Not Found
- `400` Bad Request
- `500` Internal Error

## Activity APIs
See `references/CAWPLAN_ACTIVITY_API.md`.
