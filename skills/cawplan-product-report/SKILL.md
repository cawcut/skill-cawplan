---
version: 0.2.1
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
command -v cawplan >/dev/null || { echo "cawplan is not installed. Run: npm install -g cawplan@latest"; exit 1; }
cawplan_version="$(cawplan --version)"
node -e 'const [current, required] = process.argv.slice(1); const parse = (v) => v.split(".").map(Number); const [a, b, c] = parse(current); const [x, y, z] = parse(required); process.exit(a > x || (a === x && (b > y || (b === y && c >= z))) ? 0 : 1);' "$cawplan_version" "0.0.8" || { echo "cawplan >= 0.0.8 is required. Run: npm install -g cawplan@latest"; exit 1; }
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
