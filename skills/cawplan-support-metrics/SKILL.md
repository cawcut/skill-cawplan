---
version: 0.2.9
name: cawplan-support-metrics
description: |
  Prepare, validate, import, reconcile, and correct Support Ops daily ticket metrics from Google Sheets or exported JSON into CawPlan's cawplan_csm key-metrics domain. Use when: Support asks to onboard its ticket dashboard data, backfill or upload Support ticket counts, validate a Support metrics export, compare CawPlan metrics with the Support sheet, or generate a safe Apps Script exporter. NOT for: generic CawPlan business metrics, device/app telemetry, editing the Support dashboard UI, producing the weekly Google Doc, or inventing new CSM metric names and tags.
argument-hint: "[prepare exporter | validate/export file | import after preview | reconcile date range | correct approved delta]"
allowed-tools: Bash
---

# CawPlan Support Metrics

Use this skill for the controlled Support Ops -> CawPlan key-metrics workflow. It specializes the generic `cawplan metrics` commands with a fixed Support data contract.

## Bootstrap

```bash
cawplan skill check
```

If authentication is missing, stop and ask the user to run `cawplan auth login`. Do not request or embed an API key in Apps Script.

## Supported workflow

Route the request to one of these modes:

- **Prepare exporter**: inspect the supplied Apps Script or sheet layout and create a read-only export path that emits the canonical JSON envelope. Never add direct CawPlan HTTP calls.
- **Validate / dry-run**: validate the file, resolve and confirm product IDs, reject duplicate identities or unsupported vocabulary, and show totals without writing.
- **Import**: only after the user has seen and approved the dry-run, upload canonical items in bounded batches through `cawplan metrics ingest`.
- **Reconcile**: query the exact imported range and dimensions, check `truncated`, and compare CawPlan totals with the export.
- **Correct**: never overwrite or delete a prior point. Preview an additive correction delta and write it only after explicit approval.

## V1 contract boundary

The only ordinary V1 write is:

```text
domain = cawplan_csm
metric = ticket_created
field  = value
```

Allowed base tags are `product_line`, `channel`, `assignee`, and `source_system`. `dimensions.product` must be a confirmed CawPlan product `unique_id`; workspace attribution is injected by the server and must not be supplied.

Zendesk status snapshots, Solved/Pending KPIs, Jira SPRT issues, weekly totals, percentages, and report artifacts are outside the V1 write contract. Analyze or export them if asked, but do not ingest them until the platform owner approves a new canonical metric contract.

## Write safety

- Treat validation, preview, and queries as read-only.
- Do not ingest merely because a file was attached; the user must request the write and approve the dry-run.
- Never ingest both assignee-level rows and their derived `Total` rows.
- Never retry with regenerated timestamps or altered tags. Reconcile first; retry only the byte-equivalent canonical items when needed.
- Stop on unknown columns, ambiguous products, unexpected tags, negative base values, partial source ranges, query truncation, or a totals mismatch.
- Report every write with source checksum, range, item count, accepted count, and reconciliation result.
