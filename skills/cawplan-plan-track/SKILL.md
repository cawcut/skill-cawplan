---
version: 0.2.6
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

## Important CLI constraint — read before writing any ticket-fetch command

`cawplan tickets search` **requires** `--time_range` or `--start_date`+`--end_date` unless you're doing an exact `--unique_ids`/`--display_ids`/`--parent_ids` lookup — `--version_ids`/`--product_ids`/`--priority`/`--type` alone do **not** satisfy this and the command exits with an error before it even calls the API (see `references/CAWPLAN_OPEN_API.md`'s "Canonical workaround for 'every matching ticket regardless of age' queries" — this skill picks that section's option 2). Release tracking needs tickets regardless of how long ago they were touched, so **this skill does not use `tickets search` for version-wide ticket lists** — it uses `tickets poll` instead, which has no time window at all. `tickets poll` in turn does **not** accept `--version_ids` (only `--product_ids`/`--product_line_ids`) — filter down to the target version client-side from its response's `version_id` field. Don't reintroduce a bare `tickets search --version_ids ...` call anywhere in this skill; it will fail.

## Workflow

1. Resolve product name to `product_id`:
   ```bash
   cawplan products list --search "<product name>"
   ```
   If more than one product matches, list the candidates (name + `product_id`) and ask the user to pick — do not guess. Keep the `product_line_id` (or nested `product_line.unique_id` — check the actual field name in the response) from this record.

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
   This returns each status `key` with a `category` (`UNSTARTED` / `STARTED` / `TESTING` / `COMPLETE` / `CANCELED`). Build a key→category map, and keep the full list of keys — step 5 needs it.

5. **Fetch every ticket for this version in one shared dataset** (skip only for a plain progress check with no ticket-level detail requested):
   ```bash
   cawplan tickets poll --product_ids <product_id> --status <every key from step 4, comma-separated> --page_size 200 --page_num 1
   ```
   Page through with `--page_num` if the product has more tickets than one page. This returns tickets across *every* version of the product (poll has no version filter) — filter the results client-side to `version_id == <target version_id>` to get this version's set (per the API reference, poll's response includes `version_id` per ticket precisely so this filtering is possible). Keep both the version-filtered set and the full unfiltered set in memory: steps 6-12 work off the version-filtered set, but step 10 (blocking check) can save a lookup by checking the unfiltered set first when a blocking ticket belongs to a different version. Each result already carries `status`, `priority`, `type`, `assignees`, `updated_at`, `version_id`, `parent_id` — steps 6-12 are pure filters over this one dataset, no further ticket-list fetches needed except step 10's relation calls.

   **This set includes sub-issues** (`parent_id` set) alongside top-level tickets — verified live (a version with `versions get`-reported progress of 6 top-level COMPLETE tickets out of ~60 top-level had 136 tickets total in poll once sub-issues were counted in). Keep sub-issues in every list below (steps 6-13) — a CRITICAL sub-issue bug is still a real, independently typed/prioritized/assigned ticket someone needs to see. But don't be surprised if a ticket *count* you report (e.g. "31 unstarted tickets") looks larger than what `versions get`'s `progress.status_counts` shows for the same version — that field counts top-level tickets only, so the two numbers aren't measuring the same set and shouldn't be presented as if they must reconcile.

6. **Unresolved Critical bugs** (only when the user asks about release risk / blockers — skip for a plain progress check): CawPlan tickets have no separate "Blocker" priority; treat `priority=CRITICAL` as the "Blocker" tier. From step 5's version-filtered set: `type=BUGFIX`, `priority=CRITICAL`, status category (step 4's map) not `COMPLETE`/`CANCELED`.

7. **Features not yet at QA Testing** (same trigger as step 6): from step 5's set, `type=FEATURE` whose status category maps to `UNSTARTED` or `STARTED`.

8. **Ready for QA / QA Testing ticket list** (only when asked — e.g. "what's ready for QA", "what's in QA testing"): from step 5's set, any type, status category `TESTING`. Steps 10 and 12 reuse this exact list — don't refilter step 5 for it again.

9. **Descope suggestions** (only when the user explicitly asks what to descope or how to reduce delay risk — never suggest this unprompted):
   - Candidate pool: step 5's version-filtered set. Do not suggest a ticket outside this pool, and do not guess a priority that wasn't returned; if a candidate's priority is genuinely missing, leave it out rather than invent one.
   - Only suggest descoping tickets whose status category is `UNSTARTED` (work not yet started) — never suggest descoping `STARTED`, `TESTING`, or `COMPLETE` work.
   - Order suggestions `LOW` priority first, then `MEDIUM`; never suggest descoping `HIGH` or `CRITICAL` priority tickets.
   - Ground every suggestion in `risk_reason` and step 5's actual ticket list — do not invent a reason not present in `risk_reason`.

10. **What's blocking QA testing** (only when asked): for each ticket in step 8's Ready-for-QA/TESTING list, check its blocking relations:
    ```bash
    cawplan tickets relate list <product_id> <version_id> <ticket_id>
    ```
    For each `relation_type=BLOCKED_BY` relation, resolve the blocking ticket's own status: check step 5's unfiltered (all-versions) set first, then step 5's version-filtered set if somehow not there, otherwise look it up with `cawplan tickets get <product_id> <version_id_of_that_ticket> <ticket_id>` — don't assume it's resolved just because you haven't seen it yet. Report only the ones whose status category (step 4's map) is not `COMPLETE`/`CANCELED`. This is one `relate list` call per in-testing ticket — if there are many, tell the user you're scoping to in-testing tickets only rather than silently sampling.

11. **Assignee overload** (only when asked — "is anyone overloaded", "who has too many high-priority issues"): from step 5's set, `priority` in `CRITICAL`/`HIGH`, status category not `COMPLETE`/`CANCELED`. A ticket can have multiple `assignees`; count it once per assignee, not once total. If a ticket has no assignees at all, don't drop it — report it separately as "unassigned"; an open high-priority ticket nobody owns is worth surfacing on its own. Group by assignee and sort by count descending. If two or more assignees tie for the highest count, report all of them as joint-top — don't arbitrarily pick one. Don't invent a "this counts as overloaded" cutoff (e.g. "3+ is too many") — team capacity norms aren't something you know; report the actual counts per assignee and let the user judge, calling out the top of the ranking (all tied entries, if any) as the most likely answer to "who."

12. **Per-QA pending count** (only when asked — "how many does each QA still have to verify"): reuse step 8's Ready-for-QA/QA-Testing list. Group by `assignees` the same way as step 11 (count once per assignee on multi-assignee tickets) and report a count per person. If a ticket in this list has no assignee, report it separately as unassigned rather than dropping it or attributing it to nobody silently.

13. **Tickets stale for more than N days** (only when asked — "what hasn't been touched in N days"): if the user didn't give N, ask what they mean by "a long time" rather than picking a default — there's no universal norm for what counts as stale. Once you have N: from step 5's set, exclude `COMPLETE`/`CANCELED`-category tickets (a resolved ticket that hasn't been touched since isn't "unfixed"), compute `(now - updated_at)` in days for the rest, and list those exceeding N, oldest first.

## Output

Report, scoped to what the user actually asked (don't run steps 4-13 for a plain "track this release" ask):

- Version name, status, and risk level (with reason if MEDIUM or HIGH).
- Completion: `X% complete (N done / M total)` (round `X` to a whole number).
- Target release date per channel (convert `release_at` Unix timestamp to a readable date).
- If step 5 ran: open tickets — display ID, type, priority, assignee, short description, grouped by status.
- Blockers: any CRITICAL or HIGH priority open tickets.
- If step 6/7 ran: unresolved Critical bugs and features not yet at QA Testing, each as its own list (display ID, title, assignee).
- If step 8 ran: the Ready for QA / QA Testing list — display ID, type, title, assignee.
- If step 9 ran: descope suggestions as a ranked list, each with the ticket and the one-line reason it's eligible (priority + status category) — not a restated risk_reason.
- If step 10 ran: which in-testing tickets are blocked, by what, and the blocker's own status — or state explicitly that no in-testing ticket has an unresolved blocker.
- If step 11 ran: assignees ranked by open high-priority ticket count, most first (all tied-for-top assignees called out together) — no "overloaded" verdict, just the ranked counts — plus an "unassigned" count if any qualifying ticket has no assignee.
- If step 12 ran: pending-verification count per QA assignee, plus an "unassigned" bucket if any Ready-for-QA ticket has no assignee.
- If step 13 ran: tickets older than N days (display ID, title, assignee, days since update), oldest first — or state explicitly that none exceed N days.

If all tickets are complete, say so explicitly.

## References

- `references/CAWPLAN_OPEN_API.md`
