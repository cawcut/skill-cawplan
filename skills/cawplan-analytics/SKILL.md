---
version: 0.1.0
name: cawplan-analytics
description: |
  Query CawPlan AI-categorized product feedback analytics through the cawplan CLI.
  Use when: the user asks about product feedback trends, community feedback breakdown, AI-categorized issues, feedback statistics, or what users are saying about a product over a time range.
  NOT for: crash/offline/install metrics (use cawplan-metrics), tickets, critical issues, or activity reports.
argument-hint: "[product id or name] [time range or version]"
allowed-tools: Bash
---

# CawPlan Analytics

## Bootstrap

Before running a CawPlan command:

```bash
command -v cawplan >/dev/null || { echo "cawplan is not installed. Run: npm install -g cawplan"; exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

## Workflow

1. Resolve product name to `product_id` when needed:
   ```bash
   cawplan products list --search "<product name>"
   ```
2. Fetch analytics with a time range:
   ```bash
   cawplan analytics get <product_id> --time_range 1m
   ```
3. Use explicit dates when the user gives a calendar range:
   ```bash
   cawplan analytics get <product_id> --start YYYY-MM-DD --end YYYY-MM-DD
   ```
4. Filter to a specific firmware/software version:
   ```bash
   cawplan analytics get <product_id> --time_range 1m --version 3.4
   ```

## Decision Guide

- Feedback categories and trends: use `cawplan analytics get`.
- Crash rate, install base, offline rate: use `cawplan metrics get` instead (`/cawplan-metrics`).
- Ticket-level breakdown: use `cawplan tickets search` instead (`/cawplan-ticket`).

## Output

Summarize the top feedback categories. Highlight notable shifts or outliers. Avoid overstating causality.

## References

- `references/CAWPLAN_OPEN_API.md`
