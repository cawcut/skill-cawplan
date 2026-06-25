---
version: 0.2.1
name: cawplan-ticket-create
description: |
  Create a new CawPlan ticket (version-scoped or backlog) with details, assignee, and priority.
  Use when: the user asks to create, file, or add a ticket, issue, bug, or task in CawPlan.
  NOT for: updating existing tickets, searching tickets, critical issues, or release planning.
argument-hint: "[product, version (optional), description, type, priority, assignee]"
allowed-tools: Bash
---

# CawPlan Ticket Create

## Bootstrap

```bash
command -v cawplan >/dev/null || { echo "cawplan is not installed. Run: npm install -g cawplan"; exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

## Workflow

Use `--product` and `--version` by name — the CLI resolves IDs internally. No prior lookup needed.

**Version ticket** (scoped to a specific version):
```bash
cawplan tickets create-version \
  --product "<product name>" \
  --ver "<version name>" \
  --description "<text>" \
  --type FEATURE \
  --priority MEDIUM \
  --reporter <your-email> \
  --assignee <email>
```

**Backlog ticket** (no version specified):
```bash
cawplan tickets create-backlog \
  --product "<product name>" \
  --description "<text>" \
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
- If the user did not specify a version, use `create-backlog` and tell the user: "This ticket was created as a backlog item and is not assigned to any version."
- Do not guess the description. Ask one clarifying question if the content is missing.
- If the CLI reports multiple matches for a product or version, ask the user to disambiguate.

## Confirmation

After creating, report:

- Ticket display ID and unique ID.
- Product / version scope (or "Backlog").
- Type, priority, status.
- Assignees, or `-` if none.
- Description (stripped of HTML, truncated if long).

## References

- `references/CAWPLAN_OPEN_API.md`
