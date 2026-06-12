---
version: 0.1.0
name: cawplan-qa-report
description: |
  Query CawPlan QA reports for products and versions through the cawplan CLI.
  Use when: the user asks about QA results, test reports, SQA/AQA/stress/performance/smoke test outcomes, or whether a version passed QA.
  NOT for: tickets, critical issues, product metrics, user activity, or release notes.
argument-hint: "[product id or name] [version id] [type or result filter]"
allowed-tools: Bash
---

# CawPlan QA Reports

## Bootstrap

Before running a CawPlan command:

```bash
command -v cawplan >/dev/null || { echo "cawplan is not installed. Run: npm install -g cawplan"; exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

## Workflow

1. Resolve product name to `product_id` when needed:
   ```bash
   cawplan products list --search "<product name>"
   ```
2. List all QA reports for a product (grouped by version):
   ```bash
   cawplan qa-reports list <product_id>
   ```
3. Filter by report type or result:
   ```bash
   cawplan qa-reports list <product_id> --type sqa --result failed
   ```
4. List QA reports for a specific version:
   ```bash
   cawplan versions list <product_id>   # resolve version_id
   cawplan qa-reports list-version <product_id> <version_id>
   cawplan qa-reports list-version <product_id> <version_id> --type aqa --result pass
   ```
5. Get a single QA report by ID:
   ```bash
   cawplan qa-reports get <product_id> <version_id> <qa_report_id>
   ```

## Decision Guide

- All QA reports for a product: `cawplan qa-reports list`.
- QA reports scoped to a version: `cawplan qa-reports list-version`.
- Full detail for one report: `cawplan qa-reports get`.
- Report types: `sqa` (System QA), `aqa` (Automated QA), `stress`, `performance`, `smoke`.
- Results: `pass`, `pass_with_issues`, `failed`.

## Output

State the test type, result, and version for each report. If multiple reports exist, group by version. Flag any `failed` or `pass_with_issues` results prominently.

## References

- `references/CAWPLAN_OPEN_API.md`
