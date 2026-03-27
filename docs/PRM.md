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
