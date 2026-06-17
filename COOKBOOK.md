# CawPlan Skill Cookbook

Task-oriented examples for CawPlan agent skills.

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

Collect local agent session data (Claude Code, Cursor, Codex) and upload to CawPlan.

```text
# Auto-collect all agents for today and upload immediately
/cawplan-coding-commit collect and submit today's coding sessions

# Auto-collect for a specific date and upload
/cawplan-coding-commit submit coding report for 2026-06-14

# Collect only (write to file, do not upload)
/cawplan-coding-commit collect sessions for 2026-06-14

# Collect, prepare chunks, and render a local report
/cawplan-coding-commit generate and render coding report for 2026-06-14

# Collect only Claude Code sessions for today
/cawplan-coding-commit collect today's Claude Code sessions

# Upload a pre-collected JSON file
/cawplan-coding-commit submit today's coding report from ~/reports/daily.json
```

The CLI reads sessions from:
- **Claude Code**: `~/.claude/projects/` JSONL files
- **Cursor GUI**: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
- **Codex**: `~/.codex/sessions/`

Cursor token/cost data requires `CURSOR_ACCESS_TOKEN` to be set; absence is a non-fatal warning.

## 7. cawplan-coding-insights

Track coding costs, token usage, session activity, and productivity across multiple dimensions.

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
