# Install CawPlan Skills (Agent Guide)

When a user asks an AI agent to install CawPlan skills, follow `INSTALL.md`.

Quick path:

```bash
npm install -g cawplan
npx skills add Ubiquiti-UID/flow-cawplan-skill --all -y
cawplan auth login
cawplan auth status
```

Smoke test after install:

```text
/cawplan-query find product information for "UniFi Access"
```

If auth is not needed (CI/headless): `cawplan auth configure` instead of `cawplan auth login`.
