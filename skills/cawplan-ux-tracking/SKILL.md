---
version: 0.2.8
name: cawplan-ux-tracking
description: |
  Find CawPlan tickets that need UX attention, or summarize a product's UX members' design completion: pending UX for a version, high-priority tickets missing UX design, a Team's UX-pending queue, or tickets that product's Designers marked UX Ready in a date range.
  Use when: the user asks which tickets need UX follow-up/review/spec for a version, which high-priority tickets need UX but don't have a design yet, which Team hasn't had UX provided for its tickets, or asks for a product's UX members' UX/design completion summary.
  NOT for: creating or updating tickets, setting a ticket's UX status, general ticket search, or release tracking (use `cawplan-plan-track` for version release health).
argument-hint: "[product/version, OR priority + optional product/version, OR team/product-line name]"
allowed-tools: Bash
---

# CawPlan UX Tracking

## Bootstrap

```bash
cawplan skill check
```

## Background

Tickets have `ux` values `NOT_REQUIRED`, `PENDING`, and `READY`; only `PENDING` needs UX follow-up.

Use `cawplan tickets search`, not `tickets poll`, because poll does not return `ux`.

Every workflow passes `--excluded_status_categories COMPLETE,CANCELED`: UX can remain `PENDING` after a ticket closes. Use category filters, not product-line-specific status keys.

UX queries need the full window:
```
--start_date 2000-01-01 --end_date <today>
```

**Pagination**: increment `page_num` while `page_num * page_size < total`; use `total` as the completion signal.

## Entry Routing

| Input | Flow |
|---|---|
| A specific product + version ("这个版本需要UX跟进的ticket") | **A — Version scope** |
| A specific product, no version given, not framed by priority or team | **A — Version scope**, but ask the user whether they mean a specific version or all versions of the product — "all versions" runs Workflow A step 2 with `--product_ids` and no `--version_ids`, **no priority filter added** (that's Workflow B's filter, not applicable here just because the version was dropped) |
| High-priority + no specific version, or explicitly cross-version | **B — Priority scope** |
| A Team / product line ("某个team尚未提供UX的清单") | **C — Team scope** |
| A product's UX members' design completion ("汇总 CawCut Cloud UX Team 本周的 UX 完成情况") | **D — Product UX completion** |

## Workflow A — Version scope

1. Resolve product + version (same pattern as `cawplan-plan-track` steps 1-2):
   ```bash
   cawplan products list --search "<product name>"
   cawplan versions list <product_id>
   ```
   The supplied product must be an exact accessible-name match (case-insensitive after trimming whitespace), a unique short-form/token-prefix match, or a candidate the user explicitly confirms. If no unique match exists, show the candidates and ask which product they mean before listing versions or querying tickets; never use the closest product name.
2. Fetch:
   ```bash
   cawplan tickets search --version_ids <version_id> --ux PENDING --excluded_status_categories COMPLETE,CANCELED --start_date 2000-01-01 --end_date <today> --page_size 100 --page_num 1
   ```
   Page through fully (see Pagination above).

   For "all versions of this product" (per Entry Routing), drop `--version_ids` and use `--product_ids <product_id>` instead — everything else in this step is unchanged, and no priority filter is added just because there's no version.

## Workflow B — Priority scope

1. If the user gave a product/version, resolve it the same way as Workflow A and add `--product_ids`/`--version_ids`. If they didn't, ask whether to scope to a product or search across everything they have access to — don't silently assume "everything."
2. Fetch:
   ```bash
   cawplan tickets search --priority CRITICAL,HIGH --ux PENDING --excluded_status_categories COMPLETE,CANCELED --start_date 2000-01-01 --end_date <today> --page_size 100 --page_num 1 [--product_ids <id>] [--version_ids <id>]
   ```
   Page through fully (see Pagination above), then sort `CRITICAL` → `HIGH`.

## Workflow C — Team scope

1. Resolve the Team name to a `product_line_id` — same pattern as `cawplan-product-report`'s Team workflow: `cawplan product-lines list --page_size 100`, match by name client-side. Require an exact name match (case-insensitive after trimming whitespace), a unique short-form/token-prefix match, or explicit user confirmation of a candidate. Ask to disambiguate on multiple matches; if no unique name match exists, list candidates and ask which Team the user means rather than guessing the closest one.
2. Fetch:
   ```bash
   cawplan tickets search --product_line_ids <product_line_id> --ux PENDING --excluded_status_categories COMPLETE,CANCELED --start_date 2000-01-01 --end_date <today> --page_size 100 --page_num 1
   ```
   Page through fully (see Pagination above), then sort `CRITICAL` → `HIGH` → `MEDIUM` → `LOW`.

## Workflow D — Product UX completion

UX Team here means the product's configured `members.designers` roster, not a CawPlan product
line. If the product is omitted, ask which product's UX members should be reported.

1. Resolve the product and complete the product-access gate used by Workflow A:
   ```bash
   cawplan products list --search "<product name or product_id>"
   ```
   Read the matched product's `members.designers[]` roster and collect its `user_id` values and
   display names. If it has no Designers, report that the product has no configured UX roster and
   stop. Membership is product-scoped; use this returned roster, not a workspace-wide keyword
   search. Default the date window to the current week only when the user does not provide one.
2. Fetch a broad candidate set. Do **not** add `--ux READY` or terminal-status exclusions: a
   Ticket may have been marked `READY` in the requested window and later edited, closed, or moved
   back to `PENDING`.
   ```bash
   cawplan tickets search --product_ids <product_id> --start_date 2000-01-01 --end_date <today> --updated_start_date <window_start> --updated_end_date <today> --page_size 100 --page_num 1
   ```
   Page through fully (see Pagination above). `updated_at` only produces candidates; it is not UX
   completion evidence.
3. For every candidate, fetch `cawplan tickets history <product_id> <version_id> <ticket_id>`.
   Keep only an `UPDATED` history entry whose `changed_fields.ux` changes to `READY`, whose
   `created_at` is inside the requested window, and whose history-entry `user_id` is in the
   product's `members.designers` roster. The field can be the string `READY` or an object with a
   `new` value; support both. Do not count a Ticket because its current `ux` is `READY`, because
   it is assigned to a Designer, or because a non-Designer changed its UX field.
4. Deduplicate by Ticket, retaining its latest in-window UX-Ready event. Group the retained
   Tickets by that history entry's actor (`user_id` / `user_display_name`): this actor is the
   product roster's **Designer who completed the UX work**. Never group, count, or infer the
   Designer from the Ticket's reporter or ordinary assignees.

## Output

- One row per matching ticket: display ID, title, type, priority, product/version, assignee.
- Workflow B/C: sorted by priority descending, as above.
- State the search window and that terminal categories are excluded.
- If nothing matches, say so plainly — don't return an empty table with no comment.
- For Workflow D, show each configured Designer's UX-Ready ticket count and the Ticket list
  (display ID, title, product/version, UX-Ready timestamp). State the requested window, the
  product used for the UX roster, and that counts are based on history-verified
  `ux → READY` events.

## References

- `references/CAWPLAN_OPEN_API.md`
