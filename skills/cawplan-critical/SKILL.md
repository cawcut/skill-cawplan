---
version: 0.1.0
name: cawplan-critical
description: |
  Query, search, inspect, create, update, or delete CawPlan critical issues through the cawplan CLI.
  Use when: the user asks about critical issues, blockers, incidents, urgent bugs, product-line critical status, or critical issue detail.
  NOT for: normal version tickets, product metrics, user activity reports, or release history.
argument-hint: "[critical issue query or action]"
allowed-tools: Bash
---

# CawPlan Critical Issues

## Bootstrap

Before running a CawPlan command:

```bash
command -v cawplan >/dev/null || { echo "cawplan is not installed. Run: npm install -g cawplan"; exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

For CI or headless use, suggest `cawplan auth configure` instead of browser login.

## Common Commands

List by product:

```bash
cawplan critical list <product_id> --time_range 1m
```

Search across products (note: search uses `--start_date`/`--end_date`, not `--start`/`--end`):

```bash
cawplan critical search --time_range 1m --product_ids <product_id> --status INVESTIGATING,IN_PROGRESS
cawplan critical search --start_date 2025-01-01 --end_date 2025-03-01 --product_ids <product_id>
```

List by product line (primary command is `line`; `product-line` is an alias):

```bash
cawplan critical line <product_line_id> --time_range 1m
```

Get detail:

```bash
cawplan critical get <product_id> <critical_issue_id>
```

## Rules

- Ask for or infer a time range; default to `1m` only when the user does not care.
- Resolve product names to `product_id` before product-scoped calls.
- For cross-product questions, prefer `critical search`.
- `critical list` and `critical line` use `--start`/`--end`. `critical search` uses `--start_date`/`--end_date`. Do not mix them.

## Decision Guide

- Critical issues, blockers, incidents: use this skill.
- BUGFIX or FEATURE version tickets: use `/cawplan-ticket` instead.
- Crash/install/offline metrics: use `/cawplan-metrics` instead.
- AI feedback analytics: use `/cawplan-analytics` instead.
- User or product activity reports: use `/cawplan-user-activity` or `/cawplan-product-activity` instead.

## References

- `references/CAWPLAN_OPEN_API.md`
