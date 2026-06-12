---
version: 0.1.0
name: cawplan-ticket
description: |
  Create, update, search, poll, and relate CawPlan version or backlog tickets through the cawplan CLI.
  Use when: the user asks to create a ticket, update status or progress, add relations, find tickets, poll open work, or manage backlog issues.
  NOT for: critical issues, product metrics, user activity summaries, release-only queries, or generic product lookup without ticket intent.
argument-hint: "[ticket action and details]"
allowed-tools: Bash
---

# CawPlan Ticket

## Bootstrap

Before running a CawPlan command:

```bash
command -v cawplan >/dev/null || { echo "cawplan is not installed. Run: npm install -g cawplan"; exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

For CI or headless use, suggest `cawplan auth configure` instead of browser login.

## Common Commands

Create a version or backlog ticket:

```bash
cawplan tickets create <product_id> --version_id <version_id> --description "<html or text>" --type FEATURE --priority MEDIUM
cawplan tickets create <product_id> --backlog --description "<html or text>" --type FEATURE --priority MEDIUM
```

Search or poll tickets:

```bash
cawplan tickets search --product_ids <product_id> --time_range 1m --search "<keyword>"
cawplan tickets poll --status NOT_STARTED,IN_PROGRESS --product_ids <product_id>
```

Update status, progress, or fields:

```bash
cawplan tickets update <product_id> <version_id> <ticket_id> --status <status_key>
cawplan tickets update <product_id> <version_id> <ticket_id> --progress_comment "<html>"
```

Manage relations:

```bash
cawplan tickets relate list <product_id> <version_id> <ticket_id>
cawplan tickets relate create <product_id> <version_id> <ticket_id> --target <other_ticket_id> --type BLOCKED_BY
cawplan tickets relate update <product_id> <version_id> <ticket_id> <relation_id> --type RELATED
cawplan tickets relate delete <product_id> <version_id> <ticket_id> <relation_id>
```

## Decision Guide

- Creating, updating, searching, polling tickets: use this skill.
- Critical issues (blockers, incidents): use `/cawplan-critical` instead.
- AI feedback analytics or QA test reports: use `/cawplan-analytics` or `/cawplan-qa-report` instead.

## Rules

- Resolve product/version IDs before creating version-scoped tickets.
- Require an exact version match before creating a version ticket. Do not auto-expand major versions or choose a minor version for the user.
- Parse assignees from email, username, or name when provided; resolve them with `cawplan users query` before sending `assignee_ids`.
- Status keys are product-line specific. Use `cawplan product-lines statuses <product_line_id>` when unsure.
- For append-like comments, read current detail first and merge into `progress_comment`; the field is overwritten by update.
- Default ambiguous "ticket/task" requests to `FEATURE`, not `BUGFIX`; use `BUGFIX` only when the user says bug, defect, issue, or equivalent.
- Default priority to `MEDIUM` when the user does not specify one.
- Do not guess the ticket description. Ask one clarifying question when the content is missing.
- If multiple products, versions, or users match, ask the user to disambiguate before creating.
- Never silently drop a field the user provided. If the API rejects it, surface the error instead of retrying with a different value.

## Confirmation

After creating a ticket, report:

- Ticket display ID and unique ID.
- Product/version or backlog scope.
- Type, priority, and status.
- Assignees, or `-` when none were set.
- Description, stripped of HTML and truncated if long.

## References

- `references/CAWPLAN_OPEN_API.md`
