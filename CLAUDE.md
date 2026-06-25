# CLAUDE.md — CawPlan Skills

Guidance for Claude Code and compatible agents when working in this repository.

## What This Is

Two deliverables:

1. `cawplan` CLI: TypeScript/npm binary for OAuth, API-key auth, and CawPlan Open API commands.
2. Agent skills: Markdown instruction packs under `skills/` that tell agents how to invoke the CLI.

Skills are not an MCP server. Agents execute local `cawplan` processes; skill files are routing and UX instructions only.

## Repository Structure

```text
flow-cawplan-skill/
├── cli/                      # npm package — the cawplan binary
│   ├── src/commands/
│   └── src/lib/
├── skills/
│   ├── cawplan-ticket-create/
│   ├── cawplan-product-report/
│   ├── cawplan-product-insights/
│   ├── cawplan-plan-create/
│   ├── cawplan-plan-track/
│   ├── cawplan-coding-commit/
│   └── cawplan-coding-insights/
├── .claude-plugin/
├── .cursor-plugin/
└── .codex-plugin/
```

## API Conventions

All skills route through `cawplan`. Do not call CawPlan HTTP APIs directly from skills; the CLI handles OAuth, refresh, API-key fallback, and errors.

| Concern | Convention |
|---------|------------|
| Auth | `cawplan auth login` (OAuth) or `cawplan auth configure` (API key) |
| Credentials | `~/.cawplan/credentials.json`, mode `0600` |
| Environment | `CAWPLAN_ENV=prd|proto`; overrides via `CAWPLAN_BASE_URL` / `CAWPLAN_PORTAL_URL` |
| Raw escape hatch | `cawplan api <method> <path>` |

## Development

```bash
# 验证 skills（从仓库根目录运行）
bash scripts/validate-skills.sh

# npm 单独跑测试
cd cli && npm install && npm run build && npm test
```

## Skill Authoring Rules

- Keep each `SKILL.md` concise.
- Include bootstrap checks for `cawplan` installation and auth.
- Prefer CLI commands over direct HTTP.
- Link to `references/` docs for endpoint details.
- Run `bash scripts/validate-skills.sh` before committing.
