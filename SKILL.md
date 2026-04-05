---
name: prm-open-api
description: Use PRM Open API to answer PRM questions (products, versions, release history, tickets, metrics, critical issues, activities) and summarize for openclaw/clawdbot in chat channels like Discord/Slack.
---

# PRM Open API Skill

Use this skill when the user wants PRM data (products, versions, releases, tickets, metrics, critical issues) or a person’s activity related to PRM artifacts, and the responses will be delivered via chat channels (Discord/Slack).

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
- When asked for “critical issues this month/quarter,” use `time_range` or `start/end`.
- For API-key flow (OpenAPI), **product_id must be the product `unique_id`**, not a UUID. Resolve via List Products first.
- If the user asks “by product line,” use **List Critical Issues by Product Line** with `product_line_id`.
- If the user wants cross-product filters, use **Search Critical Issues** with `time_range` (or `days`) and body filters.

### E) Product metrics (key metrics)
- Use **Get Product Metrics** with `time_range` or `start/end`.
- Summarize `summary` first (installations, crash_rate, offline_rate, update_success_rate), then 1–2 notable trends from the time series.

### F) Person activity (by email/name)
The PRM system supports activities. Use these steps:
1) Query user by email to get `unique_id` (User APIs).
2) Call the Activity API to fetch PRM activities for that user.
3) Summarize by time range and artifact type (product/version/critical issue/ticket).
4) Use `activity_types` to narrow to RELEASE/ISSUE/TICKET/VERSION/PRODUCT/USER if asked.

### G) User lookup (list/query)
- Use **List Users** for paged search by name/email.
- Use **Query User** for exact email or keyword search (email takes precedence).

### H) User todos
- Use **Get User Todos** with `user_id` to list assigned tickets and critical issues.

## Chat Output Format (Discord/Slack)
- Lead with a 1–2 sentence summary.
- Provide a compact bullet list or table-like lines:
  - `Version 3.5.1 — RELEASED — 2026-01-15`
  - `CI AC-21567 — IN_PROGRESS — event 2026-01-15`
- Keep to 5–8 items; offer “show more” paging when applicable.
- Tone default: concise, neutral, fact-first. Avoid filler.

## Response Templates (Natural Language)

### User
**Intent examples**: “查一下 user john.doe@ui.com”, “这个人是谁”, “这个用户有什么信息”
- Summary: `用户 <first_name> <last_name>（<email>）状态 <status>。`
- Details: `ID <unique_id> · 创建 <created_at> · 更新 <updated_at>`

### User Todos
**Intent examples**: “这个用户的待办”, “user 的 tickets/critical issues”
- Summary: `用户 <name/email> 当前待办：tickets <n> · critical issues <n>。`
- List line: `<type> <display_id> — <status> — <description>`

### Product
**Intent examples**: “查产品 UniFi Access”, “产品列表里有没有 access”, “给我产品列表”
- Summary: `找到 <n> 个产品匹配 “<query>”。`
- List line: `<name> — <unique_id> — <product_type.name>/<product_line.name>`

### Versions / Releases
**Intent examples**: “最近版本发布”, “release 历史”, “版本 3.5.1 详情”
- Summary: `产品 <product> 最近 <n> 个发布如下：`
- List line: `Version <version> — <status> — <release_date>`

### Tickets (FEATURE/BUGFIX)
**Intent examples**: “这个版本的 bugfix”, “feature 列表”
- Summary: `版本 <version> 的 <type> tickets：`
- List line: `<jira_key or id> — <title> — <short description>`

### Ticket Search
**Intent examples**: “搜索 tickets”, “模糊搜索 feature”
- Summary: `在 <range> 内匹配到 <n> 个 tickets。`
- List line: `<display_id> — <status> — <description>`

### Critical Issues
**Intent examples**: “关键问题列表”, “这个月的 critical issues”
- Summary: `产品 <product> 在 <range> 有 <total> 个 critical issues。`
- Status line: `OPEN <n> · IN_PROGRESS <n> · RESOLVED <n> ...`
- List line: `CI <display_id> — <status> — event <event_at>`
- If using product line critical issues, example:
  - `GET /api/v1/public/openapi/product_line/unifi/critical_issues?time_range=1m&status=OPEN,IN_PROGRESS`
- If using OpenAPI search, example:
  - `POST /api/v1/public/openapi/critical_issues/search?time_range=1m` with body `{"status":["OPEN","IN_PROGRESS"],"product_ids":["unifi-access"],"search":"connection"}`

### Product Line
**Intent examples**: “产品线列表”, “查产品线 unifi”, “product line list”
- Summary: `找到 <n> 个产品线。`
- List line: `<name> — <unique_id> — <description>`

### Metrics
**Intent examples**: “关键指标”, “近 1 个月的 metrics”
- Summary: `产品 <product> 在 <range> 的关键指标：installations <x>, crash_rate <x>, offline_rate <x>, update_success_rate <x>`
- Trend line: `crash_rate 在 <date> 达到 <x>（或上升/下降趋势）`

### Activity
**Intent examples**: “某人的 PRM 活动”, “user 在 PRM 做了什么”
- Summary: `用户 <name/email> 在 <range> 的 PRM 活动：`
- List line: `<timestamp> — <activity_type> — <object_type> <object_id>`

## Time Range & Paging
- If user says “today/this week/this month,” always echo explicit dates in the response.
- If user does not specify a time range for critical issues, ask a single clarifying question. If they don't care, default to `time_range=1m` and say so.
- Default paging: page_size 10, return top 5–8 items; offer “show more”.
- When user requests “latest” or “recent,” sort by date desc and return the newest items first.

## Natural Language → API Plan (Examples)

### “查一下 UniFi Access 过去 1 个月的关键指标”
Plan:
1) List Products with `search=UniFi Access` → pick `product_id`.
2) Get Product Metrics with `time_range=1m`.
3) Summarize `summary` + 1–2 trends.

### “给我 UniFi Access 最近 3 个版本的 release 记录”
Plan:
1) Resolve `product_id` by product search.
2) List Versions for product.
3) For each of newest 3 versions, call Release History and show newest items.

### “这个月有哪些 critical issues，按状态汇总”
Plan:
1) Resolve `product_id`.
2) List Critical Issues with `time_range=1m`.
3) Summarize `counts` and show top issues.

### “版本 3.5.1 的 bugfix tickets”
Plan:
1) Resolve `product_id`.
2) List Versions → map version string to `version_id`.
3) List Version Tickets with `type=BUGFIX`.

### “帮我看 user john.doe@ui.com 过去两周在 PRM 的活动”
Plan:
1) Query User by email → `unique_id`.
2) Call Activity API for `user_id` and date range (when available).
3) Summarize by activity type and object.

## “Show more” Pagination Phrases
- CN: “如需查看更多，请回复：继续 / 下一页”
- CN: “要看更多结果吗？我可以继续列出下一页。”
- EN: “Reply with: more / next page to continue.”
- EN: “Want more results? I can show the next page.”

## Disambiguation Prompts (Products/Versions)

### Product disambiguation
- CN: “我找到了多个产品匹配 ‘<query>’，请指定：<name>（<unique_id>），<name>（<unique_id>）…”
- EN: “Multiple products match ‘<query>’. Please choose: <name> (<unique_id>), <name> (<unique_id>)…”

### Version disambiguation
- CN: “我找到多个版本匹配 ‘<version>’，请确认：<version>（<version_id>），<version>（<version_id>）…”
- EN: “Multiple versions match ‘<version>’. Please choose: <version> (<version_id>), <version> (<version_id>)…”

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
- `401 Unauthorized`: “认证失败（API Key 无效或缺失）。请检查 `PRM_API_KEY`。”
- `404 Not Found`: “未找到资源。请确认产品/版本/ID 是否正确。”
- `400 Bad Request`: “请求参数有误。请确认必填参数与日期范围格式。”
- `500 Internal Error`: “服务端错误。请稍后重试。”
- Always include the explicit date range used when user asked for relative time.
## Guardrails
- Never expose API keys.
- If a request is ambiguous (product, version, date range), ask a single clarifying question.
- When user says “today/this week/this month,” convert to an explicit date range in the response.
- Respect linked-cases whitelist domains when creating/updating critical issues (see reference).
