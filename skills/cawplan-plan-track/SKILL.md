---
version: 0.2.9
name: cawplan-plan-track
description: |
  Track CawPlan release progress for a version: ticket completion, risk level, open items, target release dates, unresolved Critical-priority bugs, features not yet at QA Testing, what's Ready for QA/QA Testing, descope suggestions, what's blocking QA testing, assignee overload, per-QA pending counts, and tickets stale for more than N days.
  Use when: the user asks to track a release, check release progress, review open tickets for a version, assess release/delay risk, ask what to descope, ask what's Ready for QA / in QA Testing for a version, ask what's blocking QA testing, ask if any assignee has too many high-priority issues piled up, ask how many tickets each QA still has to verify, or ask which tickets haven't been fixed in over N days.
  NOT for: creating versions or tickets, product-wide metrics dashboards not scoped to a version, user activity summaries, or open-ended critical-issue search across products (use `cawplan critical search` directly for that).
argument-hint: "[product name or ID, version name or ID]"
allowed-tools: Bash
---

# CawPlan Plan Track

## Bootstrap

```bash
cawplan skill check
```

## Important ticket-query rules

`cawplan tickets search` **requires** `--time_range` or `--start_date`+`--end_date` unless doing an exact `--unique_ids`/`--display_ids`/`--parent_ids` lookup. Release tracking needs tickets regardless of age, so every version-wide search in this skill uses `--start_date 2000-01-01 --end_date <today>` and pages to `total`.

Labels are the classification source of truth. Do not use legacy ticket `type`, the `--type` search option, or returned `.type` to decide whether a ticket is a bug or feature. For category-specific queries, first list the confirmed product's visible labels, select only from that catalog, and filter with `--label_ids`.

The response's `description` is the canonical ticket title. Display it verbatim: do not translate, summarize, shorten, normalize punctuation or spacing, remove prefixes, or drop parenthetical text. Markdown escaping that preserves the same visible title is allowed; any summary belongs in a separate field.

## Workflow

### Required product-access gate

Before querying **any** product-, version-, release-, or ticket-scoped data, verify that the caller can see the product through `products list`. This applies even when the user supplied a `product_id` directly or it came from an earlier conversation — never treat a known ID as proof of access.

```bash
cawplan products list --search "<product name or product_id>"
```

Continue only when the response contains one intended product (`product_id` / `unique_id`). Match a supplied product name exactly (case-insensitively, after trimming whitespace), or accept a unique short-form/token-prefix match; a non-unique similarly named result is only a candidate, never an automatic replacement. If no unique accessible product matches, do **not** call `versions`, `tickets`, `product-lines statuses`, or any other product-scoped endpoint. If candidates were returned, list their names and ask the user to confirm which product they mean. If no candidates were returned, state that the named product either does not exist or is not accessible to the caller; do not report ticket counts or imply that its ticket list is empty. Return `NO_PERMISSION` only when the API explicitly reports denied access.

```text
NO_PERMISSION: You do not have access to product "CawCut Cloud".
```

Never convert an unavailable product into an empty result such as `Open Tickets: 0`; an empty ticket list is meaningful only after this access gate succeeds.

1. Resolve product name to `product_id` and complete the required product-access gate:
   ```bash
   cawplan products list --search "<product name>"
   ```
If no exact or unique short-form product match exists, list any candidates (name + `product_id`) and ask the user to confirm which product they mean; do not guess. If the lookup returns no candidates, say: `未找到可访问的 product “<name>”：该 product 可能不存在，或你当前没有访问权限，因此无法查询其 tickets。` If more than one match exists, ask the user to pick. Keep the `product_line_id` (or nested `product_line.unique_id` — check the actual field name in the response) from the confirmed record.

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

4. **Resolve the product line's status keys** (needed by every step below except a plain progress check — run this once, before step 5):
   ```bash
   cawplan product-lines statuses <product_line_id>
   ```
   This returns each status `key` with a `category` (`UNSTARTED` / `STARTED` / `TESTING` / `COMPLETE` / `CANCELED`). Build a key→category map for client-side checks in the steps below.

4a. **Resolve classification labels** when step 6 or 7 will run:
   ```bash
   cawplan labels list --product_id <product_id> --page_size 200 --page_num 1
   ```
   Page to `total`. Select only labels returned by this product-scoped catalog; never invent names or IDs and never fall back to legacy `type`.
   - Bug intent: `behavior=BUGFIX` is a strong match. Strong name signals are `bug`, `bugs`, `bugfix`, `bug fix`, `defect`, `defects`, `regression`, and `regressions`. Treat `fix`, `fixing`, `hotfix`, `issue`, `crash`, `incident`, and `blocker` as context-dependent; select them only when the catalog and user intent clearly make them category labels.
   - Feature intent: `behavior=FEATURE` is a strong match. Exact semantic names such as `feature` or `enhancement` are candidates when consistent with the catalog.
   - Normalize case, whitespace, hyphens, and underscores for matching, but retain the exact returned IDs/names. If multiple labels safely match, use all of them (OR within `label_ids`). If none safely match, show candidates and ask; do not use `type`.

5. **Fetch every ticket for this version in one shared full-detail dataset** (skip only for a plain progress check with no ticket-level detail requested):
   ```bash
   cawplan tickets search --version_ids <version_id> --start_date 2000-01-01 --end_date <today> --page_size 100 --page_num 1
   ```
   Page while `page_num * page_size < total`. Search returns the full ticket shape needed here, including `description`, `labels`, `status_display`, `priority`, `assignees`, `updated_at`, `version_id`, and `parent_id`. Steps 5a and 8-13 filter this shared dataset; steps 6-7 deliberately issue label-filtered searches so their category selection is enforced by the API.

   **This set includes sub-issues** (`parent_id` set) alongside top-level tickets. Keep sub-issues in every list below (steps 6-13) — a CRITICAL sub-issue bug is still a real, independently labeled/prioritized/assigned ticket someone needs to see. But don't be surprised if a ticket *count* you report (e.g. "31 unstarted tickets") looks larger than what `versions get`'s `progress.status_counts` shows for the same version — that field counts top-level tickets only, so the two numbers aren't measuring the same set and shouldn't be presented as if they must reconcile.

5a. **Open Tickets** (when the user asks for current Version's Open Tickets): from step 5's
   version-filtered set, include every Ticket whose status key maps to a category other than
   `COMPLETE` or `CANCELED`. `UNSTARTED`, `STARTED`, and **`TESTING`** are all open categories.
   Do not use a hard-coded status-key whitelist or infer terminal state from a key/display name:
   a custom status named `Testing` in category `TESTING` is an Open Ticket and must be returned.
   Group results by resolved status display name/category.

6. **Unresolved Critical bugs** (only when the user asks about release risk / blockers — skip for a plain progress check): CawPlan tickets have no separate "Blocker" priority; treat `priority=CRITICAL` as the "Blocker" tier. Use the bug label IDs selected in step 4a:
   ```bash
   cawplan tickets search --version_ids <version_id> --label_ids <bug-label-ids> --priority CRITICAL --start_date 2000-01-01 --end_date <today> --excluded_status_categories COMPLETE,CANCELED --page_size 100 --page_num 1
   ```
   Page to `total`, then independently exclude any result whose inline `status_display.category` is `COMPLETE` or `CANCELED`.

7. **Features not yet at QA Testing** (same trigger as step 6): use the feature label IDs selected in step 4a:
   ```bash
   cawplan tickets search --version_ids <version_id> --label_ids <feature-label-ids> --status_categories UNSTARTED,STARTED --start_date 2000-01-01 --end_date <today> --page_size 100 --page_num 1
   ```
   Page to `total`, then independently keep only results whose inline `status_display.category` is `UNSTARTED` or `STARTED`.

8. **Ready for QA / QA Testing ticket list** (only when asked — e.g. "what's ready for QA", "what's in QA testing"): from step 5's set, regardless of labels, keep status category `TESTING`. Steps 10 and 12 reuse this exact list — don't refilter step 5 for it again.

9. **Descope suggestions** (only when the user explicitly asks what to descope or how to reduce delay risk — never suggest this unprompted):
   - Candidate pool: step 5's version-filtered set. Do not suggest a ticket outside this pool, and do not guess a priority that wasn't returned; if a candidate's priority is genuinely missing, leave it out rather than invent one.
   - Only suggest descoping tickets whose status category is `UNSTARTED` (work not yet started) — never suggest descoping `STARTED`, `TESTING`, or `COMPLETE` work.
   - Order suggestions `LOW` priority first, then `MEDIUM`; never suggest descoping `HIGH` or `CRITICAL` priority tickets.
   - Ground every suggestion in `risk_reason` and step 5's actual ticket list — do not invent a reason not present in `risk_reason`.

10. **What's blocking QA testing** (only when asked): for each ticket in step 8's Ready-for-QA/TESTING list, check its blocking relations:
    ```bash
    cawplan tickets relate list <product_id> <version_id> <ticket_id>
    ```
    For each `relation_type=BLOCKED_BY` relation, resolve the blocking ticket's own status from step 5's dataset when it is in the same version; otherwise look it up with `cawplan tickets get <product_id> <version_id_of_that_ticket> <ticket_id>` — don't assume it is resolved merely because it is outside the target version. Report only blockers whose status category (step 4's map) is not `COMPLETE`/`CANCELED`. This is one `relate list` call per in-testing ticket — if there are many, tell the user you're scoping to in-testing tickets only rather than silently sampling.

11. **Assignee overload** (only when asked — "is anyone overloaded", "who has too many high-priority issues"): from step 5's set, `priority` in `CRITICAL`/`HIGH`, status category not `COMPLETE`/`CANCELED`. A ticket can have multiple `assignees`; count it once per assignee, not once total. If a ticket has no assignees at all, don't drop it — report it separately as "unassigned"; an open high-priority ticket nobody owns is worth surfacing on its own. Group by assignee and sort by count descending. If two or more assignees tie for the highest count, report all of them as joint-top — don't arbitrarily pick one. Don't invent a "this counts as overloaded" cutoff (e.g. "3+ is too many") — team capacity norms aren't something you know; report the actual counts per assignee and let the user judge, calling out the top of the ranking (all tied entries, if any) as the most likely answer to "who."

12. **Per-QA pending count** (only when asked — "how many does each QA still have to verify"): reuse step 8's Ready-for-QA/QA-Testing list. Group by `assignees` the same way as step 11 (count once per assignee on multi-assignee tickets) and report a count per person. If a ticket in this list has no assignee, report it separately as unassigned rather than dropping it or attributing it to nobody silently.

13. **Tickets stale for more than N days** (only when asked — "what hasn't been touched in N days"): if the user didn't give N, ask what they mean by "a long time" rather than picking a default — there's no universal norm for what counts as stale. Once you have N: from step 5's set, exclude `COMPLETE`/`CANCELED`-category tickets (a resolved ticket that hasn't been touched since isn't "unfixed"), compute `(now - updated_at)` in days for the rest, and list those exceeding N, oldest first.

## Output

Report, scoped to what the user actually asked (don't run steps 4-13 for a plain "track this release" ask):

- Version name, status, and risk level (with reason if MEDIUM or HIGH).
- Completion: `X% complete (N done / M total)` (round `X` to a whole number).
- Target release date per channel (convert `release_at` Unix timestamp to a readable date).
- If step 5a ran: Open Tickets — display ID, labels, priority, assignee, and verbatim `description` title,
  grouped by resolved status. Include every non-terminal category, including `TESTING`.
- Blockers: any CRITICAL or HIGH priority open tickets.
- If step 6/7 ran: unresolved Critical bugs and features not yet at QA Testing, each as its own list (display ID, title, assignee).
- If step 8 ran: the Ready for QA / QA Testing list — display ID, labels, verbatim `description` title, assignee.
- If step 9 ran: descope suggestions as a ranked list, each with the ticket and the one-line reason it's eligible (priority + status category) — not a restated risk_reason.
- If step 10 ran: which in-testing tickets are blocked, by what, and the blocker's own status — or state explicitly that no in-testing ticket has an unresolved blocker.
- If step 11 ran: assignees ranked by open high-priority ticket count, most first (all tied-for-top assignees called out together) — no "overloaded" verdict, just the ranked counts — plus an "unassigned" count if any qualifying ticket has no assignee.
- If step 12 ran: pending-verification count per QA assignee, plus an "unassigned" bucket if any Ready-for-QA ticket has no assignee.
- If step 13 ran: tickets older than N days (display ID, title, assignee, days since update), oldest first — or state explicitly that none exceed N days.

If all tickets are complete, say so explicitly.

## References

- `references/CAWPLAN_OPEN_API.md`
