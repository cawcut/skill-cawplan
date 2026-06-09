# Install CawPlan Skills For Agents

Use this guide when a user asks an AI agent to install CawPlan skills.

## Goal

Install the Markdown skills, ensure the `cawplan` CLI is available, authenticate, and run a smoke test.

## Install CLI For Local Development

When working from this repository, install the local CLI workspace before testing skills:

```bash
npm install
npm run build
npm link --workspace=cli
cawplan --help
```

## Preferred Path

Use the repository setup script. Do not use `npx skills add` or `gh skill install` yet; both are TODO.

```bash
./setup --all
cawplan auth status
cawplan products list --search "UniFi Access"
```

If the CLI and auth are already ready:

```bash
./setup --all --skip-cli --skip-auth
```

Install for one agent only:

```bash
./setup --agent cursor --skip-cli --skip-auth
./setup --agent claude --skip-cli --skip-auth
./setup --agent codex --skip-cli --skip-auth
```

## Verify Skills

After installation, ask the target agent to run one of these prompts:

```text
/cawplan-query products list --search "UniFi Access"
/cawplan-product-activity 查询 UniFi Access 上个星期的 activity
/cawplan-user-activity --email user@ui.com --start 2026-06-01 --end 2026-06-10
```

## Troubleshooting

- If `cawplan` is missing in local development, run `npm run build && npm link --workspace=cli`.
- After the npm package is published, users can install it with `npm install -g cawplan`.
- If auth is missing, run `cawplan auth login` or `cawplan auth configure`.
- If product/activity calls hit the wrong environment, set `CAWPLAN_ENV=proto` or override `CAWPLAN_BASE_URL`.
