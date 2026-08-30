---
version: 0.2.8
name: cawplan-internal-qa-coding-humaninputs-sample
description: |
  Pull human-input logs from CawPlan (by product, user/member, date range, count, or session), preprocess prev/assistant context like production classify, and open a local web editor to annotate expected category/topic labels for prompt eval fixtures.
  Use when: building or extending a labeled human-input sample JSON for classify prompt testing — e.g. "pull 20 turns from spx's Slack session last week and label them", "sample human inputs for core-product".
  NOT for: running classify accuracy against cloud labels (use cawplan-internal-qa-coding-humaninputs-test), classifying a single sentence (use cawplan-internal-qa-coding-humaninputs), or submitting coding reports.
argument-hint: "[product|member] [date range] [limit N] [one session?]"
allowed-tools: Bash
---

# CawPlan Internal QA — Human Input Sample & Label

## Bootstrap

```bash
cawplan skill check
```

## Task

Fetch human-input rows via the CawPlan CLI, emit a fixture JSON aligned with production classify
context rules, then open the local label editor so a human can set `expected_categories`,
`expected_topic`, optionally `expected_reason`, and `review_required` per turn.

## Workflow

### 1. Resolve scope (same disambiguation rules as humaninputs-test)

**Member** (optional): `cawplan session members` → exact `--member` git key. If ambiguous, ask
the user to pick — do not guess.

**Product** (optional): `cawplan products list --search "<name>"` → `unique_id`. If ambiguous,
ask the user to pick.

**User within product** (optional): needs PRM `user_id` for
`product-human-input-logs --user-id`, resolved via `cawplan users query`.

**Date range** (required): `--from` / `--to`, or `--date` for a single day. Default to last 2
days if the user gives no range.

**Count**: `--limit N` (default **20**).

**Session shape** (pick one):
- `--one-session` — auto-pick the session with the most rows in range (best for multi-turn prev
  chains, like the 20-turn Slack fixture).
- `--session-id <id>` — keep one session explicitly.
- Neither — first N rows after sort (prev still computed per `session_id`).

### 2. Build the fixture JSON

From this skill directory:

```bash
SKILL_DIR="/media/spx/work/github/flow-cawplan-skill/skills/cawplan-internal-qa-coding-humaninputs-sample"

node "$SKILL_DIR/scripts/build_sample.mjs" \
  --from <YYYY-MM-DD> --to <YYYY-MM-DD> \
  [--member "<exact_member>"] \
  [--product "<product name>" | --product-id <id>] \
  [--user-id <prm_user_id>] \
  [--session-id <session_id> | --one-session] \
  --limit <N> \
  --output "<path>/human-input-sample.json" \
  --copy-for-editor
```

**Output shape** (matches eval fixtures under `/media/spx/work/2026/0830/`):

| Field | Meaning |
|-------|---------|
| `items[].content` | Raw human input |
| `items[].assistant_message` | Raw paired assistant reply (full text from API) |
| `items[].prev_assistant_message` | **Processed** last paragraph of the **previous turn's assistant in the same session** (production `prev` slot). Resolved from **all rows fetched in the date range**, not only the selected N — so a recent slice can still get correct prev even when earlier turns of that session are not in the output |
| `items[].expected_categories` | Empty `[]` until labeled |
| `items[].expected_topic` | Empty until labeled |
| `items[].expected_reason` | Optional free-text rationale for reviewers (empty until filled) |
| `items[].review_required` | `false` by default; set `true` when category/topic labels need review |
| `items[].cloud_category` / `cloud_topic` | Optional hints from cloud enrichment |

Preprocessing mirrors `uid.core-product` `ClassifyPrevAssistantTail` /
`ClassifyAssistantSnippet` (see `scripts/classify_context.mjs`).

### 3. Open the label editor

After `--copy-for-editor`, start a static server and open the page:

```bash
cd "$SKILL_DIR/assets"
python3 -m http.server 8765
```

Browser: `http://localhost:8765/label-editor.html`

- **Load latest sample** — reads `assets/samples/latest.json` (written by `--copy-for-editor`).
- **Load JSON** — pick any fixture file.
- **Download labeled JSON** — exports `*-labeled.json` with `expected_categories` /
  `expected_topic` filled in; `expected_reason` / `review_required` included when set.
- Draft auto-saves to browser `localStorage`.

Tell the user the output path, editor URL, and that they should export the labeled JSON when
done (save under their eval folder, e.g. `/media/spx/work/2026/0830/`).

## Output

Report to the user:
- Resolved filters (member / product / dates / limit / session).
- Path to the generated JSON and `assets/samples/latest.json`.
- Label editor URL (`http://localhost:8765/label-editor.html`).
- Reminder: export labeled JSON from the page when annotation is complete.

## References

- `scripts/build_sample.mjs` — fetch + preprocess
- `scripts/classify_context.mjs` — production-aligned paragraph rules
- `assets/label-editor.html` — web UI
- `references/CATEGORY_TAXONOMY.md` — category label definitions
- `references/TOPIC_TAXONOMY.md` — topic label definitions
