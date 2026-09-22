---
version: 0.2.9
name: cawplan-product-insights
description: |
  Aggregate CawPlan product insights: user feedback and critical issues.
  Use when: the user asks for a product health overview, user feedback trends, or a combined product insights summary.
  NOT for: date-range activity reports, ticket creation, single-metric queries, user activity, or device/app adoption metrics (installations, crash rate -- that public endpoint has been retired, no longer available via CLI).
argument-hint: "[product name or ID, time range]"
allowed-tools: Bash
---

# CawPlan Product Insights

## Bootstrap

```bash
cawplan skill check
```

## Workflow

1. Resolve product name to `product_id`:
   ```bash
   cawplan products list --search "<product name>"
   ```
   Continue only after one exact accessible product-name match (case-insensitive after trimming whitespace), one unique short-form/token-prefix match, or an explicit user confirmation of a candidate. If the user's stated product is absent or ambiguous, list the candidates and ask which product they mean; never silently choose a non-unique similarly named product. Do not fetch insight sources until the product is confirmed. Report `NO_PERMISSION` only for an explicit access-denied response.

2. Fetch all insight sources in parallel:

   **AI feedback analytics** (feedback categories and trends):
   ```bash
   cawplan analytics get <product_id> --time_range 1m
   ```

   **Critical issues** (active blockers and incidents):
   ```bash
   cawplan critical list <product_id>
   ```

   There is no adoption/device-metrics source here anymore — the public endpoint behind
   `cawplan metrics get` (installations, crash rate, offline rate) has been retired. If the user
   specifically wants that data, tell them it's no longer available via CLI rather than silently
   omitting it or substituting something else.

## Output

Structure the insights as:

- **User feedback**: top feedback categories, notable shifts.
- **Critical issues**: count and severity of active blockers.
- **Key takeaways**: 2–3 bullet points on what needs attention.

Highlight notable shifts or outliers. Avoid overstating causality.

## Decision Guide

- For a business metric trend (subscriptions, CawPlan tickets, QA, workflow, tokens, API usage):
  use `/cawplan-metrics`. Device/app adoption metrics are no longer available via CLI at all.
- For feedback categories only: use `/cawplan-analytics`.
- For date-range activity report: use `/cawplan-product-report`.

## References

- `references/CAWPLAN_OPEN_API.md`
