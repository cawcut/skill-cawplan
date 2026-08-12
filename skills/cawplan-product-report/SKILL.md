---
version: 0.2.6
name: cawplan-product-report
description: |
  Generate a CawPlan status report over a date range: for a single product (progress, risk analysis, priority recommendations, summaries), or for a Team (CawPlan product line) — ticket-change-based completion across every product on that team.
  Use when: the user asks for a product status report, progress report, risk summary, release readiness, or priority recommendations for a product over a date range; or asks how a Team/product line is doing, its task completion, over a date range.
  NOT for: raw activity feed, user activity, ticket creation, metrics dashboards, or critical issue lists.
argument-hint: "[product name or ID, OR team/product-line name, start date, end date, optional version]"
allowed-tools: Bash
---

# CawPlan Product Report

## Bootstrap

```bash
cawplan skill check
```

## Entry Routing

| Input | Flow |
|---|---|
| A specific product (and optionally a version) | **A — Product report** |
| A Team / product line ("Team A", a squad/line name, not a product name) | **B — Team report** |

If unsure whether a name is a product or a Team, resolve both (`products list --search`, `product-lines list`) and ask if either is ambiguous or both match.

## Workflow A — Product report

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

## Workflow B — Team report

There is no team-scoped activity endpoint — `product-activity get` only takes a single `--product_id`. Build the report from ticket changes across every product on the team instead.

1. Resolve the Team name to a `product_line_id`. `product-lines list` has no name filter, so page through it and match by name client-side:
   ```bash
   cawplan product-lines list --page_size 100
   ```
   If no name matches, ask for the correct name. If more than one matches, list the candidates (name + `product_line_id`, plus any other distinguishing field the response carries) and ask the user to pick — do not guess.

2. Fetch ticket changes across the whole team — this is the ticket-change data the report is built from:
   ```bash
   cawplan tickets search --product_line_ids <product_line_id> --start_date YYYY-MM-DD --end_date YYYY-MM-DD --page_size 100 --page_num 1
   ```
   - For "last N days" asks, compute exact `--start_date`/`--end_date` (today minus N days) rather than guessing a `time_range` token — the documented `time_range` vocabulary (`1d`/`1w`/`1m`/`3m`/`6m`/`1y`, per other endpoints in `references/CAWPLAN_OPEN_API.md`) has no confirmed "N days" token and this endpoint's own docs don't list examples.
   - Reserve `--time_range` for when the user's own words already match that vocabulary ("this week" → `1w`, "this month" → `1m`).
   - Page through with `--page_num` until a page returns fewer than `--page_size` results — don't report counts from page 1 alone if the team has more tickets than one page.

3. Optionally, resolve which products make up the team (for a per-product breakdown only if asked):
   ```bash
   cawplan products list --product_line_id <product_line_id>
   ```

## Output

**Workflow A:**

- **Summary**: what changed and what was completed in the period.
- **Progress**: ticket completion rate, status breakdown.
- **Risk**: current risk level and reason (LOW / MEDIUM / HIGH).
- **Priority recommendations**: what should be addressed before release.
- **Upcoming**: target release dates and remaining open items.

**Workflow B:**

- **Summary**: what changed across the team in the period (counts, not a risk verdict — this workflow has no `versions track`-style risk field; don't invent one).
- **Completion**: ticket counts by status (done vs in-progress vs not-started), by type, by priority.
- **Notable items**: any CRITICAL/HIGH priority tickets touched in the period, and any ticket moved to a terminal status (done/canceled).
- **Per-product breakdown**: only if step 3 ran and the user asked for it.

## References

- `references/CAWPLAN_OPEN_API.md`
