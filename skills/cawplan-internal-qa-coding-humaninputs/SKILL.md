---
version: 0.2.8
name: cawplan-internal-qa-coding-humaninputs
description: |
  Internal QA check for the AI-coding human-input classifier: pulls already-uploaded human inputs (content + paired assistant reply) via the cawplan CLI, classifies each one yourself using the current classify rules, and compares your category against the already-persisted cloud category by simple string match — reporting accuracy and concrete mismatches for manual review.
  Use when: asked to test/verify/check human-input category classification accuracy — e.g. "test today's data", "test what spx submitted today", "check category accuracy for the last N days" — optionally scoped to one person, one product, or both, and/or a date range (defaults to the last 2 days when no range is given).
  NOT for: submitting coding reports (use cawplan-coding-commit), general cost/usage insights or prompt-quality scores (use cawplan-coding-insights), or creating tickets.
argument-hint: "[person] [product] [date range]"
allowed-tools: Bash
---

# CawPlan Internal QA — Coding Human Input Categories

## Bootstrap

```bash
cawplan skill check
```

## Workflow

### 1. Resolve scope: person, product, and date range

**Person** (optional):
- If the request names someone (e.g. "spx", a display name), run `cawplan session members` and
  match case-insensitively / by substring against the returned list to find the exact `member`
  key — this is the report's git identity string used by `--member`, not necessarily their
  display name.
- **If more than one member plausibly matches, don't guess** — present them as a numbered list
  (whatever distinguishing detail the response has: display name, email, member key) and ask the
  user to pick one before proceeding.
- If none match, say so and continue workspace-wide rather than guessing.
- If no person is named, don't pass `--member` — the check runs workspace-wide.

**Product** (optional — only when the request names a product):
- Resolve via `cawplan products list --search "<name>"`.
- **If more than one product plausibly matches, don't guess** — present them as a numbered list
  (name, product line, unique_id) and ask the user to pick one before proceeding.
- If none match, say so and ask for the correct product name rather than guessing the closest one.

**Date range** (optional):
- If the request gives one, use it.
- Otherwise default to the last 2 days: `--from` = 2 days ago (inclusive), `--to` = today.

### 2. Fetch human input rows (content + assistant_message + cloud category)

Pick the endpoint based on what got resolved in step 1 — all three return the same row shape
(`content`, `assistant_message`, `category`, plus pagination in `.data`):

| Resolved scope | Command |
|---|---|
| Nothing (workspace-wide) | `cawplan session human-input-logs --from ... --to ...` |
| Person only | `cawplan session human-input-logs --from ... --to ... --member "<exact_member>"` |
| Product only | `cawplan session product-human-input-logs --product-id <id> --from ... --to ...` |
| Product + person | `cawplan session product-human-input-logs --product-id <id> --user-id <id> --from ... --to ...` (needs the person's PRM `user_id`, not the member key — resolve via `cawplan users query --email <email>` or `--keyword <name>`, applying the same numbered-list disambiguation rule if more than one user matches) |

Page through until exhausted:

```bash
from="<resolved from>"; to="<resolved to>"
extra_flags=()
# extra_flags=(--member "<exact_member>")                       # person only
# extra_flags=(--product-id "<id>")                              # product only, use product-human-input-logs
# extra_flags=(--product-id "<id>" --user-id "<id>")             # product + person, use product-human-input-logs

page=1; page_size=100
: > /tmp/humaninput_rows.jsonl
while :; do
  resp=$(cawplan session human-input-logs --from "$from" --to "$to" "${extra_flags[@]}" --page-num "$page" --page-size "$page_size")
  # substitute "product-human-input-logs" for "human-input-logs" above if a product was resolved
  echo "$resp" | jq -c '.data.items[]? | select((.content // "") != "" and (.category // "") != "")' >> /tmp/humaninput_rows.jsonl
  total=$(echo "$resp" | jq '.data.total // 0')
  got=$(echo "$resp" | jq '.data.items | length')
  page=$((page + 1))
  if [ "$got" -lt "$page_size" ] || [ $(((page - 1) * page_size)) -ge "$total" ]; then break; fi
done
wc -l /tmp/humaninput_rows.jsonl
```

Rows with empty `content` or no cloud `category` yet (not enriched) are dropped up front — there
is nothing to classify or compare for them.

If the row count is large (rough guide: >100), tell the user the count and confirm before
classifying all of them yourself — this is your own reasoning per row, not a scripted/API call,
so a very large batch is a real time cost, not a dollar cost.

### 3. Classify each row yourself

Read `references/CATEGORY_TAXONOMY.md` — it mirrors uid.core-product's current classify prompt
rules. For each row in `/tmp/humaninput_rows.jsonl`, read its `content` and (if present)
`assistant_message` for domain context, and decide the single category exactly as that prompt
would: pick from the 15 leaves, using the priority order when more than one clearly applies. Do
this directly as a reasoning step — do not write a script or call an external LLM API to do it;
you are the classifier here, using the rules in the reference doc.

Produce a plain list mapping each row's `unique_id` to your chosen category before moving on to
comparison — this makes the next step a trivial diff rather than something you have to re-derive.

### 4. Compare against the cloud category

For each row, compare your category to the row's `category` field with a simple string match —
do not compare the `categories` array field, and do not build or run any script for this; it's a
plain string equality per row. Count matches vs. mismatches.

For any mismatch, check `references/CATEGORY_TAXONOMY.md`'s legacy taxonomy table: if the cloud
`category` is one of the 6 old flat values (`decision`/`direction`/`requirement`/`correction`/
`planning`/`other`) and your v2 leaf collapses to that same legacy bucket, note it separately as
a **taxonomy-version mismatch** (the row predates CWP-19829, not a real disagreement) rather than
counting it as a genuine miss.

## Output

Report:
- **Scope**: person and/or product (or "workspace-wide" if neither), resolved date range, total
  rows fetched vs. actually comparable (had both content and a cloud category).
- **Accuracy**: exact string-match rate on `category`, and separately how many of the mismatches
  were taxonomy-version mismatches (pre-v2 rows) vs. genuine disagreements — don't blend the two
  into one number.
- Up to ~10 concrete genuine mismatches (content excerpt, your category vs. cloud category) so
  the user can judge whether your classification or the persisted cloud value is the one that's
  actually wrong — a mismatch is not automatically proof the classifier is wrong; the cloud value
  could be stale or itself mis-tagged.

## Notes

- This never touches uid.core-product's codebase or runs any command from that repo — the
  classification is you, the agent, applying the rules in `references/CATEGORY_TAXONOMY.md`
  directly to each row.
- Only `category` (single value) is compared. The `categories` array field is out of scope for
  this check.

## References

- `references/CAWPLAN_OPEN_API.md`
- `references/CATEGORY_TAXONOMY.md`
