# PRM Open API (from UUM-PRM_ Open API-010226-061816.pdf)

## Base
- Base URL: `https://core-api-gw.uid.alpha.ui.com`
- Auth: `Authorization: <api-key>` header
- Notes: API key required; no JWT/RBAC per guide
- Contact for key: Neil Wei or Dada Chan (per guide)
### Local Caching (CLI)
- Cache file: `~/.config/prm/cache.json` (override with `PRM_CACHE_PATH`)
- TTL: `PRM_CACHE_TTL_HOURS` (default 12). `PRM_CACHE_TTL_DAYS` is deprecated.
- Commands with cache: users list/query, products list, product-lines list/detail, tickets search, critical search
- Bypass cache: add `--refresh`
- Clear cache: `prm cache clear`

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

## 3) Version APIs
### List Versions
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/versions`
- Path params: `product_id` (product `unique_id`)

### Get Version Detail
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/versions/{version_id}`

### Create Version (Version Plan)
- Endpoint: `POST /api/v1/public/openapi/product/{product_id}/versions`
- Body: `name` (required, e.g. `1.3.2`), `major_id` (required, the major version `unique_id`), `description?`, `extra?` (optional `target_release[]`, `monitor_link`, `hotfix`)
- Notes:
  - `major_id` is required to anchor the new version under a major release. Use `prm versions list <product_id>` (or `GET /api/v1/public/openapi/product/{product_id}/versions`) to discover existing major version IDs.
  - Major versions cannot be marked `hotfix`; minor versions may.
  - Activity is recorded with actor resolved from product owner / PM (or `public-api-user` fallback). RBAC is bypassed; workspace is taken from the API key.
- Maps to skill-prm CLI: `prm versions create`.

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
- Body: `product_ids[]`, `product_line_ids[]`, `version_ids[]`, `type[]`, `status[]`, `priority[]`, `platform[]`, `assignees[]`, `search`
- Notes: OR within same field; AND across fields

### Get Version Ticket
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}`
- Returns the same `VersionTicket` shape as the internal API minus per-user `permissions`.

### Create Version Ticket (Issue / Sub-issue)
- Endpoint: `POST /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets`
- Body (required): `description` (HTML or plain text), `type` (`FEATURE` or `BUGFIX`)
- Body (optional): `priority` (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`), `status` (per-product-line status key), `assignee_ids[]`, `parent_id` (set this to make the ticket a sub-issue), `label_ids[]`, `reporter_id`, `due_date` (`YYYY-MM-DD`), `comment`
- Notes:
  - When `parent_id` is set the new ticket becomes a sub-issue. Sub-issues must share the same `product_line` as the parent and the parent chain depth is capped at 5.
  - Activity is recorded with actor resolved from product owner / PM / first assignee (or `public-api-user` fallback).
- Maps to skill-prm CLI: `prm tickets create`.

### Update Version Ticket (transition / progress / fields)
- Endpoint: `PUT /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}`
- Body (all optional, sparse update): `status`, `priority`, `description`, `comment`, `progress_comment`, `assignee_ids[]`, `parent_id`, `label_ids[]`, `due_date`, `manual_progress`, `links[]`, `fix_versions[]`, `api_status`, `notifiers`
- Notes:
  - This is the primary "transition" + "comment" surface for adapters: change `status` to transition, set `progress_comment` (HTML) to record narrative work. `progress_comment` is a single string field — adapters that need multi-message threads should embed marker blocks (e.g. `<!-- clawcode-workpad-{runId} -->...<!-- /clawcode-workpad-{runId} -->`) and find/replace.
  - `status` must be a valid status key for the ticket's `product_line`. Read the ticket detail or list with `include=available_statuses` to discover the legal values; otherwise the call may fail with `invalid ticket status '...' for this product line`.
  - Externally synced tickets (Jira) reject status / priority edits.
  - Response includes `version_promoted: true` when the version status was auto-bumped to INPROGRESS.
- Maps to skill-prm CLI: `prm tickets update`.

## 4.1) Issue Relation APIs (Blocking / Blocked-by / Related / Duplicate)
> PRM stores **one row per relation pair** with a perspective-aware `relation_type`; reading from the other ticket inverts the type automatically. Adapters MUST NOT create the inverse row themselves — call once from either side.

### List Issue Relations
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}/relations`
- Returns `{ blocking[], blocked_by[], related[], duplicate[] }` from the perspective of `ticket_id`.
- Each entry contains `relation_id` and a `ticket` summary (display_id, status, priority, version, product, assignees).
- Maps to skill-prm CLI: `prm tickets relate list`.

### Create Issue Relation
- Endpoint: `POST /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}/relations`
- Body: `target_ticket_id` (the *other* ticket's `unique_id`), `relation_type` (`RELATED` | `BLOCKING` | `BLOCKED_BY` | `DUPLICATE`)
- Notes: only one relation may exist between two tickets (enforced by a `LEAST/GREATEST` unique index regardless of direction). Re-creating returns `relation already exists`; call `list` first if you need to overwrite.
- Maps to skill-prm CLI: `prm tickets relate create`.

### Update Issue Relation Type
- Endpoint: `PUT /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}/relations/{relation_id}`
- Body: `relation_type`
- Maps to skill-prm CLI: `prm tickets relate update`.

### Delete Issue Relation
- Endpoint: `DELETE /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}/relations/{relation_id}`
- Maps to skill-prm CLI: `prm tickets relate delete`.

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
See `references/PRM_ACTIVITY_API.md`.
