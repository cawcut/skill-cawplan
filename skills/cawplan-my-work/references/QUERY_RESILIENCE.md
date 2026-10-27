# CawPlan Query Resilience

> Canonical file: `references/QUERY_RESILIENCE.md`. Byte-identical copies live in the
> `references/` folder of each skill that uses it (the hosted agent bundles only `skills/`).
> Edit the canonical file, then copy it; `scripts/validate-skills.sh` fails on drift.

Shared rules for skills that read many tickets, page through results, or need per-ticket history.
They keep a query going after a rejected command, keep results complete when the data is large,
and keep internal details out of the answer.

## 1. Let the backend aggregate

Counting and change-history work runs on the CawPlan backend. The CLI only maps flags and pages.

| Need | Use | Instead of |
|---|---|---|
| Counts by priority / status / status category / UX / assignee / label / version | `cawplan tickets stats --group_by <dims> [tickets search filters]` | paging `tickets search` and counting |
| Status / UX / priority / assignee changes in a window, for many tickets | `cawplan tickets changes --start_date <d> --end_date <d> <scope> --fields <f> [--actor_ids ...] [--new_status_categories ...]` | one `tickets history` call per ticket |
| Counts of those changes | `cawplan tickets changes ... --group_by actor,new_status_category` | counting events yourself |
| Ticket rows to display | `cawplan tickets search` (paged), or the `tickets` map returned by `tickets changes` | — |

- When the question only needs counts, call `tickets stats` first. Do not page `tickets search`
  to count, and do not page it before trying `tickets stats`.
- `tickets stats` needs the same date window as `tickets search`: pass
  `--start_date 2000-01-01 --end_date <today>` to count every ticket in scope, for example
  `cawplan tickets stats --version_ids <id> --start_date 2000-01-01 --end_date <today> --group_by assignee`.
- `--group_by` values are exact. `tickets stats`: `priority`, `status`, `status_category`, `ux`,
  `assignee` (singular), `label`, `type`, `product`, `version`, `platform`. `tickets changes`:
  `actor`, `field`, `new_status_category`, `new_value`, `ticket`.
- `tickets changes` takes a scope of `--product_ids`, `--product_line_ids`, `--version_ids`,
  `--parent_ids`, or `--unique_ids`. For person-scoped questions ("my tickets", one member),
  get the candidate unique IDs from `tickets search --assignees ...` first, then pass them as
  `--unique_ids` in batches of at most 50 IDs per call.
- The change window is at most 90 days. Split a longer range into consecutive windows of 90 days
  or less.
- Each event already carries `at`, `actor`, `old`/`new` and, for status, `old_category` /
  `new_category`. You do not need `product-lines statuses` to classify a status change.
- CawPlan edits record both `old` and `new`. `old` can be missing only on older records or on
  some Jira / Zendesk / Slack sync events; the server then fills it with the `new` value of the
  ticket's preceding change of the same field (even one before the window) and marks it
  `old_source: previous_change` (`recorded` when it was stored on the change itself). `old` stays
  `null` only when no earlier change exists; treat that event as "changed to `new`".
- Find transitions server-side with `--old_status_categories` / `--new_status_categories`; for
  reopens use the definition and command in "Reopens" below.
- Without `--group_by`, the CLI follows the cursor for up to 20 pages. If the result has
  `truncated: true`, either narrow the scope/window or continue with `--cursor <next_cursor>`.
  Never present a truncated result as complete.
- Both commands need cawplan CLI 0.0.59 or later. Command details: `references/CAWPLAN_OPEN_API.md`
  ("Ticket Stats", "Ticket Changes").

### Reopens

A reopen is any status change from a terminal category (`COMPLETE` or `CANCELED`) back to a
non-terminal one (`BACKLOG`, `UNSTARTED`, `STARTED`, `TESTING`), whatever the new status is
called. Done → Ready for QA and Done → QA Testing are reopens, not only a move to a status named
"Reopen". Every skill uses this one definition, whatever the scope (product, version, Team,
member, or "my" tickets):

```bash
cawplan tickets changes <scope> --fields status --old_status_categories COMPLETE,CANCELED --new_status_categories BACKLOG,UNSTARTED,STARTED,TESTING --start_date <d> --end_date <d>
```

- Every returned event is one reopen. A ticket can be reopened several times; report every event,
  oldest first, with the ticket, the previous and new status names, and the time.
- The previous status comes from the change itself or, when an older record or a sync event lacks
  it, from the ticket's preceding status change (the server fills it in). A change with no earlier
  status on record cannot be classified and is not returned.
- State the window you checked (at most 90 days per call).

### Fallback when the new commands are unavailable

If `tickets stats` or `tickets changes` returns a non-`SUCCESS` envelope (for example
`OPENAPI_RBAC_SPEC_REQUIRED` before the backend ships them), or the CLI reports an unknown
command, use the legacy steps the skill documents (`tickets search` paging, per-ticket
`tickets history`). Tell the user the result came from the slower path. If that path cannot be
completed within the limits in §3, follow §4.

## 2. Resolve IDs once and never guess them

- A `product_id`, `version_id`, `product_line_id`, `user_id`, or ticket `unique_id` must come from
  a CLI result in this conversation (or from the user verbatim). Never pass a product name,
  alias, or slug (for example `cawplan`) where an ID is expected.
- In a follow-up ("now only CRITICAL+HIGH", "same for last week"), keep the previous scope
  (product, version, Team, member) and add only the new filter. Never drop a scope filter.
- Reuse an ID only when it is visible in your current context. In the hosted agent a new turn
  carries the earlier questions and answers but not their tool results, so the ID is usually
  gone: resolve the scope name from the earlier answer (for example "CawPlan") again, once, then
  run the narrowed query.
- If an ID cannot be resolved (no match, several matches, or the lookup was rejected), stop and ask
  the user. Do not continue with a guessed value; an empty result from a guessed ID is not data.

## 3. Command shape and rejections in the hosted agent

The hosted agent runs exactly one admitted `cawplan` command per tool call:

- No shell syntax: no pipes, `jq`, loops, `&&`, redirects or subshells. Fetch each page with its
  own call and combine results in your own reasoning.
- No quotes. Every value must be one whitespace-free, unquoted token:
  `--search CawPlan`, never `--search "CawPlan"`. For a name that contains spaces, search with one
  distinctive unquoted word (or page the catalog) and match the complete name in the returned data.
- A command line is at most 4096 bytes; keep ID lists in batches of at most 50.
- A skill turn has roughly 16 tool calls. Plan the calls before starting: prefer the aggregate
  commands in §1, reuse IDs already in your context (§2), and stop paging and report a partial result
  (§4) rather than running out of calls mid-way.

A rejected command returns text like:

```
error: command was not admitted by the compiled host contract: <reason>; correct the command to an admitted shape and do not retry the identical command
```

- The `<reason>` is what matters. Typical reasons: quoted values, shell syntax, an unknown or
  duplicate flag, a missing required flag, an empty value, or a command not available on this
  tool surface.
- "do not retry the identical command" means the same command will be rejected again. It is not a
  limit on calling a command more than once. A corrected command, or the same command with
  different arguments, is fine.
- Fix the shape (remove the quotes, drop the unsupported flag, add the required one, use an ID)
  and run the corrected command once. If the command itself is not available, use the fallback in
  §1.

Outside the hosted agent (a local CLI session), shell loops and `jq` are fine for paging, but the
rules on IDs, partial results and user-facing output still apply.

## 4. Partial results

- If a result is incomplete (pages not fetched, `truncated: true`, some tickets not verified,
  a fallback that stopped early), say so before the list: what was covered (for example
  "verified 28 of 41 tickets", "pages 1-20 of more"), what was not, and how to get the rest
  (narrower scope or window).
- Data shown in an earlier turn may be reused when the user asks a follow-up, but label it as
  coming from that earlier query. Do not present it as freshly verified.
- Never drop the result you do have because one later call failed.

## 5. What the user sees

The answer contains only the result, written for the user in their language.

- Lead with the answer: the count or the list, then any caveat.
- Name the scope you queried (product, version or Team, and the window). In a follow-up, a
  narrower filter cannot return more tickets than the earlier answer for the same scope; if it
  does, the scope was lost, so fix the query before answering.
- No CLI command names or flags (for example `tickets changes`, `--fields`), API paths, error
  codes, or tool diagnostics.
- No internal field names or values (for example `truncated`, `next_cursor`, `old_source`,
  `status_display.category`, page counts) and no IDs that were only used as arguments. Say coverage
  in plain words: "all status changes from Aug 22 to Oct 20 were checked".
- No reasoning, self-checks or plans ("Let me…", "I must…", "Checking…", "Returned 17 total…").
  Work them out silently. When you made a judgment call, give the outcome in one short sentence,
  for example "IH-2977 is CLOSED, so it is counted as done."
- Show status display names (Done, In Progress, Ready for QA), not status keys (`DONE`,
  `IN_PROGRESS`).
- Every count you state equals the number of items you list under it. Take the counts from the
  final list, after any grouping or deduplication, and recount before answering.
- Link a ticket as `https://app.cawplan.com/issue/<display_id>`.
- Describe a failure in product terms and give the next step, for example:
  - "I couldn't finish the full query this time. Here is what I could verify: ... Narrowing it to
    one version will let me complete it."
  - "I couldn't find a product named 'X'. Did you mean A or B?"
