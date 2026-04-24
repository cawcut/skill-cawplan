# PRM Knowledge & Product Data

> Add this file to your AI agent's context (e.g., Claude Code's `CLAUDE.md`, OpenClaw's skill config)
> to enable natural language queries against the PRM platform.

## Invocation (required)

**All PRM API calls MUST be executed with `curl`.** Do not use other HTTP clients (e.g. `wget`, Python `requests`, Node `fetch`) unless the user explicitly asks for a different tool.

- Set the base URL with `PRM_BASE_URL`.
- Set the key with `PRM_API_KEY` (or pass it inline; never commit real keys).

### Credential resolution (ask the user when missing)

Before running any `curl`, check the current shell/session environment (e.g. `env`, `printenv PRM_API_KEY PRM_BASE_URL`, or an allowed `.env` load). **Do not guess secrets.**

| Variable | If unset or empty |
|----------|-------------------|
| `PRM_API_KEY` | **Stop and ask the user** to provide or export the key. **Do not** run `curl` with an empty/missing `Authorization` header. |
| `PRM_BASE_URL` | Use the **default base URL** below. You may **override** by exporting `PRM_BASE_URL` (e.g. for a different gateway); do not ask the user which environment to use. |

### Default base URL

Always use this PRM gateway unless `PRM_BASE_URL` is explicitly set in the environment:

`https://core-api-gw.uid.alpha.ui.com/core-product` (no trailing slash)

**Rules:**

- Before `curl`, ensure the shell has `PRM_BASE_URL` set (e.g. `export PRM_BASE_URL=https://core-api-gw.uid.alpha.ui.com`) so `${PRM_BASE_URL}` resolves correctly.
- Paths append as `${PRM_BASE_URL}/api/v1/...`.

If the user supplies a custom base URL in chat for a one-off call, use it **only for that session** and remind them to use `export` or a local `.env` (not committed) for persistence.

**GET example** (run only after `PRM_API_KEY` is set and `PRM_BASE_URL` is set to the default or an explicit override):

```bash
curl -sS "${PRM_BASE_URL}/core-product/api/v1/public/openapi/products?page_size=100" \
  -H "Authorization: ${PRM_API_KEY}" \
  -H "Accept: application/json"
```

**POST JSON example:**

```bash
curl -sS -X POST "${PRM_BASE_URL}/core-product/api/v1/public/openapi/knowledge/search" \
  -H "Authorization: ${PRM_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"query":"your question here","top_k":5,"score_threshold":0.5}'
```

The sections below document paths and bodies; translate them into `curl` using the patterns above.

## Authentication

All requests require the PRM API Key in the Authorization header:

```
Authorization: <PRM_API_KEY>
```

In `curl`, pass it as: `-H "Authorization: ${PRM_API_KEY}"`.

Base URL: use `PRM_BASE_URL`, or the **Default base URL** when unset.

---

## Endpoints

### 1. Search Knowledge Base

Search across all knowledge base datasets (Confluence docs, Google Drive files, Notion pages, crawled web pages) using natural language.

**When to use:** The user asks about product documentation, architecture, guides, troubleshooting, FAQs, or any information that lives in team knowledge bases.

```
POST /api/v1/public/openapi/knowledge/search
Content-Type: application/json

{
  "query": "your question here",
  "top_k": 5,
  "score_threshold": 0.5
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| query | string | **Yes** | Natural language search query |
| top_k | int | No | Max results to return (default 5) |
| score_threshold | float | No | Min relevance score 0-1 (results below are excluded) |

**Response:**
```json
{
  "code": "SUCCESS",
  "msg": "success",
  "data": {
    "query": "What is UniFi Touch Pass?",
    "results": [
      {
        "content": "UniFi Touch Pass is a credential-based access control feature that...",
        "score": 0.92,
        "source": {
          "dataset_id": "ds-abc",
          "dataset_name": "Product Specs",
          "document_id": "doc-123",
          "document_name": "UniFi Access - Feature Overview"
        }
      }
    ]
  }
}
```

**How to use results:** Use the `content` field to answer the user's question. Cite the `source.document_name` when relevant. Higher `score` means more relevant.

---

### 2. Search Tickets

Search version tickets (features, bugfixes) across all products.

**When to use:** The user asks about feature requests, bug reports, task status, or what's being worked on in a specific version/product.

```
POST /api/v1/public/openapi/tickets/search?page_size=20&time_range=3m
Content-Type: application/json

{
  "search": "keyword",
  "product_ids": ["product-id"],
  "status": ["IN_PROGRESS", "NOT_STARTED"],
  "type": ["FEATURE", "BUGFIX"],
  "priority": ["HIGH", "CRITICAL"]
}
```

All body fields are optional. Use `search` for keyword matching, arrays for filtering (OR within same field, AND between fields).

| Query Param | Description |
|-------------|-------------|
| time_range | e.g., 1d, 1w, 1m, 3m, 6m |
| start_date / end_date | YYYY-MM-DD (use together) |
| page_num / page_size | Pagination (default 1/20, max 100) |

---

### 3. Search Critical Issues

Search critical/blocking issues across all products.

**When to use:** The user asks about urgent bugs, P0/P1 incidents, production issues, or wants a status report on critical problems.

```
POST /api/v1/public/openapi/critical_issues/search?page_size=20&time_range=1m
Content-Type: application/json

{
  "search": "keyword",
  "product_ids": ["product-id"],
  "status": ["OPEN", "IN_PROGRESS", "INVESTIGATING"],
  "issue_types": ["SOFTWARE", "FIRMWARE", "HARDWARE"]
}
```

All body fields are optional. Supports same pagination and time_range query params as ticket search.

---

### 4. List Products

Discover available products and their IDs (needed for other queries).

**When to use:** You need a product_id for other API calls, or the user asks "what products are there?"

```
GET /api/v1/public/openapi/products?page_size=100
```

---

### 5. List Product Lines

Get product line hierarchy.

**When to use:** You need a product_line_id, or the user asks about product organization.

```
GET /api/v1/public/openapi/product_lines
```

---

### 6. Get Version Info

List versions for a product and their release schedules.

**When to use:** The user asks about release dates, version status, or what's planned.

```
GET /api/v1/public/openapi/product/{product_id}/versions
```

Get specific version detail (includes planned release dates):
```
GET /api/v1/public/openapi/product/{product_id}/versions/{version_id}
```

---

### 7. Get Critical Issue Detail

Get full detail of a specific critical issue including root cause, solution, and action items.

**When to use:** The user wants to deep-dive into a specific critical issue found via search.

```
GET /api/v1/public/openapi/product/{product_id}/critical_issues/{critical_issue_id}
```

---

### 8. Get User Todos

Get a user's assigned tickets and critical issues.

**When to use:** The user asks "what am I working on?" or "what's assigned to [person]?"

```
GET /api/v1/public/openapi/todos/users/{user_id}
```

To find a user_id, use the query user endpoint:
```
POST /api/v1/public/openapi/users/query
Content-Type: application/json

{ "email": "someone@ui.com" }
```

---

### 9. Get Product Metrics

Get installation counts and adoption metrics.

**When to use:** The user asks about install base, adoption rates, or deployment numbers.

```
GET /api/v1/public/openapi/product/{product_id}/metrics
```

---

### 10. Get Community Timeline

Get community feedback and release reactions.

**When to use:** The user asks about community sentiment or public feedback.

```
GET /api/v1/public/openapi/community/timeline
```

---

## Decision Guide

| User Question Pattern | Endpoint to Use |
|----------------------|-----------------|
| "What is X?" / "How does X work?" / "Tell me about X" | **Knowledge Search** |
| "What issues are there for X?" / "Recent bugs in X" | **Critical Issues Search** |
| "What's being worked on?" / "Features in progress" | **Tickets Search** |
| "When is X releasing?" / "Release schedule for X" | **Get Versions** |
| "What's assigned to me/John?" | **Get User Todos** |
| "How many installs does X have?" | **Get Product Metrics** |
| "What does the community think about X?" | **Community Timeline** |

## Error Handling

All responses follow the same format:
```json
{ "code": "SUCCESS", "msg": "success", "data": {...} }
```

Non-success codes: `BAD_REQUEST`, `FAILURE`, `KNOWLEDGE_ERROR`, `FORBIDDEN`.
Check `code` field before using `data`.
