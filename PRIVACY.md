# Privacy: AI coding and QA session reports

This document describes what the `cawplan` CLI and the `cawplan-coding-commit` /
`cawplan-qa-commit` skills read on your machine, what they upload to CawPlan, and
how long that data is kept. Every other `cawplan` command only sends the
arguments you pass to the CawPlan Open API.

## Nothing is uploaded without a separate step

`cawplan session collect` only reads local data and writes a JSON report to a
temporary directory on your machine (`cawplan session temp-dir` prints it). It
uploads nothing. The report is sent to CawPlan only when you, or an agent with
your explicit approval, run `cawplan session report --file <path>` (coding) or
`cawplan session qa-upload` / `session collect --mode qa --upload` (QA). The
skills require the agent to show you a review and get your approval for the
exact dates before uploading. You can open the report file and edit or delete
anything in it before approving.

## What is read locally

| Source | Location | Read for |
|--------|----------|----------|
| Claude Code | `~/.claude/projects/**/*.jsonl` | prompts, replies, tool calls, token usage, files changed |
| Codex | `~/.codex/sessions/**`, `~/.codex/state_5.sqlite` | prompts, replies, tool calls, token usage |
| Cursor (GUI and CLI) | Cursor's local `state.vscdb`, `~/.cursor/chats`, `~/.cursor/projects` | prompts, replies, tool calls, files changed |
| VS Code (Copilot agent) | `~/.copilot/session-state` | prompts, replies |
| Git | `git config user.email`, repository remotes in session working directories | report author, repository names and URLs |
| CawPlan CLI config | `~/.cawplan/config.json` | environment, local product mappings, opt-ins |

Only sessions with activity on the requested date are read into the report.

## What a report contains

When uploaded, a daily report carries:

- **Identity:** the report author (the part of your Git email before `@`) and
  your CawPlan account from `cawplan auth login`.
- **Session metadata:** agent, session ID and title, project name, working
  directory (`cwd`), time range, models, token counts, cost, and
  product/repository/ticket assignments.
- **Raw conversation text:** your prompts, the assistant replies that follow
  them, raw transcript blocks, and (for QA reports) tool output.
- **Code change metadata:** file paths with added/deleted line counts and the
  repositories touched. File contents are not included except where they appear
  in the conversation text or tool output.

### Redaction

Before upload the CLI masks values shaped like secrets (private keys, cloud and
Git provider tokens, API keys, JWTs, bearer and basic auth headers, URL
credentials, `password=` / `token=`-style pairs). It prints
`Redacted N secret-like value(s)` when it masks anything. Redaction is
pattern-based: it does not remove personal data, customer names, internal
hostnames, or secrets in an unusual format. Review the report file before
approving the upload.

### Server-side processing

After upload, CawPlan may process prompts and replies with an AI model to
classify topics, summarize work, and translate text for the insights views.

## Cursor usage lookup (opt-in, off by default)

Cursor does not store token or cost data locally. Exact Cursor GUI usage is only
available from cursor.com's private dashboard API, which requires your Cursor
login. With the lookup enabled, `session collect`:

1. reads your Cursor access token from `CURSOR_ACCESS_TOKEN` /
   `CURSOR_SESSION_TOKEN`, or else from the local Cursor `state.vscdb`
   (`cursorAuth/accessToken`);
2. sends it as a session cookie to
   `https://cursor.com/api/dashboard/get-filtered-usage-events` to fetch that
   day's usage events.

The token is used only for that request. It is never written to the report or
sent to CawPlan; only the resulting token counts and cost are.

The lookup is **off by default**. With it off, no Cursor token is read and
cursor.com is not contacted; Cursor GUI sessions then have no token/cost data
and are left out of coding reports. Enable it yourself with either:

```bash
cawplan config cursor-usage on          # persistent, stored in ~/.cawplan/config.json
cawplan session collect --cursor-usage  # this run only
```

Disable it again with `cawplan config cursor-usage off`.

## Retention

Uploaded reports have no fixed retention period and no automatic expiry: they
are kept until they are replaced by a re-upload.

## Correcting or deleting uploaded data

Re-uploading a report for the same date replaces that date's sessions, prompts
and replies with the new file, so you can correct a report by editing the local
file and uploading it again. A re-upload that contains no prompts at all keeps
the previously uploaded prompts and replies for that date.

There is currently no deletion process for uploaded reports. Review the local
report file before approving an upload, and remove anything you do not want
stored.

## Local files

| File | Contents |
|------|----------|
| `~/.cawplan/credentials.json` (mode `0600`) | CawPlan OAuth tokens or API key |
| `~/.cawplan/config.json` (mode `0600`) | environment, local product mappings, `cache`, `cursor_usage` |
| `<temp>/cawplan-ai-daily/ai-daily-<date>.json` | collected coding reports, until your OS clears the temp directory |
| `<temp>/cawplan-qa-daily/qa-daily-<date>.json` | collected QA reports |
