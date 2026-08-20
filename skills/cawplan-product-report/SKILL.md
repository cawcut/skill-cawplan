---
version: 0.2.8
name: cawplan-product-report
description: |
  Generate a CawPlan status report over a date range: for a single product (progress, risk analysis, priority recommendations, summaries), for a Team (CawPlan product line), or for a named member — ticket-change-based completion, in the last two cases.
  Use when: the user asks for a product status report, progress report, risk summary, release readiness, or priority recommendations for a product over a date range; asks how a Team/product line is doing over a date range; or asks how a specific member's task completion looks over a date range (not their own — use `cawplan-my-work` for "my tasks").
  NOT for: raw activity feed, user activity, ticket creation, metrics dashboards, or critical issue lists.
argument-hint: "[product name or ID, OR team/product-line name, OR member name/email, start date, end date, optional version]"
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
| A named member, someone other than the caller ("how's Alex doing on...") | **C — Member report** |

If unsure whether a name is a product or a Team, resolve both (`products list --search`, `product-lines list`) and ask if either is ambiguous or both match. If the user asks about their *own* task completion ("my tasks"), that's `cawplan-my-work`, not this skill.

## Workflow A — Product report

1. Resolve product name to `product_id`:
   ```bash
   cawplan products list --search "<product name>"
   ```
   If more than one product matches, list the candidates (name + `product_id`) and ask the user to pick — do not guess. All three workflows in this skill resolve products this way.

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
   cawplan tickets search --product_line_ids <product_line_id> --start_date 2000-01-01 --end_date <today> --updated_start_date <window_start> --updated_end_date <today> --page_size 100 --page_num 1
   ```
   - **Use `--updated_start_date`/`--updated_end_date` for the report window, not `--start_date`/`--end_date`** — the latter filter ticket *creation* time, not last-changed time (see `references/CAWPLAN_OPEN_API.md`), so on their own they'd miss a ticket created earlier that was actually completed/progressed inside the window — silently understating "what changed." `--start_date`/`--end_date` still has to be passed (the endpoint requires a created_at window or `--time_range`), so pin it to a maximal range (`2000-01-01` to today, the same workaround `cawplan-ux-tracking` uses) so it doesn't itself narrow results — `--updated_start_date`/`--updated_end_date` does the actual filtering.
   - **Pass `--updated_end_date <today>` (real "today"), not the report window's own end date** — `updated_at` is refreshed by *any* field change, not just completion, so a ticket that completed inside the window but got an unrelated edit (version transfer, priority bump, comment) after the window would have its `updated_at` pushed past the window's end and be silently dropped if `--updated_end_date` were capped there (see the `updated_at`-is-not-"completed at" note in `references/CAWPLAN_OPEN_API.md`). Widening the end bound to today makes this a candidate set, not the final answer — step 2a below narrows it back down using the real completion time for anything currently done/canceled. A ticket created inside `[window_start, today]` is still caught (its `updated_at` starts equal to `created_at`), so this remains a strict superset of the old created_at-only behavior.
   - For "last N days" asks, compute `--updated_start_date` (today minus N days) client-side — `time_range` only applies to the created_at pair, not the updated_at pair.
   - The response is a `CommonPageResp` (`data`, `page_num`, `page_size`, `total`) — page through while `page_num * page_size < total`, the same rule used in `cawplan-my-work`/`cawplan-ux-tracking` for this identical shape. Don't stop on a page that happens to come back full without checking `total` first.

2a. **Narrow the candidate set down to the real report window** — the widened end-bound in step 2 sweeps in tickets touched after the window for reasons unrelated to this report:
   - For any candidate whose `status_display.category` is **not** `COMPLETE`/`CANCELED` (i.e. `UNSTARTED`/`STARTED`/`TESTING`): keep it only if its own `updated_at` falls inside `[window_start, window_end]` — these tickets aren't done, so there's no separate "completion timestamp" to check; their last-modified time is the best signal available and the widened end-bound would otherwise let in edits that happened after the report window closed.
   - For any candidate whose `status_display.category` **is** `COMPLETE`/`CANCELED`: verify the *actual* completion timestamp with `cawplan tickets history <product_id> <version_id> <ticket_id>`, per the canonical pattern in `references/CAWPLAN_OPEN_API.md` (latest `UPDATED` entry whose `changed_fields.status.new` is a terminal-category status; fall back to the `CREATED` entry if none). Keep the ticket only if that timestamp falls inside `[window_start, window_end]` — this catches both directions of the bug: a ticket that completed inside the window but was edited again afterward (would otherwise be missed), and a ticket that completed *before* the window but was merely touched inside it for an unrelated reason (would otherwise be miscounted as "completed this period").
   - This adds one `tickets history` call per COMPLETE/CANCELED-category candidate, not per candidate overall — usually a small fraction of the result set.

3. Optionally, resolve which products make up the team (for a per-product breakdown only if asked):
   ```bash
   cawplan products list --product_line_id <product_line_id>
   ```

## Workflow C — Member report

Same ticket-change approach as Workflow B, scoped to one person instead of a whole product line.

1. Resolve the member to a `user_id`:
   ```bash
   cawplan users query --email <email>       # if the user gave an email
   cawplan users query --keyword "<name>"    # if the user gave a name
   ```
   If the keyword query returns more than one person, list them (name + email) and ask which one — do not guess.

2. Fetch their ticket changes in the period:
   ```bash
   cawplan tickets search --assignees <user_id> --start_date 2000-01-01 --end_date <today> --updated_start_date <window_start> --updated_end_date <today> --page_size 100 --page_num 1
   ```
   If the user also scoped to a product/version, add `--product_ids <id>` / `--version_ids <id>` (resolve the same way as Workflow A step 1). Apply the same `--updated_start_date`/`--updated_end_date`-over-`--start_date`/`--end_date` rule, widened-end-date, date-computation, and pagination rules as Workflow B step 2 — a ticket assigned to this member long ago but only completed inside the window must not be missed just because it wasn't *created* inside it. Then apply **Workflow B step 2a** (history-verified completion window) to this candidate set before reporting completion counts — the `updated_at`-is-not-"completed at" issue applies identically to a single member's tickets.

## Output

**Workflow A:**

- **Summary**: what changed and what was completed in the period.
- **Progress**: ticket completion rate, status breakdown.
- **Risk**: current risk level and reason (LOW / MEDIUM / HIGH).
- **Priority recommendations**: what should be addressed before release.
- **Upcoming**: target release dates and remaining open items.

**Workflow B:**

- **Summary**: what changed across the team in the period (counts, not a risk verdict — this workflow has no `versions track`-style risk field; don't invent one).
- **Completion**: ticket counts by status (done vs in-progress vs not-started), by type, by priority — the done/canceled counts are the history-verified set from step 2a, not a raw `updated_at`/current-status count.
- **Notable items**: any CRITICAL/HIGH priority tickets touched in the period, and any ticket moved to a terminal status (done/canceled) per step 2a's verified completion timestamp.
- **Per-product breakdown**: only if step 3 ran and the user asked for it.

**Workflow C:** same shape as Workflow B (Summary + Completion + Notable items), scoped to the one person's tickets — no per-product breakdown section.

## References

- `references/CAWPLAN_OPEN_API.md`
