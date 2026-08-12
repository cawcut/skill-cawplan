---
version: 0.2.6
name: cawplan-ticket-create
description: |
  Create one or more CawPlan tickets: from an explicit request, or by extracting action items/work items out of pasted long-form text such as a PRD, a Slack discussion, or a meeting transcript (version-scoped by default, or backlog only after user confirmation).
  Use when: the user asks to create, file, or add a ticket, issue, bug, or task in CawPlan; or pastes a PRD/requirement doc, Slack conversation, or meeting transcript/notes and asks to turn it into tickets, extract action items, or split work into FE/BE/iOS/Android/QA tickets.
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

1. **Resolve product/version** the same way as Workflow A. If the text names a version, use it; otherwise ask. Apply the resolved product/version to every extracted candidate unless a specific item explicitly names a different one.
2. **Extract candidate tickets** from the source text only:
   - PRD/requirement doc → one ticket per target platform/component the doc actually calls out (e.g. FE/BE/iOS/Android/QA). If the doc describes one cohesive piece of work with no platform breakdown, produce a single ticket — do not invent a split.
   - Slack thread/meeting transcript → one ticket per distinct action item. A real item is either (a) a firm, unconditional owner statement ("X will do Y", "I'll take this", a decision with a concrete follow-up), or (b) a concretely described bug/problem (specific symptom, trigger, or repro condition) even with no owner. Conditional/future offers ("I can help once we know root cause") don't set an assignee but don't disqualify an otherwise-concrete bug. Pure chatter — a question with no decision, a "just curious" aside, someone explicitly disclaiming ownership with no follow-up — is not an action item, even if it references a known problem area.
   - If the thread retracts or corrects an earlier statement ("actually no, I think it's X not Y"), use only the corrected/final version. Do not create a ticket from a claim the speaker retracted.
   - Never fabricate a ticket, an assignee, or a detail that isn't in the source text. If the source is too vague to produce clean line items, ask a clarifying question instead of guessing a split.
3. **Map each candidate to ticket fields:**
   - `description` (title): a short summary in your own words, not a copy-pasted transcript line.
   - `remarks` (body): the relevant excerpt/context converted to HTML (see Rules).
   - `type`: `FEATURE` by default, `BUGFIX` only when the item is clearly a bug/defect.
   - `priority`: `MEDIUM` by default; raise to `HIGH`/`CRITICAL` if the source states elevated urgency, lower to `LOW` if the source explicitly says it's not urgent or can wait.
   - `assignee`: only for a firm, unconditional commitment (see above) **and** only after the name resolves to exactly one person via `cawplan users query --keyword "<name>"`; leave unassigned if there's no firm commitment, or if the query returns zero or multiple matches (apply the same disambiguation rule as products/versions — ask the user).
   - Platform tag: only apply a label when the user asked for a platform split and a matching label exists — check with `cawplan labels list --product_id <product_id> --search "<platform>"`. Do not invent a label name; if none matches, mention the platform in the title/remarks instead of tagging.
4. **Preview before creating.** Multi-ticket extraction is inferred, not explicit — always show the candidate list (Title | Type | Priority | Assignee | Platform, using `-` for any field that doesn't apply) and get user confirmation before running any create command, even if the user's message already said "create tickets for these". Confirm the *extracted list*, not the original ask. Present the list in the language the user is writing in, regardless of the source text's language.
5. On confirmation, create each ticket with the same `tickets create-version` / `tickets create-backlog` commands as Workflow A, looped one call per candidate.

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

For Workflow B, report the full list (one line per created ticket) plus any candidates the user dropped or edited during preview.

## References

- `references/CAWPLAN_OPEN_API.md`
