# PRM Skill Update Report (2026-02-01)

## Added/Updated This Round
- SKILL: Updated `SKILL.md` to align with base URL `https://core-api-gw.uid.alpha.ui.com` and env var auth (`PRM_API_KEY`, optional `PRM_BASE_URL`).
- SKILL: Added response templates for user/product/versions/tickets/critical issues/metrics/activity.
- SKILL: Added time-range + paging rules (explicit dates, default page size, “show more”).
- SKILL: Added natural language → API plan examples.
- SKILL: Added CN/EN “show more” phrases.
- SKILL: Added tone guidance (concise, neutral, fact-first).
- SKILL: Added disambiguation prompts for product/version (CN/EN).
- SKILL: Added product alias normalization (common UniFi aliases).
- SKILL: Added chat error templates for 401/404/400/500.
- REFERENCE: Added `references/PRM_ACTIVITY_API.md` and linked from `references/PRM_OPEN_API.md`.

## Files Touched
- `SKILL.md`
- `references/PRM_OPEN_API.md`
- `docs/PRM.md` (this report)

## Open Items / Next Steps
1) Validate if any additional product aliases are needed based on real usage.
2) Confirm desired response tone/format if you want tighter constraints (e.g., max lines, emoji usage, locale default).

## Notes
- The provided PRM PDF does not include Activity endpoints (not found in extracted text). If activity is documented elsewhere or embedded as non-text in the PDF, supply page references or the separate doc.

# PRM Skill Update Report (2026-02-04)

## Added/Updated This Round
- SKILL: Added explicit guidance to clarify/ask for a critical-issue time range; default to `time_range=1m` only if user does not care.
- SKILL: Added product alias normalization for “UniFi Access Application”.
- SKILL: Clarified product resolution behavior when zero matches are returned.
- CLI: Added `prm critical search` to call core-product critical issues search (days + product_ids).
- DOCS: Added core-product critical issues search example UUID.
- CLI: Added optional `PRM_BEARER_TOKEN` auth (overrides `PRM_API_KEY`).
- CLI: Added product line APIs and product-line critical issues command.
- SKILL: Added product line workflows and critical issues by product line guidance.
- REFERENCE: Added product line APIs and product-line critical issues to `references/PRM_OPEN_API.md`.
- CLI: Added file-based cache for users/products/product-lines with refresh/clear controls.
- CLI: Added users list/query keyword support and todos endpoint.
- REFERENCE: Updated User APIs and added Todo APIs in `references/PRM_OPEN_API.md`.
- CLI: Updated critical issue search to OpenAPI search endpoint with multi-dimensional filters.
- CLI: Added tickets search endpoint with multi-dimensional filters and caching.
- DOCS: Removed legacy core-product critical-issue search references.
- CLI: Cache TTL now uses hours (default 12), days deprecated.

## Files Touched
- `SKILL.md`
- `docs/PRM.md` (this report)
- `cli.ts`
- `prm-tool.ts`
- `config.example.json`
- `references/PRM_OPEN_API.md`
- `tests/cli.unit.test.ts`

# PRM Skill Update Report (2026-05-28) — Linear Adapter Parity Phase 1

## Added/Updated This Round
Backend parity work (paired with `uid.core-product` Phase 1 from
`docs/w22/PRM_OPEN_API_LINEAR_PARITY_W22.md`) — exposes the minimum write
surface needed by external adapters (e.g. Linear-style coding daemons) to
drive the PRM "version plan / issue / sub-issue / blocked-by / status /
progress" workflow over API key auth.

- CLI: Added `prm tickets create <product_id> <version_id>` — wraps `POST /api/v1/public/openapi/product/{pid}/versions/{vid}/tickets` with flags for `--description`, `--type`, `--priority`, `--status`, `--assignees`, `--parent_id` (sub-issue), `--label_ids`, `--reporter_id`, `--due_date`.
- CLI: Added `prm tickets update <product_id> <version_id> <ticket_id>` — wraps the new `PUT /api/v1/public/openapi/.../tickets/{tid}` (B1). Sparse-update body covers `--status`, `--progress_comment`, `--priority`, `--description`, `--comment`, `--assignees`, `--parent_id`, `--label_ids`, `--due_date`. This is the primary "transition + comment" surface adapters use.
- CLI: Added `prm tickets relate {create|update|delete|list}` — wraps the new public relations endpoints (B2/B3/B4). One row per pair; perspective-aware `relation_type`.
- CLI: Added `prm versions create <product_id>` — wraps the new `POST /api/v1/public/openapi/product/{pid}/versions` (B5). Requires `--name` and `--major_id`.
- SKILL: Added §I (issue / sub-issue creation), §J (relations + perspective rules + uniqueness constraint), §K (status transition + per-product-line constraint), §L (progress / comment with marker-block append pattern), §M (version plan creation), §N (Linear ↔ PRM adapter implementation notes).
- REFERENCE: Documented the new endpoints in `references/PRM_OPEN_API.md` (Create/Update Version Ticket, Issue Relation CRUD, Create Version).
- TESTS: Added `cli.unit.test.ts` cases covering `tickets create / update`, `tickets relate create / update / delete / list`, `versions create`, plus the "missing required flags" exit-1 paths.

## Files Touched
- `cli.ts`
- `tests/cli.unit.test.ts`
- `SKILL.md`
- `references/PRM_OPEN_API.md`
- `docs/PRM.md` (this report)

## Open Items / Next Steps
1) Phase 2 backend (B6 / B7): expose `parent_ids[]` and `unique_ids[]` filters on `tickets/search` (for `getChildIssues` / `fetchIssuesByIds`); expose `GET /api/v1/public/openapi/product_lines/{plid}/ticket_statuses` so adapters can build their state map without reaching for ticket detail.
2) Adapter end-to-end smoke: from an external project, run the full happy path against alpha — create issue → set BLOCKED_BY → transition status → write progress_comment → create sub-issue → create new version plan.
3) Phase 3 (`ticket_comment` table) is deferred until adapter feedback proves the marker-block approach is insufficient.
