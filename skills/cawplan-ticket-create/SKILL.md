---
version: 0.2.6
name: cawplan-ticket-create
description: |
  Create one or more CawPlan tickets: from an explicit request, or by extracting action items/work items out of pasted long-form text such as a PRD, a Slack discussion, or a meeting transcript (version-scoped by default, or backlog only after user confirmation). Also handles splitting a PRD's platforms (FE/BE/iOS/Android/QA) across different products under one Team, when the destination is a Team rather than a single product.
  Use when: the user asks to create, file, or add a ticket, issue, bug, or task in CawPlan; or pastes a PRD/requirement doc, Slack conversation, or meeting transcript/notes and asks to turn it into tickets, extract action items, or split work into FE/BE/iOS/Android/QA tickets — including when those platforms belong to different products under the same Team.
  NOT for: updating existing tickets, searching tickets, critical issues, release planning, or SQA requirement analysis and archiving (use `cawplan-requirement-analyze`).
argument-hint: "[product, version, ticket title(s), HTML description body, type, priority, assignee — OR pasted PRD/meeting transcript/Slack text to extract tickets from]"
allowed-tools: Bash
---

# CawPlan Ticket Create

## Bootstrap

```bash
cawplan skill check
```

## Entry Routing

Pick a flow before doing anything else:

| Input | Flow |
|---|---|
| An explicit, single ticket ask ("create a ticket for X", "file a bug about Y") | **A — Single ticket** |
| A pasted PRD, requirement doc, Slack thread, or meeting transcript/notes — with or without an explicit "turn this into tickets" ask | **B — Extract from text** |

If the message mixes both (an explicit ask plus a wall of pasted context), treat it as **B** and let extraction produce a single ticket if that's all the source supports.

## Workflow A — Single ticket

Use `--product` and `--version` by name when the user already provided both — the CLI resolves IDs internally.

If a product is provided but no version is provided:
1. Resolve the product first:
   ```bash
   cawplan products list --search "<product name>"
   ```
2. List versions for the resolved product:
   ```bash
   cawplan versions list <product_id> --page_size 100
   ```
3. Show the user the in-progress versions (`status`/`state` such as `IN_PROGRESS`, `INPROGRESS`, or display text "In Progress") and ask them to choose one. Include a "Backlog / no version" option only as a fallback when the user cannot provide a version.

**Confirm before creating** — even for an explicit single-ticket ask with product/version already given: state the resolved Product, Version (or "Backlog"), Title, Type, Priority, and Assignee (or `-`) back to the user and get an explicit go-ahead before running the create command below. Ticket creation isn't reversible from this CLI (no `tickets delete`), so don't skip this because the request already sounded final.

**Version ticket** (scoped to a specific version):
```bash
cawplan tickets create-version \
  --product "<product name>" \
  --ver "<version name>" \
  --description "<ticket title>" \
  --remarks "<html description body>" \
  --type FEATURE \
  --priority MEDIUM \
  --reporter <your-email> \
  --assignee <email>
```

**Backlog ticket** (fallback only when the user cannot provide a version or explicitly asks for backlog):
```bash
cawplan tickets create-backlog \
  --product "<product name>" \
  --description "<ticket title>" \
  --remarks "<html description body>" \
  --type FEATURE \
  --priority MEDIUM \
  --reporter <your-email>
```

Get your own email for `--reporter`:
```bash
cawplan auth status   # shows authenticated email
```
OAuth login is required before creating tickets.

## Workflow B — Extract tickets from pasted text

For PRDs, Slack threads, and meeting transcripts pasted directly into the conversation — plain copy-paste, no upload or Slack/meeting integration involved.

1. **Resolve destination scope — one product, or a Team with per-platform products:**
   - **Single product** (the common case): resolve it the same way as Workflow A, then resolve one version for it (list in-progress versions, ask the user to choose, or confirm backlog). If the text names a version, use it; otherwise ask. Apply this product/version to every extracted candidate unless a specific item explicitly names a different one.
   - **A Team, with platforms split across different products** (e.g. "add to VN Team, FE/BE/iOS/Android are different products") — a plain product search won't resolve this, since the destination isn't one product:
     1. Resolve the Team name to a `product_line_id` (page and match by name client-side, same as `cawplan-product-report`'s Team workflow):
        ```bash
        cawplan product-lines list --page_size 100
        ```
     2. List the Team's products:
        ```bash
        cawplan products list --product_line_id <product_line_id>
        ```
     3. Ask the user to map each platform the extraction will produce (FE/BE/iOS/Android, plus QA) to one of the listed products. Don't guess the mapping from product names alone — a name like "VN Cloud" or "VN Roadmap" isn't obviously BE or FE, and guessing wrong silently files real work under the wrong product. If the user doesn't name a product for QA specifically, ask where QA tickets go rather than assuming — a Team commonly has no dedicated QA product, so QA work usually either piggybacks on one of the other mapped products or is skipped, and which one applies isn't guessable.
     4. For each distinct product that ends up in the mapping, resolve one version for it the same way as Workflow A (list in-progress versions, ask the user to choose, or confirm backlog) — versions belong to a product, not to the Team, so do this once per product actually used, not once for the whole batch.
     5. Carry this platform→product/version mapping into step 2: each candidate's product/version comes from its own platform's mapping, not a single shared product.
2. **Extract candidate tickets** from the source text only:
   - PRD/requirement doc → one ticket per target platform/component the doc actually calls out (e.g. FE/BE/iOS/Android/QA). If the doc describes one cohesive piece of work with no platform breakdown, produce a single ticket — do not invent a split. In Team mode (previous step), tag each candidate with the product/version its platform mapped to.
   - Slack thread/meeting transcript → one ticket per distinct action item. A real item is either (a) a firm, unconditional owner statement ("X will do Y", "I'll take this", a decision with a concrete follow-up), or (b) a concretely described bug/problem (specific symptom, trigger, or repro condition) even with no owner. Conditional/future offers ("I can help once we know root cause") don't set an assignee but don't disqualify an otherwise-concrete bug. Pure chatter — a question with no decision, a "just curious" aside, someone explicitly disclaiming ownership with no follow-up — is not an action item, even if it references a known problem area.
   - If the thread retracts or corrects an earlier statement ("actually no, I think it's X not Y"), use only the corrected/final version. Do not create a ticket from a claim the speaker retracted.
   - Never fabricate a ticket, an assignee, or a detail that isn't in the source text. If the source is too vague to produce clean line items, ask a clarifying question instead of guessing a split.
3. **Map each candidate to ticket fields:**
   - `description` (title): a short summary in your own words, not a copy-pasted transcript line.
   - `remarks` (body): the relevant excerpt/context converted to HTML (see Rules).
   - `type`: `FEATURE` by default, `BUGFIX` only when the item is clearly a bug/defect.
   - `priority`: `MEDIUM` by default; raise to `HIGH`/`CRITICAL` if the source states elevated urgency, lower to `LOW` if the source explicitly says it's not urgent or can wait.
   - `assignee`: only for a firm, unconditional commitment (see above) **and** only after the name resolves to exactly one person via `cawplan users query --keyword "<name>"`; leave unassigned if there's no firm commitment, or if the query returns zero or multiple matches (apply the same disambiguation rule as products/versions — ask the user).
   - Platform tag: only apply a label when the user asked for a platform split and a matching label exists — check with `cawplan labels list --product_id <product_id> --search "<platform>"` (in Team mode, use each candidate's own mapped `product_id`, not a shared one). Do not invent a label name; if none matches, mention the platform in the title/remarks instead of tagging. In Team mode, the platform is already expressed by which product the candidate is filed under — a label is a nice-to-have, not a substitute for that routing.
4. **Preview before creating.** Multi-ticket extraction is inferred, not explicit — always show the candidate list and get user confirmation before running any create command, even if the user's message already said "create tickets for these". Confirm the *extracted list*, not the original ask. Present the list in the language the user is writing in, regardless of the source text's language.
   - Single-product mode: Title | Type | Priority | Assignee | Platform, using `-` for any field that doesn't apply.
   - Team mode: add a **Product** column (and **Version**, if versions differ across the mapped products) so the user can verify the platform→product routing before anything is created — this is exactly the mapping most likely to be silently wrong, so don't collapse it out of the preview.
5. On confirmation, create each ticket with the same `tickets create-version` / `tickets create-backlog` commands as Workflow A, looped one call per candidate — in Team mode, each call uses that specific candidate's mapped `--product`/`--ver`, not a single shared pair.

## Rules

- Default type to `FEATURE`; use `BUGFIX` only when the user says bug, defect, or issue.
- Default priority to `MEDIUM` when not specified.
- Keep title and description/body separate:
  - Use CLI `--description` only for the ticket title/summary.
  - Use CLI `--remarks` for the page description/body. It supports HTML and is the field users usually mean by "description".
  - Do not put a long body, acceptance criteria, PRD text, or multi-line description into `--description`.
- Convert plain-text body content to compact HTML before passing `--remarks`. Do not pass raw newline-separated text because it may render as one mixed line. Use `<p>`, `<br>`, `<ul>`, and `<li>` as appropriate.
- If the user provides a multi-line request (Workflow A), use the first short line or concise summary as the title and put the remaining detail into HTML `--remarks`. Ask one clarifying question if the title cannot be identified safely.
- If the user did not specify a version, resolve the product, list in-progress versions, and ask the user to choose one before creating the ticket.
- Do not create a backlog ticket by default. Use `create-backlog` only when the user explicitly asks for backlog/no version, or after they confirm they cannot provide a version.
- When creating a backlog ticket, tell the user: "This ticket was created as a backlog item and is not assigned to any version."
- Do not guess the ticket title/summary. Ask one clarifying question if it is missing.
- If the CLI reports multiple matches for a product, version, or assignee query, ask the user to disambiguate.

## Confirmation

After creating, report:

- Ticket display ID and unique ID.
- Product / version scope (or "Backlog").
- Type, priority, status.
- Assignees, or `-` if none.
- Title (from CLI `--description`, stripped/truncated if long).
- Description/body (from CLI `--remarks`, stripped of HTML and truncated if long), or `-` if none.

For Workflow B, report the full list (one line per created ticket) plus any candidates the user dropped or edited during preview. In Team mode, group the report by product (each ticket's own "Product / version scope" line already carries this, but grouping makes it easy to sanity-check the platform→product routing landed where the user confirmed in the preview).

## References

- `references/CAWPLAN_OPEN_API.md`
