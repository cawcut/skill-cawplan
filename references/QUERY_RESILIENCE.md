# CawPlan Query Resilience

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

- `tickets changes` takes a scope of `--product_ids`, `--product_line_ids`, `--version_ids`,
  `--parent_ids`, or `--unique_ids`. For person-scoped questions ("my tickets", one member),
  get the candidate unique IDs from `tickets search --assignees ...` first, then pass them as
  `--unique_ids` in batches of at most 50 IDs per call.
- The change window is at most 90 days. Split a longer range into consecutive windows of 90 days
  or less.
- Each event already carries `at`, `actor`, `old`/`new` and, for status, `old_category` /
  `new_category`. You do not need `product-lines statuses` to classify a status change.
- `old` is `null` when the record kept only the new value, which is common: most CawPlan edits
  record only the new status. Treat that event as "changed to `new`". To find transitions
  (for example a reopen out of `COMPLETE`), walk each ticket's events oldest first and use the
  preceding event's `new` / `new_category` as the previous value; do not rely on server-side
  `--old_status_categories` alone, which only matches events that recorded `old`.
- Without `--group_by`, the CLI follows the cursor for up to 20 pages. If the result has
  `truncated: true`, either narrow the scope/window or continue with `--cursor <next_cursor>`.
  Never present a truncated result as complete.
- Both commands need cawplan CLI 0.0.59 or later. Command details: `references/CAWPLAN_OPEN_API.md`
  ("Ticket Stats", "Ticket Changes").

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
- In a follow-up ("now only CRITICAL+HIGH", "same for last week"), reuse the IDs already resolved
  in this conversation. Do not call `products list` / `versions list` again for the same name.
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
  commands in §1, reuse IDs from earlier turns (§2), and stop paging and report a partial result
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

- Do not show raw CLI commands, flags, internal IDs used only as arguments, error codes, or tool
  diagnostics in the answer. Keep them for your own reasoning.
- Describe a failure in product terms and give the next step, for example:
  - "I couldn't finish the full query this time. Here is what I could verify: ... Narrowing it to
    one version will let me complete it."
  - "I couldn't find a product named 'X'. Did you mean A or B?"
- Answer in the user's language.
