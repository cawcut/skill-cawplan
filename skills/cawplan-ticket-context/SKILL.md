---
version: 0.2.6
name: cawplan-ticket-context
description: |
  Load one or more CawPlan tickets into the current AI coding session context so the next cawplan-coding-commit daily report links this session to those tickets.
  Use when: the user gives or mentions CawPlan issue URLs, display IDs, or ticket unique IDs in the current coding session. Automatically run when a CawPlan issue URL appears, even if the user did not explicitly ask to load ticket context.
  NOT for: creating tickets, uploading daily reports, product status reporting, codebase exploration, implementation, or file edits.
argument-hint: "[CawPlan issue URLs, display IDs, or unique IDs]"
allowed-tools: Bash
---

# CawPlan Ticket Context

## Bootstrap

```bash
cawplan skill check
```

## Workflow

Use this skill when the user invokes `/cawplan-ticket-context`, asks to load ticket context for the current coding session, or mentions a CawPlan issue URL in the session.

Automatically trigger this skill as soon as the user message contains a CawPlan issue URL such as `https://app.cawplan.com/issue/CWP-14471` or `https://core-web-product.uid.dev.ui.com/issue/CAW-04560`. Do not wait for an explicit `/cawplan-ticket-context` command in that case.

This skill runs before any daily report exists. Do not ask for, read, create, or modify an `ai-daily-*.json` file.

This skill is display-only. After looking up and showing the ticket details, stop. Do not inspect the repository, search source files, infer an implementation plan, run tests, edit files, commit changes, or continue into another workflow unless the user explicitly asks for that follow-up work.

Accept any mix of:
- CawPlan issue URLs, for example `https://app.cawplan.com/issue/CAWP-13477`
- Product issue URLs, for example `https://core-web-product.uid.dev.ui.com/issue/CAW-04560`
- Ticket display IDs, for example `CAWP-13477`, `CAW-04560`, or any `PREFIX-123` style ID
- Ticket unique IDs

Do not infer ticket IDs from a fixed prefix list. Display ID prefixes vary by product (`CAW`, `CAWP`, and others). Treat a token as a display ID when it matches the structural pattern `^[A-Za-z][A-Za-z0-9]+-\d+$`, or when it is extracted from a URL path segment like `/issue/<display-id>`. Validate candidates by running `cawplan tickets search`; if the search returns no result, report that no matching ticket was found instead of guessing a different prefix.

First, look up ticket details with `cawplan tickets search` and show the returned ticket information to the user. For display IDs, use the exact `--display_ids` form:

```bash
cawplan tickets search --display_ids CAW-04560
```

For multiple display IDs, pass them together:

```bash
cawplan tickets search --display_ids CAWP-13477,CAW-04560
```

If the user provided CawPlan issue URLs, extract their display IDs before searching. If the user provided only unique IDs and no display IDs, search them with `cawplan tickets search --unique_ids ...` and show the returned ticket information. If the input has both display-ID-shaped refs and non-display refs, search display IDs with `--display_ids` and unique IDs with `--unique_ids`.

After showing the ticket details, keep the ticket refs visible in the conversation. Do not write local ticket-context files. During `/cawplan-coding-commit`, `cawplan session collect` parses the session's `human_inputs` for `ticket_id`, `ticket_display_id`, CawPlan issue URLs, or display IDs and attaches resolved ticket IDs to the daily report session item's `ticket_ids` field. Cross-product ticket refs are preserved for review in the Web assignment page; tickets are allowed when they belong to the selected product or another product in the same product line, and the page warns and blocks saving only for refs outside that product line.

## Response

After the search succeeds, summarize:

- Loaded ticket display IDs and unique IDs.
- Show each ticket's title and content/description returned by `cawplan tickets search` so the current session has the ticket requirements in visible context.
- Show each ticket's `progress_comment` as current progress when present. If it is empty or absent, state that no current progress summary was returned.
- State that the next `/cawplan-coding-commit` daily report will include these ticket IDs if the ticket refs remain in the session's human inputs.
- End the turn after displaying the ticket context unless the user explicitly requested additional work.

Do not upload a daily report from this skill.
