# CawPlan Skills

AI agent skills and CLI tooling for CawPlan product release management workflows. Works with Claude Code, Cursor, Codex, and other agents that load Markdown-based skills.

## Install

The supported local skill install path is `./setup` from a checked-out repository. `npx skills add` and `gh skill install` are TODO.

```bash
./setup
```

For local development, install this repo's CLI as the global `cawplan` command:

```bash
npm install
npm run build
npm link --workspace=cli
cawplan --help
```

Full install flags, local development setup, and planned installer paths are documented in `INSTALL.md`. Agent-specific install guidance is in `INSTALL_FOR_AGENTS.md`.

## Quick Start

For interactive use, log in with OAuth and verify the connection:

```bash
cawplan auth login
cawplan auth status
cawplan products list --search "UniFi Access"
```

For CI, automation, or headless agents, configure an API key:

```bash
cawplan auth configure
cawplan products list --search "UniFi Access"
```

## Authentication

`cawplan` supports two authentication modes:

- OAuth login: `cawplan auth login`, recommended for interactive developers.
- API key: `cawplan auth configure` or `CAWPLAN_API_KEY`, recommended for CI and headless agents.

OAuth access tokens are preferred when present. If an access token expires, the CLI attempts to refresh it automatically and retries the request. If refresh fails, run `cawplan auth login` again.

Credentials are stored in `~/.cawplan/credentials.json`.
The CLI also uses `~/.cawplan/cache.json` for local cache data.

## Environments

- `CAWPLAN_ENV`: selects the built-in environment from `cli/config/products.json` (`prd` by default, `proto` for dev/proto).
- `CAWPLAN_BASE_URL`: overrides the API base URL.
- `CAWPLAN_PORTAL_URL`: overrides the browser login portal URL.
- `CAWPLAN_API_KEY`: API-key fallback for non-interactive use.
- `CAWPLAN_CREDENTIALS_PATH`: overrides credentials file path, useful for tests.
- `CAWPLAN_CACHE_PATH`: overrides the cache file path.
- `CAWPLAN_CACHE_TTL_HOURS`: overrides cache TTL, default `12`.

Use `CAWPLAN_ENV=proto` for proto/dev testing:

```bash
CAWPLAN_ENV=proto cawplan auth login
CAWPLAN_ENV=proto cawplan products list --search "UniFi Access"
```

## CLI Commands

Common command groups:

- `cawplan auth login|configure|status|logout`
- `cawplan products list`
- `cawplan product-lines list|get|statuses`
- `cawplan versions list|create`
- `cawplan releases list`
- `cawplan tickets list|search|poll|create|update|relate`
- `cawplan backlog list|get`
- `cawplan critical list|search|get|product-line`
- `cawplan metrics get`
- `cawplan todos user`
- `cawplan users list|query`
- `cawplan activities query`
- `cawplan user-activity get`
- `cawplan product-activity get`
- `cawplan knowledge search`
- `cawplan api <method> <path>` for raw OpenAPI passthrough
- `cawplan cache clear`

Examples:

```bash
cawplan products list --search "UniFi Access"
cawplan versions list unifi-access
cawplan tickets search --product_ids unifi-access --time_range 1m
cawplan user-activity get --email user@ui.com --start 2026-06-01 --end 2026-06-10
cawplan product-activity get --product_id 0197e3c7-1717-7d07-8059-10dd9d95b26d --start 2026-06-01 --end 2026-06-10
cawplan knowledge search --product_id 0197e3c7-1717-7d07-8059-10dd9d95b26d --query "door schedule"
```

## Skills

This repo ships CLI-backed skills under `skills/cawplan-*`.

Versioning note:

- Skill package versioning uses root `VERSION` + `skills/*/SKILL.md` + plugin manifests.
- CLI npm package versioning uses `cli/package.json` and is intentionally independent.

| Skill | Invoke | Description |
|-------|--------|-------------|
| `cawplan-query` | `/cawplan-query` | Product, product line, version, release, and general read queries. |
| `cawplan-ticket` | `/cawplan-ticket` | Ticket create, update, search, poll, and relation workflows. |
| `cawplan-my-todos` | `/cawplan-todos` | Assigned tickets and critical issues for a user. |
| `cawplan-user-activity` | `/cawplan-user-activity` | User activity report by email or user ID over a date range. |
| `cawplan-product-activity` | `/cawplan-product-activity` | Product activity report over a date range, optionally scoped to a version. |
| `cawplan-critical` | `/cawplan-critical` | Critical issue search, list, detail, and product-line workflows. |
| `cawplan-metrics` | `/cawplan-metrics` | Product metrics over a time range. |

## Quick Reference

| What you want | Skill | Example |
|---------------|-------|---------|
| Find product information | `cawplan-query` | `/cawplan-query 查询名称为 "UniFi Access" 的 product 信息` |
| See product activity last week | `cawplan-product-activity` | `/cawplan-product-activity 查询 UniFi Access 上个星期的 activity` |
| Summarize a user's work | `cawplan-user-activity` | `/cawplan-user-activity 查询 user@ui.com 过去两周做了什么` |
| Create or update tickets | `cawplan-ticket` | `/cawplan-ticket create a backlog ticket for UniFi Access: investigate door schedule issue` |
| Find critical issues | `cawplan-critical` | `/cawplan-critical search critical issues for UniFi Access in the last month` |
| Check metrics | `cawplan-metrics` | `/cawplan-metrics show UniFi Access metrics for the last month` |

More task-oriented examples are in `COOKBOOK.md`.

Plugin manifests are included for:

- `.claude-plugin/`
- `.cursor-plugin/`
- `.codex-plugin/`

## Using In AI Agents

After installing the skills, use slash-style prompts in Claude/Cursor/Codex. The skill will run the matching `cawplan` CLI command for you:

```text
/cawplan-query products list --search "UniFi Access"
/cawplan-query 查询名称为“UniFi Access”的 product 信息
/cawplan-ticket create a backlog ticket for UniFi Access: investigate door schedule issue
```

Use the Skills table above for slash entries and `COOKBOOK.md` for task-oriented examples.

## Troubleshooting

- `Not authenticated. Run: cawplan auth login`: no usable credentials were found.
- `Session expired. Run: cawplan auth login`: OAuth refresh failed or the refreshed token was rejected.
- `API Key invalid. Run: cawplan auth configure`: API-key authentication returned 401.
- Browser did not open during login: copy the printed URL and open it manually.
- Wrong environment: set `CAWPLAN_ENV=proto` or override `CAWPLAN_BASE_URL` / `CAWPLAN_PORTAL_URL`.
