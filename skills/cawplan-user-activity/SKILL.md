---
version: 0.1.0
name: cawplan-user-activity
description: |
  Generate user activity summaries from CawPlan by calling the user activity command through the cawplan CLI.
  Use when: the user asks what someone has been doing, requests a work summary, asks for recent activity, or wants a report for a person over a date range.
  NOT for: current todos, product-level reports, metrics dashboards, ticket creation, or generic user lookup.
argument-hint: "[user email or id] [date range]"
allowed-tools: Bash
---

# CawPlan User Activity

## Bootstrap

Before running a CawPlan command:

```bash
command -v cawplan >/dev/null || { echo "cawplan is not installed. Run: npm install -g cawplan"; exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

For CI or headless use, suggest `cawplan auth configure` instead of browser login.

## Workflow

1. Convert relative dates to explicit `YYYY-MM-DD`.
   - Default to the last 5 days when the user does not specify a range.
   - Keep the range at or below 90 days.
2. Prefer email when provided:
   ```bash
   cawplan user-activity get --email <user@ui.com> --start YYYY-MM-DD --end YYYY-MM-DD
   ```
3. Use user ID when already known:
   ```bash
   cawplan user-activity get --user_id <user_id> --start YYYY-MM-DD --end YYYY-MM-DD
   ```

## Output

Produce a concise activity report grouped by tickets, critical issues, QA reports, and notable changes. Mention the user and date range used. Avoid dumping raw JSON unless asked.

- Convert timestamps to readable local time.
- Strip HTML tags from comments and descriptions.
- Include ticket display ID, product/version, type, status, priority, latest comment, and notable activity.
- Include critical issue status, tech owners, latest comment, and notable activity.
- Include QA report type, result, status, approver/comment info, and notable activity.
- If every section is empty, say the user had no activity during the period.
- End with a short 2-3 sentence summary of the user's main focus areas.

## References

- `references/CAWPLAN_OPEN_API.md`
- `references/CAWPLAN_ACTIVITY_API.md`
