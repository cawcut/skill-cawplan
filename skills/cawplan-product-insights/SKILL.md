---
version: 0.2.4
name: cawplan-product-insights
description: |
  Aggregate CawPlan product insights: adoption metrics, installations, user feedback, key metrics, and critical issues.
  Use when: the user asks for a product health overview, adoption stats, install base, crash rate, user feedback trends, or a combined product insights summary.
  NOT for: date-range activity reports, ticket creation, single-metric queries, or user activity.
argument-hint: "[product name or ID, time range]"
allowed-tools: Bash
---

# CawPlan Product Insights

## Bootstrap

```bash
command -v cawplan >/dev/null || { echo "cawplan is not installed or not on PATH. Do not search the filesystem for it (no find/locate/where scans) — just run: npm install -g cawplan@latest"; exit 1; }
cawplan_version="$(cawplan --version)"
latest_cawplan_version="$(npm view cawplan version 2>/dev/null)" || { echo "Unable to check latest cawplan version. Upgrading..."; cawplan upgrade || exit 1; latest_cawplan_version="$(cawplan --version)"; }
node -e 'const p=v=>v.trim().replace(/^v/,"").split(".").map(n=>parseInt(n,10)||0);const [cs,ls]=process.argv.slice(1);const c=p(cs),l=p(ls);let newer=false;for(let i=0;i<3;i++){if((l[i]||0)>(c[i]||0)){newer=true;break;}if((l[i]||0)<(c[i]||0)){newer=false;break;}}process.exit(newer?1:0);' "$cawplan_version" "$latest_cawplan_version" || { echo "cawplan $latest_cawplan_version is available (current: $cawplan_version). Upgrading..."; cawplan upgrade || exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

## Workflow

1. Resolve product name to `product_id`:
   ```bash
   cawplan products list --search "<product name>"
   ```

2. Fetch all insight sources in parallel:

   **Adoption & health metrics** (installations, crash rate, offline rate):
   ```bash
   cawplan metrics get <product_id> --time_range 1m
   # or with explicit dates:
   cawplan metrics get <product_id> --start YYYY-MM-DD --end YYYY-MM-DD
   ```

   **AI feedback analytics** (feedback categories and trends):
   ```bash
   cawplan analytics get <product_id> --time_range 1m
   ```

   **Critical issues** (active blockers and incidents):
   ```bash
   cawplan critical list --product_id <product_id>
   ```

## Output

Structure the insights as:

- **Adoption**: install base, active devices, growth trend.
- **Stability**: crash rate, offline rate, notable anomalies.
- **User feedback**: top feedback categories, notable shifts.
- **Critical issues**: count and severity of active blockers.
- **Key takeaways**: 2–3 bullet points on what needs attention.

Highlight notable shifts or outliers. Avoid overstating causality.

## Decision Guide

- For a specific metric trend only: use `/cawplan-metrics`.
- For feedback categories only: use `/cawplan-analytics`.
- For date-range activity report: use `/cawplan-product-report`.

## References

- `references/CAWPLAN_OPEN_API.md`
