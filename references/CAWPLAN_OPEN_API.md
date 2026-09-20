# CawPlan Open API

## Base
- Auth:
    - Interactive CLI: `Authorization: Bearer <accessToken>` from `cawplan auth login`.
- Notes:
    - `cawplan-cli` OAuth access tokens are identified by token source and checked against the user's RBAC scope on supported OpenAPI routes.
### Local Caching (CLI)
- Cache file: `~/.cawplan/cache.json` (override with `CAWPLAN_CACHE_PATH`)
- TTL: `CAWPLAN_CACHE_TTL_HOURS` (default 12)
- Commands with cache: users list/query, products list, product-lines list/get, tickets search, critical search, knowledge documents get
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
- Response: list of products with `unique_id`, `name`, `description`, `product_type`, `product_line`, `controls` (array of enabled feature keys, e.g. `dashboard`, `version-plans`, `issues-suggestions`, `knowledge`, `test-suites`, `coding-insights` — a product only has coding session data if `coding-insights` is present), plus paging

### Get Product Overview
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/overview`
- Path params: `product_id` (product `unique_id`)
- Response envelope: `code`, `data`, `msg` — success when `code == "SUCCESS"` and `data.description` is non-empty
- Response `data` (top-level fields used by `cawplan-requirement-analyze`): `name`, `description` — ignore other `data` keys such as `product_line`, `type`, `product_types`
- Notes: read-only product background for agent context; not a QA Insights route
- Maps to cawplan CLI: `cawplan api GET /api/v1/public/openapi/product/{product_id}/overview`

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
- Body: `product_ids[]`, `product_line_ids[]`, `version_ids[]`, `unique_ids[]`, `display_ids[]`, `parent_ids[]`, `type[]`, `status[]`, `excluded_status[]`, `ux[]`, `status_categories[]`, `excluded_status_categories[]`, `priority[]`, `platform[]`, `assignees[]`, `search`
- Notes:
    - OR within same field; AND across fields.
    - `ux[]` filters by UX state (`NOT_REQUIRED`, `PENDING`, `READY`). `excluded_status[]` excludes tickets whose status key is in the supplied list. `status_categories[]` includes, and `excluded_status_categories[]` excludes, resolved product-line categories (`BACKLOG`, `UNSTARTED`, `STARTED`, `TESTING`, `COMPLETE`, `CANCELED`, `JIRA`). CLI: `--ux PENDING,READY --excluded_status DONE,CANCELED --status_categories STARTED,TESTING --excluded_status_categories COMPLETE,CANCELED`.
    - `unique_ids[]` / `display_ids[]` are exact-match lookups (Linear `fetchIssuesByIds` / global `getIssue`). When either is set, **the time window is not required** (no `time_range` / date range needed).
    - `parent_ids[]` returns **all** sub-issues of the given parents (Linear `getChildIssues`). It is a bounded relationship lookup, so it also **exempts the time window** — the full child set is returned regardless of age (a dependency-aware scheduler must not lose old children). `time_range` is therefore not required when `parent_ids[]` is set.
- **`start_date`/`end_date` filter `created_at`, not `updated_at`** — this is easy to miss since the field name isn't in the param name. A ticket created before the window but changed (status, assignee, comments, etc.) within it will **not** show up from `start_date`/`end_date` alone, no matter how the request is otherwise scoped (product/version/assignee filters don't change this). If the actual question is "what changed in this window" (release reports, member/team activity reports) rather than "what was created in this window," that's `updated_start_date`/`updated_end_date` (below), not `start_date`/`end_date`.
- **`updated_start_date`/`updated_end_date`** — independent, optional filter on `updated_at`. No default, not required, can be combined with `start_date`/`end_date` (AND) or used alone (pair with `start_date 2000-01-01`/today per the workaround below if you don't also want the created_at window narrowing results). `updated_at` has **no DB index** (unlike `created_at`), so keep this paired with a narrowing filter (`product_ids`, `assignees`, etc.) rather than firing it alone across a whole workspace/product line.
- **`updated_at` is not "completed at"** — it's the record's overall last-modified time, refreshed by *any* field change (status, version transfer, priority, assignee, comments, etc.), not specifically a status→`DONE` transition. Confirmed live: [CAWP-18478](https://app.cawplan.com/issue/CAWP-18478) moved to `DONE` on 2026-08-13 (inside an 08-10~08-16 report window), then had an unrelated version transfer (1.6.34 → 1.6.33) on 2026-08-17 that bumped `updated_at` to 08-17 — a report scoped to `--updated_start_date 2026-08-10 --updated_end_date 2026-08-16` silently drops this ticket even though it genuinely completed inside the window. The same mechanism can also cause a **false positive** the other way: a ticket that completed *before* a window but got an unrelated edit *inside* the window will show up as "changed" with a current status of `DONE`, which is easy to mis-report as "completed in this window" if you only check current status. Any report computing "completed in window N" from `status`/`updated_at` alone is subject to both failure modes — use **Get Version Ticket History** (below) to verify the actual completion timestamp instead of trusting `updated_at` or current status for that specific claim.
- **Canonical workaround for "every matching ticket regardless of age" queries** (e.g. release health checks, UX-pending sweeps, stale-ticket detection, or "what changed" reports that need `updated_start_date`/`updated_end_date` without the `created_at` window also narrowing results): none of `--version_ids`/`--product_ids`/`--product_line_ids`/`--priority`/`--type`/`--status`/`--assignees` exempt the time window on their own. Two valid options, pick per need:
    1. Pass a deliberately maximal window, e.g. `--start_date 2000-01-01 --end_date <today>` — use when you need a field only present on the full `VersionTicket` shape (see below), since Poll Tickets doesn't return it, or when combining with `updated_start_date`/`updated_end_date`.
    2. Switch to **Poll Tickets** (below) instead, which has no time window at all — use when the fields you need are in Poll's lightweight shape.
   Skills should reference this section rather than re-deriving the workaround independently.
- **`VersionTicket` fields of note** (full shape returned by Search/Get, not by Poll):
    - `ux`: `NOT_REQUIRED` / `PENDING` / `READY` — whether the ticket needs UX design work and where that stands. `PENDING` means UX was flagged as needed but isn't done; `NOT_REQUIRED` is the default and does **not** mean "needs UX."
    - `links[]`: external resource links, each `{ platform, url, title, external_id }`. `platform` is free text and not a reliable discriminator in practice (e.g. a GitHub PR/commit link can show `platform: "LINK"`) — classify by inspecting `url` instead (contains `/pull/` → PR, `/commit/` → commit).
    - `status_display.category`: the resolved workflow-status category (`UNSTARTED`/`STARTED`/`TESTING`/`COMPLETE`/`CANCELED`) for the ticket's current `status` key — same taxonomy as Get Product Line Ticket Statuses, provided inline so callers don't have to cross-reference it separately.

### Get Version Ticket History
- Endpoint: `GET /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}/history`
- Maps to cawplan CLI: `cawplan tickets history <product_id> <version_id> <ticket_id>`
- Response: `data[]`, newest first, each entry:
    - `action_type`: `CREATED` / `UPDATED` / `TRANSFERRED` (version moves) — other action types may exist; don't assume this list is exhaustive.
    - `changed_fields`: `null` for `CREATED`; for `UPDATED` a map of field → `{old, new}` (e.g. `{"status": {"old": "READY_FOR_QA", "new": "DONE"}}`); for `TRANSFERRED` a `{"transfer": {"source": {...}, "target": {...}}}` shape (product/version/major_version/is_backlog on each side) — a version transfer has **no `status` key** in `changed_fields`, so it cannot be mistaken for a status transition.
    - `created_at`: ISO-8601 string (not epoch, unlike `VersionTicket.created_at`/`updated_at`) — this is the timestamp of that specific history event, e.g. the exact moment a status transition happened.
    - `user_id`/`user_display_name`/`user_avatar`: actor who made the change; `source`/`source_id`: set for non-manual changes (e.g. an integration), `null` for direct edits.
- **Canonical pattern: finding the real "completed at" timestamp for a ticket** (use this instead of trusting `updated_at` or current status when a report specifically claims "completed in window [A, B]"):
    1. Fetch history and scan for entries where `action_type == "UPDATED"` and `changed_fields.status.new` resolves to a `COMPLETE`- or `CANCELED`-category status (cross-reference via Get Product Line Ticket Statuses, same lookup `cawplan-my-work` uses for reopen detection).
    2. Take the **latest** such entry (a ticket can cycle done → reopened → done again; only the most recent completion is "when it's currently done since") — its `created_at` is the ticket's actual completion timestamp. If no such entry exists (rare: created directly into a terminal status), fall back to the `CREATED` entry's `created_at`.
    3. A ticket only counts as "completed in window [A, B]" if that timestamp falls inside `[A, B]` — regardless of what its current `updated_at` says.
    - This adds one `tickets history` call per *candidate* ticket (ones whose current `status_display.category` is `COMPLETE`/`CANCELED`), not per ticket in the whole result set — bound the candidate set with `status`/`product_ids`/`assignees` filters on the search call first.

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
- Body (all optional, sparse update): `status`, `priority`, `version_id` (move ticket to another version), `description`, `remarks`, `comment`, `progress_comment`, `root_cause`, `solution`, `assignee_ids[]`, `parent_id`, `label_ids[]`, `due_date`, `manual_progress`, `links[]`, `fix_versions[]`, `api_status`, `notifiers`
- Notes:
    - `description` updates the ticket title/summary field. It does **not** update the web page description body; that body is stored as `remarks` and accepts HTML.
    - `version_id` updates the ticket's target version. CLI supports this through `cawplan tickets update ... --target_version_id <id>` or `--target-ver <name>`.
    - `root_cause`/`solution` are plain strings on write but come back on read (`tickets get`/`tickets search`) as `UserDataInfo` objects (`{display_name, user_id, avatar, data, updated_at}` — the actual text is in `.data`) with author/timestamp attribution auto-filled server-side from the update caller. Only processed for `type: BUGFIX` — silently ignored on a FEATURE ticket, so don't set them expecting an effect there. CLI: `cawplan tickets update ... --root_cause "<text>" --solution "<text>"`.
    - This is the primary "transition" + "comment" surface for adapters: change `status` to transition, set `progress_comment` (HTML) to record narrative work. `progress_comment` is a single string field — adapters that need multi-message threads should embed marker blocks (e.g. `<!-- clawcode-workpad-{runId} -->...<!-- /clawcode-workpad-{runId} -->`) and find/replace.
    - `status` must be a valid status key for the ticket's `product_line`. Read the ticket detail or list with `include=available_statuses` to discover the legal values; otherwise the call may fail with `invalid ticket status '...' for this product line`.
    - Externally synced tickets (Jira) reject status / priority edits.
    - Ticket-edit access is resource-scoped per ticket, not just a bare `ticket.edit` permission key — verified live that even a same-product/team ticket can 403 with `user has 'ticket.edit' but lacks access to ticket '<id>'` if the caller's role scope doesn't cover it, regardless of which fields are being updated (confirmed by isolating a plain `--comment`-only update, which failed identically). The path `{ticket_id}` must be the ticket **`unique_id` (UUID)**; a display_id such as `CAWP-20544` is not recognized by RBAC resource lookup. **`cawplan tickets update` (and `get` / `history` / `relate` / `backlog get`) auto-resolve display_id via `tickets search` before calling the API**; raw HTTP clients must resolve first.
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

> The device/app metrics public endpoint that used to live here
> (`GET /api/v1/public/openapi/product/{product_id}/metrics`, and the CLI's
> `cawplan metrics get`) has been retired — it is no longer publicly exposed
> via API key/CLI. The underlying device-metrics feature (installations,
> crash rate, etc.) still exists and still serves the internal web app
> (`GET /api/v1/product/{unique_id}/metrics`); only the public-openapi wrapper
> and its CLI command are gone. `cawplan metrics` now refers exclusively to
> the generic business key-metrics system below.

### Key Metrics APIs (generic business events)

A single schema for every non-device business metric: one `business_event`
per occurrence, tagged by `domain` + `metric` (e.g. `domain=cawplan_subscription`,
`metric=new`), plus a fixed dimension bundle (`app`, `platform`, `product`,
`workspace_id`, `plan`, `region`, `environment`) and arbitrary extra tags.
`workspace_id` is the tenant-attribution dimension — every domain here is
workspace-scoped data, so filter/group by it whenever a query should be
scoped to one tenant rather than the whole database. Fields are `value`,
`count`, `cost`, `credit` — only the ones actually supplied on a point are
stored (no zero-fill), so query results distinguish "not measured" from
"measured zero". Every domain is prefixed `cawplan_`.

Every domain and metric name is defined up front in `internal/metrics/metrics.go`
in `uid.core-product`, but a defined metric doesn't necessarily have a producer
writing to it yet — querying one that doesn't looks identical to "no data in
this range." Currently wired: `cawplan_ticket` (all three metrics),
`cawplan_qa_insight` (all four), `cawplan_subscription.new`/`.renew` (from
Stripe's `invoice.paid`, disambiguated by `billing_reason`), `cawplan_subscription.cancel`
(user-initiated cancel-to-Free), `cawplan_api.throttled` (one point per 429),
`cawplan_ai_session_usage.usage_reported` (one point per daily AI coding-tool
usage report upload — internal engineering cost telemetry, not the
customer-facing token/credit ledger). Defined but not yet wired to any
producer: `cawplan_subscription.winback`/`.upgrade`/`.downgrade`,
`cawplan_api.request`, `cawplan_workflow`, `cawplan_token`, `cawplan_user`,
`cawplan_csm`, `cawplan_purchase`.

Beyond the fixed dimension bundle, some domains attach their own dynamic tags
(via `tags`, not `dimensions`) to disambiguate events that would otherwise be
indistinguishable at query time:

| Domain | Dynamic tag | Meaning |
|---|---|---|
| `cawplan_ticket` | `ticket_id` | The ticket's own `unique_id`, on all three ticket metrics. Without it, a burst of `ticket_updated` points for one product can't be told apart from an ancestor-status-propagation cascade across several *different* tickets (expected) vs. the same ticket written repeatedly (a bug) — filter or `--group_by ticket_id` to tell them apart. |
| `cawplan_qa_insight` | `qa_result` | On `execution` events only: the literal `pass`/`pass_with_issues`/`failed` value. The standard `result` tag that `metrics.QAExecutionResult` writes is only `passed`/`failed` (`pass_with_issues` collapses into `passed` there) — `qa_result` preserves the three-way distinction. |
| `cawplan_subscription` | `from_plan`/`to_plan` | On `upgrade`/`downgrade` only — and those two metrics aren't wired to any producer yet (see above), so this tag has no real data behind it right now either. |
| `cawplan_ticket` | `from_status`/`to_status` | On `ticket_status_changed` only. |

Not every domain has one — check the producer code (`docs/cawplan-ticket-metrics-collection.md` in `uid.core-product` for tickets) if a dynamic tag you expect isn't showing up in query results; it may simply not have been wired for that call site yet.

#### Ingest one or more events
- Endpoint: `POST /api/v1/public/openapi/key-metrics/ingest`
- Body: `{ "items": [KeyMetricPoint, ...] }`, where each item is:
  ```json
  {
    "domain": "cawplan_subscription",
    "metric": "upgrade",
    "value": 1,
    "dimensions": {"product": "01983a8b-..."},
    "tags": {"from_plan": "basic", "to_plan": "pro"},
    "timestamp": "2026-09-09T10:00:00Z"
  }
  ```
  `domain`/`metric` are required and must match `^[a-z][a-z0-9_]*$`; at least
  one of `value`/`count`/`cost`/`credit` is required per item; `dimensions`,
  `tags`, and `timestamp` are all optional (`timestamp` defaults to receipt
  time). The whole batch is validated up front and rejected as one
  `INVALID_INPUT` response on the first bad item — there is no partial write.
- Maps to cawplan CLI: `cawplan metrics ingest --domain <domain> --metric <metric> --value <n> [--dimensions <json>] [--tags <json>]`,
  or `cawplan metrics ingest --items <json array>` for a batch.

#### Query events back out
- Endpoint: `GET /api/v1/public/openapi/key-metrics/query`
- Query params: `domain` (required), `metric` (optional, narrows to one metric),
  `start`/`end` (required, RFC3339, exclusive upper bound), `granularity`
  (`raw`|`minute`|`hour`|`day`, default `raw`), `tag` (repeatable
  `<key>:<value>` filter, or the equivalent `tag.<key>=<value>` form),
  `group_by` (repeated param, extra tag keys to break results down by —
  ignored when `granularity=raw`), `fields` (repeated param, subset of
  `value`/`count`/`cost`/`credit`, defaults to all four), `limit`.
- Response: `data.rows[]`, one row per time bucket per distinct tag
  combination — `{time, domain, metric, tags: {...}, value, count, cost,
  credit}` — shaped so it can be turned directly into chart series without
  further client-side grouping. `data.truncated` is `true` when more rows
  matched than were returned (raise `--limit`, though the server clamps it to
  its own maximum, or narrow the time range/filters).
- The `start`–`end` span and the row count are both capped server-side; this
  is a shared multi-tenant read path, not a per-product cache, so it will
  reject an attempt to pull unbounded history in one call.
- Maps to cawplan CLI: `cawplan metrics query --domain <domain> --start <iso> --end <iso> [--metric <metric>] [--granularity day] [--tag key:value ...] [--group_by k1,k2] [--fields value,count]`.
- By default `query` only prints the JSON (`data.rows`). For a chart the caller just wants to look
  at in-conversation rather than a file to keep, there's no CLI rendering step needed at all — hand
  `data.rows` to the `dataviz` skill (or render/describe it directly), same as any other structured
  result; nothing has to be written to disk.
- When a standalone chart *file* is actually wanted, the CLI can render the result as an SVG line
  chart (pure JS, no native dependencies — built on `d3-scale`/`d3-shape`/`d3-array`, not a DOM- or
  canvas-based charting library) via `--chart <path>.svg` [`--chart-field
  value|count|cost|credit`] [`--chart-title <text>`] on the same `query` call — one series per tag
  combination (the same grouping `--group_by` produces).

  `--png <path>.png` rasterizes that same SVG to a PNG file on disk instead —
  for contexts that can display an image but only decode raster formats and
  treat SVG as plain text, notably a Claude Code session's `Read` tool
  reading the result back into the chat. SVG remains the file to keep/store
  (vector, small, easy to re-edit); the PNG is a disposable display copy
  generated from it on demand. This shells out rather than bundling a
  rasterizer: `qlmanage` (macOS, built into the OS) is tried first, then
  `rsvg-convert` (common on Linux via librsvg). If neither is available the
  command exits non-zero with an error instead of writing a broken/empty
  file — fall back to `--chart` for the SVG in that case. Known cosmetic
  limitation: `qlmanage`'s thumbnail mode always produces a square canvas, so
  a non-square chart (e.g. the default 960x480) comes back letterboxed with
  blank space rather than cropped — doesn't affect the correctness of the
  rendered chart itself. Observed gap: `Read`-ing this PNG in a Claude Code
  session doesn't always actually display it to the user, even in a terminal
  (iTerm2) that renders images fine when the same file is opened with
  `imgcat` directly — decoding the file for the model and displaying it in
  the user's client are apparently two different things. If a user reports
  not seeing the chart after `Read`, have them try `imgcat <path>.png` (or
  their terminal's equivalent) directly as a fallback.

  `--preview` renders the same SVG as an actual inline image directly in the
  terminal — it shells out to whichever terminal-graphics tool is actually
  available (iTerm2's bundled `imgcat`, Kitty's `icat` kitten, or `chafa`,
  tried in that order) instead of bundling an SVG rasterizer into the CLI
  itself: every one of those protocols needs a raster image, and adding a
  rasterizer (native or WASM) would reintroduce exactly the native-dependency
  weight choosing SVG over PNG was meant to avoid in the first place.
  Verified that iTerm2's `imgcat` decodes SVG bytes directly with no separate
  conversion step. If none of those tools are found, the command prints a
  message and points to `--chart`/`--png` instead. **This only works in a
  real terminal emulator reading raw stdout** — verified that running it
  through a tool that captures stdout as text (as a Claude Code session does
  when it runs the CLI) just shows the raw escape-sequence bytes as garbled
  text instead of an image, so don't reach for `--preview` from inside a
  Claude Code session; read `data.rows` directly or use `--png` there instead.

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

### Create QA Report (Portal)
- Endpoint: `POST /api/v1/product/{product_id}/versions/{version_id}/qa_report`
- Body: `QAReportCreateRequest` (`topic` required; `details`, `type`, `result`, `status`, `ticket_id`, `links`, `date_start`, `date_end`, …)
- Maps to cawplan CLI: `cawplan qa-reports create <product_id> <version_id> --body-file <path>` or `--body <json>`.

### Update QA Report (Portal)
- Endpoint: `PUT /api/v1/product/{product_id}/versions/{version_id}/qa_report/{qa_report_id}`
- Body: `QAReportUpdateRequest` (partial fields)
- Maps to cawplan CLI: `cawplan qa-reports update <product_id> <version_id> <qa_report_id> --body-file <path>` or `--body <json>`.

## 11) Community APIs
### Get Community Release Timeline
- Endpoint: `GET /api/v1/public/openapi/community/timeline`
- Query params: `time_range` OR (`start` + `end`); `channels` (CSV: `GA,EA,Alpha`)
- Response: release timeline events across all products for the given window and channels
- Maps to cawplan CLI: `cawplan community timeline`.

## 12) Knowledge APIs
### List Knowledge Datasets
- Endpoint: `GET /api/v1/public/openapi/knowledge/datasets`
- Response: `data.datasets[]` — every dataset the caller can access, each `{id, name, document_count}`. `id` is the raw dataset id used by the other two knowledge endpoints below.
- Maps to cawplan CLI: `cawplan knowledge datasets list`.

### Create Knowledge Dataset
- Endpoint: `POST /api/v1/public/openapi/knowledge/datasets`
- Body: `name` (required), `description` (optional), `permission` (optional: `only_me` | `all_team_members` | `partial_members`, default `only_me`); also accepts the other `KBCreateDatasetRequest` fields (`indexing_technique`, `embedding_model`, ...) if needed, passed straight through to Dify.
- Response: the created dataset — the raw Dify id, name, etc., plus `document_count: 0` patched in for shape-consistency with the datasets-list response.
- Maps to cawplan CLI: `cawplan knowledge datasets create --name <name> [--description <text>] [--permission <level>]`.
- Implementation note: proxies to Dify's `POST /api/v1/datasets` and also creates a PRM `knowledge_dataset` tracking record (same as the internal `KbCreateDataset`), but — unlike the internal API, which swaps the response id for the PRM `unique_id` — the public response keeps the raw Dify id, consistent with every other public knowledge endpoint.

### List Documents in a Dataset
- Endpoint: `GET /api/v1/public/openapi/knowledge/datasets/{dataset_id}/documents`
- Query params: `keyword` (optional), `page` (optional), `limit` (optional)
- `dataset_id` must be one of the ids returned by the datasets-list endpoint above; an inaccessible or unknown id returns `NOT_FOUND`.
- Maps to cawplan CLI: `cawplan knowledge documents list --dataset <id>`.

### Get Document Content
- Endpoint: `GET /api/v1/public/openapi/knowledge/datasets/{dataset_id}/documents/{document_id}/content`
- `dataset_id` and `document_id` must come from the datasets-list and documents-list endpoints above; an inaccessible or unknown id returns `NOT_FOUND`.
- Reads the original source file directly (e.g. from S3 via the document's stored file reference) and returns it verbatim — not reassembled from search-index segments/chunks, so formatting and content lost to indexing are preserved.
- Response: `data.content` (full raw text of the document), plus `data.name`.
- Maps to cawplan CLI: `cawplan knowledge documents get --dataset <id> --document <id>`.
  - Add `--output <path>` to also write `data.content` to a file.
  - Add `--grep <pattern>` (with `--context <n>`, default 3, like `grep -C`) to have the CLI itself
    filter `data.content` client-side and return only matching line ranges with context — for a large
    document, this locates one section precisely in a single call instead of loading the whole
    response into an agent's context or piping to a separate shell `grep`. Best for freeform pattern
    search in body text, or non-Markdown sources; `--section` (below) is better once you know the
    exact heading, since a fixed-line-count `--context` can bleed into a neighboring section.
  - Add `--outline` to get the document's Markdown heading tree as structured JSON
    (`{level, title, line, preview, children}`) instead of the content — built client-side from the
    cached content (`cli/src/lib/knowledge/outline.ts`, skips lines inside fenced ` ``` ` code blocks
    so a `#`-prefixed shell comment in a curl example is never mistaken for a heading). Each node's
    `preview` is its own first few body lines, so one `--outline` call already carries enough to
    describe every heading for a browsing menu — no follow-up fetch per heading needed. Previews
    are converted to plain text (`src/lib/knowledge/plaintext.ts`): headings, `**bold**`, inline
    code and table pipes are stripped, tables become space-aligned columns. Preview consumers (a
    chat client's preview panel, a terminal picker's description line) display text verbatim, so
    raw Markdown would show its syntax as visible noise. Cannot be combined with `--grep`,
    `--section`, or `--interactive`.
  - Add `--section <heading>` to get the complete, cleanly-bounded content of the heading(s) whose
    title contains this text (case-insensitive substring match, returns every match) — from that
    heading's own line up to (not including) the next heading at the same or a shallower level, so
    nested subsections are included and neighboring sections never bleed in. Use after `--outline`
    once you know which heading you want. Cannot be combined with `--grep`, `--outline`, or
    `--interactive`.
  - The raw response is cached locally per `(dataset_id, document_id)`, scoped per workspace, for the
    same TTL as the rest of the CLI's local cache (`~/.cawplan/cache.json`, default 12h, see Local
    Caching (CLI) above) — repeated `--grep`/`--outline`/`--section`/`--output` calls against the same
    document re-filter the cached content instead of re-fetching it. Add `--refresh` to bypass the
    cache and re-fetch.
  - Interactive browsing (CLI-only, no backend/response change): browse the document's markdown
    headings as a live `select` menu in the terminal instead of printing JSON — pick a heading to
    print that section, then the menu reappears (Esc or "Exit" to quit). This is the **default**
    when both stdin and stdout are a real TTY and none of `--grep`/`--outline`/`--section` are given;
    pass `--no-interactive` to force plain JSON at a terminal instead, or `-i, --interactive` to be
    explicit (also errors clearly if forced without a real TTY). Cannot be combined with `--grep`.
    Agent/skill invocations are unaffected — `cawplan` run as a subprocess never has a real TTY, so
    they always get plain JSON regardless of these flags; agents should use `--outline`/`--section`
    (see the `cawplan-knowledge` skill's Navigation Model for the drill-down pattern).

### Browse the Knowledge Base Interactively (CLI-only, real TTY required)
- No new endpoint — composes the three GET endpoints above (datasets list → documents list →
  document content) into one live picker.
- CLI: `cawplan knowledge browse` — pick a dataset (name + `document_count`), then a document
  (previewing its first lines as you highlight it), then browse that document's heading tree
  exactly like `documents get --interactive`. Esc goes back one level; Esc at the dataset list
  exits. Shows only the first 10 documents per dataset — fall back to
  `documents list --dataset <id> --keyword ...` to search a larger set.
- Requires a real interactive terminal, same restriction as `documents get --interactive` — errors
  with `"cawplan knowledge browse requires an interactive terminal"` if run as a subprocess (e.g.
  from an agent). Agents should use the `--outline`/`--section` drill-down pattern instead.

### Upload Document to a Dataset — File (async)
- Endpoint: `POST /api/v1/public/openapi/knowledge/datasets/{dataset_id}/documents/create-by-file`
- Body: `multipart/form-data` with **one** `file` part per call, plus an optional `data` part (a JSON
  string with indexing config, same shape as create-by-text minus `name`/`text`). One file per request —
  there is no multi-file batch body; batching means issuing this call once per file.
- `dataset_id` must come from the datasets-list (or datasets-create) endpoint above.
- This mirrors the internal `create-by-file` endpoint's real behavior: it does **not** block on
  processing. It runs a background pipeline (convert-to-markdown → S3 → create-by-text — the same
  pipeline the internal Knowledge Base UI uses) and returns immediately with
  `data: {status: "pending", job_id}`. Poll the job status endpoint below for completion and the
  resulting `document_id`.
- Maps to cawplan CLI: `cawplan knowledge documents upload --dataset <id> --file <path> [--file <path> ...]`
  — repeat `--file` to batch multiple files into the same dataset; the CLI submits one request per file
  and then polls each job to completion by default (`--no-wait` to just return job ids;
  `--poll-interval`/`--poll-timeout` control the polling, default 3s / 180s per file).
- Implementation note: the CLI sends real multipart (Node's native `FormData`/`Blob`, no base64
  encoding) via a `formData` option added to `cawplanRequest` (`cli/src/lib/http.ts`) — everything else
  on this CLI is JSON-only.

### Poll File-Upload Job Status
- Endpoint: `GET /api/v1/public/openapi/knowledge/datasets/{dataset_id}/documents/ai-jobs/{job_id}`
- `job_id` comes from the create-by-file response above.
- Response: `data.status` (`pending` / `processing` / `succeeded` / `failed`), `data.document_id` once
  succeeded, `data.error_message` if failed, `data.batch` (Dify's indexing batch id) once the document
  is created — `succeeded` only means Dify accepted the document, not that embedding has finished.
- Maps to cawplan CLI: `cawplan knowledge documents job-status --dataset <id> --job <job_id>` (used
  automatically by `documents upload --file` unless `--no-wait` is passed).

### Upload Document to a Dataset — Text (sync)
- Endpoint: `POST /api/v1/public/openapi/knowledge/datasets/{dataset_id}/documents/create-by-text`
- Body: `name` (required), `text` (required); also accepts the other `KBCreateDocumentByTextRequest`
  fields (`indexing_technique`, `doc_form`, `doc_language`, ...) if needed. One document per call — no
  batch array; batching means issuing this call once per document.
- `dataset_id` must come from the datasets-list (or datasets-create) endpoint above.
- If `indexing_technique` is omitted, the server resolves it from the dataset automatically (Dify
  requires it explicitly for create-by-text, unlike create-by-file which inherits it), so a bare
  `{name, text}` body works.
- Response: the created document (Dify's create-by-text response, `{document: {...}, batch}`) —
  synchronous, no polling needed. The text is also best-effort mirrored into S3 so
  `documents get`/`--content` works for these documents too.
- Maps to cawplan CLI: `cawplan knowledge documents upload --dataset <id> --text-file <path> [--text-file <path> ...]`
  — the CLI reads each local file's content and sends it as `text`, named after the file's basename;
  repeat `--text-file` to batch multiple text documents into the same dataset (one request per file).
  Do not mix `--file` and `--text-file` in the same invocation — the CLI rejects that locally; run it
  twice for a mixed batch.

### Search Knowledge Base
- Endpoint: `POST /api/v1/public/openapi/knowledge/search`
- Body: `query` (required), `dataset_id` (optional, narrows to a single dataset), `dataset_ids` (optional array, narrows to multiple datasets — takes precedence over `dataset_id` if both are set), `product_id` (optional, scopes search to a product's knowledge datasets), `limit` (default 10)
- Dataset ids must come from the datasets-list endpoint above; if any requested id isn't accessible, the request fails closed.
- When neither `dataset_id` nor `dataset_ids` is set, all datasets accessible to the caller are searched.
- Response: ranked knowledge fragments with source metadata
- Maps to cawplan CLI: `cawplan knowledge search`, or repeat `--dataset <id>` one or more times to narrow (single repeat sends `dataset_id`, multiple repeats send `dataset_ids`).

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

**CLI routing**: the four **write** endpoints used by QA Skills go through the `cawplan qa-insights` command family, which owns the correctness-critical rules (five-field strong match, PATCH changed-keys diff, batch all-or-nothing, forbidden-field rejection, UNKNOWN handling). The manual TestPoint category PATCH documented below is a frontend/manual-classification path, not a QA Skill write. **`cawplan-testcase-generate` reads** (single Requirement, List TestPoints) also go through `cawplan qa-insights` (`requirements get`, `testpoints list`); other reads (module tree, requirement list) still use the `cawplan api GET` escape hatch. Reconcile paths (`requirements reconcile`, `testpoints reconcile`) are read-only and never write.

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
- Body (optional on API): `out_of_scope`, `ticket_id` (ticket `display_id`), `summary` (display label for list/cards — API allows null), `is_ai_generated` (default `false`; QA Skills inject `true` via CLI at body top level)
- Notes:
    - `summary`: short one-line overview for QA Insights list display. **Not** one of the five requirement fields; **not** test-point input. `cawplan-requirement-analyze` always sends non-empty `summary` on POST.
    - Do not send `review_status` (defaults to `PENDING`) or `is_edited` (TestPoint field only).
    - `is_ai_generated`: injected by `cawplan qa-insights requirements create` — skill/agent omit from `--body-file`.
    - Response `data.url` is a **portal deep-link path** (e.g. `/product/{product_id}/qa-insights/test-suites/requirements/{id}`) for opening Test Suites in the browser — **not** a Public Open API route. Return it to the user as-is from the response; **never** construct or guess this path.
    - Response `data.id` is the requirement id for later API calls (e.g. `GET .../qa/requirements/{id}`, `POST .../qa/requirements/{id}/testpoints/batch`).
- Maps to cawplan CLI: `cawplan qa-insights requirements create {product_id} --body-file <path>`
- Example body: `{"summary":"道具图固定1:1裁剪","function_description":"...","entry_trigger":"...","normal_expectation":"...","constraints":"...","out_of_scope":"...","module_tree_node_id":"<id>","ticket_id":"CAWP-04606"}`

### Update Requirement
- Endpoint: `PATCH /api/v1/public/openapi/product/{product_id}/qa/requirements/{requirement_id}`
- Path params: `product_id`, `requirement_id`
- Body: any subset of `function_description`, `entry_trigger`, `normal_expectation`, `constraints`, `out_of_scope`, `summary`, `ticket_id`, `is_ai_generated` — send **only changed** fields (plus CLI-injected `is_ai_generated: true` on every non-empty PATCH from QA Skills)
- Notes: do not send `product_id`, `review_status`, or `is_edited` in the body. `summary` may be cleared with empty string or `null`. `ticket_id` is the ticket **display_id** (e.g. `CAWP-04606`); pass `null` to unlink. Use when updating an existing Requirement after hot/cold handoff; compare five fields against `five_field_snapshot`, `summary` against `summary_snapshot`, and `ticket_id` against `ticket_id_snapshot` before PATCH vs POST create. `is_ai_generated` is added by the CLI — omit from `--desired` / `--snapshot`. Example bodies (changed keys only): `{"constraints":"..."}`, `{"summary":"..."}`, `{"ticket_id":"CAWP-04606"}`, `{"ticket_id":null}`
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
- Response: `test_points[]` for the requirement, stable order by `sort_order` (backend-assigned). Each item includes `id`, `requirement_id`, `title`, `tags[]`, nullable `category_code`, `group`, `priority`, `is_edited`, `created_by`, `created_at`, `updated_at`.
- Notes:
    - **No sequence number in response** — caller computes N / N.M from `group` + return order (empty `group` → "未分组", last). See `cawplan-testpoint-generate` A2_SPEC §4.4.
    - Used before generate (first vs incremental, stubs), and after ambiguous POST (count reconcile). `cawplan-testpoint-generate` does **not** use PATCH/DELETE on archived rows.
- Maps to cawplan CLI: `cawplan api GET /api/v1/public/openapi/product/{product_id}/qa/requirements/{requirement_id}/testpoints`

### TestPoint `category_code` contract (V1)

Contract version: `qa-testpoint-category/v1`. `category_code` is a nullable enum; its only non-null values are (see table below for the current full list):

| Code | Chinese label | English label |
|------|---------------|---------------|
| `POSITIVE` | 正向 | Positive |
| `BOUNDARY` | 边界 | Boundary |
| `EXCEPTION` | 异常 | Exception |
| `REVERSE_ACTION` | 逆向 | Reverse Action |
| `INPUT_TYPE` | 输入类型 | Input Type |
| `INTERACTION_FEEDBACK` | 交互反馈 | Interaction Feedback |
| `STATE_TRANSITION` | 状态迁移 | State Transition |
| `ROLE_PERMISSION` | 角色权限 | Role & Permission |
| `SOURCE_ENTRY` | 来源入口 | Source Entry |
| `IDEMPOTENCY` | 幂等 | Idempotency |
| `CONCURRENCY` | 并发 | Concurrency |
| `CONSISTENCY` | 一致性 | Consistency |
| `BACKWARD_COMPATIBILITY` | 存量兼容 | Backward Compatibility |
| `ENVIRONMENT_COMPATIBILITY` | 环境兼容 | Environment Compatibility |
| `PERFORMANCE` | 性能 | Performance |
| `SECURITY_AUDIT` | 安全审计 | Security Audit |
| `OBSERVABILITY` | 可观测 | Observability |
| `RESULT_VALIDITY` | 结果有效性 | Result Validity |
| `INSTRUCTION_COMPLIANCE` | 指令遵循 | Instruction Compliance |
| `FACTUAL_GROUNDING` | 事实依据 | Factual Grounding |
| `OUTPUT_STABILITY` | 输出稳定性 | Output Stability |
| `CONTEXT` | 上下文 | Context |
| `AGENT_EXECUTION` | Agent 执行 | Agent Execution |
| `OTHER` | 其他 | Other |

- `null` is not an enum value. It means automatic classification could not determine a category; clients display it as `Unclassified` / 「待归类」.
- `OTHER` means a human has confirmed that the test point belongs to another category. Only a manual categorization operation may write it; automatic tag mapping must never produce `OTHER`.
- Batch create accepts an omitted `category_code`, explicit `null`, or one of the valid codes above. The new CLI computes and injects it once at creation from `tags[0]`; the server only accepts, stores, and validates it and does not derive it from tags.
- Unmatched example: `{"tags":["自定义"],"category_code":null}`. A standard primary tag such as `正向` maps to `POSITIVE`, not `null`.
- TestPoint create and list/detail responses return nullable `category_code`.
- PATCH may update or clear `category_code` independently. Updating `tags` does not recalculate `category_code`; updating `category_code` does not change `tags`. A mismatch between them is valid.
- Historical records are not backfilled. Creates from old clients that omit `category_code` are stored as `null`.

### Batch Create TestPoints (write — archive drafts)
- Endpoint: `POST /api/v1/public/openapi/product/{product_id}/qa/requirements/{requirement_id}/testpoints/batch`
- Path params: `product_id`, `requirement_id` (**do not include in body**)
- Body: `{ "test_points": [ { "title", "tags", "group", "priority", "is_edited", "is_ai_generated", "category_code" }, ... ] }` — skill/agent supply only the five caller keys `title`, `tags`, `group`, `priority`, `is_edited`; CLI injects `is_ai_generated: true` and nullable `category_code` on each element before POST
- Notes:
    - Each item (caller): **only** `title`, `tags`, `group`, `priority`, `is_edited`. `tags` may be `[]`; `group` may be empty (display as 未分组). `priority` is required and must be one of `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`.
    - CLI POST payload: each item also carries `is_ai_generated: true` and `category_code` (a valid V1 code or explicit `null`; both are inside the object, not at batch top level).
    - Old clients may omit `category_code`; the server stores it as `null`. Explicit `null` is also valid. Unknown codes are rejected as invalid input.
    - **Do not send**: `id`, `sort_order`, `product_id`, `requirement_id`, review fields, or display sequence N/N.M.
    - Array order = display order = backend `sort_order`. Batch is all-or-nothing (no partial success).
    - Response on `code: SUCCESS`: `data.test_points[]` — same length as POST array; each item echoes `title`, `tags`, nullable `category_code`, `group`, `priority`, `is_edited` from the request plus server-assigned `id`, `requirement_id`, `created_by`, `created_at`, `updated_at` (same shape as List TestPoints rows).
    - **`cawplan-testpoint-generate` counts shown to SQA**: **only** in post-POST success receipt (`已归档 N 条…`, N = `body.test_points.length`). **Do not** output `共 N 条草稿`, `本轮新增 M 条`, `其余 K 条为已存`, or any other row-count summary after tables; do not put counts in archive prompts or §8.4 read-back — agents cannot reliably count table rows in chat. Incremental display uses per-row `已存`/`新增` status column only (optional non-numeric footer allowed).
    - **`cawplan-testpoint-generate` success receipt**: agent stores returned `id`s in session stubs only; tells SQA a one-line count confirmation (e.g. `已归档 N 条到 Requirement〔标题〕下`, N = POST length) — **does not** list per-row `id`s or titles, **does not** re-generate or summarize titles after POST, **does not** post-hoc apologize for miscounts; appends Requirement `url` from refresh **only when non-empty** — **never** mentions missing `url` (no "未返回 url"/"无法附链接").
- Maps to cawplan CLI: `cawplan qa-insights testpoints archive {product_id} {requirement_id} --body-file <path>`
- Example body: `{"test_points":[{"title":"用户名含特殊字符注册时应被拦截并明确提示","tags":["异常"],"group":"注册校验","priority":"HIGH","is_edited":false}]}`

### Update TestPoint category (manual write)
- Endpoint: `PATCH /api/v1/public/openapi/product/{product_id}/qa/testpoints/{test_point_id}`
- Path params: `product_id`, `test_point_id`
- Body: any supported changed fields; for manual categorization, send only `category_code` with one valid V1 code or `null`, for example `{"category_code":"OTHER"}`.
- Notes:
    - Unknown codes are rejected as invalid input.
    - Updating `tags` does not recalculate `category_code`.
    - Updating or clearing `category_code` does not modify `tags`.
    - QA Skills do not call this endpoint for archived-row edits; it is the frontend/manual classification path.

## Error Responses
- `401` Unauthorized
- `404` Not Found
- `400` Bad Request
- `500` Internal Error
