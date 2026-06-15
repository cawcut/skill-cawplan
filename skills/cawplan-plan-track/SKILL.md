---
version: 0.2.0
name: cawplan-plan-track
description: |
  Track CawPlan release progress for a version: ticket completion, risk level, open items, and target release dates.
  Use when: the user asks to track a release, check release progress, see what's blocking a version, or review open tickets for a version.
  NOT for: creating versions or tickets, product metrics dashboards, user activity summaries, or critical issue search.
argument-hint: "[product name or ID, version name or ID]"
allowed-tools: Bash
---

# CawPlan Plan Track

## Bootstrap

```bash
command -v cawplan >/dev/null || { echo "cawplan is not installed. Run: npm install -g cawplan"; exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

## Workflow

1. Resolve product name to `product_id`:
   ```bash
   cawplan products list --search "<product name>"
   ```

2. Resolve version name to `version_id` (skip if already known):
   ```bash
   cawplan versions list <product_id>
   ```

3. Fetch progress and release history in one call:
   ```bash
   cawplan versions track <product_id> <version_id>
   ```
   This returns:
   - `detail.data.progress` — `complete_percent`, `status_counts` (COMPLETE / UNSTARTED / STARTED / TESTING / CANCELED)
   - `detail.data.risk` — LOW / MEDIUM / HIGH
   - `detail.data.risk_reason`
   - `detail.data.extra.target_release` — channel name and `release_at` timestamp
   - `detail.data.status` — NOT_STARTED / INPROGRESS / RELEASED
   - `release.data` — release history events (status changes, risk changes)

4. Fetch open tickets to surface pending work:
   ```bash
   cawplan tickets poll --product_ids <product_id> --version_ids <version_id> --status NOT_STARTED,IN_PROGRESS
   ```

## Output

Report:

- Version name, status, and risk level (with reason if MEDIUM or HIGH).
- Completion: `X% complete (N done / M total)`.
- Target release date per channel (convert `release_at` Unix timestamp to a readable date).
- Open tickets: display ID, type, priority, assignee, short description. Group by status.
- Blockers: any CRITICAL or HIGH priority open tickets.

If all tickets are complete, say so explicitly.

## References

- `references/CAWPLAN_OPEN_API.md`
