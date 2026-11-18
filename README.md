# CawPlan Skills

AI agent skills, the `cawplan` CLI and the CawPlan MCP server for CawPlan product release management workflows. Works with Claude Code, Claude, Cursor, Codex, VS Code and other agents that load Markdown-based skills or connect to MCP servers.

## Install

```bash
npm install -g cawplan
cawplan auth login
cawplan skill update
```

`cawplan skill update` installs only the skills for your product roles (Owner / PM / R&D / QA / UX / Support / viewer).
See `INSTALL.md` for the role mapping and all install options.

## Quick Start

```bash
cawplan auth login
cawplan auth status
cawplan products list --search "UniFi Access"
```

## Use with MCP (no CLI)

Agents without a shell (for example Claude on the web) can use the CawPlan MCP
server instead of the CLI; the skills pick the route themselves.

- URL: `https://api.cawplan.com/core-product/api/v1/public/openapi/mcp` (streamable HTTP)
- Sign-in: OAuth in the browser, no API key
- Claude Code: `claude mcp add --transport http cawplan https://api.cawplan.com/core-product/api/v1/public/openapi/mcp`, then `/mcp` to sign in

One-click setup for Claude, Cursor, VS Code and Codex, what still needs the CLI,
and troubleshooting: [MCP.md](MCP.md).

## Skills

`cawplan skill update` installs the skills that match your product roles; see
[INSTALL.md](INSTALL.md#agent-skills) for the role mapping.

**Everyone**

| Skill | Description |
|-------|-------------|
| `/cawplan-ticket-create` | Create tickets from a request or from a PRD, Slack thread or meeting notes; split work into sub-tickets |
| `/cawplan-ticket-context` | Load CawPlan tickets into the current session so the daily coding report links them |
| `/cawplan-ticket-attachments` | List and download a ticket's attachments, or add local files, a folder or a Markdown write-up to a ticket |
| `/cawplan-my-work` | Your tickets and critical issues, open work by priority, and your recent status changes |
| `/cawplan-knowledge` | Browse and search the CawPlan knowledge base; create datasets and upload documents |

**Product management**

| Skill | Description |
|-------|-------------|
| `/cawplan-plan-create` | Create a version plan, optionally with tickets extracted from goals or OKRs |
| `/cawplan-plan-track` | Track release progress, risk, open items and stale tickets for a version |
| `/cawplan-product-report` | Product status report with progress, risk and recommendations |
| `/cawplan-product-insights` | Product health overview: user feedback trends and critical issues |
| `/cawplan-metrics` | Query, chart or record business metrics (subscriptions, tickets, QA, workflows, tokens, API usage) |
| `/cawplan-risk-assessment` | Compute a version's release risk with the QA Insights rules and save the confirmed assessment |

**Engineering**

| Skill | Description |
|-------|-------------|
| `/cawplan-coding-commit` | Collect local Claude Code, Cursor and Codex sessions and upload a daily AI coding report |
| `/cawplan-coding-insights` | AI coding cost, token, session and prompt-quality insights by member, model, agent or product |
| `/cawplan-coding-recall` | Recall the team's confirmed coding experience for the current repository's product; owners review candidates |

**QA**

| Skill | Description |
|-------|-------------|
| `/cawplan-requirement-analyze` | Analyze requirement material into five fields and save it as a QA Insights requirement |
| `/cawplan-testpoint-generate` | Generate test points for a saved requirement and save them after QA review |
| `/cawplan-testcase-generate` | Expand saved test points into executable test cases and export CSV |
| `/cawplan-testcase-import` | Import test cases from CawPlan into TestRail, with a preview first |
| `/cawplan-testplan-layout` | Build TestRail test plans for a version or ticket from imported cases, with a preview first |
| `/cawplan-testrail-link` | Link TestRail cases, plans or runs created by hand back to CawPlan, or unlink wrong mappings |
| `/cawplan-test-execution-progress` | TestRail execution progress for a version or run: execution rate, pass rate, failures and per-ticket tables |
| `/cawplan-defect-ticket` | File or link CawPlan defects from failed or blocked TestRail results |
| `/cawplan-ticket-report-generate` | Generate and save a progress or completion QA report for a ticket and version |
| `/cawplan-qa-commit` | Collect and upload the daily QA session report |

**UX and Support**

| Skill | Description |
|-------|-------------|
| `/cawplan-ux-tracking` | Find tickets that need UX design, by version, priority or Team |
| `/cawplan-support-metrics` | Export, import and reconcile Support Ops ticket metrics safely |

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
| 9 | Analyze and archive a requirement | `/cawplan-requirement-analyze analyze this ticket CAWP-04606 into five fields` |
| 10 | Generate test points for a requirement | `/cawplan-testpoint-generate generate test points for requirement 019fb63e-d5ad-7cb7-8b5f-761ceeb50c0a` |
| 11 | Generate test cases and export CSV | `/cawplan-testcase-generate generate test cases from the test points above` |
| 12 | See my own tasks | `/cawplan-my-work what's on my plate for UniFi Access 4.1.10?` |
| 13 | Find tickets needing UX | `/cawplan-ux-tracking which high-priority tickets need UX but don't have a design yet?` |
| 14 | Import Support metrics | `/cawplan-support-metrics validate this Support Ops metrics export, dry-run only` |
| 15 | Add files to a ticket | `/cawplan-ticket-attachments add the screenshots and logs in ./qa-results to CWP-14471` |
| 16 | Recall team experience | `/cawplan-coding-recall approval resume loses form context after a retry` |

More examples: `COOKBOOK.md`.

Use `/cawplan-ticket-context` before or during ticket work so the next `/cawplan-coding-commit` report includes those tickets on the matching session's `ticket_ids`.

## Troubleshooting

- `Not authenticated` → run `cawplan auth login`
- `Session expired` → run `cawplan auth login`
- Browser did not open → copy the printed URL and open it manually
- On your own computer, `cawplan auth login` opens the browser and the browser returns to the CLI by itself; no code is typed
- Browser on another device (SSH, Codespaces, no display) → `cawplan auth login` switches to a sign-in code automatically; force it with `cawplan auth login --no-browser`, open the printed URL on any device and enter the code the CLI shows
- Agent or sandbox that cannot wait → `cawplan auth login --device-auth`, approve the printed URL on any device, then `cawplan auth login --device-auth --complete`

## Support, security and license

- Help and bug reports: [SUPPORT.md](SUPPORT.md)
- Report a vulnerability privately: [SECURITY.md](SECURITY.md)
- Data handling: [PRIVACY.md](PRIVACY.md)
- License: [MIT](LICENSE)

