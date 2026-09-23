---
version: 0.2.9
name: cawplan-metrics
description: |
  Query or write generic CawPlan business metrics (subscriptions, CawPlan tickets, QA, workflow executions, tokens/credit, API usage, ...) via the metrics store, optionally charting the result.
  Use when: the user asks to query, chart, or plot a business metric like subscription upgrades, ticket creation/status-change counts, QA test point/report counts, workflow success/failure rates, token consumption, or API usage over time; or asks to record/write/log a business metric event.
  NOT for: Support Ops sheet exports/backfills/reconciliation (use `cawplan-support-metrics`), a combined product health overview mixing metrics + feedback + critical issues (use `cawplan-product-insights`), device/app install metrics (that public endpoint has been retired), AI feedback categorization (`cawplan analytics get`), ticket creation, or critical issue lists.
argument-hint: "[domain/metric + time range for a query; OR event to record]"
allowed-tools: Bash
---

# CawPlan Metrics

## Bootstrap

```bash
cawplan skill check
```

## Entry Routing

| Input | Flow |
|---|---|
| A business metric trend to query or chart (subscriptions, CawPlan tickets, QA, workflow, tokens, API usage, ...) | **A — Metrics query** |
| Recording/logging a business metric event | **B — Metrics ingest** |

There is no device/app metrics flow here — the public endpoint that used to serve installations/
crash rate/etc. via API key/CLI has been retired. If a user asks for that kind of data, tell them
it's no longer available through this skill/CLI rather than guessing at a substitute.

## Workflow A — Metrics query

Every domain is prefixed `cawplan_`. Business domains and their metric names are open-ended (new
ones get added over time), but the common ones today — and, critically, **which metrics inside
each domain actually have a producer writing to them right now** vs. which are defined but still
empty (a query against an empty one returns zero rows, which looks identical to "no data in this
range," not "this isn't wired yet" — don't guess past this list without checking):

- `cawplan_ticket`: `ticket_created`, `ticket_updated`, `ticket_status_changed` — all wired.
- `cawplan_qa_insight`: `test_point_created`, `test_point_updated`, `report_created`, `execution` — all wired.
- `cawplan_subscription`: `new`, `renew` (from Stripe `invoice.paid`, disambiguated by
  `billing_reason`) and `cancel` (user-initiated cancel-to-Free) are wired; `winback`, `upgrade`,
  `downgrade` are defined but nothing calls them yet.
- `cawplan_api`: `throttled` (one point per 429 response) is wired; `request` is defined but
  nothing calls it yet.
- `cawplan_ai_session_usage`: `usage_reported` — wired, one point per daily AI coding-tool usage
  report upload (tokens/sessions/cost, workspace-scoped). This is **internal engineering cost
  telemetry for AI coding tools** (the cawplan-coding-insights pipeline), not a customer-facing
  token/credit ledger — don't conflate it with `cawplan_token` below.
- `cawplan_workflow` (`execution`), `cawplan_token` (`consumed`, `recharged`, `refunded`, `cost`),
  `cawplan_user` (`signup`, `active`), `cawplan_csm`, `cawplan_purchase`: all defined, **none wired
  to any producer yet** — querying any of these will always return zero rows today.

If the user names a metric that doesn't obviously map to one of these, ask rather than guessing a
`domain`/`metric` pair.

1. Determine the time range. Require both `--start` and `--end` (RFC3339) — if the user gave a
   relative range ("last 30 days", "this week"), compute the bounds client-side; there is no
   `time_range` shorthand on this endpoint.

2. If the user wants to filter or break the result down by product or workspace, resolve the
   product name to an ID first (`cawplan products list --search "<product name>"`, same match
   rules as any other skill: exact or unique short-form match only, ask if ambiguous) and pass it
   as `--tag product:<product_id>` / `--tag workspace_id:<workspace_id>`, or include `product`/
   `workspace_id` in `--group_by` — `product` holds the product's `unique_id` (same value
   `cawplan products list` returns, not a display name); `workspace_id` is the tenant-attribution
   dimension and is worth adding whenever a query should be scoped to one workspace rather than
   the whole database. For `cawplan_ticket` events specifically, `--tag ticket_id:<ticket_id>` (a
   dynamic tag, not a standard dimension) disambiguates a burst of points for one product — an
   ancestor-status-propagation cascade touching several different tickets looks identical to the
   same ticket being written repeatedly unless you filter or group by `ticket_id`.

3. Run the query:
   ```bash
   cawplan metrics query \
     --domain <domain> [--metric <metric>] \
     --start <iso> --end <iso> \
     --granularity day \
     [--tag <key:value> ...] \
     [--group_by <k1,k2>] \
     [--fields value,count]
   ```
   Default `--granularity raw` returns every stored point unaggregated; pick `day`/`hour`/`minute`
   to get one summed row per bucket per tag combination instead — use a bucketed granularity
   whenever the user wants a trend rather than a raw event list.

4. Check `data.truncated` in the response. If `true`, the result was capped — narrow the time
   range or filters (or raise `--limit`, up to the server's own maximum) before reporting a total,
   rather than presenting a truncated count as complete.

## Workflow B — Metrics ingest

Only use this when the user explicitly asks to record/log/write a metric event — not as a way to
backfill or correct history in bulk (the ingest endpoint validates and rejects on the first bad
item in a batch; it isn't a bulk-load tool).

```bash
cawplan metrics ingest --domain <domain> --metric <metric> --value 1 \
  [--dimensions '{"product":"<product_id>"}'] \
  [--tags '{"from_plan":"basic","to_plan":"pro"}']
```

Confirm the `domain`/`metric` pair and any dimensions/tags with the user before writing — there is
no undo for a written point (see `references/CAWPLAN_OPEN_API.md` §7).

## Output

**Workflow A:**
- `query` returns full structured `data.rows` — that's usually all you need. For a chart the user
  just wants to see in this conversation (not a file to keep), don't reach for a CLI rendering flag
  at all: read `data.rows` yourself and render/describe the chart directly (or hand it to the
  `dataviz` skill for an inline/interactive visualization). Map `time` to the x-axis, group by the
  tag combination that distinguishes series, and the requested field to the y-axis. Nothing needs
  to be written to disk for this.
- If the user asked for a number/summary instead of a chart: report totals per bucket/tag
  combination directly.
- If the user asked for a standalone chart *file* to keep/share (not just to look at now): add
  `--chart <path>.svg` (and `--chart-field <value|count|cost|credit>` if not `value`) and hand back
  the file path.
- If that file needs to render as an actual image inline in this chat (e.g. via the `Read` tool,
  which decodes raster images but treats SVG as plain text): add `--png <path>.png` to the same
  `query` call, then `Read` that path to show it. It rasterizes from an SVG built the same way
  `--chart` does, using whatever's available in the environment (`qlmanage` on macOS,
  `rsvg-convert` elsewhere) — no separate rendering step needed. If no rasterizer is available the
  command exits with an error rather than writing a broken file. Note: `Read`-ing the PNG doesn't
  always actually display it to the user even when it decodes fine for you (observed in an
  iTerm2-direct session — manually running `imgcat <path>.png` in the same window rendered
  correctly, but the same file via `Read` didn't show up on the user's screen). If the user reports
  not seeing the image after you `Read` it, tell them to try `imgcat <path>.png` (or whatever their
  terminal supports) directly instead of relying on `Read`.
- `--preview` (inline image via iTerm2/Kitty/chafa) is for a human running `cawplan` directly in
  their own terminal — it does not work when you run it: the escape codes it prints only render as
  an image inside a real terminal emulator reading raw stdout, and this chat's tool output is
  captured as text, so it would show up as garbled escape-sequence text instead. Don't use it here;
  read `data.rows` yourself or use `--png` instead.
- Always mention the time range and granularity used, and flag if `data.truncated` was true.

**Workflow B:** confirm what was written (domain, metric, fields, dimensions/tags) and note that
this metrics store is a reporting store, not a system of record — for anything with financial or
compliance weight (e.g. token/credit), the authoritative ledger is elsewhere; this write is for
dashboards only.

## Decision Guide

- For Support Ops Google Sheet exports, CSM ticket-count backfills, corrections, or reconciliation:
  use `cawplan-support-metrics`.
- For a combined product health overview (feedback + critical issues, without device metrics,
  which are no longer available through this CLI): use `cawplan-product-insights`.
- For AI-categorized feedback trends only: `cawplan analytics get <product_id>`.
- For a date-range activity/progress report: use `cawplan-product-report`.

## References

- `references/CAWPLAN_OPEN_API.md`
