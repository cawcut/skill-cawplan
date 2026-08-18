---
version: 0.2.7
name: cawplan-ux-tracking
description: |
  Find CawPlan tickets that need UX attention: pending UX for a version, high-priority tickets missing UX design, or a Team's whole UX-pending queue.
  Use when: the user asks which tickets need UX follow-up/review/spec for a version, which high-priority tickets need UX but don't have a design yet, or which Team hasn't had UX provided for its tickets.
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

Tickets have a real `ux` field with three values: `NOT_REQUIRED`, `PENDING`, `READY` (documented in `references/CAWPLAN_OPEN_API.md` under "VersionTicket fields of note"). "Needs UX" means `ux = PENDING` — `NOT_REQUIRED` means this ticket was never flagged as needing UX at all, and `READY` means UX is done. Never treat `NOT_REQUIRED` as "needs UX" — that's the opposite of what it means.

This field is only present on the full ticket record returned by `cawplan tickets search` / `tickets get` — it is **not** on `tickets poll`'s lightweight shape, so this skill uses `search`, not `poll`, unlike `cawplan-plan-track`.

A ticket can sit at `ux == "PENDING"` while the ticket itself is already done or closed — the `ux` field isn't automatically cleared when a ticket reaches a terminal status, so a stale `PENDING` on an otherwise-finished ticket doesn't mean UX work is actually still owed. Every workflow below excludes tickets whose `status_display.category` (already present inline on each `tickets search` result, no extra lookup needed) is `COMPLETE` or `CANCELED` — the same terminal-category exclusion `cawplan-plan-track` uses for its own staleness check. Match on `status_display.category`, not on the ticket's status *key*/display name (e.g. don't string-match "done"/"closed") — status keys are configured per product line and aren't a fixed set, but the category taxonomy is.

`tickets search` requires `--time_range` or `--start_date`+`--end_date` (no exemption for `--version_ids`/`--product_line_ids`/`--priority` alone) — see `references/CAWPLAN_OPEN_API.md`'s "Canonical workaround for 'every matching ticket regardless of age' queries." Since "needs UX" queries want every matching ticket, use the maximal-window option from that section rather than guessing a narrower one that could silently drop older tickets:
```
--start_date 2000-01-01 --end_date <today>
```
State this window choice to the user once, so it's clear the query isn't missing anything for being "too recent."

**Pagination**: every response is a `CommonPageResp` — `data`, plus `page_num`, `page_size`, `total`. Keep incrementing `page_num` and re-fetching while `page_num * page_size < total`; stop once you've fetched `total` results. Don't stop after one page just because it came back full or empty of `PENDING` matches — `total` is the only reliable signal, since a page can be full of non-matching tickets before the filter is applied.

## Entry Routing

| Input | Flow |
|---|---|
| A specific product + version ("这个版本需要UX跟进的ticket") | **A — Version scope** |
| A specific product, no version given, not framed by priority or team | **A — Version scope**, but ask the user whether they mean a specific version or all versions of the product — "all versions" runs Workflow A step 2 with `--product_ids` and no `--version_ids`, **no priority filter added** (that's Workflow B's filter, not applicable here just because the version was dropped) |
| High-priority + no specific version, or explicitly cross-version | **B — Priority scope** |
| A Team / product line ("某个team尚未提供UX的清单") | **C — Team scope** |

## Workflow A — Version scope

1. Resolve product + version (same pattern as `cawplan-plan-track` steps 1-2):
   ```bash
   cawplan products list --search "<product name>"
   cawplan versions list <product_id>
   ```
2. Fetch and filter:
   ```bash
   cawplan tickets search --version_ids <version_id> --start_date 2000-01-01 --end_date <today> --page_size 100 --page_num 1
   ```
   Page through fully (see Pagination above). Keep only results where `ux == "PENDING"` **and** `status_display.category` is not `COMPLETE`/`CANCELED` (see Background).

   For "all versions of this product" (per Entry Routing), drop `--version_ids` and use `--product_ids <product_id>` instead — everything else in this step is unchanged, and no priority filter is added just because there's no version.

## Workflow B — Priority scope

1. If the user gave a product/version, resolve it the same way as Workflow A and add `--product_ids`/`--version_ids`. If they didn't, ask whether to scope to a product or search across everything they have access to — don't silently assume "everything."
2. Fetch and filter:
   ```bash
   cawplan tickets search --priority CRITICAL,HIGH --start_date 2000-01-01 --end_date <today> --page_size 100 --page_num 1 [--product_ids <id>] [--version_ids <id>]
   ```
   Page through fully (see Pagination above). Keep only results where `ux == "PENDING"` **and** `status_display.category` is not `COMPLETE`/`CANCELED` (see Background), and sort by priority `CRITICAL` → `HIGH` (same ordering as Workflow C) — the framing is "high-priority," so lead with the higher one.

## Workflow C — Team scope

1. Resolve the Team name to a `product_line_id` — same pattern as `cawplan-product-report`'s Team workflow: `cawplan product-lines list --page_size 100`, match by name client-side. Ask to disambiguate on multiple matches; if no name matches at all, say so and ask for the correct Team name rather than guessing the closest one.
2. Fetch and filter:
   ```bash
   cawplan tickets search --product_line_ids <product_line_id> --start_date 2000-01-01 --end_date <today> --page_size 100 --page_num 1
   ```
   Page through fully (see Pagination above). Keep only results where `ux == "PENDING"` **and** `status_display.category` is not `COMPLETE`/`CANCELED` (see Background). Sort by priority `CRITICAL` → `HIGH` → `MEDIUM` → `LOW` (the scenario this covers explicitly asks for high-to-low ordering).

## Output

- One row per matching ticket: display ID, title, type, priority, product/version, assignee.
- Workflow B/C: sorted by priority descending, as above.
- State the search window used (`2000-01-01` to today) once, so the user knows this isn't a "recent activity" view — it's every ticket currently marked `ux = PENDING`, regardless of when it was last touched.
- Also mention once that tickets already `COMPLETE`/`CANCELED` are excluded even if their `ux` field still reads `PENDING` — this is a real filter that changes the result set, not an implementation detail to hide.
- If nothing matches, say so plainly — don't return an empty table with no comment.

## References

- `references/CAWPLAN_OPEN_API.md`
