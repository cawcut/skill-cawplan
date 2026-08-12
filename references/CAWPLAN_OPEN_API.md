# CawPlan Open API

## Base
- Auth:
    - Interactive CLI: `Authorization: Bearer <accessToken>` from `cawplan auth login`.
- Notes:
    - `cawplan-cli` OAuth access tokens are identified by token source and checked against the user's RBAC scope on supported OpenAPI routes.
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
- Query params: `page_size` (default 10), `page_num` (default 1), `search`, `type_id`, `product_line_id`, `version_id` (filter by version `unique_id`, CSV)
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
- Maps to cawplan CLI: `cawplan product-lines statuses <product_line_id>`.

## 2.2) Label APIs
### List Labels (name → id resolution)
- Endpoint: `GET /api/v1/public/openapi/labels`
- Query params: `search` (case-insensitive substring on name), `product_id` (scope to a product's visible labels; omit for workspace-wide), `page_size`, `page_num`
- Response items: `unique_id`, `name`, `color`, `behavior` (`FEATURE` / `BUGFIX` / `null`), `is_system`, `product_id` (`null` = workspace-wide), `created_at`
- Notes: read-only. Adapters that receive label **names** (e.g. Linear) build a `name → unique_id` cache from this, then pass `label_ids[]` to create/update. No label write API is exposed.
- Maps to cawplan CLI: `cawplan labels list`.

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
- Maps to cawplan CLI: `cawplan versions create`.

### Get Release History
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/versions/{version_id}/release`
- Response items: `unique_id`, `version`, `status`, `release_date`

## 4) Ticket APIs
### List Version Tickets
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets`
- Query params: `type` (required: `FEATURE` or `BUGFIX`), `page_size`, `page_num`

### Search Version Tickets
- Endpoint: `POST /api/v1/public/openapi/tickets/search`
- Query params: `time_range` or (`start_date` + `end_date`), optionally also (`updated_start_date` + `updated_end_date`), `page_size`, `page_num`
- Body: `product_ids[]`, `product_line_ids[]`, `version_ids[]`, `unique_ids[]`, `display_ids[]`, `parent_ids[]`, `type[]`, `status[]`, `priority[]`, `platform[]`, `assignees[]`, `search`
- Notes:
    - OR within same field; AND across fields.
    - `unique_ids[]` / `display_ids[]` are exact-match lookups (Linear `fetchIssuesByIds` / global `getIssue`). When either is set, **the time window is not required** (no `time_range` / date range needed).
    - `parent_ids[]` returns **all** sub-issues of the given parents (Linear `getChildIssues`). It is a bounded relationship lookup, so it also **exempts the time window** — the full child set is returned regardless of age (a dependency-aware scheduler must not lose old children). `time_range` is therefore not required when `parent_ids[]` is set.
- **`start_date`/`end_date` filter `created_at`, not `updated_at`** — this is easy to miss since the field name isn't in the param name. A ticket created before the window but changed (status, assignee, comments, etc.) within it will **not** show up from `start_date`/`end_date` alone, no matter how the request is otherwise scoped (product/version/assignee filters don't change this). If the actual question is "what changed in this window" (release reports, member/team activity reports) rather than "what was created in this window," that's `updated_start_date`/`updated_end_date` (below), not `start_date`/`end_date`.
- **`updated_start_date`/`updated_end_date`** — independent, optional filter on `updated_at`. No default, not required, can be combined with `start_date`/`end_date` (AND) or used alone (pair with `start_date 2000-01-01`/today per the workaround below if you don't also want the created_at window narrowing results). `updated_at` has **no DB index** (unlike `created_at`), so keep this paired with a narrowing filter (`product_ids`, `assignees`, etc.) rather than firing it alone across a whole workspace/product line.
- **Canonical workaround for "every matching ticket regardless of age" queries** (e.g. release health checks, UX-pending sweeps, stale-ticket detection, or "what changed" reports that need `updated_start_date`/`updated_end_date` without the `created_at` window also narrowing results): none of `--version_ids`/`--product_ids`/`--product_line_ids`/`--priority`/`--type`/`--status`/`--assignees` exempt the time window on their own. Two valid options, pick per need:
    1. Pass a deliberately maximal window, e.g. `--start_date 2000-01-01 --end_date <today>` — use when you need a field only present on the full `VersionTicket` shape (see below), since Poll Tickets doesn't return it, or when combining with `updated_start_date`/`updated_end_date`.
    2. Switch to **Poll Tickets** (below) instead, which has no time window at all — use when the fields you need are in Poll's lightweight shape.
   Skills should reference this section rather than re-deriving the workaround independently.
- **`VersionTicket` fields of note** (full shape returned by Search/Get, not by Poll):
    - `ux`: `NOT_REQUIRED` / `PENDING` / `READY` — whether the ticket needs UX design work and where that stands. `PENDING` means UX was flagged as needed but isn't done; `NOT_REQUIRED` is the default and does **not** mean "needs UX."
    - `links[]`: external resource links, each `{ platform, url, title, external_id }`. `platform` is free text and not a reliable discriminator in practice (e.g. a GitHub PR/commit link can show `platform: "LINK"`) — classify by inspecting `url` instead (contains `/pull/` → PR, `/commit/` → commit).
    - `status_display.category`: the resolved workflow-status category (`UNSTARTED`/`STARTED`/`TESTING`/`COMPLETE`/`CANCELED`) for the ticket's current `status` key — same taxonomy as Get Product Line Ticket Statuses, provided inline so callers don't have to cross-reference it separately.

### Poll Tickets (daemon-friendly, no time window)
- Endpoint: `POST /api/v1/public/openapi/tickets/poll`
- Body: `status[]` (**required**), `product_ids[]?`, `product_line_ids[]?`, `since_updated_at?` (epoch seconds — only return tickets with `updated_at >` this), `page_num?`, `page_size?` (max 200)
- Notes:
    - No `time_range` — this is the difference from `tickets/search`. Use it for daemon reconcile loops that must see all open tickets regardless of age.
    - Ordered by `updated_at desc`; pass `since_updated_at` for incremental polling.
    - Response items are lightweight: `unique_id`, `display_id`, `status`, `priority`, `type`, `version_id`, `product_id`, `product_line_id`, `parent_id`, `assignees`, `updated_at`, `is_backlog`. For full detail call Get Version Ticket.
- Maps to cawplan CLI: `cawplan tickets poll`.

### Get Version Ticket
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}`
- Returns the same `VersionTicket` shape as the internal API minus per-user `permissions`.

### Create Version Ticket (Issue / Sub-issue)
- Endpoint: `POST /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets`
- Body (required): `description` (ticket title/summary; not the web page description body)
- Body (optional): `remarks` (ticket page body; HTML supported), `type` (`FEATURE`/`BUGFIX` — legacy; when omitted it is derived from `label_ids`), `priority` (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`), `status` (per-product-line status key), `assignee_ids[]`, `parent_id` (set this to make the ticket a sub-issue), `label_ids[]`, `reporter_id`, `due_date` (`YYYY-MM-DD`), `comment`
- Notes:
    - The web page description body is stored as `remarks`; set it with CLI `--remarks "<html>"`.
    - **`priority` and `status` are optional and defaulted server-side**: when omitted (or empty) the backend stores `priority = MEDIUM` and `status =` the product line's configured default status (or its first active status). An adapter that only carries a "todo" intent (Clawcode/Linear `createIssue`) can leave both unset and still get a well-formed ticket — no empty-string fields are persisted. A provided `status` is still validated against the product line.
    - When `parent_id` is set the new ticket becomes a sub-issue. Sub-issues must share the same `product_line` as the parent and the parent chain depth is capped at 5.
    - Activity is recorded with actor resolved from product owner / PM / first assignee (or `public-api-user` fallback).
- Maps to cawplan CLI: `cawplan tickets create`.

### Update Version Ticket (transition / progress / fields)
- Endpoint: `PUT /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}`
- Body (all optional, sparse update): `status`, `priority`, `version_id` (move ticket to another version), `description`, `remarks`, `comment`, `progress_comment`, `assignee_ids[]`, `parent_id`, `label_ids[]`, `due_date`, `manual_progress`, `links[]`, `fix_versions[]`, `api_status`, `notifiers`
- Notes:
    - `description` updates the ticket title/summary field. It does **not** update the web page description body; that body is stored as `remarks` and accepts HTML.
    - `version_id` updates the ticket's target version. CLI supports this through `cawplan tickets update ... --target_version_id <id>` or `--target-ver <name>`.
    - This is the primary "transition" + "comment" surface for adapters: change `status` to transition, set `progress_comment` (HTML) to record narrative work. `progress_comment` is a single string field — adapters that need multi-message threads should embed marker blocks (e.g. `<!-- clawcode-workpad-{runId} -->...<!-- /clawcode-workpad-{runId} -->`) and find/replace.
    - `status` must be a valid status key for the ticket's `product_line`. Read the ticket detail or list with `include=available_statuses` to discover the legal values; otherwise the call may fail with `invalid ticket status '...' for this product line`.
    - Externally synced tickets (Jira) reject status / priority edits.
    - Response includes `version_promoted: true` when the version status was auto-bumped to INPROGRESS.
    - **Optimistic lock (optional)**: the response carries the current `version` (integer). To guard against lost updates when multiple writers touch `progress_comment`, read the ticket, then PUT with `version` set to the value you read. If it no longer matches, the server returns **409 CONFLICT** with the current version — re-read and retry. Omitting `version` (or `0`) keeps the legacy last-writer-wins behaviour.
- Maps to cawplan CLI: `cawplan tickets update` (`--expected_version N` to opt into the lock).

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
- Maps to cawplan CLI: `cawplan tickets create <product_id> [--version_id VID | --backlog]`, `cawplan backlog list/get`.

## 4.1) Issue Relation APIs (Blocking / Blocked-by / Related / Duplicate)
> PRM stores **one row per relation pair** with a perspective-aware `relation_type`; reading from the other ticket inverts the type automatically. Adapters MUST NOT create the inverse row themselves — call once from either side.

### List Issue Relations
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}/relations`
- Returns `{ blocking[], blocked_by[], related[], duplicate[] }` from the perspective of `ticket_id`.
- Each entry contains `relation_id` and a `ticket` summary (display_id, status, priority, version, product, assignees).
- Maps to cawplan CLI: `cawplan tickets relate list`.

### Create Issue Relation
- Endpoint: `POST /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}/relations`
- Body: `target_ticket_id` (the *other* ticket's `unique_id`), `relation_type` (`RELATED` | `BLOCKING` | `BLOCKED_BY` | `DUPLICATE`)
- Notes: only one relation may exist between two tickets (enforced by a `LEAST/GREATEST` unique index regardless of direction). Re-creating returns `relation already exists`; call `list` first if you need to overwrite.
- Maps to cawplan CLI: `cawplan tickets relate create`.

### Update Issue Relation Type
- Endpoint: `PUT /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}/relations/{relation_id}`
- Body: `relation_type`
- Maps to cawplan CLI: `cawplan tickets relate update`.

### Delete Issue Relation
- Endpoint: `DELETE /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}/relations/{relation_id}`
- Maps to cawplan CLI: `cawplan tickets relate delete`.

## 5) AI Session Ticket Links
### Load Coding Session Ticket Context
- During `cawplan session collect`, session `human_inputs` are parsed for `ticket_id`, `ticket_display_id`, issue URLs, and display IDs. Resolved tickets receive `sessions[].ticket_ids[]` only when their `product_id` matches the session `product_id`.
- Ticket refs are resolved through `POST /api/v1/public/openapi/tickets/search`.

### Upload AI Session Report With Ticket Context
- Endpoint: `POST /api/v1/public/openapi/ai-session-usage/reports`
- Body: existing daily report payload with optional session-level `sessions[].ticket_ids[]`.
- Session-level `sessions[].ticket_ids[]` scopes the association to the exact coding session.
- Maps to CawPlan CLI: `cawplan session collect`.

## 6) Critical Issue APIs
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

## 7) Metrics APIs
### Get Product Metrics
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/metrics`
- Query params: `time_range` OR (`start` + `end`) required
- Response: `summary` (installations, crash_rate, offline_rate, update_success_rate),
  plus time series in `installations`, `crash_rate`, `offline_rate`

## 8) Analytics APIs
### Get Product AI Feedback Analytics
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/analytics`
- Query params: `time_range` OR (`start` + `end`) required; `version` (major.minor filter, e.g. `3.4`)
- Response: AI-categorized feedback buckets: `software_issues`, `hardware_issues`, `suggestions` — each with `counts`, `sorted_counts`, `stats` (time series), `tickets`, `versions`
- Maps to cawplan CLI: `cawplan analytics get <product_id>`.

## 9) Activity Report APIs
### Get Product Activity Report
- Endpoint: `GET /api/v1/public/openapi/product-report`
- Query params: `product_id` (required), `start` (YYYY-MM-DD, required), `end` (YYYY-MM-DD, required), `version_id` (optional)
- Response: `summary` (ticket_updates, critical_issue_updates, qa_report_updates, versions_affected), `versions[]` (each with tickets and their activity log), `critical_issues[]`
- Maps to cawplan CLI: `cawplan product-activity get`.

### Get User Activity Report
- Endpoint: `GET /api/v1/public/openapi/user-report`
- Query params: `user_id` OR `email` (one required), `start` (YYYY-MM-DD, required), `end` (YYYY-MM-DD, required)
- Response: activity summary scoped to a single user across all products they contribute to
- Maps to cawplan CLI: `cawplan user-activity get`.

## 10) QA Report APIs
### List QA Reports for a Product
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/qa_report`
- Query params: `type` (`sqa`|`aqa`|`stress`|`performance`|`smoke`), `result` (`pass`|`pass_with_issues`|`failed`), `status`, `page_size` (max 100), `page_num`
- Response: QA reports grouped by version
- Maps to cawplan CLI: `cawplan qa-reports list <product_id>`.

### List QA Reports for a Version
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/versions/{version_id}/qa_report`
- Query params: same as product-level (`type`, `result`, `status`, `page_size`, `page_num`)
- Maps to cawplan CLI: `cawplan qa-reports list-version <product_id> <version_id>`.

### Get QA Report Detail
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/versions/{version_id}/qa_report/{qa_report_id}`
- Maps to cawplan CLI: `cawplan qa-reports get <product_id> <version_id> <qa_report_id>`.

## 11) Community APIs
### Get Community Release Timeline
- Endpoint: `GET /api/v1/public/openapi/community/timeline`
- Query params: `time_range` OR (`start` + `end`); `channels` (CSV: `GA,EA,Alpha`)
- Response: release timeline events across all products for the given window and channels
- Maps to cawplan CLI: `cawplan community timeline`.

## 12) Knowledge APIs
### Search Knowledge Base
- Endpoint: `POST /api/v1/public/openapi/knowledge/search`
- Body: `query` (required), `product_id` (optional, scopes search to a product's knowledge datasets), `limit` (default 10)
- Response: ranked knowledge fragments with source metadata
- Maps to cawplan CLI: `cawplan knowledge search`.

## 13) Activity APIs
### Query Activities
- Endpoint: `POST /api/v1/public/openapi/activities/query`
- Query params:
    - `page_num` (int, default 1)
    - `page_size` (int, default 20, max 100)
    - `time_range` (string, e.g. `1d`, `1w`, `1m`, `3m`, `6m`, `1y`; default 7 days)
- Body:
    - `user_id` (string, optional) actor `unique_id`
    - `product_id` (string, optional)
    - `activity_types` (array, optional): `RELEASE`, `ISSUE`, `TICKET`, `VERSION`, `PRODUCT`, `USER`
- Response fields (selected):
    - `unique_id`
    - `actor.unique_id`, `actor.display_name`, `actor.alternate_id`, `actor.avatar`
    - `event.activity_scope` (user, product, version, system, organization)
    - `event.display_message`
    - `event.published` (ISO 8601)
    - `event.type` (RELEASE, ISSUE, TICKET, VERSION, PRODUCT, USER)
    - `targets[]`: `id`, `type` (product, product.version, product.line, product.type, user, critical_issue), `display_name`
    - `status`: `COMPLETED`, `IN_PROGRESS`, `FAILED`, `CANCELLED`, `PENDING`

## 14) AI Session Usage APIs
AI coding daily reports (`ai-daily-<date>.json`, schema `2.0`), workspace analytics, human-input quality, and product-repo mappings.

Most read endpoints accept `date` (`YYYY-MM-DD`) or `date_from` + `date_to`. Paginated breakdowns also accept `page_num` (default 1) and `page_size` (default 20, max 200). Overview endpoints optionally accept `compare_date`, `compare_date_from`, `compare_date_to` for period-over-period deltas.

### Upload AI Session Usage Daily Report
- Endpoint: `POST /api/v1/public/openapi/ai-session-usage/reports`
- Body: `daily.json` schema **2.0** (`additionalProperties` allowed)
- Required: `date` (`YYYY-MM-DD`), `author` (reporter key, usually git username)
- Optional (recommended): `schema`, `generated_at`, `totals`, `sessions[]`, `human_inputs[]`, `usage_breakdown`, `model_usage`, `repos[]`
- Notes:
    - Each `sessions[]` item should include `product_id` before upload.
    - `include_conversation` (bool, default `false`) — when `true`, non-empty `sessions[].conversation` is encrypted server-side.
- Response: `report_id`, `upserted`, `report_date`, `reporter_key`
- Maps to cawplan CLI: `cawplan session report --file <path>`

### List Uploaded AI Session Usage Reports
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/reports`
- Query params: `date`, `date_from`, `date_to`, `user_id`, `include_payload` (bool, default `false`), `limit` (default 20, max 100), `offset` (default 0)
- Response: report metadata list for the workspace; `include_payload=true` returns decrypted `raw_payload`
- Maps to cawplan CLI: `cawplan session reports`

### Get AI Session Usage Overview
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/overview`
- Query params: `date`, `date_from`, `date_to`, `compare_date`, `compare_date_from`, `compare_date_to`
- Response: `member_count`, `total_cost`, `total_tokens`, `date_from`, `date_to`, plus optional `compare_*` change fields
- Maps to cawplan CLI: `cawplan session overview`

### Get AI Session Usage Trend
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/trend`
- Query params: `date`, `date_from`, `date_to`, `page_num`, `page_size`
- Response: daily rows with `date`, `cost`, `cost_percentage`, `tokens`, `members`
- Maps to cawplan CLI: `cawplan session trend`

### Get AI Session Usage by Member
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/by-member`
- Query params: `date`, `date_from`, `date_to`, `page_num`, `page_size`
- Response: per-member rows with `member`, `user_id`, `user_display_name`, `user_avatar`, `cost`, `cost_percentage`, `tokens`
- Maps to cawplan CLI: `cawplan session by-member`

### Get AI Session Usage by Model
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/by-model`
- Query params: `date`, `date_from`, `date_to`, `page_num`, `page_size`
- Response: per-model rows with `model`, `cost`, `cost_percentage`, `tokens`
- Maps to cawplan CLI: `cawplan session by-model`

### Get AI Session Usage by Model Dimension
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/by-model-dimension`
- Query params: `date`, `date_from`, `date_to`, `page_num`, `page_size`
- Response: cost breakdown by model plus billing dimension (input/output/cache)
- Maps to cawplan CLI: `cawplan session by-model-dimension`

### Get AI Session Usage by Agent
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/by-agent`
- Query params: `date`, `date_from`, `date_to`, `page_num`, `page_size`
- Response: cost breakdown by coding agent (e.g. Claude Code, Cursor)
- Maps to cawplan CLI: `cawplan session by-agent`

### Get AI Session Usage by Project
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/by-project`
- Query params: `date`, `date_from`, `date_to`, `page_num`, `page_size`
- Response: cost breakdown by git project/repository name
- Maps to cawplan CLI: `cawplan session by-project`

### Get AI Session Usage by Product
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/by-product`
- Query params: `date`, `date_from`, `date_to`, `page_num`, `page_size`, `product_id`, `fuzzy_match` (bool, default `false`)
- Notes: when `fuzzy_match=true`, product-repo `repo_name` glob patterns (`*`, `?`) match `sessions[].project`; unmatched sessions roll into `Other`
- Response: cost breakdown by product
- Maps to cawplan CLI: `cawplan session by-product`

### List AI Session Usage Report Dates
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/dates`
- Response: array of `YYYY-MM-DD` strings, newest first
- Maps to cawplan CLI: `cawplan session dates`

### List AI Session Usage Members
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/members`
- Response: members (`reporter_key`) who have uploaded reports in the workspace
- Maps to cawplan CLI: `cawplan session members`

### Get AI Session Usage Member Detail
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/member-detail`
- Query params: `member` (required, reporter key)
- Response: full session/cost detail for one member
- Maps to cawplan CLI: `cawplan session member-detail --member <name>`

### Get Human Input Summary
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/human-input-summary`
- Query params: `date`, `date_from`, `date_to`
- Response: `total`, `files_changed`, `lines_added`, `lines_deleted`, `categories[]`, `topics[]`, `low_classification_confidence`, `classification_confidence_threshold`, `members[]`
- Maps to cawplan CLI: `cawplan session human-input-summary`

### List Human Inputs
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/human-inputs`
- Query params: `date`, `date_from`, `date_to`, `member`, `product`, `category`, `topic`, `model`, `needs_review` (bool), `q`, `page_num`, `page_size`
- Response: `items[]`, `total`, `limit`, `offset`
- Maps to cawplan CLI: `cawplan session human-inputs`

### List Human Input Logs
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/human-input-logs`
- Query params: same as List Human Inputs
- Response: same shape as List Human Inputs

### Get Human Input Quality
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/human-input-quality`
- Query params: `date`, `date_from`, `date_to`, `limit` (default 100, max 500)
- Response: `low_classification_confidence`, `classification_confidence_threshold`, `items[]` (prompt rows flagged for review)
- Maps to cawplan CLI: `cawplan session human-input-quality`

### Get Human Input by Product
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/human-input-by-product`
- Query params: `date`, `date_from`, `date_to`, `page_num`, `page_size`
- Response: prompt counts and quality breakdown grouped by product/project
- Maps to cawplan CLI: `cawplan session human-input-by-product`

### Get User AI Session Usage Overview
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/user/{user_id}/overview`
- Path params: `user_id` (user `unique_id`)
- Query params: `date`, `date_from`, `date_to`, `compare_date`, `compare_date_from`, `compare_date_to`
- Response: user-scoped overview with optional comparison deltas
- Maps to cawplan CLI: `cawplan session my-sessions` (combined with sessions)

### Get User AI Session Usage Sessions
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/user/{user_id}/sessions`
- Path params: `user_id` (user `unique_id`)
- Query params: `date`, `date_from`, `date_to`
- Response: session list for the user in the date window
- Maps to cawplan CLI: `cawplan session my-sessions`

### Get User Human Input Summary
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/user/{user_id}/human-input-summary`
- Path params: `user_id` (user `unique_id`)
- Query params: `date`, `date_from`, `date_to`
- Response: same shape as workspace Human Input Summary, scoped to one user
- Maps to cawplan CLI: `cawplan session user-human-inputs --user-id <id>`

### List User Human Input Logs
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/user/{user_id}/human-input-logs`
- Path params: `user_id` (user `unique_id`)
- Query params: `date`, `date_from`, `date_to`, `category`, `topic`, `model`, `needs_review`, `q`, `page_num`, `page_size`
- Response: paginated human-input rows for the user

### Get Product AI Session Usage Overview
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/product/{product_id}/overview`
- Path params: `product_id` (product `unique_id`)
- Query params: `date`, `date_from`, `date_to`, `compare_date`, `compare_date_from`, `compare_date_to`
- Response: product-scoped overview with optional comparison deltas
- Maps to cawplan CLI: `cawplan session product-overview --product-id <id>`

### Get Product AI Session Usage Trend
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/product/{product_id}/trend`
- Path params: `product_id` (product `unique_id`)
- Query params: `date`, `date_from`, `date_to`, `page_num`, `page_size`
- Response: daily trend rows for the product
- Maps to cawplan CLI: `cawplan session product-trend --product-id <id>`

### Get Product AI Session Usage by Member
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/product/{product_id}/by-member`
- Path params: `product_id` (product `unique_id`)
- Query params: `date`, `date_from`, `date_to`, `page_num`, `page_size`
- Response: per-member cost breakdown for the product
- Maps to cawplan CLI: `cawplan session product-by-member --product-id <id>`

### Get Product AI Session Usage by Model
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/product/{product_id}/by-model`
- Path params: `product_id` (product `unique_id`)
- Query params: `date`, `date_from`, `date_to`, `page_num`, `page_size`
- Response: per-model cost breakdown for the product
- Maps to cawplan CLI: `cawplan session product-by-model --product-id <id>`

### Get Product Human Input Summary
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/product/{product_id}/human-input-summary`
- Path params: `product_id` (product `unique_id`)
- Query params: `date`, `date_from`, `date_to`
- Response: same shape as workspace Human Input Summary, scoped to one product
- Maps to cawplan CLI: `cawplan session product-human-inputs --product-id <id>`

### List Product Human Input Logs
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/product/{product_id}/human-input-logs`
- Path params: `product_id` (product `unique_id`)
- Query params: `date`, `date_from`, `date_to`, `category`, `topic`, `model`, `needs_review`, `q`, `page_num`, `page_size`
- Response: paginated human-input rows for the product

### List Product-Repo Mappings
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/product-repo`
- Query params: `product_id` (optional filter)
- Response: `mappings[]` with `unique_id`, `product_id`, `product_name`, `repo_name`, `repo_url`, `added_by`, `added_date`, `contributors[]`, `last_update`
- Maps to cawplan CLI: `cawplan session product-repos`

### Create Product-Repo Mapping
- Endpoint: `POST /api/v1/public/openapi/ai-session-usage/product-repo`
- Body (required): `product_id`, `repo_name`
- Body (optional): `repo_url`, `contributors[]` (user `unique_id` list), `last_update` (ISO 8601)
- Notes: `repo_name` may be a glob when queries use `fuzzy_match=true` (e.g. `uid.core-*`)
- Response: created mapping item
- Maps to cawplan CLI: `cawplan session product-repos create --product-id --repo-url [--repo-name]`

### Get Product-Repo Mapping
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/product-repo/{unique_id}`
- Path params: `unique_id` (mapping `unique_id`)
- Response: single mapping item

### Update Product-Repo Mapping
- Endpoint: `PATCH /api/v1/public/openapi/ai-session-usage/product-repo/{unique_id}`
- Path params: `unique_id` (mapping `unique_id`)
- Body (all optional): `product_id`, `repo_name`, `repo_url`, `contributors[]`, `last_update`
- Response: updated mapping item

### Delete Product-Repo Mapping
- Endpoint: `DELETE /api/v1/public/openapi/ai-session-usage/product-repo/{unique_id}`
- Path params: `unique_id` (mapping `unique_id`)
- Response: standard success envelope

### Get AI Session Conversation
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/conversation`
- Query params: `entry_id` (required, `ai_session_entry.unique_id`)
- Response: decrypted conversation JSON for one session entry
- Maps to cawplan CLI: `cawplan session conversation --entry-id <id>`

### Download AI Session Usage PDF Report
- Endpoint: `GET /api/v1/public/openapi/ai-session-usage/report.pdf`
- Query params: `date` or `date_from` + `date_to`, `fuzzy_match` (optional)
- Response: `application/pdf` binary

## 15) QA Insights APIs
Module tree and Requirement archive for Test Suites. **Public Open API only** — do not use Internal routes (`/api/v1/product/{unique_id}/qa/...`).

**CLI routing**: the four **write** endpoints go through the `cawplan qa-insights` command family, which owns the correctness-critical rules (five-field strong match, PATCH changed-keys diff, batch all-or-nothing, forbidden-field rejection, UNKNOWN handling). **`cawplan-testcase-generate` reads** (single Requirement, List TestPoints) also go through `cawplan qa-insights` (`requirements get`, `testpoints list`); other reads (module tree, requirement list) still use the `cawplan api GET` escape hatch. Reconcile paths (`requirements reconcile`, `testpoints reconcile`) are read-only and never write.

### Get Module Tree
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/qa/module-tree`
- Path params: `product_id` (product `unique_id`)
- Response: `product_id`, hierarchical `nodes[]` (`id`, `name`, `parent_id`, `level`, `children[]`); `nodes` may be empty
- Maps to cawplan CLI: `cawplan api GET /api/v1/public/openapi/product/{product_id}/qa/module-tree`

### Create Module Tree Node
- Endpoint: `POST /api/v1/public/openapi/product/{product_id}/qa/module-tree`
- Path params: `product_id`
- Body: `parent_id` (node `id`, or `null` for a root node), `name` (required)
- Response: single node `id`, `name`, `parent_id`, `level`
- Notes: depth > 5 → `FAILURE_INVALID_INPUT` (`module tree depth exceeds limit (5)`)
- Maps to cawplan CLI: `cawplan qa-insights module-tree node create {product_id} --name "..."` (omit `--parent-id` for a root node)

### Create Requirement
- Endpoint: `POST /api/v1/public/openapi/product/{product_id}/qa/requirements`
- Path params: `product_id` (**do not include `product_id` in the body**)
- Body (required): `module_tree_node_id`, `function_description`, `entry_trigger`, `normal_expectation`, `constraints`
- Body (optional on API): `out_of_scope`, `ticket_id` (ticket `display_id`), `summary` (display label for list/cards — API allows null)
- Notes:
    - `summary`: short one-line overview for QA Insights list display. **Not** one of the five requirement fields; **not** test-point input. `cawplan-requirement-analyze` always sends non-empty `summary` on POST.
    - Do not send `review_status` (defaults to `PENDING`) or `is_edited` (TestPoint field only).
    - Response `data.url` is a **portal deep-link path** (e.g. `/product/{product_id}/qa-insights/test-suites/requirements/{id}`) for opening Test Suites in the browser — **not** a Public Open API route. Return it to the user as-is from the response; **never** construct or guess this path.
    - Response `data.id` is the requirement id for later API calls (e.g. `GET .../qa/requirements/{id}`, `POST .../qa/requirements/{id}/testpoints/batch`).
- Maps to cawplan CLI: `cawplan qa-insights requirements create {product_id} --body-file <path>`
- Example body: `{"summary":"道具图固定1:1裁剪","function_description":"...","entry_trigger":"...","normal_expectation":"...","constraints":"...","out_of_scope":"...","module_tree_node_id":"<id>","ticket_id":"CAWP-04606"}`

### Update Requirement
- Endpoint: `PATCH /api/v1/public/openapi/product/{product_id}/qa/requirements/{requirement_id}`
- Path params: `product_id`, `requirement_id`
- Body: any subset of `function_description`, `entry_trigger`, `normal_expectation`, `constraints`, `out_of_scope`, `summary`, `ticket_id` — send **only changed** fields
- Notes: do not send `product_id`, `review_status`, or `is_edited` in the body. `summary` may be cleared with empty string or `null`. `ticket_id` is the ticket **display_id** (e.g. `CAWP-04606`); pass `null` to unlink. Use when updating an existing Requirement after hot/cold handoff; compare five fields against `five_field_snapshot`, `summary` against `summary_snapshot`, and `ticket_id` against `ticket_id_snapshot` before PATCH vs POST create. Example bodies (changed keys only): `{"constraints":"..."}`, `{"summary":"..."}`, `{"ticket_id":"CAWP-04606"}`, `{"ticket_id":null}`
- Maps to cawplan CLI: `cawplan qa-insights requirements update {product_id} {requirement_id} --desired '<json>' --snapshot '<json>'` — pass complete states; the command derives the changed keys and PATCHes only those

### Get Requirement (read — single item)
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/qa/requirements/{requirement_id}`
- Path params: `product_id`, `requirement_id`
- Response: single `QARequirement` in `data` — five fields, `summary` (`null` if unset), optional `url` (portal deep-link path, often `null`), and metadata (`id`, `module_tree_node_id`, `review_status`, `ticket_id`, etc.)
- Notes: **primary path for `cawplan-testpoint-generate`** — cold handoff and pre-generate refresh (hot/cold). Use `data` directly; no list filter. `404` → Requirement missing or deleted. RBAC: `qa_insights.view`.
- Maps to cawplan CLI: `cawplan api GET /api/v1/public/openapi/product/{product_id}/qa/requirements/{requirement_id}`

### List Requirements (read — reconcile)
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/qa/requirements`
- Query params: `module_tree_node_id` (optional), `version_id` (optional)
- Response: array of requirements (not paginated); each row includes five fields, `summary` (`null` if unset), optional `url` (portal deep-link path, often `null`), and metadata; filter client-side by `id` when needed.
- Notes: used by `cawplan-requirement-analyze` when a POST/PATCH outcome is **unknown** (network/timeout) — list rows under the target `module_tree_node_id` and compare **five fields only** to avoid duplicate POST creates. **Strong match / dedup compares five fields only** — `summary` does **not** participate. Reconcile compare rules: see `skills/cawplan-requirement-analyze/SKILL.md` §10 (Field comparison). **Not** used by `cawplan-testpoint-generate` for fetching five fields (use Get Requirement above).
- Maps to cawplan CLI: `cawplan api GET /api/v1/public/openapi/product/{product_id}/qa/requirements --query "module_tree_node_id=..."`

### List TestPoints (read — probe, incremental, UNKNOWN reconcile)
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/qa/requirements/{requirement_id}/testpoints`
- Path params: `product_id`, `requirement_id`
- Response: `test_points[]` for the requirement, stable order by `sort_order` (backend-assigned). Each item includes `id`, `requirement_id`, `title`, `tags[]`, `group`, `is_edited`, `created_by`, `created_at`, `updated_at`.
- Notes:
    - **No sequence number in response** — caller computes N / N.M from `group` + return order (empty `group` → "未分组", last). See `cawplan-testpoint-generate` A2_SPEC §4.4.
    - Used before generate (first vs incremental, stubs), and after ambiguous POST (count reconcile). `cawplan-testpoint-generate` does **not** use PATCH/DELETE on archived rows.
- Maps to cawplan CLI: `cawplan api GET /api/v1/public/openapi/product/{product_id}/qa/requirements/{requirement_id}/testpoints`

### Batch Create TestPoints (write — archive drafts)
- Endpoint: `POST /api/v1/public/openapi/product/{product_id}/qa/requirements/{requirement_id}/testpoints/batch`
- Path params: `product_id`, `requirement_id` (**do not include in body**)
- Body: `{ "test_points": [ { "title", "tags", "group", "is_edited" }, ... ] }`
- Notes:
    - Each item: **only** `title`, `tags`, `group`, `is_edited`. `tags` may be `[]`; `group` may be empty (display as 未分组).
    - **Do not send**: `id`, `sort_order`, `product_id`, `requirement_id`, review fields, or display sequence N/N.M.
    - Array order = display order = backend `sort_order`. Batch is all-or-nothing (no partial success).
    - Response on `code: SUCCESS`: `data.test_points[]` — same length as POST array; each item echoes `title`, `tags`, `group`, `is_edited` from the request plus server-assigned `id`, `requirement_id`, `created_by`, `created_at`, `updated_at` (same shape as List TestPoints rows).
    - **`cawplan-testpoint-generate` counts shown to SQA**: **only** in post-POST success receipt (`已归档 N 条…`, N = `body.test_points.length`). **Do not** output `共 N 条草稿`, `本轮新增 M 条`, `其余 K 条为已存`, or any other row-count summary after tables; do not put counts in archive prompts or §8.4 read-back — agents cannot reliably count table rows in chat. Incremental display uses per-row `已存`/`新增` status column only (optional non-numeric footer allowed).
    - **`cawplan-testpoint-generate` success receipt**: agent stores returned `id`s in session stubs only; tells SQA a one-line count confirmation (e.g. `已归档 N 条到 Requirement〔标题〕下`, N = POST length) — **does not** list per-row `id`s or titles, **does not** re-generate or summarize titles after POST, **does not** post-hoc apologize for miscounts; appends Requirement `url` from refresh **only when non-empty** — **never** mentions missing `url` (no "未返回 url"/"无法附链接").
- Maps to cawplan CLI: `cawplan qa-insights testpoints archive {product_id} {requirement_id} --body-file <path>`
- Example body: `{"test_points":[{"title":"用户名含特殊字符注册时应被拦截并明确提示","tags":["异常"],"group":"注册校验","is_edited":false}]}`

## Error Responses
- `401` Unauthorized
- `404` Not Found
- `400` Bad Request
- `500` Internal Error
