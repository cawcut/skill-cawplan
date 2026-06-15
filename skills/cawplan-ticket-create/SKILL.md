---
version: 0.1.0
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

1. Resolve product name to `product_id`:
   ```bash
   cawplan products list --search "<product name>"
   ```

2. If a version is specified, resolve it to `version_id`:
   ```bash
   cawplan versions list <product_id>
   ```

3. Resolve assignee email to `user_id` when provided:
   ```bash
   cawplan users query --email <email>
   ```

4. Create the ticket:

   **Version ticket** (scoped to a specific version):
   ```bash
   cawplan tickets create-version <product_id> <version_id> \
     --description "<html or text>" \
     --type FEATURE \
     --priority MEDIUM \
     --reporter_id <your_user_id> \
     --assignees <user_id>
   ```

   **Backlog ticket** (not assigned to any version):
   ```bash
   cawplan tickets create-backlog <product_id> \
     --description "<html or text>" \
     --type FEATURE \
     --priority MEDIUM \
     --reporter_id <your_user_id>
   ```

   For OAuth auth, resolve your own `reporter_id` first:
   ```bash
   cawplan auth status          # get your email
   cawplan users query --email <your-email>
   ```
   For API Key auth, omit `--reporter_id`.

## Rules

- Default type to `FEATURE`; use `BUGFIX` only when the user says bug, defect, or issue.
- Default priority to `MEDIUM` when not specified.
- If the user did not specify a version, use `create-backlog` and tell the user: "This ticket was created as a backlog item and is not assigned to any version."
- Do not guess the description. Ask one clarifying question if the content is missing.
- If multiple products or versions match, ask the user to disambiguate.

## Confirmation

After creating, report:

- Ticket display ID and unique ID.
- Product / version scope (or "Backlog").
- Type, priority, status.
- Assignees, or `-` if none.
- Description (stripped of HTML, truncated if long).

## References

- `references/CAWPLAN_OPEN_API.md`
