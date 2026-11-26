# CawPlan MCP Server

The CawPlan MCP server lets an AI client read and update CawPlan (products,
versions, tickets, critical issues, knowledge, metrics and QA Insights) without
installing the `cawplan` CLI. Use it in clients without a shell, such as Claude
on the web, or wherever you prefer a remote connector to a local CLI.

The agent skills in [`skills/`](skills/) work on both routes: each skill names
capabilities, not commands, and picks the CLI when `cawplan skill check` passes,
otherwise the MCP tools. See [`references/CAPABILITIES.md`](references/CAPABILITIES.md)
for the route rules and the capability → CLI command / MCP tool table.

## Endpoint and sign-in

| | |
|---|---|
| URL | `https://api.cawplan.com/core-product/api/v1/public/openapi/mcp` |
| Transport | Streamable HTTP |
| Authentication | OAuth 2.1 with PKCE and dynamic client registration |
| API key or client ID | None to configure |

- The client opens a CawPlan sign-in and consent page. The token carries your own
  CawPlan permissions: you see and change only what you can in the CawPlan web app.
- The client refreshes its token by itself. Sign in again after 30 days without
  use, and at least every 90 days.
- Accepted OAuth callbacks: local clients (`http://localhost`, `127.0.0.1` or
  `[::1]`, any port) and the hosted clients claude.ai, claude.com and
  chatgpt.com. Other hosted clients are rejected at registration.
- Private environment: append `/api/v1/public/openapi/mcp` to that environment's
  API base (the `apiBase` of its profile; see
  [Private and development environments](INSTALL.md#private-and-development-environments)).
  The server is enabled per environment. If the client cannot start sign-in, or
  the URL answers `API_KEY_REQUIRED` with no OAuth `WWW-Authenticate` header, it
  is not available in that environment yet.

### Read-only connection

To let a client query CawPlan without changing data, use
`https://api.cawplan.com/core-product/api/v1/public/openapi/mcp/readonly`
instead of the default `/mcp` URL in the client setup below. For a private
environment, append `/readonly` to its MCP endpoint. Sign in as usual.

The read-only endpoint exposes only read tools, even for users who can edit
data in the web app. This restriction applies to that MCP connection, not to
the CLI or other connections.

## Set up your client

The examples use the production URL; replace it for a private environment.

### Claude Code

```bash
claude mcp add --transport http cawplan https://api.cawplan.com/core-product/api/v1/public/openapi/mcp
```

Add `--scope user` to use it in every project. Then run `/mcp`, pick `cawplan`,
choose to authenticate and sign in in the browser.

### Claude (claude.ai, desktop and mobile)

1. Open **Settings → Connectors** and choose **Add custom connector**.
   On a Team or Enterprise plan, an owner adds it once under
   **Admin settings → Connectors** for the whole organization.
2. Name it `CawPlan` and paste the URL:
   `https://api.cawplan.com/core-product/api/v1/public/openapi/mcp`.
   Leave the OAuth client ID and secret empty.
3. Choose **Connect** and sign in to CawPlan.
4. In a chat, open the tools menu and turn on the CawPlan connector.

Connectors added on claude.ai are also available in the Claude desktop and
mobile apps.

### Cursor

One click: open this link in your browser; Cursor asks to install the server.

```text
cursor://anysphere.cursor-deeplink/mcp/install?name=cawplan&config=eyJ1cmwiOiJodHRwczovL2FwaS5jYXdwbGFuLmNvbS9jb3JlLXByb2R1Y3QvYXBpL3YxL3B1YmxpYy9vcGVuYXBpL21jcCJ9
```

Or add it to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one
project):

```json
{
  "mcpServers": {
    "cawplan": {
      "url": "https://api.cawplan.com/core-product/api/v1/public/openapi/mcp"
    }
  }
}
```

Sign in when Cursor asks. Cursor's web and Cloud Agents use a `cursor.com`
callback, which the server does not accept; use the desktop app.

### VS Code

One click (VS Code 1.101 or later):
[Install in VS Code](https://insiders.vscode.dev/redirect/mcp/install?name=cawplan&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fapi.cawplan.com%2Fcore-product%2Fapi%2Fv1%2Fpublic%2Fopenapi%2Fmcp%22%7D)

From a terminal:

```bash
code --add-mcp '{"name":"cawplan","type":"http","url":"https://api.cawplan.com/core-product/api/v1/public/openapi/mcp"}'
```

Or add it to `.vscode/mcp.json` in a workspace:

```json
{
  "servers": {
    "cawplan": {
      "type": "http",
      "url": "https://api.cawplan.com/core-product/api/v1/public/openapi/mcp"
    }
  }
}
```

Start the server from the file or the **MCP: List Servers** command and sign in
in the browser. Use the tools in Copilot Chat's agent mode.

### Codex

```bash
codex mcp add cawplan --url https://api.cawplan.com/core-product/api/v1/public/openapi/mcp
```

This writes the server to `~/.codex/config.toml` and starts the sign-in; if it
does not, run `codex mcp login cawplan`. The equivalent `config.toml` entry:

```toml
[mcp_servers.cawplan]
url = "https://api.cawplan.com/core-product/api/v1/public/openapi/mcp"
```

### Other clients

Add a remote MCP server with the streamable HTTP transport, the URL above and no
headers. The client must support OAuth dynamic client registration and use a
loopback callback (or be one of the hosted clients listed above).

## Tools

The server exposes the tools listed in
[`references/mcp-tools.json`](references/mcp-tools.json); what each one does,
and whether it reads or writes, is in
[`references/CAPABILITIES.md`](references/CAPABILITIES.md). Tool groups:

- Products, product lines, versions, releases and labels
- Tickets, backlog tickets, ticket history and relations, and their attachments
  (download URLs)
- Critical issues, product analytics, activity reports and the activity feed
- Users, the signed-in user and their to-dos
- Knowledge datasets, documents and search
- Business key metrics
- QA Insights: module tree, requirements, test points, risk assessment, QA
  reports and TestRail execution data

Write tools change CawPlan data. The skills confirm the target and the content
with you before calling one; when you call tools directly, review the request
your client shows before you approve it.

## What needs the CLI

Steps that read or write local files or local agent data need the `cawplan` CLI
(see [INSTALL.md](INSTALL.md#cli)):

- `cawplan-coding-commit` and `cawplan-coding-insights`
- In `cawplan-ticket-attachments`: download, upload and add (on MCP the skill
  lists attachments and gives their download URLs)
- In `cawplan-testpoint-generate`: the review page and archiving (on MCP the
  skill shows the draft and stops before saving)
- In `cawplan-testcase-generate`: CSV export
- The TestRail and QA session skills

All other skills work on MCP.

## Troubleshooting

- **New tools are missing**: clients cache the tool list. After a CawPlan update,
  reconnect the server in the client you are using (for example `/mcp` in Claude
  Code); reconnecting in another client or terminal does not refresh this one.
- **Connection reset or tool calls fail after a CawPlan deploy**: reconnect the server.
- **Sign-in page does not open, or `API_KEY_REQUIRED`**: the MCP server is not
  enabled in that environment (see [Endpoint and sign-in](#endpoint-and-sign-in)),
  or the URL is missing `/api/v1/public/openapi/mcp`.
- **`invalid_redirect_uri` at sign-in**: the client uses a hosted callback that
  is not accepted; use a desktop or CLI client.
- **Signed in again too often**: sessions end after 30 days without use and at
  most 90 days after sign-in.
- **A skill says the CLI is required**: that step needs local files (see
  [What needs the CLI](#what-needs-the-cli)).

## Privacy, security and support

- Data handling: [PRIVACY.md](PRIVACY.md)
- Report a vulnerability: [SECURITY.md](SECURITY.md)
- Get help: [SUPPORT.md](SUPPORT.md)
