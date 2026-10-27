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

When an agent runs `cawplan auth login` (detected via `CLAUDECODE` /
`CODEX_THREAD_ID`, or no interactive terminal), the CLI switches to the
non-blocking device-auth flow automatically instead of opening a local browser
and blocking for up to 5 minutes. `--device-auth` forces it; `--browser` forces
the browser flow.

```bash
cawplan auth login                           # prints a URL, then exits
# Show the URL to the user and wait until they say they approved it.
cawplan auth login --device-auth --complete  # exit 2 = still pending, re-run
cawplan auth status
```

The URL can be opened on any device where the user is signed in to CawPlan. It is
valid for 5 minutes; after that, start again with `--device-auth`.
