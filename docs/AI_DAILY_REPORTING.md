# AI Daily Reporting Guide

This guide explains how developers submit AI Coding daily reports to CawPlan Cloud.
Reports include local AI coding sessions, token usage, estimated or actual costs, human prompts, changed files, and Product assignments.

## First-Time Setup

### 1. Install Or Update The Skill

```bash
npx skills add Ubiquiti-UID/flow-cawplan-skill -a cursor claude-code codex -g -y
```

Run the same command again to update the skill. Restart the agent after installation or upgrade so the new instructions take effect.

### 2. Install Or Upgrade The CLI

`cawplan` requires Node.js `>=22.13.0`.

```bash
# Install
npm install -g cawplan@latest

# Upgrade an existing install
cawplan upgrade
```

### 3. Log In

```bash
cawplan auth login
cawplan auth status
```

`cawplan auth login` opens a browser-based verification flow.

### 4. Preconfigure Repository Mapping

This step is optional. From the GitHub repository root, run:

```bash
cawplan init
```

This command will preconfigure the default mapping from the current GitHub repository to a CawPlan Product, which can reduce the need for manual assignment later.
If you skip it, daily reports can still be collected and uploaded;  unmapped sessions can be assigned on the local Web assignment page.

## Daily Reporting

Run these commands in the agent chat, not directly in your shell:

```bash
# Default: collect and upload today, then check missing dates in the current month
/cawplan-coding-commit

# Specify one day
/cawplan-coding-commit yesterday
/cawplan-coding-commit 2026-06-20

# Fill missing cloud reports for a month
/cawplan-coding-commit last month
/cawplan-coding-commit 2026-06
```

## FAQ

### Skill Installation Fails

The `npx skills add` uses HTTPS by default. If cloning fails, try SSH:

```bash
npx skills add git@github.com:Ubiquiti-UID/flow-cawplan-skill.git -a cursor claude-code codex -g -y
```

### Authentication Expires

Log in again:

```bash
cawplan auth login
```

### Cursor Cost Is Missing

Cursor token and cost data depend on the Cursor Dashboard API. If the token is missing or the network is unavailable, the report can still be generated, but Cursor costs may be empty or incomplete.