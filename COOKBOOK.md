# CawPlan Skill Cookbook

Task-oriented examples for CawPlan agent skills.

## Query Product Information

Use when the user asks for product details, IDs, product line, owners, current versions, or links.

```text
/cawplan-query find product information for "UniFi Access"
```

Equivalent CLI shape:

```bash
cawplan products list --search "UniFi Access"
```

## Product Activity For Last Week

Use when the user asks what changed for a product during a date range.

```text
/cawplan-product-activity show UniFi Access activity for last week
```

Agent behavior:

- Resolve product name to `product_id`.
- Convert "last week" to the previous complete calendar week.
- Call `cawplan product-activity get` with explicit `--start` and `--end`.

Equivalent CLI shape:

```bash
cawplan product-activity get --product_id <product_id> --start YYYY-MM-DD --end YYYY-MM-DD
```

## Product Activity For A Version

Use when the user scopes the activity to a version or release train.

```text
/cawplan-product-activity show UniFi Access 4.1.10 activity from 2026-06-01 to 2026-06-10
```

Equivalent CLI shape:

```bash
cawplan versions list <product_id>
cawplan product-activity get --product_id <product_id> --version_id <version_id> --start 2026-06-01 --end 2026-06-10
```

## User Activity Summary

Use when the user asks what a person has been doing.

```text
/cawplan-user-activity summarize what user@ui.com did in the past two weeks
```

Equivalent CLI shape:

```bash
cawplan user-activity get --email user@ui.com --start YYYY-MM-DD --end YYYY-MM-DD
```

## Create A Backlog Ticket

Use when the user asks to create a product-level ticket without a specific version.

```text
/cawplan-ticket create a backlog ticket for UniFi Access: investigate door schedule issue
```

Equivalent CLI shape:

```bash
cawplan products list --search "UniFi Access"
cawplan tickets create <product_id> --backlog --description "investigate door schedule issue" --type FEATURE --priority MEDIUM
```

## Create A Version Ticket

Use when the user gives a product and exact version.

```text
/cawplan-ticket file a HIGH bug on UniFi Access 4.1.10: door stuck after firmware update, assign to yida.chen@ui.com
```

Equivalent CLI shape:

```bash
cawplan products list --search "UniFi Access"
cawplan versions list <product_id>
cawplan users query --email yida.chen@ui.com
cawplan tickets create <product_id> --version_id <version_id> --description "door stuck after firmware update" --type BUGFIX --priority HIGH --assignees <user_id>
```

## Critical Issues

Use when the user asks about active, recent, or product-line critical issues.

```text
/cawplan-critical search critical issues for UniFi Access in the last month
```

Equivalent CLI shape:

```bash
cawplan critical search --search "UniFi Access" --time_range 1m
```

## Product Metrics

Use when the user asks for installations, crash rate, offline rate, or metric trends.

```text
/cawplan-metrics show UniFi Access metrics for the last month
```

Equivalent CLI shape:

```bash
cawplan metrics get <product_id> --time_range 1m
```

## Knowledge Search

Use when the user asks product documentation or release-management knowledge questions.

```text
/cawplan-query search knowledge for UniFi Access: door schedule setup
```

Equivalent CLI shape:

```bash
cawplan knowledge search --product_id <product_id> --query "door schedule setup"
```
