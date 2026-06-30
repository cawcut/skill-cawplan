# AI Daily Reporting Guide

This document is for developers and explains how to submit AI Coding daily reports.
Reports are uploaded to CawPlan Cloud to track AI sessions, tokens, costs, and prompt usage.

## First-Time Setup

1. Install the skill:
    ```bash
    npx skills add Ubiquiti-UID/flow-cawplan-skill -a cursor claude-code codex -g -y
    ```

    Running the command again updates the skill. After installation, restart the agent so the skill takes effect.

2. Install the `cawplan` CLI:

    `cawplan` requires Node.js `>=22.13.0`. If your Node.js version is too old, upgrade Node.js before installing.

    ```bash
    # Install
    npm install -g cawplan@latest

    # Upgrade
    cawplan upgrade
    ```

3. Log in to CawPlan:

    ```bash
    cawplan auth login

    # Check login status
    cawplan auth status
    ```

Before reporting from a repository for the first time, run this once from the repository root:

```bash
cawplan init
```

This lets you select a CawPlan Team and Product in the terminal, then configures the default mapping between the current GitHub repository and the selected Product. If there is only one Team, it skips directly to Product selection. If the selected Team has no Products, it prompts whether to open the Product creation page.

## Daily Reporting

Run this in the agent:

```bash
# Default: collect and upload today, then check missing dates in the current month
/cawplan-coding-commit

# Specify one day (yesterday / exact date)
/cawplan-coding-commit yesterday
/cawplan-coding-commit 2026-06-20

# Fill missing cloud reports for an entire month (missing dates only; already-uploaded dates are not overwritten)
/cawplan-coding-commit last month
/cawplan-coding-commit 2026-06
```

No extra prompt is required, and no second upload confirmation is needed. The agent automatically collects the AI sessions, shows a summary, and uploads the daily report.

After a successful upload, the CLI checks for missing cloud reports in the current month and automatically fills collectible historical dates.

## FAQ

### Skill Installation Fails

`npx skills add Ubiquiti-UID/flow-cawplan-skill` uses HTTPS clone by default. If cloning fails, try SSH clone instead:

```bash
# SSH clone
npx skills add git@github.com:Ubiquiti-UID/flow-cawplan-skill.git -a cursor claude-code codex -g -y
```

### Authentication Expires

Log in again:

```bash
cawplan auth login
```

### Cursor Cost Is Missing

Cursor token and cost data depend on the Cursor Dashboard API. If the token is missing or the network is unavailable, the report can still be generated, but Cursor costs may be empty or incomplete.