---
version: 0.2.6
name: cawplan-ticket-create
description: |
  Create a new CawPlan ticket (version-scoped by default, or backlog only after user confirmation) with a title and optional HTML description body.
  Use when: the user asks to create, file, or add a ticket, issue, bug, or task in CawPlan.
  NOT for: updating existing tickets, searching tickets, critical issues, or release planning.
argument-hint: "[product, version, ticket title, HTML description body, type, priority, assignee; backlog only if user cannot provide version]"
allowed-tools: Bash
---

# CawPlan Ticket Create

## Bootstrap

```bash
cawplan skill check
```

## Workflow

Use `--product` and `--version` by name when the user already provided both — the CLI resolves IDs internally.

If a product is provided but no version is provided:
1. Resolve the product first:
   ```bash
   cawplan products list --search "<product name>"
   ```
2. List versions for the resolved product:
   ```bash
   cawplan versions list <product_id> --page_size 100
   ```
3. Show the user the in-progress versions (`status`/`state` such as `IN_PROGRESS`, `INPROGRESS`, or display text "In Progress") and ask them to choose one. Include a "Backlog / no version" option only as a fallback when the user cannot provide a version.

**Version ticket** (scoped to a specific version):
```bash
cawplan tickets create-version \
  --product "<product name>" \
  --ver "<version name>" \
  --description "<ticket title>" \
  --remarks "<html description body>" \
  --type FEATURE \
  --priority MEDIUM \
  --reporter <your-email> \
  --assignee <email>
```

**Backlog ticket** (fallback only when the user cannot provide a version or explicitly asks for backlog):
```bash
cawplan tickets create-backlog \
  --product "<product name>" \
  --description "<ticket title>" \
  --remarks "<html description body>" \
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
- Keep title and description/body separate:
  - Use CLI `--description` only for the ticket title/summary.
  - Use CLI `--remarks` for the page description/body. It supports HTML and is the field users usually mean by "description".
  - Do not put a long body, acceptance criteria, PRD text, or multi-line description into `--description`.
- Convert plain-text body content to compact HTML before passing `--remarks`. Do not pass raw newline-separated text because it may render as one mixed line. Use `<p>`, `<br>`, `<ul>`, and `<li>` as appropriate.
- If the user provides a multi-line request, use the first short line or concise summary as the title and put the remaining detail into HTML `--remarks`. Ask one clarifying question if the title cannot be identified safely.
- If the user did not specify a version, resolve the product, list in-progress versions, and ask the user to choose one before creating the ticket.
- Do not create a backlog ticket by default. Use `create-backlog` only when the user explicitly asks for backlog/no version, or after they confirm they cannot provide a version.
- When creating a backlog ticket, tell the user: "This ticket was created as a backlog item and is not assigned to any version."
- Do not guess the ticket title/summary. Ask one clarifying question if it is missing.
- If the CLI reports multiple matches for a product or version, ask the user to disambiguate.

## Confirmation

After creating, report:

- Ticket display ID and unique ID.
- Product / version scope (or "Backlog").
- Type, priority, status.
- Assignees, or `-` if none.
- Title (from CLI `--description`, stripped/truncated if long).
- Description/body (from CLI `--remarks`, stripped of HTML and truncated if long), or `-` if none.

## References

- `references/CAWPLAN_OPEN_API.md`
