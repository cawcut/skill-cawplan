---
version: 0.2.8
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

## Workflow A — Version scope

1. Resolve product + version (same pattern as `cawplan-plan-track` steps 1-2):
   ```bash
   cawplan products list --search "<product name>"
   cawplan versions list <product_id>
   ```
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

1. Resolve the Team name to a `product_line_id` — same pattern as `cawplan-product-report`'s Team workflow: `cawplan product-lines list --page_size 100`, match by name client-side. Ask to disambiguate on multiple matches; if no name matches at all, say so and ask for the correct Team name rather than guessing the closest one.
2. Fetch:
   ```bash
   cawplan tickets search --product_line_ids <product_line_id> --ux PENDING --excluded_status_categories COMPLETE,CANCELED --start_date 2000-01-01 --end_date <today> --page_size 100 --page_num 1
   ```
   Page through fully (see Pagination above), then sort `CRITICAL` → `HIGH` → `MEDIUM` → `LOW`.

## Output

- One row per matching ticket: display ID, title, type, priority, product/version, assignee.
- Workflow B/C: sorted by priority descending, as above.
- State the search window and that terminal categories are excluded.
- If nothing matches, say so plainly — don't return an empty table with no comment.

## References

- `references/CAWPLAN_OPEN_API.md`
