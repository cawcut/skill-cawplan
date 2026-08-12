---
version: 0.2.6
name: cawplan-plan-track
description: |
  Track CawPlan release progress for a version: ticket completion, risk level, open items, target release dates, unresolved Critical-priority bugs, features not yet at QA Testing, what's Ready for QA/QA Testing, descope suggestions, and what's blocking QA testing.
  Use when: the user asks to track a release, check release progress, review open tickets for a version, assess release/delay risk, ask what to descope, ask what's Ready for QA / in QA Testing for a version, or ask what's blocking QA testing for a version.
  NOT for: creating versions or tickets, product-wide metrics dashboards not scoped to a version, user activity summaries, or open-ended critical-issue search across products (use `cawplan critical search` directly for that).
argument-hint: "[product name or ID, version name or ID]"
allowed-tools: Bash
---

# CawPlan Plan Track

## Bootstrap

```bash
cawplan skill check
```

## Workflow

1. Resolve product name to `product_id`:
   ```bash
   cawplan products list --search "<product name>"
   ```
   Keep the `product_line_id` (or nested `product_line.unique_id` — check the actual field name in the response) from this record; steps 6-7 need it.

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

5. **Unresolved Critical bugs** (only when the user asks about release risk / blockers — skip for a plain progress check): CawPlan tickets have no separate "Blocker" priority; treat `priority=CRITICAL` as the "Blocker" tier.
   ```bash
   cawplan tickets search --version_ids <version_id> --type BUGFIX --priority CRITICAL
   ```
   Exclude any ticket whose `status` maps to a `COMPLETE`/`CANCELED` category (see step 6) — those are already resolved.

6. **Features not yet at QA Testing** (same trigger as step 5): the workflow-status categories are per product line, not fixed strings, so resolve them first.
   ```bash
   cawplan product-lines statuses <product_line_id>
   ```
   This returns each status `key` with a `category` (`UNSTARTED` / `STARTED` / `TESTING` / `COMPLETE` / `CANCELED`). Build a key→category map, then:
   ```bash
   cawplan tickets search --version_ids <version_id> --type FEATURE
   ```
   Each result is a full ticket record (includes `priority`) — step 7 reuses this list, no extra fetch needed for feature priority. A feature is "not yet at QA Testing" when its `status` key maps to category `UNSTARTED` or `STARTED`.

7. **Ready for QA / QA Testing ticket list** (only when asked — e.g. "what's ready for QA", "what's in QA testing"): reuse the key→category map from step 6, but don't restrict by type this time — the user wants every ticket at that stage, not just features.
   ```bash
   cawplan tickets search --version_ids <version_id>
   ```
   A ticket is "Ready for QA / QA Testing" when its `status` key maps to category `TESTING`. Step 9 reuses this exact list — don't re-fetch it there if this step already ran.

8. **Descope suggestions** (only when the user explicitly asks what to descope or how to reduce delay risk — never suggest this unprompted):
   - Candidate pool: the step-4 poll results plus the step-6 FEATURE results — both already carry `priority` and `status`. Do not suggest a ticket outside this pool, and do not guess a priority that wasn't returned; if a candidate's priority is genuinely missing from every fetched result, leave it out rather than invent one.
   - Only suggest descoping tickets whose status category is `UNSTARTED` (work not yet started) — never suggest descoping `STARTED`, `TESTING`, or `COMPLETE` work.
   - Order suggestions `LOW` priority first, then `MEDIUM`; never suggest descoping `HIGH` or `CRITICAL` priority tickets.
   - Ground every suggestion in `risk_reason` and the actual ticket list from steps 4-6 — do not invent a reason not present in `risk_reason`.

9. **What's blocking QA testing** (only when asked): find tickets currently in QA testing whose blockers aren't resolved.
   ```bash
   cawplan tickets search --version_ids <version_id>
   ```
   (Skip this call if step 7 already ran — reuse its result instead.) Filter to `status` category `TESTING` (step 6's map), then for each one check its blocking relations:
   ```bash
   cawplan tickets relate list <product_id> <version_id> <ticket_id>
   ```
   For each `relation_type=BLOCKED_BY` relation, resolve the blocking ticket's own status: reuse it if already fetched in an earlier step (5/6/7/9), otherwise look it up with `cawplan tickets get <product_id> <version_id> <ticket_id>` — don't assume it's resolved just because you haven't seen it yet. Report only the ones whose status category (step 6) is not `COMPLETE`/`CANCELED`. This can be several calls (one per in-testing ticket, plus one per unresolved blocker not already known) — if there are many, tell the user you're scoping to in-testing tickets only rather than silently sampling.

## Output

Report, scoped to what the user actually asked (don't run steps 5-9 for a plain "track this release" ask):

- Version name, status, and risk level (with reason if MEDIUM or HIGH).
- Completion: `X% complete (N done / M total)` (round `X` to a whole number).
- Target release date per channel (convert `release_at` Unix timestamp to a readable date).
- Open tickets: display ID, type, priority, assignee, short description. Group by status.
- Blockers: any CRITICAL or HIGH priority open tickets.
- If step 5/6 ran: unresolved Critical bugs and features not yet at QA Testing, each as its own list (display ID, title, assignee).
- If step 7 ran: the Ready for QA / QA Testing list — display ID, type, title, assignee.
- If step 8 ran: descope suggestions as a ranked list, each with the ticket and the one-line reason it's eligible (priority + status category) — not a restated risk_reason.
- If step 9 ran: which in-testing tickets are blocked, by what, and the blocker's own status — or state explicitly that no in-testing ticket has an unresolved blocker.

If all tickets are complete, say so explicitly.

## References

- `references/CAWPLAN_OPEN_API.md`
