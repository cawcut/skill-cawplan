---
version: 0.2.8
name: cawplan-internal-qa-coding-humaninputs
description: |
  Classifies a single piece of text (an AI-coding human input, optionally with its paired assistant reply and previous-assistant tail) into the current v2 human-input category + topic taxonomies, returning the primary category, the full priority-ordered categories array, one topic, topic_reason, and topic_confidence — a pure reasoning check against uid.core-product's classify rules, no CawPlan data or API calls involved.
  Use when: asked to classify/categorize a specific sentence or human input against the current category and topic rules — e.g. "what category/topic is this: ...", "classify this with this assistant reply" — or as the per-row classification step used by cawplan-internal-qa-coding-humaninputs-test.
  NOT for: bulk/batch accuracy testing across many already-uploaded human inputs, or fetching data from CawPlan at all (use cawplan-internal-qa-coding-humaninputs-test for that), submitting reports, or creating tickets.
argument-hint: "[content] [assistant_message?] [prev_message?]"
allowed-tools: Bash
---

# CawPlan Internal QA — Classify One Human Input

## Task

Given one piece of `content` (required) and, optionally, its paired `assistant_message` (this
turn's AI reply) and `prev_message` (the **last paragraph** of the **immediately previous**
assistant reply — not the previous human turn), classify using `references/CATEGORY_TAXONOMY.md`
and `references/TOPIC_TAXONOMY.md`. This makes no CawPlan API calls and needs no `cawplan` auth —
it is a pure reasoning check against uid.core-product's current classify rules, not a lookup.

## Workflow

1. Read `references/CATEGORY_TAXONOMY.md` and `references/TOPIC_TAXONOMY.md` if you haven't
   already this session.
2. **Prepare `assistant_message`** the same way production does before reading it — don't reason
   over raw untruncated text:
   - Normalize literal `\n` / `\t` escapes and line endings to real whitespace.
   - Strip `[REDACTED]` placeholders (upload-time redaction — not real bracketed content like
     `[Done]` / `[QA Testing]`, which must stay).
   - Strip markdown noise within each paragraph (table rules, `---` horizontal rules, heading/bold
     markers, emoji).
   - Split on blank lines into paragraphs; keep only the **first 3 paragraphs**.
   - Join those paragraphs with `\n\n`, then cap at **~1200 runes** (head cut with `...` if
     longer) — mirrors `ClassifyAssistantSnippet` /
     `AISessionClassifyAssistantMaxRunes`.
3. **Prepare `prev_message`** when provided (same paragraph split + per-paragraph sanitize as
   step 2, but take only the **last paragraph**; cap at **~500 runes**) — mirrors
   `ClassifyPrevAssistantTail` / `AISessionClassifyPrevMaxRunes`. When omitted, treat `prev` as
   empty; bare follow-ups ("commit & push", "直接改") may be ambiguous without it.
4. **Route categories** exactly like production (see `CATEGORY_TAXONOMY.md`):
   - **Primary signal: `content`.** Always read this first.
   - **`prev`:** use ONLY on short bare follow-ups (typically ≤12 Han chars or ≤6 English
     words) to distinguish `decision` (human names/repeats the concrete action the assistant
     offered) vs `approval` (generic go-ahead: "直接改", "可以", "do it"). Never use `prev` for
     any other category; never treat it as a prior human requirement.
   - **`assistant_message`:** use for category ONLY when `content` is a bare hand-off (URL, file
     path, screenshot path, log path) with no intent words. Do **not** infer category from what
     the assistant already did or verified.
5. Determine every category from the taxonomy that clearly applies, then sort by the priority
   order in the reference doc (highest → lowest). Use the exact **snake_case** leaf names
   (`direction_constraint`, `rejection_rollback`, `question_clarification`, `other_meta`, … —
   not shortened forms like `direction` / `rejection` / `question` / `other`). Don't invent a
   secondary category just to fill the list. When only one applies, the list has one element.
6. The first element of that sorted list is the primary category.
7. **Pick exactly one topic** from `TOPIC_TAXONOMY.md` using `content` + prepared
   `assistant_message` only — **never** use `prev_message` for topic. Apply ASKING vs CHANGING,
   bare `commit & push` → `git_ops`, and Slack-heavy hints from the reference doc.
8. Write one short `topic_reason` sentence and **`topic_confidence`** (0.0–1.0 per
   `TOPIC_TAXONOMY.md`) mirroring production.

## Output

Report:
- `category` — the primary category (single value, first element of `categories`).
- `categories` — the full priority-ordered list (may be a single value).
- `topic` — exactly one value from the 17-topic list in `TOPIC_TAXONOMY.md`.
- `topic_reason` — one short sentence explaining the topic pick.
- `topic_confidence` — float 0.0–1.0 (how sure you are about the topic pick).
- One short sentence explaining the primary **category** pick, citing the specific phrase in
  `content`, `prev_message`, or prepared `assistant_message` that drove the decision — this is
  what makes a caller's downstream disagreement (e.g. vs. an already-persisted cloud category)
  reviewable rather than opaque.

## References

- `references/CATEGORY_TAXONOMY.md`
- `references/TOPIC_TAXONOMY.md`
