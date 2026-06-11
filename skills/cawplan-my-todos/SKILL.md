---
version: 0.1.0
name: cawplan-my-todos
description: |
  Query CawPlan todos assigned to a user, including tickets and critical issues grouped by product context.
  Use when: the user asks for their todos, assigned work, pending CawPlan tasks, or what a specific person needs to handle.
  NOT for: activity history, product metrics, ticket creation, or release planning.
argument-hint: "[user id or todo filters]"
allowed-tools: Bash
---

# CawPlan My Todos

## Bootstrap

Before running a CawPlan command:

```bash
command -v cawplan >/dev/null || { echo "cawplan is not installed. Run: npm install -g cawplan"; exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

For CI or headless use, suggest `cawplan auth configure` instead of browser login.

## Workflow

1. If the user gives an email or name instead of a user ID, resolve it:
   ```bash
   cawplan users query --email "<email>"
   cawplan users query --keyword "<name>"
   ```
2. Fetch todos:
   ```bash
   cawplan todos user <user_id>
   ```
3. Apply status filters when requested:
   ```bash
   cawplan todos user <user_id> --ticket_status IN_PROGRESS,NOT_STARTED --issue_status INVESTIGATING
   ```

## Output

Summarize by product and urgency. Include ticket or critical issue IDs, status, priority, and short title/description when present.

## References

- `references/CAWPLAN_OPEN_API.md`
