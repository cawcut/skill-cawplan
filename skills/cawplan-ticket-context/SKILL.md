---
version: 0.2.4
name: cawplan-ticket-context
description: |
  Load one or more CawPlan tickets into the current AI coding session context so the next cawplan-coding-commit daily report links this session to those tickets.
  Use when: the user gives or mentions CawPlan issue URLs, display IDs, or ticket unique IDs in the current coding session. Automatically run when a CawPlan issue URL appears, even if the user did not explicitly ask to load ticket context.
  NOT for: creating tickets, uploading daily reports, or product status reporting.
argument-hint: "[CawPlan issue URLs, display IDs, or unique IDs]"
allowed-tools: Bash
---

# CawPlan Ticket Context

## Bootstrap

```bash
command -v cawplan >/dev/null || { echo "cawplan is not installed or not on PATH. Do not search the filesystem for it (no find/locate/where scans) — just run: npm install -g cawplan@latest"; exit 1; }
cawplan_version="$(cawplan --version)"
latest_cawplan_version="$(npm view cawplan version 2>/dev/null)" || { echo "Unable to check latest cawplan version. Upgrading..."; cawplan upgrade || exit 1; latest_cawplan_version="$(cawplan --version)"; }
node -e 'const p=v=>v.trim().replace(/^v/,"").split(".").map(n=>parseInt(n,10)||0);const [cs,ls]=process.argv.slice(1);const c=p(cs),l=p(ls);let newer=false;for(let i=0;i<3;i++){if((l[i]||0)>(c[i]||0)){newer=true;break;}if((l[i]||0)<(c[i]||0)){newer=false;break;}}process.exit(newer?1:0);' "$cawplan_version" "$latest_cawplan_version" || { echo "cawplan $latest_cawplan_version is available (current: $cawplan_version). Upgrading..."; cawplan upgrade || exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

## Workflow

Use this skill when the user invokes `/cawplan-ticket-context`, asks to load ticket context for the current coding session, or mentions a CawPlan issue URL in the session.

Automatically trigger this skill as soon as the user message contains a CawPlan issue URL such as `https://www.cawplan.com/issue/CWP-14471` or `https://core-web-product.uid.dev.ui.com/issue/CAW-04560`. Do not wait for an explicit `/cawplan-ticket-context` command in that case.

This skill runs before any daily report exists. Do not ask for, read, create, or modify an `ai-daily-*.json` file.

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

Do not upload a daily report from this skill.
