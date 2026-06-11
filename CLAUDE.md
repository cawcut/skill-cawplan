# CLAUDE.md — CawPlan Skills

Guidance for Claude Code and compatible agents when working in this repository.

## What This Is

This repo ships two deliverables:

1. `cawplan` CLI: TypeScript/npm binary for OAuth, API-key auth, and CawPlan Open API commands.
2. Agent skills: Markdown instruction packs under `skills/` that tell agents how to invoke the CLI.

Skills are not an MCP server. Agents execute local `cawplan` processes; skill files are routing and UX instructions only.

## Repository Structure

```text
flow-cawplan-skill/
├── README.md
├── INSTALL.md
├── CONTRIBUTING.md
├── VERSION
├── setup
├── scripts/validate-skills.sh
├── cli/
│   ├── package.json
│   ├── tsconfig.json
│   ├── config/products.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── commands/
│   │   └── lib/
│   └── tests/
├── skills/
│   ├── cawplan-query/
│   ├── cawplan-ticket/
│   ├── cawplan-my-todos/
│   ├── cawplan-user-activity/
│   ├── cawplan-product-activity/
│   ├── cawplan-critical/
│   └── cawplan-metrics/
├── .claude-plugin/
├── .cursor-plugin/
└── .codex-plugin/
```

## API Conventions

All skills route through `cawplan`. Do not call CawPlan HTTP APIs directly with `curl` from skills unless debugging; the CLI handles OAuth, refresh, API-key fallback, and readable errors.

| Concern | Convention |
|---------|------------|
| Auth | `cawplan auth login` or `cawplan auth configure` |
| Credentials | `~/.cawplan/credentials.json`, mode `0600` |
| Environment | `CAWPLAN_ENV=prd|proto`; overrides via `CAWPLAN_BASE_URL` and `CAWPLAN_PORTAL_URL` |
| Raw escape hatch | `cawplan api <method> <path>` |

## Development Commands

```bash
npm install
npm run build
npm test
npm run validate:skills
```

Use a test credentials path when running CLI tests that write credentials:

```bash
export CAWPLAN_CREDENTIALS_PATH=/tmp/cawplan-test-credentials.json
```

## Skill Authoring Rules

- Keep each `SKILL.md` concise.
- Include bootstrap checks for `cawplan` installation and auth.
- Prefer CLI commands over direct HTTP.
- Link to `references/` docs for endpoint details.
- Run `npm run validate:skills` before committing.
