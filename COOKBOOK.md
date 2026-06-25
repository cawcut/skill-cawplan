# CawPlan Skill Cookbook

Task-oriented examples for CawPlan agent skills.

**Before you start:** install the CLI and authenticate (`README.md`). For AI daily reporting onboarding, see `docs/AI_DAILY_REPORTING.md`. Agent execution details live in each skill's `SKILL.md` under `skills/`.

## 1. cawplan-ticket-create

Create a new ticket with details, assignee, and priority

```text
/cawplan-ticket-create create a HIGH bug for UniFi Access 4.1.10: door stuck after firmware update, assign to user@ui.com
/cawplan-ticket-create create a backlog ticket for UniFi Access: investigate door schedule issue
```

## 2. cawplan-product-report

Generate progress reports, risk analysis, priority recommendations, and summaries

```text
/cawplan-product-report show UniFi Access status report for last week
/cawplan-product-report show UniFi Access 4.1.10 progress report from 2026-06-01 to 2026-06-15
```

## 3. cawplan-product-insights

Track product adoption, installations, user feedback, key metrics, and critical issues

```text
/cawplan-product-insights show UniFi Access product insights for last month
/cawplan-product-insights what is the health of UniFi Access right now
```

## 4. cawplan-plan-create

Create a version plan with goals and optional tickets

```text
/cawplan-plan-create create version plan for UniFi Access 4.2.0
/cawplan-plan-create create version plan for UniFi Access 4.2.0 with tickets: add NFC card import, fix door schedule bug
```

## 5. cawplan-plan-track

Track release progress, dependencies, pending tasks, and target delivery dates

```text
/cawplan-plan-track track release progress for UniFi Access 4.1.10
/cawplan-plan-track what's blocking UniFi Access 4.1.10 release
```

## 6. cawplan-coding-commit

Collect local agent session data (Claude Code, Cursor, Codex) and upload a daily AI coding report to CawPlan.

**Authoritative workflow:** `skills/cawplan-coding-commit/SKILL.md`

### Recommended daily flow

```text
# Default: collect today → review → upload → backfill missing days in the current month
/cawplan-coding-commit
```

No extra prompt is required. The agent collects `ai-daily-<date>.json`, summarizes sessions and human inputs, uploads when product assignment is complete, then checks for missing reports in the current month.

### Natural-language variants

```text
# Explicit upload for a specific date
/cawplan-coding-commit submit coding report for 2026-06-14

# Collect only (write JSON, do not upload)
/cawplan-coding-commit collect sessions for 2026-06-14

# Collect only Claude Code for today
/cawplan-coding-commit collect today's Claude Code sessions

# Upload a pre-collected file
/cawplan-coding-commit submit today's coding report from ~/reports/ai-daily-2026-06-14.json
```

### CLI equivalents

| Intent | Command |
|--------|---------|
| Collect | `cawplan ai-session collect --date <YYYY-MM-DD>` |
| Upload | `cawplan ai-session report --file ./ai-daily-<date>.json` |
| Assign products (TTY) | `cawplan ai-session assign --file ./ai-daily-<date>.json --tty` |
| Assign products (Web UI) | `cawplan ai-session assign --file ./ai-daily-<date>.json --web` |
| Backfill current month | `cawplan ai-session backfill --from <YYYY-MM-01> --to <YYYY-MM-DD>` |

Use absolute paths with `assign` when running from another directory. For multiple files, repeat `--files <path>` with `--web` or `--tty`.

### Product assignment

Every `sessions[]` entry needs a `product_id` before upload.

During `collect`, the CLI auto-matches sessions from cloud product-repo mappings, then prompts for remaining sessions when a TTY is available. In Cursor and other non-interactive shells, assignment is often skipped — complete it before upload:

```bash
# Option A: terminal selector
cawplan ai-session assign --file /absolute/path/ai-daily-2026-06-24.json --tty

# Option B: local browser table (session / human inputs / product / repo)
cawplan ai-session assign --file /absolute/path/ai-daily-2026-06-24.json --web
```

Run `/cawplan-coding-init` once per repo so auto-matching works for future collects.

### Data sources

`cawplan ai-session collect` reads:

- **Claude Code** — `~/.claude/projects/` JSONL session files
- **Cursor GUI** — `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
- **Cursor CLI** — agent transcripts on disk (`cursor-cli` sessions)
- **Codex** — `~/.codex/sessions/`

Cursor token/cost enrichment uses the Cursor Dashboard API when `CURSOR_ACCESS_TOKEN` is set. Missing token or network is a non-fatal warning; the report is still written.

### After upload

After a successful daily upload, the skill may backfill other missing dates in the same calendar month:

```bash
cawplan ai-session backfill --from 2026-06-01 --to 2026-06-24 --dry-run
cawplan ai-session backfill --from 2026-06-01 --to 2026-06-24
```

## 7. cawplan-coding-init

Link the **current git repository** to a CawPlan product (and optional GitHub repo mapping) so `/cawplan-coding-commit` can auto-fill `product_id` during collection.

Run once per repo, from the repository root, before your first daily report from that codebase:

```text
/cawplan-coding-init
```

The skill resolves `git remote get-url origin`, lets you pick a CawPlan product, and creates a cloud `product-repo` mapping when needed. Details: `skills/cawplan-coding-init/SKILL.md`.

## 8. cawplan-coding-insights

Track coding costs, token usage, session activity, and productivity across multiple dimensions.

`by-product` and product-scoped views require product-repo mappings (see §7).

```text
# Workspace overview
/cawplan-coding-insights show team coding costs for last week
/cawplan-coding-insights what did we spend on AI coding this month
/cawplan-coding-insights show daily cost trend for June 2026

# By member
/cawplan-coding-insights what did we spend on AI coding this month, by member
/cawplan-coding-insights who spent the most on AI coding last week
/cawplan-coding-insights show full detail for member xin.li

# By model / agent / project
/cawplan-coding-insights which AI models did the team use most this month
/cawplan-coding-insights break down last week's cost by model and token type
/cawplan-coding-insights which coding agents (Claude Code, Cursor) drove the most spend this month
/cawplan-coding-insights which git repos consumed the most AI tokens last week

# By product
/cawplan-coding-insights show AI coding cost breakdown by product for June
/cawplan-coding-insights how much did the UniFi Access team spend on AI coding this month

# Product-scoped views
/cawplan-coding-insights show UniFi Access AI coding overview for last month
/cawplan-coding-insights show daily AI coding trend for UniFi Access in June 2026
/cawplan-coding-insights who on the UniFi Access team spent the most on AI coding this month
/cawplan-coding-insights which models is the UniFi Access team using most

# Personal sessions
/cawplan-coding-insights show my own session activity for 2026-06-15
/cawplan-coding-insights show my AI coding sessions for the past week

# Prompt quality analysis
/cawplan-coding-insights show team prompt quality summary for last week
/cawplan-coding-insights what categories of prompts is the team writing most
/cawplan-coding-insights show prompt quality scores for the team this month
/cawplan-coding-insights which product has the best prompt quality
/cawplan-coding-insights show prompts that need review from last week
/cawplan-coding-insights search for prompts about "door schedule" from the last month
```

**CLI examples** (agents use these under the hood):

```bash
cawplan ai-session overview --from 2026-06-01 --to 2026-06-30
cawplan ai-session trend --from 2026-06-01 --to 2026-06-30
cawplan ai-session by-member --from 2026-06-01 --to 2026-06-30
cawplan ai-session by-model --from 2026-06-01 --to 2026-06-30
cawplan ai-session by-agent --from 2026-06-01 --to 2026-06-30
cawplan ai-session by-project --from 2026-06-01 --to 2026-06-30
cawplan ai-session by-product --from 2026-06-01 --to 2026-06-30
cawplan ai-session my-sessions --from 2026-06-01 --to 2026-06-30
cawplan ai-session human-input-summary --from 2026-06-01 --to 2026-06-30
```

Full command list: `skills/cawplan-coding-insights/SKILL.md`.
