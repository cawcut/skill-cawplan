---
name: prm-open-api
description: Use PRM Open API to answer PRM questions (products, versions, release history, tickets, metrics, critical issues, activities, user activity reports) and summarize for openclaw/clawdbot in chat channels like Discord/Slack. Also use when the user asks what someone has been doing recently, asks for a user's activity report, work summary, or says things like "what has X been doing", "give me X's activity", "show X's recent work".
---

# PRM Open API Skill

Use this skill when the user wants PRM data (products, versions, releases, tickets, metrics, critical issues) or a person's activity related to PRM artifacts, and the responses will be delivered via chat channels (Discord/Slack). Also use when the user asks for a user's activity report or work summary.

## Quick Start
1) Resolve the product (`product_id`) using the Product APIs.
2) Pick the data domain: versions/releases, tickets, critical issues (product or product line), metrics, or user activity.
3) Call the appropriate endpoints and summarize results for chat (natural language input; no slash commands required).

For endpoint details, parameters, and status values, read:
- `references/PRM_OPEN_API.md`
- `references/PRM_ACTIVITY_API.md`

If you need exact language or examples, use:
- `docs/UUM-PRM_ Open API-010226-061816.pdf`
- `docs/UUM-PRM_ Open API-010226-061816.txt`

**Extension — knowledge base:** For documentation-style Q&A via `POST ${PRM_BASE_URL}/core-product/api/v1/public/openapi/knowledge/search`, see `SKILL-prm-knowledge.md` (same env vars; use `curl` per that file).

## Configuration
- **Auth**: API key in `Authorization` header. Do not log or echo the key.
- **Env vars** (preferred):
  - `PRM_API_KEY` (required)
  - `PRM_BEARER_TOKEN` (optional; when set, overrides `PRM_API_KEY`)
  - `PRM_BASE_URL` (optional; default `https://core-api-gw.uid.alpha.ui.com`)
  - `PRM_CACHE_PATH` (optional; default `~/.config/prm/cache.json`)
  - `PRM_CACHE_TTL_HOURS` (optional; default 12)
  - `PRM_CACHE_TTL_DAYS` (optional; deprecated)
- **Base URL**: see `references/PRM_OPEN_API.md`.
## Setup (CLI)
1) Install dependencies:
```bash
npm install
```

2) Configure auth (choose one):

Option A — env vars:
```bash
export PRM_API_KEY=your-api-key
export PRM_BASE_URL=https://core-api-gw.uid.alpha.ui.com
```

Option B — config file:
```bash
mkdir -p ~/.config/prm
cp config.example.json ~/.config/prm/config.json
# Edit with your credentials
```

## CLI Usage
```bash
npx tsx cli.ts api GET /api/v1/public/openapi/products --query "page_size=10&page_num=1"
npx tsx cli.ts products list --search "UniFi Access"
npx tsx cli.ts versions list unifi-access
npx tsx cli.ts releases list unifi-access version-001
npx tsx cli.ts tickets list unifi-access version-001 --type BUGFIX
npx tsx cli.ts critical list unifi-access --time_range 1m --status OPEN,IN_PROGRESS
npx tsx cli.ts metrics get unifi-access --time_range 1m
npx tsx cli.ts activities query --time_range 1m --user_id user-123
```

## Core Workflows

### A) Product resolution (always first)
- Ask for product name if missing.
- Call **List Products** with `search` to find candidates.
- If no matches, ask the user to confirm the exact product name or provide a keyword.
- If multiple matches, return a short disambiguation list (name + `unique_id`).

### A1) Product line resolution (when user asks for a product line)
- Call **List Product Lines** to get `product_line_id` (unique_id).
- If multiple matches, return a short disambiguation list (name + `unique_id`).

### B) Versions & releases
- Use **List Versions** to get version IDs for the product.
- Use **Get Version Detail** for specific version metadata.
- Use **Get Release History** to build a release timeline.
- In chat, show newest releases first with release date and status.

### C) Version tickets (plan/features/bugfixes)
- Use **List Version Tickets** with `type=FEATURE` or `type=BUGFIX`.
- Provide a compact list: `jira_key` (if present), title, and short description.
- If the user wants cross-product filtering or fuzzy search, use **Search Version Tickets**.

### D) Critical issues (status + detail)
- Use **List Critical Issues** to get status counts and tickets.
- Use **Get Critical Issue Detail** for a specific issue.
- When asked for "critical issues this month/quarter," use `time_range` or `start/end`.
- For API-key flow (OpenAPI), **product_id must be the product `unique_id`**, not a UUID. Resolve via List Products first.
- If the user asks "by product line," use **List Critical Issues by Product Line** with `product_line_id`.
- If the user wants cross-product filters, use **Search Critical Issues** with `time_range` (or `days`) and body filters.

### E) Product metrics (key metrics)
- Use **Get Product Metrics** with `time_range` or `start/end`.
- Summarize `summary` first (installations, crash_rate, offline_rate, update_success_rate), then 1–2 notable trends from the time series.

### F) Person activity report (by email/name)

Use this workflow when the user asks "what has X been doing", "tell me X's activity this week", "give me X's work summary", "show X's recent work", or any request about what a person has been doing in PRM.

This uses the **User Report API** which is **actor-centric** — it returns all actions **performed by** the specified user, enriched with full object snapshots (ticket status/priority/comments, CI details, QA report results).

**Step 1: Resolve User Identity**

Query the users API with the name/keyword provided by the user to find their `unique_id`:

```bash
curl -sS -X POST "${PRM_BASE_URL}/core-product/api/v1/public/openapi/users/query" \
  -H "Authorization: ${PRM_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"keyword":"neil","page_size":10}'
```

- **Prefer using the first name or a partial keyword** (e.g., `"john"` instead of `"john doe"`). Full-name queries may return empty results even when the user exists; partial keywords are more reliable.
- Use the `unique_id` from the matched user for Step 2.
- If multiple results are returned, ask the user to confirm which one.

**Step 2: Calculate Date Range**

Map the user's intent to explicit dates:
- "today" → today only
- "this week" → Monday to today (or last 7 days)
- "this month" → 1st of month to today
- "last N days" → calculate accordingly
- Default if unspecified: **last 7 days**
- Format: `YYYY-MM-DD` (UTC). Max range: 90 days.

**Step 3: Call User Report API**

```bash
curl -sS "${PRM_BASE_URL}/core-product/api/v1/public/openapi/user-report?user_id=${USER_ID}&start_date=${START_DATE}&end_date=${END_DATE}" \
  -H "Authorization: ${PRM_API_KEY}"
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | string | One of user_id/email | User unique_id from Step 1 |
| `email` | string | One of user_id/email | User email (exact match). Can be used instead of user_id. |
| `start_date` | string | Yes | Start date (YYYY-MM-DD) |
| `end_date` | string | Yes | End date (YYYY-MM-DD) |

**Response Structure:**

The response groups data by object type, each enriched with full current-state snapshot:

- `summary` — counts: `ticket_updates`, `critical_issue_updates`, `qa_report_updates`
- `tickets[]` — each ticket the user acted on, with:
  - `display_id`, `description`, `type`, `status`, `priority`
  - `product_name`, `version_name`
  - `comment` / `comment_by` / `comment_at` (latest comment on the ticket)
  - `progress_comment` / `progress_comment_by` / `progress_comment_at`
  - `activities[]` — what the user did to this ticket (action, description, detail, timestamp, source)
- `critical_issues[]` — each CI the user acted on, with:
  - `display_id`, `description`, `status`, `product_name`
  - `comment`, `progress_comment`
  - `activities[]`
- `qa_reports[]` — each QA report the user acted on, with:
  - `display_id`, `topic`, `type`, `result`, `status`
  - `product_name`, `version_name`
  - `comment` / `comment_by` / `comment_at`
  - `activities[]`

**Activity Event fields:**

| Field | Description |
|-------|-------------|
| `action` | What was done: `created`, `commented`, `updated_status`, `updated`, `updated_sprint`, etc. |
| `description` | Human-readable summary (e.g., "Added a comment to ticket AC-22200 via Jira.") |
| `detail` | Comment body (HTML) for `commented`; changelog diff for `updated_status`; may be null |
| `actor_name` | Who did it (usually the queried user, but could be others for shared items) |
| `timestamp` | Unix timestamp |
| `source` | Origin: `API` (PRM Web UI), `JIRA`, `ZENDESK`, `PRM` (system), etc. **Do not display in reports** — internal metadata only. |

**Step 4: Generate Report**

Parse the response and produce a structured report using the **Person Activity Report Template** (see Response Templates section below).

### G) User lookup (list/query)
- Use **List Users** for paged search by name/email.
- Use **Query User** for exact email or keyword search (email takes precedence).

### H) User todos
- Use **Get User Todos** with `user_id` to list assigned tickets and critical issues.

### I) Issue / sub-issue creation
- Use **Create Version Ticket** (`POST /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets`) to create an issue. Required body fields are `description` and `type` (`FEATURE` | `BUGFIX`); the rest (priority, status, assignee_ids, label_ids, due_date, parent_id, reporter_id, comment) are optional.
- To create a **sub-issue**, set `parent_id` to the parent ticket's `unique_id`. PRM enforces:
  - parent and child must share the same `product_line`
  - parent chain depth is capped at 5
- The Linear concept "issue" maps to a top-level ticket; "sub-issue" maps to a ticket with `parent_id != null`.
- Resolve `unique_id` from a known `display_id` (e.g. `PRM-07102`) via `POST /api/v1/public/openapi/tickets/search` — the search response carries both fields.
- CLI: `prm tickets create <product_id> <version_id> --description "..." --type BUGFIX [--parent_id <uid>] [--assignees u1,u2] [--priority HIGH] [--status KEY] [--label_ids l1,l2] [--due_date YYYY-MM-DD]`.

### J) Relations (Blocking / Blocked-by / Related / Duplicate)
- PRM stores **one row per relation pair** with a perspective-aware `relation_type`. Reading the relation from the *other* ticket inverts `BLOCKING` ↔ `BLOCKED_BY`; `RELATED` and `DUPLICATE` are symmetric. Adapters MUST NOT create the inverse row themselves — call once from either side.
- Two tickets may have **at most one** relation row (regardless of direction); this is enforced by a `LEAST/GREATEST` unique index. Re-creating returns "relation already exists" — list first if you need to overwrite, then `update` or `delete` + `create`.
- CLI:
  - `prm tickets relate list   <product_id> <version_id> <ticket_id>` — returns `{ blocking, blocked_by, related, duplicate }` from `<ticket_id>`'s perspective.
  - `prm tickets relate create <product_id> <version_id> <ticket_id> --target <other_ticket_uid> --type BLOCKING|BLOCKED_BY|RELATED|DUPLICATE`
  - `prm tickets relate update <product_id> <version_id> <ticket_id> <relation_id> --type ...`
  - `prm tickets relate delete <product_id> <version_id> <ticket_id> <relation_id>`
- When the user says "issue A is blocked by B", call `relate create` from A with `--target B --type BLOCKED_BY`. The other side will see a `BLOCKING` entry automatically.

### K) Status transition (workflow states)
- Status values are **per product line**, not global. Discover the legal set by reading the ticket detail / list with `include=available_statuses`, or from the `ticket_status_definition` data on the parent product line.
- Use **Update Version Ticket** (`PUT /api/v1/public/openapi/product/{product_id}/versions/{version_id}/tickets/{ticket_id}`) with body `{ "status": "<KEY>" }` to transition.
- Hard-coding strings is unsafe: passing an unknown key returns `invalid ticket status '...' for this product line`. Always pre-validate against the available list.
- Externally synced (Jira) tickets reject `status` and `priority` edits — handle the error and surface it to the caller.
- The response includes `version_promoted: true` when this transition auto-promoted the parent version status to `INPROGRESS`.
- CLI: `prm tickets update <product_id> <version_id> <ticket_id> --status <KEY>`.

### L) Progress / comment writing
- PRM has **no multi-comment thread**: `comment` and `progress_comment` are single string fields. Each PUT overwrites the previous value.
- Adapters that need an append-only stream of messages should embed marker blocks inside `progress_comment` (HTML), e.g.:
  ```html
  <!-- clawcode-workpad-{runId} -->
  <p>Iteration 1 — investigation summary</p>
  <!-- /clawcode-workpad-{runId} -->
  ```
  …then read back, regex-replace the marker block, and PUT the merged HTML.
- The PUT is **not atomic** with respect to the read; if multiple writers are possible, accept eventual consistency or coordinate at a higher layer.
- For "design comment" semantics (Linear `postDesignComment`) reuse the same field with a different marker (e.g. `<!-- clawcode-design -->`); PRM has no separate design entity.
- CLI: `prm tickets update <product_id> <version_id> <ticket_id> --progress_comment "<html>"`.

### M) Version plan creation
- Versions in PRM are anchored under a **major version** (`major_id`). The Linear concept "Project Milestone" maps to a PRM version (e.g. `1.3.2` under major `1.3`).
- Required body: `name` (e.g. `1.3.2`), `major_id` (the major version's `unique_id`). Optional: `description`, `extra` (`target_release[]`, `monitor_link`, `hotfix`).
- Discover available `major_id`s: `prm versions list <product_id>` or `GET /api/v1/public/openapi/product/{product_id}/versions` and look at the `major_version` / `version_id` fields on the major-level entries.
- Major versions cannot be marked `hotfix`; only minors can.
- CLI: `prm versions create <product_id> --name <X.Y.Z> --major_id <major_uid> [--description "..."]`.

### N) Adapter implementation notes (Linear ↔ PRM)
- `stateMap` (Linear `IssueState` → PRM status key) MUST be built per product line at adapter init time. Read available statuses from the relevant `product_line` (or the ticket-list endpoint with `include=available_statuses`). Different product lines have different status sets.
- `transition(issue, state)` ≡ `prm tickets update ... --status <KEY>`.
- `addComment(issue, body)` ≡ read current `progress_comment` → append marker block → `prm tickets update ... --progress_comment "<merged html>"`.
- `updateComment(issue, commentId, body)` ≡ regex-replace the marker block in `progress_comment` and PUT.
- `findComment(issue, marker)` ≡ regex against `progress_comment` HTML.
- `getCommentReactions(commentId)` ≡ stub (always `[]`); PRM has no reactions.
- `createRelation(source, target, type)` ≡ `prm tickets relate create` from `source`. Do NOT create the inverse row.
- `getChildIssues(parentId)` ≡ `tickets/search` body with `parent_ids: [parentId]` (Phase 2 backend support — until then, fall back to the ticket detail endpoint which embeds the sub-issue tree).

## Execution Style
- Execute all API calls silently — do NOT narrate steps, show "Step 1/2/3", or announce what you are about to do.
- Output only the final result or report. No process commentary.

## Chat Output Format (Discord/Slack)
- Lead with a 1–2 sentence summary.
- Provide a compact bullet list or table-like lines:
  - `Version 3.5.1 — RELEASED — 2026-01-15`
  - `CI AC-21567 — IN_PROGRESS — <short description or title> — event 2026-01-15`
- Always include a human-readable title or description alongside IDs. Never output ID-only lines.
- Keep to 5–8 items; offer "show more" paging when applicable.
- Tone default: concise, neutral, fact-first. Avoid filler.

## Response Templates (Natural Language)

### User
**Intent examples**: "查一下 user john.doe@ui.com", "这个人是谁", "这个用户有什么信息"
- Summary: `用户 <first_name> <last_name>（<email>）状态 <status>。`
- Details: `ID <unique_id> · 创建 <created_at> · 更新 <updated_at>`

### User Todos
**Intent examples**: "这个用户的待办", "user 的 tickets/critical issues"
- Summary: `用户 <name/email> 当前待办：tickets <n> · critical issues <n>。`
- List line: `<type> <display_id> — <status> — <description>`

### Person Activity Report
**Intent examples**: "neil 最近在忙什么", "what has X been doing", "give me X's activity", "show X's recent work", "X 的工作报告", "tell me what X did this week"

Use Traditional Chinese for the report structure, English for ticket/issue content.

```
## {display_name} Activity Report ({start_date} ~ {end_date})

### Overview
- Tickets acted on: {ticket_updates}
- Critical Issues acted on: {critical_issue_updates}
- QA Reports acted on: {qa_report_updates}

### Ticket Details

For each ticket, show:

#### [{display_id}] {description}
- **Product**: {product_name} / **Version**: {version_name}
- **Type**: {type} | **Status**: {status} | **Priority**: {priority}
- **Comment** ({comment_by}, {comment_at}):
  > {comment text, stripped of HTML}
- **Progress Comment** ({progress_comment_by}, {progress_comment_at}):
  > {progress_comment text, stripped of HTML}

**Actions performed:**
| Time | Action | Detail |
|------|--------|--------|
| {timestamp} | {action label} | {detail content stripped of HTML; if null, use description} |

(Only show Comment / Progress Comment when non-null. For commented actions, Detail MUST show the actual comment text, not just "Added a comment".)

### Critical Issue Details
(or "None" if empty)

#### [{display_id}] {description}
- **Product**: {product_name}
- **Status**: {status}
- **Comment**: {comment}
- **Progress Comment**: {progress_comment}

**Actions performed:**
| Time | Action | Detail |
|------|--------|--------|
| {timestamp} | {action label} | {description} |

### QA Report Details
(or "None" if empty)

#### [{display_id}] {topic}
- **Product**: {product_name} / **Version**: {version_name}
- **Type**: {type} | **Result**: {result} | **Status**: {status}
- **Comment** ({comment_by}, {comment_at}):
  > {comment text}

**Actions performed:**
| Time | Action | Detail |
|------|--------|--------|
| {timestamp} | {action label} | {description} |

### Summary
A 2-3 sentence summary of the user's main focus areas during this period.
```

**Person Activity Report Formatting Rules:**
- Convert all Unix timestamps to `YYYY-MM-DD HH:mm` (UTC+8 for TW users).
- Strip HTML tags from comments for readability, but preserve key content.
- For `action` field, use human-readable labels:
  - `created` → Created
  - `commented` → Commented
  - `updated_status` → Status Change
  - `updated` → Updated
  - `updated_sprint` → Sprint Change
- **CRITICAL**: The `detail` field contains the actual content of the action. For `commented` actions, it is the full comment body (HTML). For `updated_status`, it is the changelog diff. **Always display the `detail` content** (stripped of HTML tags) in the report. Never describe a comment action as just "新增 comment" or "Added a comment" — you MUST show what the comment actually says. If `detail` is null/empty, fall back to the `description` field.
- Group tickets by product when there are more than 5 tickets.
- If the response has no data (all summary counts = 0), say "{name} had no activity during this period".
- Always show the date range and user info at the top.
- If there are many tickets (>10), show a compact summary first (display_id + description + key action), then offer to expand individual tickets on request.

**Comment Fields Reference:**

| Object | Field | Has by/at? | Description |
|--------|-------|------------|-------------|
| Ticket | `comment`, `comment_by`, `comment_at` | Yes | Latest comment with author and timestamp |
| Ticket | `progress_comment`, `progress_comment_by`, `progress_comment_at` | Yes | Latest progress comment with author and timestamp |
| Critical Issue | `comment` | No | Latest comment (text only) |
| Critical Issue | `progress_comment` | No | Latest progress comment (text only) |
| QA Report | `comment`, `comment_by`, `comment_at` | Yes | Latest comment with author and timestamp |

### Product
**Intent examples**: "查产品 UniFi Access", "产品列表里有没有 access", "给我产品列表"
- Summary: `找到 <n> 个产品匹配 "<query>"。`
- List line: `<name> — <unique_id> — <product_type.name>/<product_line.name>`

### Versions / Releases
**Intent examples**: "最近版本发布", "release 历史", "版本 3.5.1 详情"
- Summary: `产品 <product> 最近 <n> 个发布如下：`
- List line: `Version <version> — <status> — <release_date>`

### Tickets (FEATURE/BUGFIX)
**Intent examples**: "这个版本的 bugfix", "feature 列表"
- Summary: `版本 <version> 的 <type> tickets：`
- List line: `<jira_key or id> — <title> — <short description>`

### Ticket Search
**Intent examples**: "搜索 tickets", "模糊搜索 feature"
- Summary: `在 <range> 内匹配到 <n> 个 tickets。`
- List line: `<display_id> — <status> — <description>`

### Critical Issues
**Intent examples**: "关键问题列表", "这个月的 critical issues"
- Summary: `产品 <product> 在 <range> 有 <total> 个 critical issues。`
- Status line: `OPEN <n> · IN_PROGRESS <n> · RESOLVED <n> ...`
- List line: `CI <display_id> — <description or title> — <status> — event <event_at>`
- If using product line critical issues, example:
  - `GET /api/v1/public/openapi/product_line/unifi/critical_issues?time_range=1m&status=OPEN,IN_PROGRESS`
- If using OpenAPI search, example:
  - `POST /api/v1/public/openapi/critical_issues/search?time_range=1m` with body `{"status":["OPEN","IN_PROGRESS"],"product_ids":["unifi-access"],"search":"connection"}`

### Product Line
**Intent examples**: "产品线列表", "查产品线 unifi", "product line list"
- Summary: `找到 <n> 个产品线。`
- List line: `<name> — <unique_id> — <description>`

### Metrics
**Intent examples**: "关键指标", "近 1 个月的 metrics"
- Summary: `产品 <product> 在 <range> 的关键指标：installations <x>, crash_rate <x>, offline_rate <x>, update_success_rate <x>`
- Trend line: `crash_rate 在 <date> 达到 <x>（或上升/下降趋势）`

### Activity
**Intent examples**: "某人的 PRM 活动", "user 在 PRM 做了什么"
- Summary: `用户 <name/email> 在 <range> 的 PRM 活动：`
- List line: `<timestamp> — <activity_type> — <object_type> <object_id> — <object_title or description>`

## Time Range & Paging
- If user says "today/this week/this month," always echo explicit dates in the response.
- If user does not specify a time range for critical issues, ask a single clarifying question. If they don't care, default to `time_range=1m` and say so.
- For person activity reports, map user's intent to explicit `start_date`/`end_date`: "today" → today only, "this week" → Monday to today, "this month" → 1st to today. Default to last 7 days if unspecified. Max range: 90 days.
- Default paging: page_size 10, return top 5–8 items; offer "show more".
- When user requests "latest" or "recent," sort by date desc and return the newest items first.

## Natural Language → API Plan (Examples)

### "查一下 UniFi Access 过去 1 个月的关键指标"
Plan:
1) List Products with `search=UniFi Access` → pick `product_id`.
2) Get Product Metrics with `time_range=1m`.
3) Summarize `summary` + 1–2 trends.

### "给我 UniFi Access 最近 3 个版本的 release 记录"
Plan:
1) Resolve `product_id` by product search.
2) List Versions for product.
3) For each of newest 3 versions, call Release History and show newest items.

### "这个月有哪些 critical issues，按状态汇总"
Plan:
1) Resolve `product_id`.
2) List Critical Issues with `time_range=1m`.
3) Summarize `counts` and show top issues.

### "版本 3.5.1 的 bugfix tickets"
Plan:
1) Resolve `product_id`.
2) List Versions → map version string to `version_id`.
3) List Version Tickets with `type=BUGFIX`.

### "帮我看 user john.doe@ui.com 过去两周在 PRM 的活动"
Plan:
1) Calculate date range: today minus 14 days.
2) Call User Report API: `GET /api/v1/public/openapi/user-report?email=john.doe@ui.com&start_date=...&end_date=...`.
3) Generate report using the Person Activity Report Template.

### "neil 最近在忙什么" / "what has neil been doing"
Plan:
1) Query User API with `keyword=neil` → resolve `unique_id`.
2) If multiple matches, ask user to confirm.
3) Calculate date range (default: last 7 days).
4) Call User Report API: `GET /api/v1/public/openapi/user-report?user_id=${USER_ID}&start_date=...&end_date=...`.
5) Generate structured report using the Person Activity Report Template.

### "告诉我 john 这周做了什么" / "tell me what john did this week"
Plan:
1) Query User API with `keyword=john` → resolve `unique_id`.
2) Calculate this week's date range (Monday to today).
3) Call User Report API with `user_id` and dates.
4) Output the Person Activity Report — tickets with status/comments, CIs, QA reports.

## "Show more" Pagination Phrases
- CN: "如需查看更多，请回复：继续 / 下一页"
- CN: "要看更多结果吗？我可以继续列出下一页。"
- EN: "Reply with: more / next page to continue."
- EN: "Want more results? I can show the next page."

## Disambiguation Prompts (Products/Versions)

### Product disambiguation
- CN: "我找到了多个产品匹配 '<query>'，请指定：<name>（<unique_id>），<name>（<unique_id>）…"
- EN: "Multiple products match '<query>'. Please choose: <name> (<unique_id>), <name> (<unique_id>)…"

### Version disambiguation
- CN: "我找到多个版本匹配 '<version>'，请确认：<version>（<version_id>），<version>（<version_id>）…"
- EN: "Multiple versions match '<version>'. Please choose: <version> (<version_id>), <version> (<version_id>)…"

## Product Alias & Normalization
- Normalize common aliases before search (case-insensitive):
  - `ua`, `uaccess`, `unifi access` → `UniFi Access`
  - `unifi access application`, `access application`, `ua application` → `UniFi Access`
  - `unifi protect`, `protect` → `UniFi Protect`
  - `unifi network`, `unifi controller`, `network` → `UniFi Network`
  - `unifi talk`, `talk` → `UniFi Talk`
  - `unifi connect`, `connect` → `UniFi Connect`
- If alias resolves to a product line, still confirm `product_id` from API.
- Keep alias list short; add only when repeatedly requested by users.

## Error Handling (Chat)
- `401 Unauthorized`: "认证失败（API Key 无效或缺失）。请检查 `PRM_API_KEY`。"
- `404 Not Found`: "未找到资源。请确认产品/版本/ID 是否正确。"
- `404 / empty user` (Activity query): User not found — list similar users and ask user to confirm.
- `400 Bad Request`: "请求参数有误。请确认必填参数与日期范围格式。"
- `500 Internal Error`: "服务端错误。请稍后重试。"
- Always include the explicit date range used when user asked for relative time.

## Guardrails
- Never expose API keys.
- If a request is ambiguous (product, version, date range), ask a single clarifying question.
- When user says "today/this week/this month," convert to an explicit date range in the response.
- Respect linked-cases whitelist domains when creating/updating critical issues (see reference).
