# Installing CawPlan

## CLI

```bash
npm install -g cawplan
cawplan --version
```

## Agent Skills

**Option A — `npx skills add` (recommended, no git clone needed)**

```bash
npx skills add Ubiquiti-UID/flow-cawplan-skill --all -y
```

Install only selected skills:

```bash
npx skills add Ubiquiti-UID/flow-cawplan-skill --skill cawplan-query --skill cawplan-ticket -g
```

Update to latest:

```bash
npx skills update
```

**Option B — `./setup` (from a cloned repo)**

```bash
git clone git@github.com:Ubiquiti-UID/flow-cawplan-skill.git
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
/cawplan-query find product information for "UniFi Access"
```
