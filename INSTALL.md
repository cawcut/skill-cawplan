# Installing CawPlan

## CLI

```bash
npm install -g cawplan
cawplan --version
```

## Agent Skills

**Option A — `npx skills add` (recommended, no git clone needed)**

```bash
npx skills add cawcut/skill-cawplan --all -g -y
```

Install only selected skills:

```bash
npx skills add cawcut/skill-cawplan --skill cawplan-ticket-create -g
```

Update to latest:

```bash
npx skills update
```

**Option B — `./setup` (from a cloned repo)**

```bash
git clone git@github.com:cawcut/skill-cawplan.git
cd flow-cawplan-skill
./setup
```

Flags: `--agent claude|cursor|codex`, `--all`, `--skip-cli`, `--skip-auth`.

## After Install

Authenticate and verify:

```bash
cawplan auth login
cawplan auth status
cawplan products list --search "UniFi Access"
```

Then try a skill:

```text
/cawplan-product-report show UniFi Access status report for last week
```
