---
version: 0.1.0
name: cawplan-product-activity
description: |
  Generate product-centric CawPlan activity reports over an explicit date range through the cawplan CLI.
  Use when: the user asks for a product activity report, release train report, date-range report for a product, or asks what changed for a product recently.
  NOT for: a single user's activity report, personal todos, generic product lookup, ticket creation, or product metric time-series dashboards.
argument-hint: "[product name or id] [start/end date] [optional version]"
allowed-tools: Bash
---

# CawPlan Product Activity

## Bootstrap

Before running a CawPlan command:

```bash
command -v cawplan >/dev/null || { echo "cawplan is not installed. Run: npm install -g cawplan"; exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

For CI or headless use, suggest `cawplan auth configure` instead of browser login.

## Workflow

1. Parse the product, explicit date range, and optional version.
   - Dates must be `YYYY-MM-DD`.
   - Date range must be at most 90 days.
   - If the user asks for daily/weekly/monthly, convert that intent into explicit `--start` and `--end` dates before calling the CLI.
2. Resolve product name to `product_id` when needed:
   ```bash
   cawplan products list --search "<product name>"
   ```
3. Resolve version name to `version_id` when the user scopes the report to a version or release train:
   ```bash
   cawplan versions list <product_id>
   ```
4. Run the report:
   ```bash
   cawplan product-activity get --product_id <product_id> --start YYYY-MM-DD --end YYYY-MM-DD
   cawplan product-activity get --product_id <product_id> --version_id <version_id> --start YYYY-MM-DD --end YYYY-MM-DD
   ```

## Output

Render a product-centric report:

- Start with product name and date range from the response.
- Summarize ticket updates, critical issue updates, QA report updates, and versions affected.
- Group details by version when present.
- Strip HTML tags from descriptions and comments; keep status, priority, type, display IDs, and assignee names verbatim.
- If there is no activity, say the product had no activity during the report window.

## Rules

- If multiple products match, show candidates and ask the user to choose.
- If the requested date range or version is invalid, surface the CLI/API error and ask for a corrected value.
- Do not fabricate release or ticket findings when the response is empty.

## References

- `references/CAWPLAN_OPEN_API.md`
