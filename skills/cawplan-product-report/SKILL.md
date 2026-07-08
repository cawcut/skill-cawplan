---
version: 0.2.3
name: cawplan-product-report
description: |
  Generate a CawPlan product status report with progress, risk analysis, priority recommendations, and summaries.
  Use when: the user asks for a product status report, progress report, risk summary, release readiness, or priority recommendations for a product over a date range.
  NOT for: raw activity feed, user activity, ticket creation, metrics dashboards, or critical issue lists.
argument-hint: "[product name or ID, start date, end date, optional version]"
allowed-tools: Bash
---

# CawPlan Product Report

## Bootstrap

```bash
command -v cawplan >/dev/null || { echo "cawplan is not installed or not on PATH. Do not search the filesystem for it (no find/locate/where scans) — just run: npm install -g cawplan@latest"; exit 1; }
cawplan_version="$(cawplan --version)"
latest_cawplan_version="$(npm view cawplan version 2>/dev/null)" || { echo "Unable to check latest cawplan version. Run: cawplan upgrade"; exit 1; }
node -e 'const [current, latest] = process.argv.slice(1); process.exit(current === latest ? 0 : 1);' "$cawplan_version" "$latest_cawplan_version" || { echo "cawplan $latest_cawplan_version is available (current: $cawplan_version). Run: cawplan upgrade"; exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

## Workflow

1. Resolve product name to `product_id`:
   ```bash
   cawplan products list --search "<product name>"
   ```

2. Resolve version name to `version_id` if the user scopes to a version:
   ```bash
   cawplan versions list <product_id>
   ```

3. Fetch the product report:
   ```bash
   cawplan product-activity get \
     --product_id <product_id> \
     --start YYYY-MM-DD \
     --end YYYY-MM-DD

   # Scoped to a specific version:
   cawplan product-activity get \
     --product_id <product_id> \
     --version_id <version_id> \
     --start YYYY-MM-DD \
     --end YYYY-MM-DD
   ```

4. Supplement with version progress when reporting on a specific version:
   ```bash
   cawplan versions get <product_id> <version_id>
   ```
   This provides `progress.complete_percent`, `risk`, `risk_reason`, and `target_release`.

## Output

Structure the report as:

- **Summary**: what changed and what was completed in the period.
- **Progress**: ticket completion rate, status breakdown.
- **Risk**: current risk level and reason (LOW / MEDIUM / HIGH).
- **Priority recommendations**: what should be addressed before release.
- **Upcoming**: target release dates and remaining open items.

## References

- `references/CAWPLAN_OPEN_API.md`
