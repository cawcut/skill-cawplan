# Installing CawPlan CLI + Agent Skills

## Install The `cawplan` CLI

For local development, link the CLI workspace so the global `cawplan` command points at this repository:

```bash
npm install
npm run build
npm link --workspace=cli
cawplan --help
```

After the npm package is published, users can install it with:

```bash
npm install -g cawplan
```

## Install Agent Skills With `./setup` (Supported)

Clones the repo and symlinks skills into your agent config directory. It can also check whether `cawplan` is installed and whether auth is ready.

```bash
git clone git@github.com:Ubiquiti-UID/flow-cawplan-skill.git
cd flow-cawplan-skill
./setup
```

Flags:

| Flag | Effect |
|------|--------|
| `--agent claude\|cursor\|codex` | Force target agent; otherwise auto-detects from `~/.claude`, `~/.cursor`, `~/.codex` |
| `--all` | Install into all existing agent skill directories |
| `--skip-cli` | Do not try to install the published `cawplan` package |
| `--skip-auth` | Do not require `cawplan auth status` to succeed |

Update after `git pull`:

```bash
git pull && ./setup --skip-cli --skip-auth
```

Install into every existing agent directory:

```bash
./setup --all --skip-cli --skip-auth
```

## TODO: `npx skills`

Cross-agent skill install is planned but not ready yet.

```bash
npx skills add Ubiquiti-UID/flow-cawplan-skill
```

When this is enabled, it will still require CLI install and auth:

```bash
npm install -g cawplan
cawplan auth login
```

## TODO: `gh skill install` (Skills Only)

GitHub skill install support is planned but not verified yet. This path would install skills only; it would not install the CLI or run auth.

```bash
gh skill install Ubiquiti-UID/flow-cawplan-skill
gh skill install Ubiquiti-UID/flow-cawplan-skill --agent cursor --scope user
gh skill install ./path/to/skill --from-local --agent cursor --scope user --force
```

| | `npx skills add` | `./setup` | `gh skill install` |
|--|------------------|-----------|-------------------|
| Status | TODO | supported | TODO |
| Skill install | installer-managed | symlink to repo | copy into agent dir |
| CLI | not installed | optional `npm install -g cawplan` | not installed |
| Auth check | none | optional | none |
| Update | rerun `npx skills add Ubiquiti-UID/flow-cawplan-skill` | `git pull && ./setup` | `gh skill update Ubiquiti-UID/flow-cawplan-skill` |

## After Install

Use `README.md` for available skills and slash entries. Use `COOKBOOK.md` for task-oriented examples.

If a skill reports that `cawplan` is missing during local development, run `npm run build && npm link --workspace=cli`. After npm publish, use `npm install -g cawplan`. If authentication is missing, run `cawplan auth login` or `cawplan auth configure`.

## Local Test Flow

```bash
npm install
npm run build
npm link --workspace=cli
npm test
npm run validate:skills
npm run cli -- --help
./setup --all --skip-cli --skip-auth
```

Use proto/dev:

```bash
export CAWPLAN_ENV=proto
cawplan auth login
```
