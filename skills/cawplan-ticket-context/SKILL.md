---
version: 0.2.7
name: cawplan-ticket-context
description: |
  Query one or more CawPlan tickets and show their current details in the conversation.
  Use when: the user gives or mentions CawPlan issue URLs, display IDs, or ticket unique IDs and wants ticket context. Automatically run when a CawPlan issue URL appears with no other workflow intent, even if the user did not explicitly ask to query ticket context.
  NOT for: creating tickets, updating tickets, product status reporting, codebase exploration, implementation, file edits, or SQA requirement analysis.
argument-hint: "[CawPlan issue URLs, display IDs, or unique IDs]"
allowed-tools: Bash
---

# CawPlan Ticket Context

## Bootstrap

```bash
cawplan skill check
```

## Workflow

Use this skill when the user invokes `/cawplan-ticket-context`, asks to query ticket context, or mentions a CawPlan issue URL in the session.

Automatically trigger this skill when the user message contains a CawPlan issue URL such as `https://app.cawplan.com/issue/CWP-14471` or `https://core-web-product.uid.dev.ui.com/issue/CAW-04560` **and** they are not asking for SQA requirement analysis, five-field structuring, module-tree selection, or QA Insights archiving — use `cawplan-requirement-analyze` for those. Do not wait for an explicit `/cawplan-ticket-context` command when only a bare issue URL is pasted.

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

After showing the ticket details, stop. Do not write local ticket-context files or continue into another workflow unless the user explicitly asks for that follow-up.

## Response

After the search succeeds, summarize:

- Queried ticket display IDs and unique IDs.
- Show each ticket's title and content/description returned by `cawplan tickets search` so the current session has the ticket requirements in visible context.
- Show each ticket's `progress_comment` as current progress when present. If it is empty or absent, state that no current progress summary was returned.
- End the turn after displaying the ticket context unless the user explicitly requested additional work.

