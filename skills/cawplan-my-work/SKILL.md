---
version: 0.2.6
name: cawplan-my-work
description: |
  Show the current user's own CawPlan work: tickets and critical issues assigned to them, grouped by product line, product, and version, as a single priority-sorted open-ticket list, as a list of their own tickets that got reopened with the reason, their tickets' linked repo PRs/commits, or tickets that have a linked PR/commit but whose status hasn't moved forward — optionally narrowed to one project/version.
  Use when: the user asks what's on their plate, their current tasks, "my tickets", "my open tickets by priority", "my work", their tasks for a specific project/version, which of their tickets got reopened and why, what PRs/commits are linked to today's tickets, or which tickets already have a PR/commit but the ticket status wasn't updated — without giving a ticket ID or asking to search/filter broadly across other people.
  NOT for: another person's tasks, searching/filtering tickets by arbitrary criteria (use ad-hoc `cawplan tickets search`), creating or updating tickets, or release tracking.
argument-hint: "[optional: product/version to narrow to]"
allowed-tools: Bash
---

# CawPlan My Work

## Bootstrap

```bash
cawplan skill check
```

## Workflow

1. Resolve your own `user_id` — this is decoded from your local access token, no network call needed:
   ```bash
   cawplan auth status
   ```
   Read the `User ID:` line from the output. If it's missing, re-authenticate (`cawplan auth login`) rather than falling back to `cawplan users query --email` — that would spend a network call resolving something `auth status` should already have.

2. Fetch your todos:
   ```bash
   cawplan todos user <user_id>
   ```
   This returns `tickets` (grouped by `product_line` → `product` → `version`), `critical_issues` (grouped by `product_line` → `product`), and `summary`. No status filter is applied by default — the response includes everything assigned to you, not just open items.

3. If the user named a specific project/version, narrow `tickets` to that exact `product` → `version` leaf. `critical_issues` has no version dimension (only `product_line` → `product`), so it can't be narrowed to the same granularity — when the user named a version, narrow `critical_issues` to the matching *product* only, and say explicitly that these critical issues are product-wide and not confirmed to be specific to the named version. If the named project/version doesn't appear anywhere in `tickets`, say so explicitly ("no tickets found for you under <name>") rather than falling back to showing everything.

4. If the user asks for only open/未完成 items, resolve status categories for every distinct product line present in the response and filter properly — this is your own work, so it's realistically a handful of lines, not worth shortcutting:
   ```bash
   cawplan product-lines statuses <product_line_id>   # once per distinct product line in the response
   ```
   Exclude tickets whose status key maps to category `COMPLETE` or `CANCELED`. Only fall back to "just show every item's status clearly instead, let the user judge" if this turns out to span more product lines than is reasonable to resolve (rare for one person's own work) — and say explicitly that's what you're doing rather than silently presenting an unfiltered list as if it were filtered.

5. **Priority-sorted flat list** (only when the user asks for "my open tickets by priority" / sorted-by-priority framing, rather than a project/version breakdown): flatten `tickets` across every product line/product/version into one list. This framing implies open-only even if not stated explicitly — run step 4's filtering for it. Then sort `CRITICAL` → `HIGH` → `MEDIUM` → `LOW`. Still show which product/version each ticket belongs to per row — flattening the grouping for sort order doesn't mean dropping that context.

6. **My reopened tickets** (only when the user asks about reopened tickets / why something got reopened): there's no `REOPENED` status *category* (only `UNSTARTED`/`STARTED`/`TESTING`/`COMPLETE`/`CANCELED`) — reopening shows up as a status *key* whose name says so, or as a history transition backward out of a terminal category. History-scanning (bullet 2) is always the ground truth; the status-key check (bullet 1) is only a shortcut for the common case where a ticket is *currently sitting* on the reopen status — it does not replace history-scanning.
   - Check history for every one of your tickets, regardless of current status: `cawplan tickets history <product_id> <version_id> <ticket_id>`, looking for any transition *from* a `COMPLETE`/`CANCELED`-category status *back to* a non-terminal category — each such transition is a reopen event. A ticket can have more than one; report all of them (oldest to newest), not just the latest — don't assume a ticket is reopened at most once.
   - As a labeling aid only, resolve each distinct product line's statuses (`cawplan product-lines statuses <product_line_id>`) to check whether the ticket's status right after a reopen transition has "reopen" in its `display_name` — if so you can call it out as "reopened" by name in the report; if not (e.g. it went straight back to `in_progress` or `TESTING`), it's still a reopen per the history transition, just report the actual status name instead of assuming there's a dedicated label for it.
   - For each reopen event, report the timestamp and actor from that history entry if present, and the reason: use the history entry's own comment if the API returns one on status-change events *and it's plausibly about that specific transition* (a general free-text comment field that isn't tied to the transition shouldn't be presented as if it explains the reopen); otherwise fall back to the ticket's `progress_comment` and label it explicitly as "latest progress note, not necessarily the reopen reason" rather than presenting it as if it directly explains the reopen. If neither exists, say the reason wasn't recorded — do not infer a reason from the ticket title or description. If the `tickets history` call itself fails or returns nothing, treat that ticket the same as "no reopen found," not as evidence of a missing reason.

7. **My tickets' linked repo PRs/commits** (only when asked — "today's tickets with their PR/commits", "整理我当天任务涉及的tickets和PR/commit"): tickets carry a `links[]` array that can hold GitHub PR/commit URLs (shape documented in `references/CAWPLAN_OPEN_API.md` under "VersionTicket fields of note") — `todos`/`poll` don't return this field, only the full ticket record does, so this step uses `tickets search` instead of steps 1-6's `todos` call.
   ```bash
   cawplan tickets search --assignees <user_id> --start_date 2000-01-01 --end_date <today> --updated_start_date <date> --updated_end_date <date> --page_size 100 --page_num 1
   ```
   Default `<date>`-`<date>` to today for both `--updated_start_date`/`--updated_end_date` unless the user asked for a different day/range; treat the end date as inclusive of the whole day unless a result set proves otherwise. Use `--updated_start_date`/`--updated_end_date`, not `--start_date`/`--end_date`, for "today's tickets" — the latter filter ticket *creation* time (confirmed against `uid.core-product`'s DAO, see `references/CAWPLAN_OPEN_API.md`), so a ticket created last week that you're actively working on today would be silently missed. `--start_date`/`--end_date` still has to be passed (the endpoint requires a created_at window or `--time_range`) — pin it to the maximal-window workaround (`2000-01-01` to today) so it doesn't itself narrow the result.
   `platform` on a link isn't a reliable fixed value — the same manually-added GitHub link can show up as `platform: "LINK"` — so classify by the `url` itself: contains `/pull/` → PR, contains `/commit/` → commit, otherwise report it as a plain link with its `title`. A ticket with an empty `links` array has no repo links; say so rather than omitting it from the report.
   Page through using the response's `total`/`page_num`/`page_size` fields (keep fetching while `page_num * page_size < total`) rather than assuming one page of 100 covers everything.

8. **Ticket has a PR/commit linked but status hasn't moved** (only when asked — "哪些ticket已经有PR/commit但状态还没更新"): reuse step 7's fetch mechanism (`tickets search`, needs the full record for `links`) and its pagination rule. Scope: if the user names a product/version, use `--product_ids`/`--version_ids` in place of `--assignees`; if they explicitly say "my"/自己的, use `--assignees <user_id>`. If they specify neither (a bare "which tickets have a PR/commit but no status update"), default to your own tickets (`--assignees <user_id>`) — this skill's whole scope is the current user's work — but say plainly that you defaulted to "your tickets" and that they can ask again scoped to a specific product/version if they meant something broader. Use the maximal-window workaround from `references/CAWPLAN_OPEN_API.md` (`--start_date 2000-01-01 --end_date <today>`) since a stale ticket by definition hasn't been touched recently — a narrow "today" window would systematically miss the exact tickets this is looking for.
   - A ticket "has a PR/commit" when any of its `links` has a `url` containing `/pull/` or `/commit/` — either one counts, since an open PR (not yet merged into a commit reference) is just as much a sign of active code work as a bare commit link.
   - "Status hasn't updated" means its `status_display.category` (or resolve via `product-lines statuses` if `status_display` isn't present in the response) is still `UNSTARTED` or `STARTED` — a ticket already at `TESTING`/`COMPLETE` has clearly progressed, even if nobody manually closed the loop on the PR/commit link.
   - Report each qualifying ticket with the PR/commit link(s) found (and whether each is a PR or a commit, same classification as step 7) and its current status, so the user can judge whether the ticket genuinely needs a status bump.

## Output

- Group by product line → product → version, matching the API's own grouping — don't re-flatten it into one undifferentiated list, **unless step 5 ran**, in which case present the single priority-sorted list instead (still showing product/version per row).
- For each ticket: display ID, type, priority, status, one-line title.
- Critical issues: separate section, grouped by product line → product, with severity/status.
- Lead with `summary` if the response includes one **and step 3 didn't narrow the scope** — `summary` describes the full unnarrowed response, so showing it alongside a narrowed list would contradict what's actually listed. When narrowed, state counts for the narrowed slice instead (e.g. "1 ticket, 1 product-wide critical issue for UniFi Access 4.1.10").
- If step 3 narrowed the scope, say what it was narrowed to before listing results.
- If there's genuinely nothing assigned, say so plainly rather than returning an empty section with no comment.
- If step 6 ran: one entry per reopened ticket (display ID, title, reopened-at, reopened-by if known, reason or "not recorded"). If none of your tickets were reopened, say so explicitly rather than showing an empty list.
- If step 7 ran: one entry per ticket in the fetched window, its PRs/commits/other links (or "no repo links"); note the date-field assumption once, not per ticket.
- If step 8 ran: one entry per qualifying ticket — display ID, title, current status, and the PR/commit link(s) that triggered the flag. If none qualify, say so explicitly.

## References

- `references/CAWPLAN_OPEN_API.md`
