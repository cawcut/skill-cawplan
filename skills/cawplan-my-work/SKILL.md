---
version: 0.2.6
name: cawplan-my-work
description: |
  Show the current user's own CawPlan work: tickets and critical issues assigned to them, grouped by product line, product, and version, or as a single priority-sorted open-ticket list, optionally narrowed to one project/version.
  Use when: the user asks what's on their plate, their current tasks, "my tickets", "my open tickets by priority", "my work", or their tasks for a specific project/version, without giving a ticket ID or asking to search/filter broadly across other people.
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

1. Resolve your own `user_id`:
   ```bash
   cawplan auth status                       # shows your authenticated email
   cawplan users query --email <your-email>  # resolves email -> user_id
   ```

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

## Output

- Group by product line → product → version, matching the API's own grouping — don't re-flatten it into one undifferentiated list, **unless step 5 ran**, in which case present the single priority-sorted list instead (still showing product/version per row).
- For each ticket: display ID, type, priority, status, one-line title.
- Critical issues: separate section, grouped by product line → product, with severity/status.
- Lead with `summary` if the response includes one **and step 3 didn't narrow the scope** — `summary` describes the full unnarrowed response, so showing it alongside a narrowed list would contradict what's actually listed. When narrowed, state counts for the narrowed slice instead (e.g. "1 ticket, 1 product-wide critical issue for UniFi Access 4.1.10").
- If step 3 narrowed the scope, say what it was narrowed to before listing results.
- If there's genuinely nothing assigned, say so plainly rather than returning an empty section with no comment.

## References

- `references/CAWPLAN_OPEN_API.md`
