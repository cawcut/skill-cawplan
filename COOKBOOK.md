# CawPlan Skill Cookbook

Task-oriented examples for CawPlan agent skills.

**Before you start:** use these examples as agent skill prompts. For AI daily reporting onboarding, see `docs/AI_DAILY_REPORTING.md`. Agent execution details live in each skill's `SKILL.md` under `skills/`.

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

## 6. cawplan-ticket-context

Load one or more CawPlan tickets into the current AI coding session so the next daily report links this session to those tickets.

```text
/cawplan-ticket-context https://app.cawplan.com/issue/CWP-14471 https://app.cawplan.com/issue/CWP-14472
/cawplan-ticket-context CWP-14471 CWP-14472
```

Use this before or during implementation work for a ticket. The next `/cawplan-coding-commit` will attach the ticket IDs to the matching session item's `ticket_ids`. If no ticket context was loaded, collection only infers tickets from explicit CawPlan issue URLs or display IDs such as `CWP-14471`.

## 7. cawplan-coding-commit

Collect local agent session data (Claude Code, Cursor, Codex) and upload a daily AI coding report to CawPlan.

**Authoritative workflow:** `skills/cawplan-coding-commit/SKILL.md`

```text
# Default: collect and upload today, then check missing dates in the current month
/cawplan-coding-commit

# Specify one day
/cawplan-coding-commit yesterday
/cawplan-coding-commit 2026-06-20

# Fill missing cloud reports for a month
/cawplan-coding-commit last month
/cawplan-coding-commit 2026-06
```

No extra prompt is required for the default daily flow. The agent collects today's report, summarizes sessions and human inputs, handles product assignment when needed, uploads when ready, then checks for missing reports in the current month.

The skill can work with these local agent data sources:

- **Claude Code** sessions
- **Cursor GUI** sessions
- **Cursor CLI** sessions
- **Codex** sessions

## 8. cawplan-coding-insights

Track coding costs, token usage, session activity, and productivity across multiple dimensions.

Product-scoped views require product-repo mappings created during the coding report workflow.

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
