---
version: 0.2.8
name: cawplan-knowledge
description: |
  Browse and search the CawPlan knowledge base: list/create datasets, list/upload documents in a
  dataset, and search for information across one or all datasets.
  Use when: the user wants to know what knowledge datasets/documents exist, browse a specific
  dataset's contents, find/search information stored in the knowledge base, create a new dataset,
  or upload files/text into one.
  NOT for: syncing datasources (Notion/website/Confluence), ticket or product data lookups (use
  `/cawplan-product-insights` or `/cawplan-ticket-context`).
argument-hint: "[search query, or dataset name]"
allowed-tools: Bash
---

# CawPlan Knowledge

## Bootstrap

```bash
cawplan skill check
```

## Navigation Model

The whole knowledge base is one continuous drillable tree: **datasets → documents → headings →
section content**, plus search results, which are the same tree pre-filtered by relevance. The
user never needs to know or type CLI flag names (`--outline`, `--section`, `--dataset`, `--grep`,
...) — those are implementation details you choose based on what level of the tree they're asking
about. If a user pastes a literal `cawplan ...` command instead of a plain-language request, treat
it as identifying *what they want* (a dataset, a document, a section), not as a script to execute
verbatim; still pick the right underlying flags yourself.

At every level, decide the presentation by candidate-set size and how iterative the pick will be:

- **Bounded, one-shot pick** (the current level's real candidates fit within `AskUserQuestion`'s
  caps — at most 4 options × 4 questions per call, so ≤16 total — and the user is choosing once,
  not about to rapidly reselect/backtrack through many rounds): `AskUserQuestion` with `preview`
  is fine here. Example: picking among the handful of *non-empty* datasets, or among a short list
  of same-topic endpoints. If a level has more raw items than that (e.g. 96 datasets total, only
  3 non-empty), filter down to the real candidates first — don't force a large list into
  `AskUserQuestion` across many chained calls just to avoid plain text.
- **Large or iterative browsing** (a document's full heading tree, dozens of headings, the user
  needs to jump around and reselect quickly across many rounds without waiting each time): plain
  text, numbered/nested list, free-form reply for the deep/iterative parts — see step 5 for the
  one exception (the top level of the tree, when it's bounded) and why going deeper than that
  with `AskUserQuestion` was confirmed to be the wrong tool: modal round-trip per pick, no fast
  reselect/backtrack.

Either way, after showing a leaf-level result (a section's content, a document's full text), show
the list at the level the user was just browsing again so they can keep going, rather than ending
the turn on a one-shot answer.

### Making the clickable path cheap

When you do use `AskUserQuestion`, these keep it from feeling slow or shallow:

- **A `preview` is always the node's own `--outline` `preview` string, verbatim.** Copy that field
  in unchanged. Do **not** write your own preview text, and specifically do not substitute a
  structural summary (a list of the chapter's child headings, a count, a paraphrase) — the point
  of a preview is to show the section's actual opening 正文 so the user can judge the content
  before selecting. A child-heading list tells them nothing the option labels don't already say,
  and it costs a round trip of your own tokens to invent. Structure belongs in `label` /
  `description`; body text belongs in `preview`.
  - Already plain text, so paste it directly: `--outline` (and the CLI's own pickers) run every
    preview through `markdownToPlainText` (`src/lib/knowledge/plaintext.ts`) — headings,
    `**bold**`, `` `code` `` and table pipes are converted, tables become space-aligned columns.
    A preview panel renders its text verbatim, so raw Markdown would leak `###`/`**`/`|` as
    visible noise (verified side by side; converted wins). Don't hand-clean it and don't re-add
    Markdown syntax.
  - A node whose `preview` is empty genuinely has no body of its own (e.g. a heading holding only
    subsections, or a figure). Say so plainly — don't backfill it with an invented summary.
- **Collapse 1:1 levels.** Most datasets hold a single document, so dataset→document is a wasted
  click. Offer `dataset / document` as one combined option and skip a whole round trip.
- **Fill the call.** One `AskUserQuestion` carries 4 questions × 4 options — up to 16 selections
  answered in a single round trip. Grouping related picks into one call beats chaining several.
- **Fetch before you ask, not after.** Content is cached per document for 12h, and `--outline`
  already embeds previews, so pull what the menu needs up front; then a selection renders straight
  from what you have instead of paying a fetch on the click.
- **Re-offer the menu in the same turn.** After rendering a selection, call `AskUserQuestion`
  again immediately with the same (or parent) level. That gives a real pick → view → pick loop —
  the thing plain text otherwise wins on — without the user retyping anything.

1. **List datasets** — the root of the tree. When the user asks what's available, names a dataset
   you need to resolve to an `id`, or hasn't picked one yet and you need to offer a starting point:
   ```bash
   cawplan knowledge datasets list
   ```
   Returns every dataset accessible to the caller: `{id, name, document_count}`. The workspace can
   have many datasets total but few real (non-empty) ones — filter to `document_count > 0` before
   deciding how to present the pick: if that filtered set is small (≤16), `AskUserQuestion` with
   `preview` (e.g. each option's description = a sample of its documents) is a fine one-shot picker
   here; for the full raw list (dozens+, mostly empty), fall back to a plain-text tree instead of
   forcing it through many chained `AskUserQuestion` calls.

2. **List documents in a dataset** — second level of the tree, when browsing a specific dataset's
   contents (the user picked a dataset from step 1, or named one directly):
   ```bash
   cawplan knowledge documents list --dataset <id>
   # optional: --keyword <text> --page <n> --limit <n>
   ```
   `<id>` must come from step 1's output.

3. **Search** — the default path for "find information about X" requests; conceptually the same
   tree filtered to relevance-ranked hits instead of everything:
   ```bash
   cawplan knowledge search --query "<text>"
   ```
   With no dataset selected, this searches every dataset the caller can access. Only add
   `--dataset <id>` when the user explicitly names or selects one or more datasets to narrow to
   — repeat the flag to select multiple:
   ```bash
   cawplan knowledge search --query "<text>" --dataset <id>
   cawplan knowledge search --query "<text>" --dataset <id-1> --dataset <id-2>
   ```
   Search returns ranked fragments, not the full document — it can miss sections that don't
   match the query terms. If the user wants the whole document, or search keeps missing a
   section you know exists, use step 4 instead of trying more search queries.

   Present multiple hits grouped by dataset → document (same tree shape as the rest of this
   skill), not a flat ranked list — so the user can drill from any hit straight into that
   document's outline (step 5) or full section (step 4) using the same reply-in-free-text pattern.

4. **Get full document content** — when the user asks for a document's full text, or a
   specific document's content instead of matching fragments:
   ```bash
   cawplan knowledge documents get --dataset <id> --document <id>
   ```
   `<dataset id>` and `<document id>` must come from steps 1 and 2's output. Returns the raw
   source file content verbatim, not reassembled from search-index segments.

   **For a large document, or when you only need one section**, do not read the whole content
   into your own context — it can silently exceed the file-read tool's context window, and the
   section you want may still get lost in an oversized response even after getting the "full"
   content. If you already know (or can find, via `--outline` in step 5) the exact heading you
   want, use `--section "<heading text>"` instead — it returns that heading's complete,
   cleanly-bounded content (see step 5 for details) with no risk of cutting it short or bleeding
   into the next section:
   ```bash
   cawplan knowledge documents get --dataset <id> --document <id> --section "6.7 Fetch NFC Card"
   ```
   Only reach for `--grep <pattern> --context <n>` when you're searching for a pattern in body
   text rather than a known heading, or the source isn't cleanly headed with Markdown:
   ```bash
   cawplan knowledge documents get --dataset <id> --document <id> --grep "6.7 Fetch NFC Card" --context 20
   ```
   Widen or narrow `--context` (default 3 lines) to the section's expected size. If you also want
   the full document saved for later, add `--output <path>` in the same call — it writes the raw
   file to disk alongside the `--section`/`--grep` result. Only fall back to `--output` on its own
   (then `grep`/`sed` the file yourself) when you need to browse a section whose heading you don't
   know yet and `--outline` (step 5) doesn't cover it (e.g. non-Markdown source).

   The fetched content is cached locally per document (12h default TTL, same cache as other
   `cawplan` commands) — re-running `documents get` with a different `--outline`/`--section`/
   `--grep` against the same `--dataset`/`--document` re-filters the cached copy instead of
   re-fetching, so trying several in a row to locate a section is cheap. Only add `--refresh` if
   the source document may have changed since the last fetch.

5. **Browse a large document with an index tree** — when the user wants to explore an
   unfamiliar or long document:

   - Fetch the document's structure as a heading tree in one call, without pulling the whole
     content: `cawplan knowledge documents get --dataset <id> --document <id> --outline`
     This returns `data.outline`, a nested `{level, title, line, preview, children}` tree built
     server-side from the cached content — do not regex-parse `data.content` yourself for this;
     the CLI already does it (`src/lib/knowledge/outline.ts`). Each node's `preview` is its own
     first few non-blank body lines, so this single call already carries enough to describe every
     heading — there is no need for a separate fetch per heading just to build preview text for
     the menu. Do not re-fetch just to rebuild the tree.
   - **Top level of the tree only**: if the document's top-level headings (level 1) fit within
     `AskUserQuestion`'s caps (≤16 total, ≤4 per question), offer them as a clickable
     `AskUserQuestion` pick, one option per top-level heading, `preview` = that heading's own
     `--outline` preview verbatim (see "Making the clickable path cheap" above — same rules
     apply: real preview text, not an invented child-heading summary). This gives the user a
     clickable first hop into a long document instead of always typing.
   - **Below the top level, do NOT use `AskUserQuestion`** — deeper levels of a document's
     heading tree are exactly the "large or iterative browsing" case from the Navigation Model
     above: dozens+ of headings, and the user needs to jump around and reselect quickly across
     many rounds. Claude Code has no native document-tree UI, and `AskUserQuestion`'s modal
     round-trip per pick was confirmed clunky here specifically once a heading has more than a
     handful of children (e.g. a chapter with 20-30 subsections). Instead, render the remaining
     tree as an actual indented plain-text tree — every node on its own line, 2 spaces of
     indentation per nesting level, mirroring `data.outline`'s `children` structure directly —
     and let the user reply freely with any section, heading, combination of sections, or other
     request. This is a real nested tree, not a single flattened summary line of top-level
     titles joined by commas/bullets; collapsing it into one line defeats the purpose of showing
     structure at all.

     By default render only the first two heading levels (`#` and `##`) — deeper levels
     (`### Request Header`, `### Response Body`, etc.) are the same boilerplate sub-fields
     repeated under nearly every endpoint and just add noise; skip them unless the user asks to go
     deeper on a specific node. Add each node's `preview` inline (e.g. as a short indented line
     under the title, or a trailing em-dash summary) wherever it helps distinguish similarly-named
     headings — it's already there in `data.outline`, no extra fetch needed.

     Example (as literally rendered, not summarized into one line):

     ```
     Document outline:

     1. Introduction
       1.1 Create API Token & Download API Documentation
       1.2 Obtain Your Hostname
     2. Overview
       2.1 API Token
     3. User
       3.1 Schemas
       3.2 User Registration
       3.3 Update User
     4. Access Policy
       4.1 Create
       4.2 Update
     ```

     The user can reply with `3.2`, `User`, `3.2 + 4.1`, or describe what they want.

   - When the user selects a section, fetch only that section's complete, cleanly-bounded text:
     `cawplan knowledge documents get --dataset <id> --document <id> --section "<heading text>"`
     This matches heading titles by case-insensitive substring (returns every match, so a query
     matching more than one heading yields multiple `matches`) and extracts each one's content
     from its own heading line up to (not including) the next heading at the same or a shallower
     level — it never bleeds into a neighboring section the way a fixed-line-count
     `--grep --context <n>` can. Prefer `--section` over `--grep` whenever you're targeting a
     specific heading from the outline; keep `--grep` for freeform pattern search when you don't
     know the exact heading or want to search body text, not titles.
   - After displaying the section, show the outline again so the user can continue browsing.
     Do not fetch or print the entire document again.

   - This is an Agent-side browsing pattern. Do NOT use `--interactive`, or run
     `cawplan knowledge browse`, from an Agent. Both require a real interactive terminal — a
     human running `cawplan` directly at one — and error out immediately when run as a subprocess
     (which is all an Agent ever is).

   - If the user explicitly wants terminal-based interactive browsing, tell them to run one of
     these themselves in a real terminal (do not attempt either on their behalf):
     - `cawplan knowledge browse` — the full picker: dataset → document (with live preview) →
       heading tree, Esc to go back a level. Best starting point if they haven't picked a
       document yet.
     - `cawplan knowledge documents get --dataset <id> --document <id>` — same heading-tree
       browser, scoped to a document they already picked.

6. **Create a dataset** — when the user asks to create a new knowledge dataset:
   ```bash
   cawplan knowledge datasets create --name "<name>" [--description "<text>"] [--permission only_me|all_team_members|partial_members]
   ```
   Confirm the dataset name with the user before creating — this is a create action, not idempotent.
   The response includes the new dataset's `id`; use it directly for the next `documents upload` call
   instead of re-running `datasets list` to look it up.

7. **Upload documents into a dataset** — when the user asks to add/upload files or text content into
   a dataset (existing or just-created):
   ```bash
   # real files (pdf/docx/markdown/...), batch: repeat --file for multiple in one dataset
   cawplan knowledge documents upload --dataset <id> --file <path> [--file <path> ...]

   # plain-text content from local files, batch: repeat --text-file for multiple
   cawplan knowledge documents upload --dataset <id> --text-file <path> [--text-file <path> ...]
   ```
   `<id>` must come from `datasets list` or `datasets create`. Do not mix `--file` and `--text-file`
   in one call — the CLI rejects that; run the command twice for a mixed batch. Confirm the target
   dataset and file list with the user before uploading, since this mutates the dataset.

   `--file` uploads are asynchronous server-side (each file runs a convert-to-markdown → index
   pipeline). By default the CLI submits one request per file and polls each to completion before
   returning, so the command can take a while for larger files — that's expected, not a hang. Do not
   re-run the command if it seems slow. If the user wants to fire-and-forget instead of waiting, add
   `--no-wait`; it returns immediately with `job_id`s per file, which can be checked later with:
   ```bash
   cawplan knowledge documents job-status --dataset <id> --job <job_id>
   ```
   `--text-file` uploads are synchronous (no job/polling involved) — the command returns as soon as
   each document is created.

## Output

Every level follows the Navigation Model above: `AskUserQuestion` for a bounded one-shot pick,
plain-text numbered/nested list for large or iterative browsing. For a document's heading tree
specifically, that split lands at the top level: `AskUserQuestion` for the level-1 headings when
they fit the caps, plain-text free-form for everything below that. Either way, show the level the
user was browsing again after a leaf result so they can continue.

- **Dataset listing**: table/list of `name`, `id`, `document_count` — the root of the tree; filter to non-empty before offering a pick.
- **Document listing**: table/list of document names/ids for the requested dataset, noting total count if paginated — second level.
- **Search results**: grouped by dataset → document (not a flat ranked list), with source metadata per fragment; note whether the search was scoped to one dataset or ran across all accessible datasets. Each hit should be drillable into that document's outline or full section.
- **Document outline**: level-1 headings as a clickable `AskUserQuestion` pick when they fit the caps (≤16 total, ≤4 per question); everything below the top level as a plain-text menu with free-form user selection — not raw content. Where a node's `preview` is worth inlining (to tell similarly-named headings apart), inline that field verbatim — never a summary you wrote yourself.
- **Document content**: quote/summarize directly from the `--section`/`--grep` match you pulled, not from a re-assembly of prior search hits — the leaf of the tree.
- **Create/upload**: confirm what was created/uploaded (dataset id/name, or per-document id/name from the response) — do not assume success without checking `code` in the response.

## Decision Guide

- User gives no starting point at all ("what's in the knowledge base?"): `datasets list` — the root of the tree; filter to non-empty datasets, then `AskUserQuestion` if that fits ≤16, else plain text.
- User names a specific dataset (or a few) ("search the X dataset for..."): resolve each with `datasets list` first, then `search --dataset <id>` (repeat for multiple).
- User asks a general question with no dataset context: go straight to `search` with no `--dataset`.
- User asks "what documents are in X": `documents list --dataset <id>`, not `search`.
- User asks for a document's full content/summary, or search results only surface a title/fragment with no body: `documents get --dataset <id> --document <id>`.
- User wants to browse/explore a long or unfamiliar document rather than a known section: `documents get --outline`, offer the level-1 headings as an `AskUserQuestion` pick if they fit the caps (else plain text), then for any deeper level present the remaining tree as a plain-text menu with free-form selection, then loop `--section "<heading>"` → outline → section on request.
- User pastes a literal `cawplan knowledge ...` command instead of describing what they want: read it as naming a dataset/document/section, not as a script to run verbatim — resolve missing ids yourself (steps 1–2) and pick whichever flags (`--outline`, `--section`, `--grep`, ...) actually fit what they're asking for.
- User asks to create a new dataset: `datasets create --name <name>`, after confirming the name.
- User asks to upload/add files or text into a dataset: `documents upload --dataset <id> --file <path>...` or `--text-file <path>...`, after confirming target dataset and files.

## References

- `references/CAWPLAN_OPEN_API.md` — section 12) Knowledge APIs.
