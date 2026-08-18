---
version: 0.2.7
name: cawplan-plan-create
description: |
  Create a CawPlan version plan: create a version and optionally populate it with tickets, either from an explicit ticket list or by extracting work items from pasted OKRs/stage goals — deduplicating against the existing backlog and adding a rough, clearly-labeled effort estimate.
  Use when: the user asks to create a version plan, set up a new release, create a version with goals or tasks, plan a release train, or pastes OKRs/quarterly goals and asks to turn them into a version plan.
  NOT for: tracking an existing plan, creating standalone backlog tickets outside of a new version plan, querying product info, or metrics.
argument-hint: "[product name or ID, version name, and optional ticket titles/summaries — OR pasted OKRs/stage goals to generate a plan from]"
allowed-tools: Bash
---

# CawPlan Plan Create

## Bootstrap

```bash
cawplan skill check
```

## Entry Routing

| Input | Flow |
|---|---|
| Explicit version name + optional explicit ticket list | **A — Direct create** |
| Pasted OKRs / stage goals, asking to generate a plan from them | **B — OKR-driven plan** |

## Workflow A — Direct create

1. Resolve product name to `product_id`:
   ```bash
   cawplan products list --search "<product name>"
   ```
   If more than one product matches, list the candidates (name + `product_id`) and ask the user to pick — do not guess. This applies whether reached from Workflow A or Workflow B.

2. Create the version:
   ```bash
   cawplan versions create <product_id> --name <X.Y.Z> --description "<goals>"
   ```

3. If the user provided tickets or tasks, create them on the new version:
   ```bash
   cawplan tickets create-version <product_id> <version_id> \
     --description "<ticket title/summary>" \
     --remarks "<html body>" \
     --type FEATURE --priority MEDIUM
   ```
   Repeat for each ticket. Include `--remarks` only when the user provides ticket body details; it supports HTML. Resolve assignees with `cawplan users query --email <email>` when provided.

## Workflow B — OKR-driven plan

CawPlan has no effort-estimate or story-point field anywhere in the ticket schema — any estimate here is a rough LLM guess, never an authoritative number, and must be labeled as such everywhere it's shown.

1. Resolve product (Workflow A step 1) and get the target version name — same rule as Workflow A: ask if not provided, never invent one.
2. Fetch the existing backlog to dedupe against:
   ```bash
   cawplan backlog list <product_id> --page_size 100
   ```
   Page through fully — a partial backlog list makes dedup unreliable, not just incomplete. The response is a `CommonPageResp` (`data`, `page_num`, `page_size`, `total`); keep incrementing `page_num` while `page_num * page_size < total`, don't stop after one page just because it came back full. Keep each result's `unique_id` (not `display_id` — the display ID is for showing to the user, the API calls need `unique_id`), plus its current `type`/`priority`, for steps 4 and 6.
3. Extract candidate work items from the pasted OKRs/goals — one ticket per distinct goal/initiative the text actually states. Don't invent scope, sub-tasks, or acceptance criteria that aren't in the source text; if a goal is too vague to turn into a concrete ticket, list it as a question for the user instead of guessing.
4. **Dedupe against the backlog** for each candidate, by meaning, not exact string match:
   - Strong match (the backlog item is clearly the same piece of work) → don't create a duplicate ticket. Plan to move the existing backlog ticket into the new version instead (see step 6); carry over its existing `unique_id`, `type`, and `priority` from step 2 — a moved ticket's preview row reflects what it actually is today, not Workflow A's FEATURE/MEDIUM defaults (those only apply to genuinely new tickets).
   - Partial/uncertain overlap → treat the OKR item as a new ticket, but flag the backlog item alongside it as "possibly related — worth checking manually" rather than silently merging two things that might not actually be the same. Persist this flag into the new ticket's `--remarks`, not just the preview — it should survive after the chat session ends.
   - No overlap → new ticket, no flag.
5. For each new-ticket candidate, add a rough effort estimate labeled unambiguously as a guess (e.g. "~M rough estimate, unverified" in the remarks or in the preview — not as a committed number), based only on the scope described in the source text.
6. **Preview before creating anything** — this step involves interpretation (goal → ticket) and reuse decisions (move vs. create), both of which carry real misread risk. Show: version name, and for each candidate — title, type, priority, rough estimate, and whether it's "new" or "move existing backlog ticket `<display_id>`". Get explicit confirmation before running any create/update command.
7. On confirmation:
   - Create the version (Workflow A step 2).
   - For "new" candidates: `cawplan tickets create-version` (Workflow A step 3), same field conventions.
   - For "move existing" candidates: a backlog ticket's `version_id` equals its own `product_id` by convention (that's what makes it "backlog" rather than version-scoped — see `references/CAWPLAN_OPEN_API.md`'s backlog ticket notes), so:
     ```bash
     cawplan tickets update <product_id> <product_id> <backlog_ticket_unique_id> --target_version_id <new_version_id>
     ```
     Use the `unique_id` kept from step 2, not the display ID. Moving, not duplicating, keeps the ticket's history intact.

## Rules

- Ask for the version name if not provided. Do not invent or auto-increment a version number.
- Require an exact version name in `X.Y.Z` format before creating.
- If a `--major_id` is needed (to associate with a major version), resolve it first:
  ```bash
  cawplan versions list <product_id>
  ```
- Default ticket type to `FEATURE`, priority to `MEDIUM` unless specified.
- Do not create tickets unless the user explicitly describes them (Workflow A) or the OKR/goal text actually states them (Workflow B).

## Confirmation

After creating the version, report:

- Version name and unique ID.
- Product name and ID.
- Description (truncated if long).
- List of created tickets (display ID, type, title/summary, remarks if provided), or "No tickets created" if none.
- For Workflow B: also list which tickets were moved from backlog (with their original display ID) vs. newly created, and repeat the rough-estimate caveat once at the end of the summary — not just in the preview.

## References

- `references/CAWPLAN_OPEN_API.md`
