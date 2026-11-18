# Contributing

## Development

Run all npm commands in `cli/`.
```bash
# First install / production use
npm install && npm run build && npm install -g .

# Frequent changes during development (link instead of a global install; a rebuild takes effect at once)
npm install && npm run build && npm link

# Run the tests
npm test
```

Install local skill changes (run from the repository root):
```bash
# Install public skills for local development
npx skills add ./ -a cursor claude-code codex -g -y

```

**Validate skills (run from the repository root):**
```bash
bash scripts/validate-skills.sh
```

## Commit Messages

Conventional Commits: `<type>[scope]: <description>`

| Type | When |
|------|------|
| `feat` | New command, skill capability, or user-facing behavior |
| `fix` | Bug fix |
| `docs` | Docs only |
| `test` | Tests only |
| `refactor` | Internal cleanup, no behavior change |
| `chore` | Tooling, deps, maintenance |

Scopes: `cli`, `skills`, `setup`, `config`.

## Skill Layout

Each skill lives under `skills/<name>/SKILL.md`.

- `name` frontmatter must match the directory name.
- `version` must match root `VERSION`.
- `description` must include `Use when` and `NOT for` phrases.
- `allowed-tools: Bash`.
- `min_cli_version` is the oldest `cawplan` CLI the skill works with; `cawplan skill check` enforces it.
- No `../` parent-directory references.

## Versioning

Two independent version lines:

- **Skill package**: root `VERSION` + every `skills/*/SKILL.md` + plugin manifests.
- **CLI npm package**: `cli/package.json`.

### Skill package release

1. Update `VERSION`.
2. Sync `version` in every `skills/*/SKILL.md`.
3. Sync `version` in `.cursor-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.claude-plugin/marketplace.json`.
4. Run `bash scripts/validate-skills.sh`.

Release steps, the CLI/skills compatibility contract, and the changelog: `docs/RELEASING.md` and `CHANGELOG.md`.

### CLI npm release

1. Bump `cli/package.json` `version`.
2. Build and verify `cawplan --version`.
3. Run `npm test`.
