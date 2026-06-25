# Contributing

## Development

所有 npm 命令在 `cli/` 目录下运行。
```bash
# 首次安装 / 生产使用
npm install && npm run build && npm install -g .

# 开发中频繁改动（用 link 代替全局安装，rebuild 后立即生效）
npm install && npm run build && npm link

# 单独跑测试
npm test
```

**验证 skills（从仓库根目录运行）：**
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

### CLI npm release

1. Bump `cli/package.json` `version`.
2. Build and verify `cawplan --version`.
3. Run `npm test`.
