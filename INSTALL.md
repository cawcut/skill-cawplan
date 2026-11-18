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
| rd | common + coding-commit, coding-insights, coding-recall |
| qa | common + requirement-analyze, testpoint-generate, testcase-generate, testcase-import, testplan-layout, testrail-link, defect-ticket, test-execution-progress, ticket-report-generate, qa-commit, risk-assessment |
| ux | common + ux-tracking |
| support | common + support-metrics |
| viewer | ticket-context, my-work, product-report, product-insights, plan-track, coding-insights, ux-tracking, test-execution-progress, knowledge, metrics |

`common` = ticket-context, ticket-attachments, my-work, ticket-create, knowledge.
`viewer` does not get `common`; it gets only the skills listed in its row.

- `--role pm,qa` overrides detection; `--all` installs every default skill.
- CawPlan skills that are installed but no longer match your roles are listed,
  and uninstalled only after you confirm (or with `--prune`). Optional skills are retained.

**Option A — `npx skills add` (no git clone needed)**

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
git clone https://github.com/cawcut/skill-cawplan.git
cd skill-cawplan
./setup
```

Flags: `--agent claude|cursor|codex`, `--all`, `--role <roles>`, `--skip-cli`, `--skip-auth`.

On Windows (PowerShell or cmd), run `node setup.mjs` with the same flags. It needs Node.js 22.13+
and links skills with directory junctions, so no administrator rights or Developer Mode are needed.

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

## MCP server (no CLI)

Agents without a shell (for example Claude on the web) can use the CawPlan MCP
server instead of the `cawplan` CLI. Install the skill files as in
[Agent Skills](#agent-skills); each skill picks the CLI or the MCP route itself.

Endpoint, OAuth sign-in, one-click setup for Claude Code, Claude, Cursor,
VS Code and Codex, what still needs the CLI, and troubleshooting:
[MCP.md](MCP.md).

## Private and development environments

Only public production and localhost defaults are stored in the repository.
To use a private environment, add a profile to your local `~/.cawplan/config.json`
(merge it into the existing file; keep permissions at `0600`):

```json
{
  "env": "proto",
  "environments": {
    "proto": {
      "apiBase": "https://your-api.example.com/core-product",
      "portalBase": "https://your-portal.example.com"
    }
  }
}
```

Replace the example URLs with endpoints provided privately by your administrator.
Then run `cawplan config env proto` and authenticate for that environment.
A previously selected profile without configured URLs produces an error; it does
not silently switch to production. Never commit local configuration or credentials.
