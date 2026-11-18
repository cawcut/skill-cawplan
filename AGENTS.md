# AGENTS.md — CawPlan Skills

Guidance for Codex and compatible agents when working in this repository.

## What This Is

Two deliverables:

1. `cawplan` CLI: TypeScript/npm binary for OAuth sign-in and CawPlan Open API commands.
2. Agent skills: Markdown instruction packs under `skills/` that tell agents how to invoke the CLI.

Skills are not an MCP server. Agents execute local `cawplan` processes or, where no CLI is available (for example Claude on the web), call the CawPlan MCP server; skill files are routing and UX instructions only.

## Repository Structure

```text
flow-cawplan-skill/
├── cli/                      # npm package — the cawplan binary
│   ├── config/               # skill-roles.json and other shipped config
│   ├── src/commands/
│   └── src/lib/
├── skills/                   # one directory per skill: cawplan-<name>/SKILL.md
│                             # (+ optional references/ and scripts/)
├── references/               # CAPABILITIES.md, capabilities.json, mcp-tools.json, ...
├── scripts/                  # validators, capability renderer, public publisher
├── docs/                     # internal design and reporting docs (not published)
├── .claude-plugin/
├── .codex-plugin/
├── .cursor-plugin/
├── README.md  INSTALL.md  MCP.md  COOKBOOK.md
└── LICENSE  SECURITY.md  SUPPORT.md  PRIVACY.md
```

The skill list, grouped by role, is in `README.md`; the role → skill mapping is
`cli/config/skill-roles.json`. Internal skills (`cawplan-internal-*`) are
optional and never published.

## API Conventions

Skills route through the `cawplan` CLI or, when there is no shell, the CawPlan MCP server (route rules: `references/CAPABILITIES.md`; MCP setup: `MCP.md`). Do not call CawPlan HTTP APIs directly from skills; the CLI handles OAuth sign-in, token refresh, and errors. Both routes use OAuth; there is no API-key auth.

| Concern | Convention                                                           |
|---------|----------------------------------------------------------------------|
| Auth | `cawplan auth login` (OAuth)                                         |
| Credentials | `~/.cawplan/credentials.json`, mode `0600`                           |
| Environment | `cawplan config env prd/proto/local` writes `~/.cawplan/config.json` |
| Raw escape hatch | `cawplan api <method> <path>`                                        |

## Development

```bash
# Validate skills (run from the repository root)
bash scripts/validate-skills.sh

# Run the CLI tests
cd cli && npm install && npm run build && npm test
```

## Skill Authoring Rules

- Keep each `SKILL.md` concise.
- Include bootstrap checks for `cawplan` installation and auth.
- Prefer CLI commands over direct HTTP.
- Transport-neutral skills (pilot: `cawplan-ticket-context`) name capabilities such as capability `tickets.search` and reference `references/CAPABILITIES.md` instead of CLI commands or MCP tools. Edit `references/capabilities.json`, run `python3 scripts/capabilities.py render`, and refresh `references/mcp-tools.json` with `python3 scripts/capabilities.py sync-mcp --core-product <path>` when the MCP tool set changes.
- Link to `references/` docs for endpoint details.
- Plugin manifest skill lists (`.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `scripts/optional-skills.json`) are generated: assign a new skill to a role (or `optional`) in `cli/config/skill-roles.json`, then run `python3 scripts/manifests.py render`. Do not edit those lists by hand.
- Run `bash scripts/validate-skills.sh` before committing.
