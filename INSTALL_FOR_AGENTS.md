# Install CawPlan Skills (Agent Guide)

When a user asks an AI agent to install CawPlan skills, follow `INSTALL.md`.

Quick path:

```bash
npm install -g cawplan
npx skills add cawcut/skill-cawplan --all -g -y
cawplan auth login
cawplan auth status
```

Smoke test after install:

```text
/cawplan-product-report show UniFi Access status report for last week
```

Authenticate with `cawplan auth login` before running CawPlan commands.
