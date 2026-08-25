---
version: 0.2.8
name: cawplan-internal-qa-coding-humaninputs
description: |
  Internal QA check for the AI-coding human-input classifier: re-classifies already-uploaded human inputs (content + paired assistant reply) through uid.core-product's current classify prompt/schema/guardrails and compares the freshly generated category array against the already-persisted cloud category, reporting legacy-group accuracy, leaf-level accuracy (where available), and concrete mismatches for manual review.
  Use when: asked to test/verify/check human-input category classification accuracy — e.g. "test today's data", "test what spx submitted today", "check category accuracy for the last N days" — optionally scoped to one person and/or a date range (defaults to the last 2 days when no range is given).
  NOT for: submitting coding reports (use cawplan-coding-commit), general cost/usage insights or prompt-quality scores (use cawplan-coding-insights), or creating tickets.
argument-hint: "[person] [date range]"
allowed-tools: Bash
---

# CawPlan Internal QA — Coding Human Input Categories

## Bootstrap

```bash
cawplan skill check
```

## Prerequisites

- A real `OPENAI_API_KEY` exported in the shell. This calls OpenAI directly to re-run
  classification — it is **not free** and is separate from CawPlan's own enrichment billing.
- A local clone of `uid.core-product` — the classify prompt, JSON schema, and post-classify
  guardrails all live there (`internal/pkg/genai`, `internal/service`), and this skill re-runs
  that exact code rather than re-implementing it. Default path:
  `/home/spx/github/uid.core-product`. If it doesn't exist at that path in this environment,
  find the correct local checkout before proceeding, and use that path everywhere below instead
  — do not fall back to reconstructing the classify logic from memory in an ad hoc script; that
  would test a guess, not the actual current code.

## Workflow

### 1. Resolve scope: person + date range

**Person** (optional):
- If the request names someone (e.g. "spx", a display name), run `cawplan session members` and
  match case-insensitively / by substring against the returned list to find the exact `member`
  key — this is the report's git identity string used by `--member`, not necessarily their
  display name. If more than one member plausibly matches, ask which one. If none match, say so
  and continue workspace-wide rather than guessing.
- If no person is named, don't pass `--member` — the check runs workspace-wide.

**Date range** (optional):
- If the request gives one, use it.
- Otherwise default to the last 2 days: `--from` = 2 days ago (inclusive), `--to` = today.

### 2. Fetch human input rows (content + assistant_message + cloud category)

`human-input-logs` is the only endpoint that returns `content`, `assistant_message`, and
`category`/`categories` together — page through it until exhausted:

```bash
from="<resolved from>"; to="<resolved to>"; member_flag=()
# member_flag=(--member "<exact_member>") if a person was resolved in step 1

page=1; page_size=100
: > /tmp/humaninput_rows.jsonl
while :; do
  resp=$(cawplan session human-input-logs --from "$from" --to "$to" "${member_flag[@]}" --page-num "$page" --page-size "$page_size")
  echo "$resp" | jq -c '.data.items[]?' >> /tmp/humaninput_rows.jsonl
  total=$(echo "$resp" | jq '.data.total // 0')
  got=$(echo "$resp" | jq '.data.items | length')
  page=$((page + 1))
  if [ "$got" -lt "$page_size" ] || [ $(((page - 1) * page_size)) -ge "$total" ]; then break; fi
done
wc -l /tmp/humaninput_rows.jsonl
```

### 3. Build the harness input, skipping rows with nothing to compare

Keep only rows with real content and an already-assigned cloud `category` (rows still pending
enrichment have nothing to compare against and would just burn an OpenAI call for nothing):

```bash
jq -s '[.[] | select((.content // "") != "" and (.category // "") != "") | {
  unique_id: .unique_id,
  session_key: (.session_id // .session_title // ""),
  session_title: (.session_title // ""),
  content: .content,
  assistant_message: (.assistant_message // ""),
  project: (.project // ""),
  files_changed: (.files_changed // 0),
  lines_added: (.lines_added // 0),
  cloud_category: .category,
  cloud_categories: (.categories // [])
}]' /tmp/humaninput_rows.jsonl > /tmp/humaninput_check_input.json
jq length /tmp/humaninput_check_input.json
```

Tell the user the row count before calling OpenAI (each row is one paid call, batched ~20 per
request). For a large count (rough guide: >300), confirm with the user before proceeding instead
of silently spending their OpenAI budget.

### 4. Run the classify-accuracy harness

```bash
cd /home/spx/github/uid.core-product   # or the correct local path from Prerequisites
OPENAI_API_KEY="$OPENAI_API_KEY" go run ./cmd/humaninputcategorycheck \
  < /tmp/humaninput_check_input.json > /tmp/humaninput_check_result.json
cat /tmp/humaninput_check_result.json | jq length
```

This reruns the exact current classify prompt/schema and the exact post-classify guardrails —
read-only, it never writes to any database, it only calls OpenAI and diffs the result against
what you fetched. If `cmd/humaninputcategorycheck` doesn't exist in this checkout, stop and say
so (it may be on a different branch, or not yet merged) rather than reimplementing the pipeline.

### 5. Compute accuracy

```bash
jq '{
  total: length,
  comparable: ([.[] | select((.error // "") == "")] | length),
  group_accuracy: (([.[] | select((.error // "") == "")] ) as $c
    | if ($c | length) == 0 then null
      else ($c | map(select(.group_match)) | length) / ($c | length) end),
  rows_with_v2_cloud_categories: ([.[] | select(.cloud_categories_available)] | length),
  leaf_accuracy_where_v2: (([.[] | select(.cloud_categories_available)]) as $v2
    | if ($v2 | length) == 0 then null
      else ($v2 | map(select(.primary_match)) | length) / ($v2 | length) end),
  avg_set_overlap_where_v2: (([.[] | select(.cloud_categories_available) | .set_overlap]) as $o
    | if ($o | length) == 0 then null else (($o | add) / ($o | length)) end),
  errors: ([.[] | select((.error // "") != "")] | length)
}' /tmp/humaninput_check_result.json
```

List concrete mismatches (group-level — meaningful for every row) for manual review:

```bash
jq '[.[] | select(.group_match == false and (.error // "") == "") | {
  unique_id, content, fresh_category, fresh_categories, cloud_category, cloud_categories
}] | .[0:10]' /tmp/humaninput_check_result.json
```

## Output

Report:
- **Scope**: person (or "workspace-wide") and resolved date range, total rows fetched vs.
  actually comparable (had both content and a cloud category).
- **Group-level accuracy** (legacy 6-bucket match) — the headline number; meaningful for every
  comparable row regardless of whether it predates the v2 taxonomy (CWP-19829).
- **Leaf-level accuracy** and **average category-set overlap**, computed ONLY over rows where
  `cloud_categories_available` is true, and state how many rows were excluded from that figure
  (still on the pre-v2 taxonomy, not yet re-enriched) — don't present leaf accuracy as if it
  covered the whole sample when it didn't.
- Up to ~10 concrete mismatches (content excerpt, fresh vs. cloud) so the user can judge whether
  the *current prompt* or the *persisted cloud value* is the one that's actually wrong — a
  mismatch is not automatically proof the classifier is wrong; the cloud value could be stale.
- If `errors > 0`, say how many rows failed classification and that they were excluded from the
  accuracy computation, rather than silently dropping them.

## Notes

- Cost control: this makes real OpenAI API calls, one batch (~20 inputs) per request. Don't run
  it over a huge unscoped range without checking the row count with the user first.
- Rows with an empty `assistant_message` are still classified (assistant context improves
  accuracy but isn't required) — don't skip them.
- Taxonomy reference: `references/CATEGORY_TAXONOMY.md`. Its source of truth is
  `uid.core-product/internal/pkg/genai/ai_session_human_category_taxonomy.go` — if this doc and
  that file disagree, trust the code.

## References

- `references/CAWPLAN_OPEN_API.md`
- `references/CATEGORY_TAXONOMY.md`
