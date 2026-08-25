---
version: 0.2.8
name: cawplan-internal-qa-coding-session-test
description: |
  Internal QA check for the new AI-coding session-summary feature: fetches one session's full conversation via the cawplan CLI and generates a narrative summary yourself using the same rules uid.core-product's session-insights prompt uses, so you can eyeball the summary's quality before/without needing the cloud enrichment pipeline to have run. Display-only, no comparison against any cloud value (the field is new and may not be backfilled yet).
  Use when: asked to test/check/try out the session summary prompt — e.g. "test the summary for yupeng's session today", "see what the summary would look like for entry <id>", "try the session summary on a random recent session".
  NOT for: human-input category classification (use cawplan-internal-qa-coding-humaninputs[-test]), bulk accuracy testing, submitting reports, or general session cost/usage insights.
argument-hint: "[entry_id] or [person] [date]"
allowed-tools: Bash
---

# CawPlan Internal QA — Session Summary Prompt Test

## Bootstrap

```bash
cawplan skill check
```

## Workflow

### 1. Resolve one session

If the request gives an `entry_id` directly, skip to step 2.

Otherwise resolve a session to test:
- **Person** (optional): if named, resolve via `cawplan session members` (case-insensitive /
  substring match) the same way as the humaninputs skills. If more than one plausibly matches,
  present a numbered list and ask — don't guess. If no person is named, use the current user
  (`cawplan session my-sessions`, no `--user-id` override needed).
- **Date**: if given, use it; otherwise default to the last 2 days.
- List sessions in that scope:
  ```bash
  cawplan session my-sessions --date "<date>"                    # current user, or:
  cawplan session my-sessions --user-id "<resolved_user_id>" --from "<from>" --to "<to>"
  ```
- If more than one session comes back, present a numbered list (session_title, date/time,
  project, entry_id/unique_id) and ask which one to test — don't pick automatically. If exactly
  one, use it. If none, say so and ask for a different scope rather than guessing.

### 2. Fetch the full conversation

```bash
cawplan session conversation --entry-id "<entry_id>"
```

This returns `data.messages[]` — ordered `{role, time, text}` entries (the raw uploaded
conversation, not the human-input rows). Note the total message count and roughly how much of it
is `user` vs `assistant`.

If the response has no messages (empty conversation, or the session wasn't uploaded with
`include_conversation`), say so and stop — there's nothing to summarize.

### 3. Generate the summary yourself

Read `references/SESSION_SUMMARY_RULES.md` if you haven't already this session. Read through
`data.messages[]` in order and write the `summary` exactly as that doc describes: a narrative
prose recap (not bullets), up to ~800 words but proportional to the session's actual content,
matching the conversation's dominant language. Do this directly as a reasoning step — don't write
a script or call an external LLM API; you are the generator here, using the rules in the
reference doc.

### 4. Report

Show, in order:
- **Session identified**: entry_id, session_title (if known), date, message count.
- **The generated summary** in full.
- **A one-line self-assessment**: does the summary actually reflect the conversation (right
  artifacts named, right outcome stated), or did anything get invented/missed? This is a
  read-only sanity check, not a pass/fail gate — there is no cloud value to compare against yet.

## Notes

- This is display-only: it never writes anything back to CawPlan, and it doesn't compare against
  a cloud-persisted summary (the feature is new; historical sessions won't have one until they're
  reenriched). If you want to compare a *specific* session's cloud summary once it exists, use
  `cawplan session my-sessions` / the session detail endpoint directly and read `summary` from the
  response — this skill doesn't need to grow comparison logic for that.
- Very long sessions (many dozens of messages) are still fine to summarize directly in one pass
  for this manual test — production's map-reduce slicing is an LLM output-budget concern, not a
  requirement for a human/agent doing the same task by reading.

## References

- `references/SESSION_SUMMARY_RULES.md`
