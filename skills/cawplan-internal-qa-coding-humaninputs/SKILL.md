---
version: 0.2.8
name: cawplan-internal-qa-coding-humaninputs
description: |
  Classifies a single piece of text (an AI-coding human input, optionally with its paired assistant reply) into the current v2 human-input category taxonomy, returning the primary category and the full priority-ordered categories array — a pure reasoning check against uid.core-product's classify rules, no CawPlan data or API calls involved.
  Use when: asked to classify/categorize a specific sentence or human input against the current category rules — e.g. "what category is this: ...", "classify this with this assistant reply" — or as the per-row classification step used by cawplan-internal-qa-coding-humaninputs-test.
  NOT for: bulk/batch accuracy testing across many already-uploaded human inputs, or fetching data from CawPlan at all (use cawplan-internal-qa-coding-humaninputs-test for that), submitting reports, or creating tickets.
argument-hint: "[content] [assistant_message?]"
allowed-tools: Bash
---

# CawPlan Internal QA — Classify One Human Input

## Task

Given one piece of `content` (required) and, optionally, its paired `assistant_message` (the
AI's reply to that turn, for domain context), classify it using the rules in
`references/CATEGORY_TAXONOMY.md`. This makes no CawPlan API calls and needs no `cawplan` auth —
it is a pure reasoning check against uid.core-product's current classify rules, not a lookup.

## Workflow

1. Read `references/CATEGORY_TAXONOMY.md` if you haven't already this session.
2. Read the given `content`, and `assistant_message` if provided — use it for domain context the
   same way the real classify prompt does: a short or ambiguous instruction ("do it", "add that")
   should be read in light of what the assistant actually worked on, not guessed from the content
   alone.
3. Determine every category from the taxonomy that clearly applies, then sort them by the
   priority order in the reference doc (highest → lowest). Don't invent a secondary category just
   to fill the list — only include ones that clearly apply. When only one applies, the list has
   one element.
4. The first element of that sorted list is the primary category.

## Output

Report:
- `category` — the primary category (single value, first element of `categories`).
- `categories` — the full priority-ordered list (may be a single value).
- One short sentence explaining the primary pick, citing the specific phrase in `content` (or
  `assistant_message`) that drove the decision — this is what makes a caller's downstream
  disagreement (e.g. vs. an already-persisted cloud category) reviewable rather than opaque.

## References

- `references/CATEGORY_TAXONOMY.md`
