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
