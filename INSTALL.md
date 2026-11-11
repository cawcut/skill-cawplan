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
git clone git@github.com:cawcut/skill-cawplan.git
cd flow-cawplan-skill
./setup
```

Flags: `--agent claude|cursor|codex`, `--all`, `--role <roles>`, `--skip-cli`, `--skip-auth`.

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
server instead of the `cawplan` CLI. The skills work on both: each one names
capabilities, not commands, and picks the route itself. It uses the CLI when
`cawplan skill check` passes, otherwise the CawPlan MCP tools. See
[`references/CAPABILITIES.md`](references/CAPABILITIES.md) for the route rules
and the capability → CLI command / MCP tool table.

Install the skill files as in [Agent Skills](#agent-skills).

### Endpoint and sign-in

- **URL**: `https://api.cawplan.com/core-product/api/v1/public/openapi/mcp`.
  For a private environment, append `/api/v1/public/openapi/mcp` to that
  environment's API base (the `apiBase` of its profile; see
  [Private and development environments](#private-and-development-environments)).
- **Transport**: streamable HTTP.
- **Authentication**: OAuth 2.1 with PKCE and dynamic client registration. The
  client opens a CawPlan sign-in and consent page; there is no API key or client
  ID to configure. Tokens carry your own CawPlan permissions.
- **Session length**: the client refreshes its token by itself. Sign in again
  after 30 days without use, and at least every 90 days.
- **Accepted callbacks**: local clients (`http://localhost`, `127.0.0.1` or
  `[::1]`, any port) and the hosted clients claude.ai, claude.com and
  chatgpt.com. Other hosted clients are rejected at registration.

The MCP server is enabled per environment. If the client cannot start sign-in, or
the URL answers `API_KEY_REQUIRED` with no OAuth `WWW-Authenticate` header, it is
not available in that environment yet.

The examples below use the production URL; replace it for a private environment.

### Clients

#### Claude Code

```bash
claude mcp add --transport http cawplan https://api.cawplan.com/core-product/api/v1/public/openapi/mcp
```

Then run `/mcp`, pick `cawplan`, choose to authenticate and sign in in the browser.
Add `--scope user` to use it in every project.

#### Claude (web and desktop)

Settings → Connectors → add a custom connector with the URL above, then connect
it and sign in. In a chat, turn on the CawPlan connector's tools.

#### Codex

```bash
codex mcp add cawplan --url https://api.cawplan.com/core-product/api/v1/public/openapi/mcp
```

This writes the server to `~/.codex/config.toml` and starts the sign-in; if it
does not, run `codex mcp login cawplan`. The equivalent `config.toml` entry:

```toml
[mcp_servers.cawplan]
url = "https://api.cawplan.com/core-product/api/v1/public/openapi/mcp"
```

#### Cursor (desktop)

Add the server to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one
project), then sign in when Cursor asks:

```json
{
  "mcpServers": {
    "cawplan": {
      "url": "https://api.cawplan.com/core-product/api/v1/public/openapi/mcp"
    }
  }
}
```

Cursor's web and Cloud Agents use a `cursor.com` callback, which the server does
not accept; use the desktop app.

#### Other clients

Add a remote MCP server with the streamable HTTP transport, the URL above and no
headers. The client must support OAuth dynamic client registration and use a
loopback callback (or be one of the hosted clients listed above).

### What needs the CLI

All other skills work on MCP. Write tools change CawPlan data; skills confirm the
target and content with you before calling them. These need the CLI because they
read or write local files or local agent data:

- `cawplan-coding-commit` and `cawplan-coding-insights`
- In `cawplan-ticket-attachments`: download, upload and add (on MCP the skill
  lists attachments and gives their download URLs)
- In `cawplan-testpoint-generate`: the review page and archiving (on MCP the
  skill shows the draft and stops before saving)
- In `cawplan-testcase-generate`: CSV export
- The TestRail and QA session skills

### Troubleshooting

- **New tools are missing**: clients cache the tool list. After a CawPlan update,
  reconnect the server in the client you are using (for example `/mcp` in Claude
  Code); reconnecting in another client or terminal does not refresh this one.
- **Connection reset or tool calls fail after a CawPlan deploy**: reconnect the server.
- **Sign-in page does not open, or `API_KEY_REQUIRED`**: the MCP server is not
  enabled in that environment (see above), or the URL is missing
  `/api/v1/public/openapi/mcp`.
- **`invalid_redirect_uri` at sign-in**: the client uses a hosted callback that
  is not accepted; use a desktop or CLI client.
- **Signed in again too often**: sessions end after 30 days without use and at
  most 90 days after sign-in.
- **A skill says the CLI is required**: that step needs local files (see
  [What needs the CLI](#what-needs-the-cli)).

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
