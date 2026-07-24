# CawPlan Skills

AI agent skills and CLI tooling for CawPlan product release management workflows. Works with Claude Code, Cursor, Codex, and other agents that load Markdown-based skills.

## Install

```bash
npm install -g cawplan
npx skills add Ubiquiti-UID/flow-cawplan-skill --all -g -y
```

See `INSTALL.md` for all install options.

## Quick Start

```bash
cawplan auth login
cawplan auth status
cawplan products list --search "UniFi Access"
```

For CI or headless use: `cawplan auth configure` (API key).

## Skills

| # | Skill | Invoke | Description |
|---|-------|--------|-------------|
| 1 | `cawplan-ticket-create` | `/cawplan-ticket-create` | Create a ticket with details, assignee, and priority |
| 2 | `cawplan-product-report` | `/cawplan-product-report` | Product status report with progress, risk, and recommendations |
| 3 | `cawplan-product-insights` | `/cawplan-product-insights` | Product adoption, installations, user feedback, and critical issues |
| 4 | `cawplan-plan-create` | `/cawplan-plan-create` | Create a version plan with optional tickets |
| 5 | `cawplan-plan-track` | `/cawplan-plan-track` | Track release progress, risk, and open items |
| 6 | `cawplan-ticket-context` | `/cawplan-ticket-context` | Load CawPlan tickets into the current coding session context for daily report linkage |
| 7 | `cawplan-coding-commit` | `/cawplan-coding-commit` | Collect local agent data (Claude Code, Cursor, Codex) and upload a daily AI coding session report |
| 8 | `cawplan-coding-insights` | `/cawplan-coding-insights` | AI coding cost, token, and prompt quality insights across all dimensions |

## Quick Reference

| # | What you want | Example |
|---|---------------|---------|
| 1 | Create a ticket | `/cawplan-ticket-create create a HIGH bug for UniFi Access 4.1.10: door stuck after firmware update` |
| 2 | Product status report | `/cawplan-product-report show UniFi Access status report for last week` |
| 3 | Product health overview | `/cawplan-product-insights show UniFi Access product insights for last month` |
| 4 | Create a version plan | `/cawplan-plan-create create version plan for UniFi Access 4.2.0` |
| 5 | Track release progress | `/cawplan-plan-track track release progress for UniFi Access 4.1.10` |
| 6 | Load ticket context | `/cawplan-ticket-context https://app.cawplan.com/issue/CWP-14471 https://app.cawplan.com/issue/CWP-14472` |
| 7 | Collect & submit AI coding report | `/cawplan-coding-commit` |
| 8 | My session activity | `/cawplan-coding-insights show my own session activity for 2026-06-15` |

More examples: `COOKBOOK.md`.

For developer AI daily reporting, see `docs/AI_DAILY_REPORTING.md`.
Use `/cawplan-ticket-context` before or during ticket work so the next `/cawplan-coding-commit` report includes those tickets on the matching session's `ticket_ids`.

## Troubleshooting

- `Not authenticated` → run `cawplan auth login`
- `Session expired` → run `cawplan auth login`
- `API Key invalid` → run `cawplan auth configure`
- Browser did not open → copy the printed URL and open it manually
