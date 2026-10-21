---
version: 0.2.11
name: cawplan-product-report
description: |
  Generate a CawPlan status report over a date range: for a single product (progress, risk analysis, priority recommendations, summaries), for a Team (CawPlan product line), or for a named member — ticket-change-based completion, in the last two cases. Also lists product-wide open tickets by a requested label-backed category and optional title keyword, including backlog and cross-version tickets.
  Use when: the user asks for a product status report, progress report, risk summary, release readiness, priority recommendations, the open/unclosed tickets in a product's current or named version, or a product-wide filtered list such as "remaining Collage bugs"; asks how a Team/product line is doing over a date range; asks which product/Team/version tickets were reopened over a period; or asks how a specific member's task completion looks over a date range (not their own — use `cawplan-my-work` for "my tasks").
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
| Product-wide remaining/open tickets by category and optional keyword (for example, “VN iOS Collage bugs”) | **A1 — Product-wide label-filtered tickets** |
| Open/unclosed tickets in a product's current or named version | **A0 — Version open tickets** |
| A specific product (and optionally a version) | **A — Product report** |
| A Team / product line ("Team A", a squad/line name, not a product name) | **B — Team report** |
| A product's UX members' UX/design completion | Use `cawplan-ux-tracking` **Workflow D**; it counts `ux → READY` events performed by the product's configured Designers, not reporters or assignees. |
| A product's QA members' Ticket verification / acceptance status | **D — QA verification activities**; count status-change events performed by that product's configured QA members, not by current Assignee. |
| A named member, someone other than the caller ("how's Alex doing on...") | **C — Member report** |
| Counts of tickets in a product, version or Team by status, assignee, priority, label or UX ("当前版本各状态多少条", "每个 Assignee 多少条") | One call per dimension, scoped with `--product_ids` or `--version_ids`: `cawplan tickets stats --version_ids <version_id> --start_date 2000-01-01 --end_date <today> --group_by status` (then `--group_by assignee`, singular). The date window is required. See `references/QUERY_RESILIENCE.md` §1. Do not page `tickets search` to count. |
| Reopened tickets in a product, version, Team or member scope over a period ("哪些被 reopen 了") | Use the definition and command in `references/QUERY_RESILIENCE.md` ("Reopens"), scoped with `--product_ids`, `--version_ids`, `--product_line_ids`, or the member's candidate `--unique_ids`. Report every reopen event (ticket, previous → new status, time). Do not limit it to a status named "Reopen". |

If unsure whether a name is a product or a Team, resolve both (`products list --search`, `product-lines list`) and ask if either is ambiguous or both match. A user-supplied Team or product name must match an accessible record exactly (case-insensitively, after trimming whitespace), or be a unique short-form/token-prefix match. If it does not match uniquely, list the available or search-returned candidates and ask which Team/product they mean; never substitute a similarly named product or Team. If the user asks about their *own* task completion ("my tasks"), that's `cawplan-my-work`, not this skill.

## Shared ticket rules

### Labels are the classification source of truth

Do not use legacy ticket `type`, the `--type` search option, or the returned `.type` field to decide whether a ticket is a bug, feature, or another category. Resolve classification from the labels visible to the confirmed product and filter with `--label_ids`. The legacy field may still appear in API responses for compatibility; ignore it for category decisions.

### Ticket title fidelity

The ticket response's `description` field is the canonical title. Whenever a ticket title is displayed, reproduce it verbatim: do not translate, summarize, shorten, rewrite, normalize punctuation or spacing, remove prefixes, or drop parenthetical text. If an explanation or summary is useful, put it in a separate field. Markdown escaping needed to preserve the same visible title (for example, escaping a table pipe) is allowed.

## Workflow A0 — Version open tickets

Use this workflow for requests such as “查看 VN Cloud 当前 Version 的 Open Tickets” or “list the unclosed tickets for Product X 1.2.3.” Apply **Workflow A's required product-access gate before every other query**. Do not infer a product from a similar name, alias, prior query, or another product's current version.

1. Resolve the requested product with:
   ```bash
   cawplan products list --search <product-name-word-or-product_id>
   ```
   Pass the search text as one unquoted token (`--search CawPlan`, never `--search "CawPlan"`): the hosted agent rejects quoted values. For a name with spaces, search one distinctive word and match the full name in the results.
   Continue only with an exact accessible-name match or a unique short-form/token-prefix match. If no candidate matches, report: “No accessible Product matched `<input>`; it may not exist, have a different name, or you may not have permission.” Do not query versions or tickets. If the API explicitly returns an access-denied error, report `NO_PERMISSION`; otherwise do not claim that lack of permission is certain.

2. Resolve the version. For “current Version,” use the matched product's `inprogress_version_id` and `inprogress_version_name`; if either is absent, report that the product has no current in-progress version. For a named version, use `cawplan versions list <product_id>` and require an exact version-name match. Never borrow a version from another product.

3. Fetch every ticket in that version, paging to `total`:
   ```bash
   cawplan tickets search --version_ids <version_id> --start_date 2000-01-01 --end_date <today> --page_size 100 --page_num 1
   ```
   Treat a ticket as open only when its inline `status_display.category` is neither `COMPLETE` nor `CANCELED`. Filter this client-side even if an `--excluded_status_categories COMPLETE,CANCELED` filter is also supplied; do not trust a server-side exclusion as the only safeguard.

4. Report the resolved Product and Version, total open count, and a status/priority breakdown. For each listed ticket, show display ID, labels, priority, status, and the verbatim `description` title. If the result is too large for a useful chat response, provide the count and breakdown first, then ask for a priority/status slice or an export; do not silently substitute another product or report a partial list as complete.

## Workflow A1 — Product-wide label-filtered tickets

Use this workflow for requests such as “list the remaining Collage bugs for VN iOS.” It intentionally spans active versions and Backlog unless the user explicitly narrows the scope.

1. Resolve the requested product and complete **Workflow A's required product-access gate**. Keep the confirmed `product_id`; do not infer a similarly named product.

2. Fetch the complete label catalog visible to that product:
   ```bash
   cawplan labels list --product_id <product_id> --page_size 200 --page_num 1
   ```
   Page to `total`. This product-scoped catalog includes the labels applicable through its Team/product line plus any workspace-wide labels. Select only from records actually returned; never invent a label name or ID, and never query an unscoped workspace-wide catalog as a substitute.

3. Match the user's requested category to the returned catalog. Normalize case, whitespace, hyphens, and underscores for comparison, but retain the exact returned label ID and name:
   - For bug/defect intent, every returned label whose `behavior` is `BUGFIX` is a strong match.
   - Strong name signals are `bug`, `bugs`, `bugfix`, `bug fix`, `defect`, `defects`, `regression`, and `regressions` when they occur as a label name or clear token/phrase, not as an arbitrary substring such as `debug`.
   - `fix`, `fixing`, `hotfix`, `issue`, `crash`, `incident`, and `blocker` are context-dependent candidates. Select them only when the returned catalog and the user's wording make their category meaning clear; do not blindly treat workflow/state labels such as `Fixing` as bug classification.
   - Labels such as `Feature`, `Enhancement`, `Blocked`, and priority labels are not bugs merely because they may occur on a bug ticket.
   - For a non-bug category, apply the same semantic rule: choose only labels from the returned catalog that clearly express the user's requested category.
   - If more than one label is a safe semantic match, select all of them. Search treats them as OR within `label_ids`, then ANDs the result with the other filters.
   - If no returned label is a safe match, show the closest returned candidates and ask the user to choose. Do not fall back to legacy `type`.

4. Query all matching tickets. Use IDs from step 3 and add `--search` only when the user supplied a separate title/text keyword such as `Collage`:
   ```bash
   cawplan tickets search \
     --product_ids <product_id> \
     --label_ids <comma-separated-selected-label-ids> \
     --search <optional-keyword> \
     --start_date 2000-01-01 \
     --end_date <today> \
     --excluded_status_categories COMPLETE,CANCELED \
     --page_size 100 \
     --page_num 1
   ```
   Omit `--search` when there is no separate keyword. Page while `page_num * page_size < total`.

   `--search` is a free-text match across multiple ticket fields, not a structured module filter. A ticket such as `Photo Edit ... Collage` can therefore match `Collage` without belonging to a Collage module. Do not describe keyword results as strict module membership. If the user requires a module-pure list and the API provides no dedicated module filter, disclose that limitation. Do not add a module label beside bug labels in the same `--label_ids` argument as a workaround: values within `label_ids` are OR, so that would return `bug OR module`, not `bug AND module`.

5. Independently classify each result as open only when its inline `status_display.category` is neither `COMPLETE` nor `CANCELED`; `TESTING` remains open. This client-side check is mandatory even though the server exclusion is supplied.

6. Make the classification auditable. Before the result table, state the exact selected labels (name, ID, and why each matched, including `behavior=BUGFIX` when present). Then report the resolved Product, total open count, status/priority/version breakdown, and each ticket's display ID, labels, version or Backlog, priority, status, and verbatim `description` title. Never display a rewritten title or present a partial page as the complete list.

## Workflow A — Product report

### Required product-access gate

Before querying **any** product-, version-, or ticket-scoped data, confirm that the requested product appears in the caller's `products list` response. Apply this gate even when the caller supplied a product ID directly or the ID was retained from earlier context.

```bash
cawplan products list --search <product-name-word-or-product_id>
```

Proceed only after identifying one intended product (`product_id` / `unique_id`) through an exact match or unique short-form match. If the user's named product has no unique accessible match, stop and ask them to confirm the intended product from the candidates; do not issue product, version, activity, or ticket queries. Use `NO_PERMISSION` only when the API explicitly reports that access is denied. Never report an inaccessible or unresolved product as a successful empty result (for example, `Open Tickets: 0`).

1. Resolve product name to `product_id` and complete the required product-access gate:
   ```bash
   cawplan products list --search <product-name-word>
   ```
   If no exact or unique short-form product match exists, list the candidates (name + `product_id`) and ask the user to confirm which product they mean; do not guess. All product-scoped workflows in this skill resolve products this way.

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

2a. **Narrow the candidate set to actual status changes in the report window** — `updated_at`
   is only a broad candidate filter: it is refreshed by any edit, including recomputing a Parent
   Ticket after one of its Sub-tickets changes. It is never evidence that this Ticket changed
   status.
   - Fetch the real status changes for the whole Team in one bulk call (window at most 90 days;
     split longer ranges):
     ```bash
     cawplan tickets changes --product_line_ids <product_line_id> --fields status --start_date <window_start> --end_date <window_end>
     ```
     Every returned event is a status change inside the window, with `at`, `old` → `new`, and
     `new_category`. Keep a Ticket only when it has at least one event. Do not keep a Ticket
     solely because its `updated_at` is in the window. Classify terminal completion by the
     event's `new_category` (`COMPLETE` / `CANCELED`) rather than hard-coding `DONE`. For counts
     only, `--group_by new_category` (or `ticket`) returns them server-side.
   - Count each Ticket once in the summary, retaining its latest in-window event as the displayed
     evidence. A Parent Ticket whose status did not change has no event and is excluded even if a
     Sub-ticket change refreshed the Parent's `updated_at`. The response's `tickets` map carries
     display ID, title, priority, labels and version for the output.
   - If the result is `truncated`, continue with `--cursor` or split the window before reporting.
   - **Fallback** (only if `tickets changes` is unavailable, see
     `references/QUERY_RESILIENCE.md`): for **every** candidate from step 2, call
     `cawplan tickets history <product_id> <version_id> <ticket_id>` and keep the Ticket only when
     an `UPDATED` entry has `changed_fields.status` (the new status key string, or an object with
     `old` and `new`) with `created_at` inside `[window_start, window_end]`; never treat `CREATED`
     as a status change. Resolve the product line's status definitions to classify the new status
     by category. Say that the slower path was used, and report a partial result if not every
     candidate could be checked.

3. Optionally, resolve which products make up the team (for a per-product breakdown only if asked):
   ```bash
   cawplan products list --product_line_id <product_line_id>
   ```

## Workflow D — QA verification activities

Use this workflow for requests such as “汇总 CawCut Cloud 的 QA Team 本周的 Ticket 验收情况” or
“Summarize this product's QA ticket verification status.” Here, **QA Team means the product's
configured `members.qas` roster**, not a CawPlan product line. If the product is omitted, ask
which product's QA members should be reported. This workflow measures **QA Activities**: actual
Ticket status transitions performed by a QA member during the requested period. It does not use
current Assignee, Reporter, or a Ticket's current status as a proxy for QA work.

1. Resolve the product and complete Workflow A's required product-access gate:
   ```bash
   cawplan products list --search <product-name-word-or-product_id>
   ```
   Read the matched product's `members.qas[]` roster and collect its `user_id` values and display
   names. If it has no QA members, report that the product has no configured QA roster and stop.
   Membership is product-scoped; use the roster returned for this product, not a workspace-wide
   keyword search. Default an omitted range to the current week and state the inclusive date range
   used.

2. Fetch every status change the QA roster made in the window with one bulk call (window at most
   90 days; split longer ranges):
   ```bash
   cawplan tickets changes --product_ids <product_id> --fields status --actor_ids <qa_user_ids_csv> --start_date <window_start> --end_date <window_end>
   ```
   Each returned event is a status change inside the window performed by a roster member. Do not
   count `CREATED`, `TRANSFERRED`, an arbitrary `updated_at`, a status change performed by a
   non-QA actor, or a Ticket merely because it is currently assigned to QA. For counts per QA
   person, `--group_by actor,new_status_category` returns them server-side. If the result is
   `truncated`, continue with `--cursor` or split the window.

3. **Fallback** (only if `tickets changes` is unavailable, see `references/QUERY_RESILIENCE.md`):
   build a complete candidate set exactly as in Workflow B step 2, including pagination:
   ```bash
   cawplan tickets search --product_ids <product_id> --start_date 2000-01-01 --end_date <today> --updated_start_date <window_start> --updated_end_date <today> --page_size 100 --page_num 1
   ```
   (`updated_at` only identifies Tickets whose history may be relevant; its end bound stays real
   today.) For every candidate, call `cawplan tickets history <product_id> <version_id> <ticket_id>`
   and keep every `UPDATED` entry whose `changed_fields.status` is present (normally `{old, new}`;
   tolerate a legacy string as the new status), whose `created_at` is inside
   `[window_start, window_end]`, and whose `user_id` belongs to the `members.qas` roster. Say that
   the slower path was used, and report a partial result if not every candidate could be checked.

4. Treat each retained history entry as one QA activity — do **not** deduplicate by Ticket. A
   Ticket can legitimately be moved through QA Testing, Done, Reopen, and Close within one week;
   each status transition is useful verification evidence. Attribute the activity to the event's
   `actor` (or the history entry's `user_id` / `user_display_name` on the fallback path), the QA
   person who performed the change. Do not infer
   that person from the Ticket's Reporter or Assignee. Exclude an entry with no actor that cannot
   be matched to the product QA roster; identify it separately as an unassigned/integration event
   only if relevant to explaining the exclusion.

5. For a category breakdown, use each event's `new_category`; resolve the product line's status
   definitions only on the fallback path. Display the actual transition (`old → new`) and, when
   available, its new-status category. Do not
   hard-code `DONE`, `REOPEN`, `CLOSE`, or `QA Testing`: custom status keys and categories are
   valid QA activities too.

## Workflow C — Member report

Same ticket-change approach as Workflow B, scoped to one person instead of a whole product line.

1. Resolve the member to a `user_id`:
   ```bash
   cawplan users query --email <email>       # if the user gave an email
   cawplan users query --keyword <name-word>    # if the user gave a name
   ```
   If the keyword query returns more than one person, list them (name + email) and ask which one — do not guess.

2. Fetch their ticket changes in the period:
   ```bash
   cawplan tickets search --assignees <user_id> --start_date 2000-01-01 --end_date <today> --updated_start_date <window_start> --updated_end_date <today> --page_size 100 --page_num 1
   ```
   If the user also scoped to a product/version, add `--product_ids <id>` / `--version_ids <id>` (resolve the same way as Workflow A step 1). Apply the same `--updated_start_date`/`--updated_end_date`-over-`--start_date`/`--end_date` rule, widened-end-date, date-computation, and pagination rules as Workflow B step 2 — a ticket assigned to this member long ago but only completed inside the window must not be missed just because it wasn't *created* inside it.

3. Verify the status changes with one bulk call per 50 candidates, as in **Workflow B step 2a** — the `updated_at`-is-not-"completed at" issue applies identically to a single member's tickets:
   ```bash
   cawplan tickets changes --unique_ids <candidate_ids_csv> --fields status --start_date <window_start> --end_date <window_end>
   ```
   Do not call `tickets history` per candidate. Use it only under Workflow B step 2a's fallback, when `tickets changes` itself fails (`references/QUERY_RESILIENCE.md`).

## Output

If any lookup, page, batch or window could not be completed, say what was verified and what was
not before the report (`references/QUERY_RESILIENCE.md`). Write the answer by the rules in `references/QUERY_RESILIENCE.md` §5: no CLI commands, internal field names or reasoning text.

**Workflow A:**

- **Summary**: what changed and what was completed in the period.
- **Progress**: ticket completion rate, status breakdown.
- **Risk**: current risk level and reason (LOW / MEDIUM / HIGH).
- **Priority recommendations**: what should be addressed before release.
- **Upcoming**: target release dates and remaining open items.

**Workflow B:**

- **Summary**: what changed across the team in the period (counts, not a risk verdict — this workflow has no `versions track`-style risk field; don't invent one).
- **Completion**: counts by status, returned labels, and priority for Tickets with a history-verified status change in the period; terminal counts are based on the event's new status category, never raw `updated_at` or current status alone. Do not use legacy `type` for classification.
- **Notable items**: CRITICAL/HIGH priority Tickets that actually changed status in the period, plus any Ticket moved to a terminal category by its verified status-change event.
- **Per-product breakdown**: only if step 3 ran and the user asked for it.

**Workflow C:** same shape as Workflow B (Summary + Completion + Notable items), scoped to the one person's tickets — no per-product breakdown section.

**Workflow D:**

- **QA activity summary**: total in-window status-change events and distinct Tickets involved.
- **By QA member**: activity count and distinct Ticket count per history-event actor that matches
  the product's configured `members.qas` roster; never use current Assignee or Reporter as the
  grouping field.
- **Verification transitions**: counts and Ticket evidence grouped by `old → new` status (and
  new-status category when resolved), including QA Testing, Done, Reopen, Close, and custom
  statuses as returned by the API.

## References

- `references/CAWPLAN_OPEN_API.md`
- `references/QUERY_RESILIENCE.md`
