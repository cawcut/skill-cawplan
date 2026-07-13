---
version: 0.2.4
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

Automatically trigger this skill as soon as the user message contains a CawPlan issue URL such as `https://www.cawplan.com/issue/CWP-14471` or `https://core-web-product.uid.dev.ui.com/issue/CAW-04560`. Do not wait for an explicit `/cawplan-ticket-context` command in that case.

This skill runs before any daily report exists. Do not ask for, read, create, or modify an `ai-daily-*.json` file.

This skill is display-only. After looking up and showing the ticket details, stop. Do not inspect the repository, search source files, infer an implementation plan, run tests, edit files, commit changes, or continue into another workflow unless the user explicitly asks for that follow-up work.

Accept any mix of:
- CawPlan issue URLs, for example `https://www.cawplan.com/issue/CAW-04560`
- Product issue URLs, for example `https://core-web-product.uid.dev.ui.com/issue/CAW-04560`
- Ticket display IDs, for example `CAW-04560`
- Ticket unique IDs

First, look up ticket details with `cawplan tickets search` and show the returned ticket information to the user. For display IDs, use the exact `--display_ids` form:

```bash
cawplan tickets search --display_ids CAW-04560
```

For multiple display IDs, pass them together:

```bash
cawplan tickets search --display_ids CAW-04560,CAW-04561
```

If the user provided CawPlan issue URLs, extract their display IDs before searching. If the user provided only unique IDs and no display IDs, search them with `cawplan tickets search --unique_ids ...` and show the returned ticket information.

After showing the ticket details, keep the ticket refs visible in the conversation. Do not write local ticket-context files. During `/cawplan-coding-commit`, `cawplan session collect` parses the session's `human_inputs` for `ticket_id`, `ticket_display_id`, CawPlan issue URLs, or display IDs and attaches matching ticket IDs to the daily report session item's `ticket_ids` field only when the resolved ticket `product_id` matches the session `product_id`.

## Response

After the search succeeds, summarize:

- Loaded ticket display IDs and unique IDs.
- Show each ticket's title and content/description returned by `cawplan tickets search` so the current session has the ticket requirements in visible context.
- Show each ticket's `progress_comment` as current progress when present. If it is empty or absent, state that no current progress summary was returned.
- State that the next `/cawplan-coding-commit` daily report will include these ticket IDs if the ticket refs remain in the session's human inputs.
- End the turn after displaying the ticket context unless the user explicitly requested additional work.

Do not upload a daily report from this skill.
