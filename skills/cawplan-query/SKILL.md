---
version: 0.1.0
name: cawplan-query
description: |
  Query CawPlan products, product lines, versions, release history, labels, and general Open API data through the cawplan CLI.
  Use when: the user asks to find a product, list versions, inspect release history, resolve IDs, list product lines, or run a general CawPlan read query.
  NOT for: creating or updating tickets, critical issue workflows, metrics reports, personal todos, or user activity reports.
argument-hint: "[natural language CawPlan query]"
allowed-tools: Bash
---

# CawPlan Query

## Bootstrap

Before running a CawPlan command:

```bash
command -v cawplan >/dev/null || { echo "cawplan is not installed. Run: npm install -g cawplan"; exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

For CI or headless use, suggest `cawplan auth configure` instead of browser login.

## Workflow

1. Resolve product names first:
   ```bash
   cawplan products list --search "<product name>"
   ```
2. List product lines when the user asks by organization or product line:
   ```bash
   cawplan product-lines list
   cawplan product-lines get <product_line_id>
   ```
3. List versions and release history:
   ```bash
   cawplan versions list <product_id>
   cawplan releases list <product_id> <version_id>
   ```
4. Use raw API passthrough only when no typed command exists:
   ```bash
   cawplan api GET /api/v1/public/openapi/products --query "page_size=10&page_num=1"
   ```
5. Search product or release-management knowledge when the user asks documentation-style questions:
   ```bash
   cawplan knowledge search --query "<question>"
   cawplan knowledge search --product_id <product_id> --query "<question>"
   ```

## Decision Guide

- Products/product lines: use `cawplan products list`, `cawplan product-lines list`, or `cawplan product-lines get`.
- Versions/release history: resolve `product_id`, then use `cawplan versions list` and `cawplan releases list`.
- Version tickets: resolve `product_id` and exact `version_id`, then run two separate calls — `cawplan tickets list --type FEATURE` and `cawplan tickets list --type BUGFIX` — and merge the results. Do not combine `--type` in a single invocation; only the last value is used.
- Ticket search: use `cawplan tickets search --search "<keyword>"`.
- Critical issues: use `/cawplan-critical` when the user intent is centered on critical issue workflows.
- Product metrics (crash/install/offline/update rates): use `/cawplan-metrics`.
- AI-categorized feedback analytics: use `/cawplan-analytics` when the user asks what users are saying, feedback categories, or AI feedback breakdown.
- QA reports (SQA/AQA/stress/smoke results): use `/cawplan-qa-report`.
- User activity report: use `/cawplan-user-activity`.
- Product activity report: use `/cawplan-product-activity`.
- Knowledge search: use `cawplan knowledge search` when the user asks product or release-management documentation questions. Resolve `product_id` first when the question names a specific product.

## Output

Summarize results briefly. If multiple products or versions match, show a short disambiguation list with `name` and `unique_id`.

- Show totals and pagination info when available.
- Convert Unix timestamps to readable dates.
- For tickets, group by type (`FEATURE`, then `BUGFIX`) and include display ID, priority, status, description, and assignees.
- Truncate very long descriptions or comments, but keep raw IDs/status values intact.
- If no data is returned, say that clearly and suggest a broader filter only when useful.

## References

- `references/CAWPLAN_OPEN_API.md`
