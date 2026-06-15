# CawPlan Skills

AI agent skills and CLI tooling for CawPlan product release management workflows. Works with Claude Code, Cursor, Codex, and other agents that load Markdown-based skills.

## Install

```bash
npm install -g cawplan
npx skills add Ubiquiti-UID/flow-cawplan-skill --all -y
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

| Skill | Invoke | Description |
|-------|--------|-------------|
| `cawplan-query` | `/cawplan-query` | Products, versions, releases, general read queries |
| `cawplan-ticket` | `/cawplan-ticket` | Ticket create, update, search, poll, relations |
| `cawplan-my-todos` | `/cawplan-my-todos` | Assigned tickets and critical issues |
| `cawplan-user-activity` | `/cawplan-user-activity` | User activity report over a date range |
| `cawplan-product-activity` | `/cawplan-product-activity` | Product activity report over a date range |
| `cawplan-critical` | `/cawplan-critical` | Critical issue search and detail |
| `cawplan-metrics` | `/cawplan-metrics` | Product metrics over a time range |
| `cawplan-analytics` | `/cawplan-analytics` | AI feedback analytics |
| `cawplan-qa-report` | `/cawplan-qa-report` | QA test reports |

## Quick Reference

| What you want | Example |
|---------------|---------|
| Find product info | `/cawplan-query find product information for "UniFi Access"` |
| Product activity last week | `/cawplan-product-activity show UniFi Access activity for last week` |
| Summarize a user's work | `/cawplan-user-activity summarize what user@ui.com did in the past two weeks` |
| Create a ticket | `/cawplan-ticket create a backlog ticket for UniFi Access: investigate door schedule issue` |
| Find critical issues | `/cawplan-critical search critical issues for UniFi Access in the last month` |
| Check metrics | `/cawplan-metrics show UniFi Access metrics for the last month` |

More examples: `COOKBOOK.md`.

## Troubleshooting

- `Not authenticated` → run `cawplan auth login`
- `Session expired` → run `cawplan auth login`
- `API Key invalid` → run `cawplan auth configure`
- Browser did not open → copy the printed URL and open it manually
