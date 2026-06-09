---
version: 0.1.0
name: cawplan-metrics
description: |
  Query CawPlan product metrics such as installations, crash rate, offline rate, and update success rate through the cawplan CLI.
  Use when: the user asks for product metrics, install base, adoption, reliability trends, crash/offline rates, or update success over time.
  NOT for: tickets, critical issue workflows, user activity reports, todos, or release notes.
argument-hint: "[product id or name] [time range]"
allowed-tools: Bash
---

# CawPlan Metrics

## Bootstrap

Before running a CawPlan command:

```bash
command -v cawplan >/dev/null || { echo "cawplan is not installed. Run: npm install -g cawplan"; exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

For CI or headless use, suggest `cawplan auth configure` instead of browser login.

## Workflow

1. Resolve product name to `product_id` when needed:
   ```bash
   cawplan products list --search "<product name>"
   ```
2. Query metrics with an explicit time range:
   ```bash
   cawplan metrics get <product_id> --time_range 1m
   ```
3. Use explicit dates when the user gives a calendar range:
   ```bash
   cawplan metrics get <product_id> --start YYYY-MM-DD --end YYYY-MM-DD
   ```

## Output

Lead with the summary values, then call out one or two notable trends. Do not overstate causality unless the data directly supports it.

## References

- `references/CAWPLAN_OPEN_API.md`
