# Installing CawPlan

## CLI

```bash
npm install -g cawplan
cawplan --version
```

## Agent Skills

**Recommended — install by product role**

```bash
cawplan auth login
cawplan skill update --dry-run   # preview
cawplan skill update
```

`cawplan skill update` reads your roles from the products you are a member of
(Product Settings → Owner / PM / R&D / QA / UX / Support / viewer) and installs
the union of skills for those roles. The mapping lives in
`cli/config/skill-roles.json`:

| Role | Skills |
|------|--------|
| owner | every default skill |
| pm | common + plan-create, plan-track, product-report, product-insights, metrics, risk-assessment |
| rd | common + coding-commit, coding-insights |
| qa | common + requirement-analyze, testpoint-generate, testcase-generate, testcase-import, testplan-layout, testrail-link, defect-ticket, test-execution-progress, ticket-report-generate, qa-commit, risk-assessment |
| ux | common + ux-tracking |
| support | common + support-metrics |
| viewer | ticket-context, my-work, product-report, product-insights, plan-track, coding-insights, ux-tracking, test-execution-progress, knowledge, metrics |

`common` = ticket-context, my-work, ticket-create, knowledge.

- `--role pm,qa` overrides detection; `--all` installs every default skill.
- CawPlan skills that are installed but no longer match your roles are listed,
  and uninstalled only after you confirm (or with `--prune`). Internal QA
  skills are never pruned.

**Option A — `npx skills add` (no git clone needed)**

```bash
npx skills add cawcut/skill-cawplan --all -g -y
```

Install only selected skills:

```bash
npx skills add cawcut/skill-cawplan --skill cawplan-ticket-create -g
```

**Optional — human-input classify QA** (not in the default Cursor/Codex plugin bundle):

```bash
npx skills add cawcut/skill-cawplan --skill cawplan-internal-qa-coding-humaninputs -g
npx skills add cawcut/skill-cawplan --skill cawplan-internal-qa-coding-humaninputs-test -g
npx skills add cawcut/skill-cawplan --skill cawplan-internal-qa-coding-humaninputs-sample -g
```

Or from a cloned repo: `./setup --optional-qa` (see `scripts/optional-skills.json`).

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

Flags: `--agent claude|cursor|codex`, `--all`, `--role <roles>`, `--optional-qa`, `--skip-cli`, `--skip-auth`.

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
