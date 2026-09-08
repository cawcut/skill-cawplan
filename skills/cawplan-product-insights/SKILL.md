---
version: 0.2.8
name: cawplan-product-insights
description: |
  Aggregate CawPlan product insights: adoption metrics, installations, user feedback, key metrics, and critical issues.
  Use when: the user asks for a product health overview, adoption stats, install base, crash rate, user feedback trends, or a combined product insights summary.
  NOT for: date-range activity reports, ticket creation, single-metric queries, or user activity.
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

   **Adoption & health metrics** (installations, crash rate, offline rate):
   ```bash
   cawplan metrics get <product_id> --time_range 1m
   # or with explicit dates:
   cawplan metrics get <product_id> --start YYYY-MM-DD --end YYYY-MM-DD
   ```

   **AI feedback analytics** (feedback categories and trends):
   ```bash
   cawplan analytics get <product_id> --time_range 1m
   ```

   **Critical issues** (active blockers and incidents):
   ```bash
   cawplan critical list <product_id>
   ```

## Output

Structure the insights as:

- **Adoption**: install base, active devices, growth trend.
- **Stability**: crash rate, offline rate, notable anomalies.
- **User feedback**: top feedback categories, notable shifts.
- **Critical issues**: count and severity of active blockers.
- **Key takeaways**: 2–3 bullet points on what needs attention.

Highlight notable shifts or outliers. Avoid overstating causality.

## Decision Guide

- For a specific metric trend only: use `/cawplan-metrics`.
- For feedback categories only: use `/cawplan-analytics`.
- For date-range activity report: use `/cawplan-product-report`.

## References

- `references/CAWPLAN_OPEN_API.md`
