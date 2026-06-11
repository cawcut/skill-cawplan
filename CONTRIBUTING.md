# Contributing

## Commit Messages

This repo follows Conventional Commits.

```text
<type>[optional scope]: <description>
```

Common types:

| Type | When to use |
|------|-------------|
| `feat` | New CLI command, skill capability, or user-facing behavior |
| `fix` | Bug fix |
| `docs` | README, skill docs, references only |
| `test` | Tests only |
| `refactor` | Internal cleanup, no behavior change |
| `ci` | GitHub Actions or validation |
| `chore` | Tooling, deps, maintenance |

Recommended scopes:

| Scope | Path |
|-------|------|
| `cli` | `cli/src/`, `cli/config/`, CLI behavior |
| `skills` | `skills/cawplan-*/` |
| `setup` | `setup`, `INSTALL.md` |
| `config` | `cli/config/products.json`, env profiles |

Examples:

```text
feat(cli): add cawplan auth login with OAuth callback
fix(cli): retry refresh token once on 401
feat(skills): split and package CawPlan agent skills
docs: document CAWPLAN_ENV proto workflow
ci: validate skill metadata on pull requests
```

## Skill Layout

Each skill lives under `skills/<name>/` with a required `SKILL.md`.

- Frontmatter `name` must match the directory name.
- `version` must match root `VERSION`.
- `description` must include `Use when` trigger phrases and a `NOT for` boundary.
- `allowed-tools` must be `Bash`.
- Avoid `../` parent-directory references; installed skills should be self-contained.

## Versioning Model

This repository has two independent version lines:

- **Skill package version**: root `VERSION`, every `skills/*/SKILL.md` frontmatter `version`, and plugin manifest versions (`.cursor-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.claude-plugin/marketplace.json`).
- **CLI package version**: `cli/package.json` `version` (the npm package version shown by `cawplan --version`).

These two version lines do **not** need to be numerically equal.

## Development

```bash
npm install
npm run build
npm test
npm run validate:skills
```

## Version Bumps

### Skill package release

1. Update `VERSION`.
2. Sync `version` in every `skills/*/SKILL.md`.
3. Sync `version` in `.cursor-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, and `.claude-plugin/marketplace.json`.
4. Run `npm run validate:skills`.

### CLI npm release

1. Bump `cli/package.json` `version`.
2. Build and verify `cawplan --version`.
3. Run CLI tests (`npm test` and CLI smoke checks).
