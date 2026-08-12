---
version: 0.2.6
name: cawplan-my-work
description: |
  Show the current user's own CawPlan work: tickets and critical issues assigned to them, grouped by product line, product, and version, optionally narrowed to one project/version.
  Use when: the user asks what's on their plate, their current tasks, "my tickets", "my work", or their tasks for a specific project/version, without giving a ticket ID or asking to search/filter broadly across other people.
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

4. If the user asks for only open/未完成 items and everything from step 2 falls under a single product line, resolve that line's status categories to filter properly:
   ```bash
   cawplan product-lines statuses <product_line_id>
   ```
   Exclude tickets whose status key maps to category `COMPLETE` or `CANCELED`. If the results span multiple product lines, skip this per-line filtering (that's one extra call per line) — just show every item's status clearly instead, so the user can tell what's open at a glance.

## Output

- Group by product line → product → version, matching the API's own grouping — don't re-flatten it into one undifferentiated list.
- For each ticket: display ID, type, priority, status, one-line title.
- Critical issues: separate section, grouped by product line → product, with severity/status.
- Lead with `summary` if the response includes one **and step 3 didn't narrow the scope** — `summary` describes the full unnarrowed response, so showing it alongside a narrowed list would contradict what's actually listed. When narrowed, state counts for the narrowed slice instead (e.g. "1 ticket, 1 product-wide critical issue for UniFi Access 4.1.10").
- If step 3 narrowed the scope, say what it was narrowed to before listing results.
- If there's genuinely nothing assigned, say so plainly rather than returning an empty section with no comment.

## References

- `references/CAWPLAN_OPEN_API.md`
