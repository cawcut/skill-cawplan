---
version: 0.2.8
name: cawplan-internal-qa-coding-humaninputs-test
description: |
  Internal QA check for the AI-coding human-input classifier: pulls already-uploaded human inputs via the cawplan CLI, classifies each one via cawplan-internal-qa-coding-humaninputs, and compares category and/or topic against persisted cloud labels — in category-only, topic-only, or both-together mode — reporting accuracy and concrete mismatches for manual review.
  Use when: asked to test/verify/check human-input classification accuracy — e.g. "test today's category accuracy", "check topic only for spx last week", "compare both category and topic for the last 2 days" — optionally scoped to one person, one product, or both.
  NOT for: classifying a single ad hoc sentence (use cawplan-internal-qa-coding-humaninputs directly), submitting coding reports (use cawplan-coding-commit), general cost/usage insights or prompt-quality scores (use cawplan-coding-insights), or creating tickets.
argument-hint: "[person] [product] [date range] [category|topic|both]"
allowed-tools: Bash
---

# CawPlan Internal QA — Coding Human Input Classify Test (Batch)

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

**Compare mode** (optional — default **`both`**):

| Mode | User intent (examples) | Rows kept | What gets scored |
|------|------------------------|-----------|------------------|
| `category` | "category accuracy", "only category", "只看分类" | cloud `category` non-empty | `category` only |
| `topic` | "topic accuracy", "only topic", "只看 topic" | cloud `topic` non-empty | `topic` only |
| `both` | default; "category and topic", "both", "两项一起" | cloud `category` **and** `topic` non-empty | category, topic, **and combined** (both match on same row) |

If the user names a mode explicitly, use it. If they ask only about category or only about topic,
use the matching single mode. Otherwise use `both`.

State the resolved `compare_mode` in the final report header.

### 2. Fetch human input rows (content + assistant_message + cloud labels)

Pick the endpoint based on what got resolved in step 1 — all return the same row shape
(`content`, `assistant_message`, `category`, `topic`, plus pagination in `.data`):

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
  case "$compare_mode" in
    category)
      echo "$resp" | jq -c '.data.items[]? | select((.content // "") != "" and (.category // "") != "")' >> /tmp/humaninput_rows.jsonl
      ;;
    topic)
      echo "$resp" | jq -c '.data.items[]? | select((.content // "") != "" and (.topic // "") != "")' >> /tmp/humaninput_rows.jsonl
      ;;
    both)
      echo "$resp" | jq -c '.data.items[]? | select((.content // "") != "" and (.category // "") != "" and (.topic // "") != "")' >> /tmp/humaninput_rows.jsonl
      ;;
  esac
  total=$(echo "$resp" | jq '.data.total // 0')
  got=$(echo "$resp" | jq '.data.items | length')
  page=$((page + 1))
  if [ "$got" -lt "$page_size" ] || [ $(((page - 1) * page_size)) -ge "$total" ]; then break; fi
done
wc -l /tmp/humaninput_rows.jsonl
```

Rows failing the `compare_mode` filter above are dropped — e.g. in `both` mode, rows missing either
cloud label are excluded. Empty `content` is always excluded.

If the row count is large (rough guide: >100), tell the user the count and confirm before
classifying all of them — each row is one classification pass, your own reasoning per row, not
a scripted/API call, so a very large batch is a real time cost.

### 3. Classify each row via the base skill

Read `cawplan-internal-qa-coding-humaninputs`'s instructions first if you haven't already this
session — its Task/Workflow steps and taxonomy reference file (in its own reference folder) are
what you apply per row, so the classification rules stay defined in exactly one place instead of
duplicated here.

For each row in `/tmp/humaninput_rows.jsonl`, apply that classification to the row's `content`
and `assistant_message` as input, and print one progress line per row as you go — this is both
the progress indicator and the visible input/output of each atomic-skill call, not just a final
summary:

```
[<n>/<total>] content: "<content excerpt, ~80 chars>" | assistant: <"<excerpt>" or "(none)"> -> category: <category>, categories: <categories>, topic: <topic>, topic_confidence: <0.00-1.00>
```

Do this for every row in order, one line each, before moving on to comparison — don't batch
several rows into one silent pass and only report the end result. After the last row, produce a
plain list mapping each row's `unique_id` to its resulting `category`, `topic`, and
`topic_confidence` — this makes the next step a trivial diff rather than something you have to
re-derive.

### 4. Compare against cloud labels (per compare_mode)

Use simple string equality per dimension — do not compare a `categories` array field, and do not
build or run any script. **`topic_confidence` is not compared** (cloud may store LLM confidence;
this check is label accuracy only).

**`category` mode** — compare your `category` to the row's cloud `category` only.

**`topic` mode** — compare your `topic` to the row's cloud `topic` only (apply legacy
normalization below).

**`both` mode** — compare category and topic separately **and** report **combined accuracy**: the
fraction of rows where **both** labels match after legacy normalization.

Legacy normalization (do not count as genuine misses when normalized values agree):

- **Category:** cloud v1 bucket (`decision`/`direction`/`requirement`/`correction`/`planning`/
  `other`) vs your v2 leaf — see base skill `CATEGORY_TAXONOMY.md` legacy table →
  **taxonomy-version mismatch**
- **Topic:** cloud `improvement` → `refactor`, cloud `ux` → `design_ui` → **legacy-topic mismatch**

## Output

The per-row progress lines from step 3 already show every input/output — the final report below
is a summary and highlight reel on top of that, not a replacement for it.

Report:
- **Scope**: `compare_mode`, person and/or product (or "workspace-wide"), resolved date range,
  total rows fetched vs. comparable under that mode.
- **`category` mode**: category match rate; taxonomy-version mismatches vs. genuine disagreements;
  up to ~10 genuine category mismatches.
- **`topic` mode**: topic match rate; legacy-topic mismatches vs. genuine disagreements; up to ~10
  genuine topic mismatches.
- **`both` mode**: category match rate, topic match rate, **combined match rate** (both labels
  correct on the same row), and separate legacy/taxonomy-version buckets; up to ~10 genuine
  mismatches per dimension (flag rows where only one of the two labels disagrees).

## Notes

- Classification itself is delegated to `cawplan-internal-qa-coding-humaninputs`, one row at a
  time — this skill only handles scope resolution, data fetching, and comparison. If that skill's
  rules ever change, this one picks it up automatically since nothing here duplicates them.
- Only single-value `category` and/or `topic` labels are compared (per `compare_mode`). A
  `categories` array and `topic_confidence` are out of scope for scoring — confidence is shown in
  progress lines for human review only.

## References

- `references/CAWPLAN_OPEN_API.md`
