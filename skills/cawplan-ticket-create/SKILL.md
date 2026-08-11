---
version: 0.2.6
name: cawplan-ticket-create
description: |
  Create a new CawPlan ticket (version-scoped by default, or backlog only after user confirmation) with title/summary, optional HTML remarks, assignee, and priority.
  Use when: the user asks to create, file, or add a ticket, issue, bug, or task in CawPlan.
  NOT for: updating existing tickets, searching tickets, critical issues, or release planning.
argument-hint: "[product, version, ticket title/summary, remarks, type, priority, assignee; backlog only if user cannot provide version]"
allowed-tools: Bash
---

# CawPlan Ticket Create

## Bootstrap

```bash
cawplan skill check
```

## Workflow

Use `--product` and `--version` by name — the CLI resolves IDs internally. No prior lookup needed.

**Version ticket** (scoped to a specific version):
```bash
cawplan tickets create-version \
  --product "<product name>" \
  --ver "<version name>" \
  --description "<ticket title/summary>" \
  --remarks "<html body>" \
  --type FEATURE \
  --priority MEDIUM \
  --reporter <your-email> \
  --assignee <email>
```

**Backlog ticket** (fallback only when the user cannot provide a version or explicitly asks for backlog):
```bash
cawplan tickets create-backlog \
  --product "<product name>" \
  --description "<ticket title/summary>" \
  --remarks "<html body>" \
  --type FEATURE \
  --priority MEDIUM \
  --reporter <your-email>
```

Get your own email for `--reporter`:
```bash
cawplan auth status   # shows authenticated email
```
For API Key auth, omit `--reporter`.

## Rules

- Default type to `FEATURE`; use `BUGFIX` only when the user says bug, defect, or issue.
- Default priority to `MEDIUM` when not specified.
- If the user did not specify a version, ask one clarifying question for the target version before creating the ticket.
- Do not create a backlog ticket by default. Use `create-backlog` only when the user explicitly asks for backlog/no version, or after they confirm they cannot provide a version.
- When creating a backlog ticket, tell the user: "This ticket was created as a backlog item and is not assigned to any version."
- Do not guess the ticket title/summary. Ask one clarifying question if it is missing.
- Use `--remarks` for the ticket page body; it supports HTML. Omit it when the user only provides a title/summary.
- If the CLI reports multiple matches for a product or version, ask the user to disambiguate.

## Confirmation

After creating, report:

- Ticket display ID and unique ID.
- Product / version scope (or "Backlog").
- Type, priority, status.
- Assignees, or `-` if none.
- Title/summary (stripped of HTML, truncated if long).
- Remarks (stripped of HTML, truncated if long), or `-` if none.

## References

- `references/CAWPLAN_OPEN_API.md`
