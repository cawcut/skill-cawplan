---
version: 0.2.0
name: cawplan-coding-commit
description: |
  Collect and/or submit an AI coding session report to CawPlan — reading local agent data (Claude Code, Cursor, Codex) and uploading daily usage including cost, tokens, sessions, and code changes.
  Use when: the user asks to collect, commit, submit, upload, or report today's (or a specific day's) AI coding activity.
  NOT for: viewing insights, querying costs, or searching tickets.
argument-hint: "[date, file path, or agent name]"
allowed-tools: Bash
---

# CawPlan Coding Commit

## Bootstrap

```bash
command -v cawplan >/dev/null || { echo "cawplan is not installed. Run: npm install -g cawplan"; exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

## Workflow

There are three modes. Choose based on **what the user explicitly says**:

- User mentions **upload / submit / commit / report / 上传 / 提交** → Mode 1
- User mentions **generate / collect / summarize / 生成 / 收集 / 总结** without upload intent → Mode 2
- User provides a file path → Mode 3

---

### Mode 1: Collect → AI summarize → confirm → upload

Use **only** when the user explicitly asks to upload or submit the report.

**Do not upload directly.** Always collect, AI-summarize, then confirm before uploading.

**Step 1 — Collect:**
```bash
cawplan ai-session collect --date <YYYY-MM-DD>
# output defaults to ./ai-daily-<date>.json
```

**Step 2 — AI summarize (agent does this directly):**

Read `./ai-daily-<date>.json`. The `human_inputs` array contains all user messages from each session — use them to understand what decisions were made, what was built, what was fixed.

For each session, condense into structured summaries and **overwrite** the JSON file. Use the Write tool to overwrite `./ai-daily-<date>.json` with the updated content.

Summarization rules:
- Group items into four categories: `decision` / `direction` / `correction` / `planning`
- Each item: `{ "category": "...", "content": "...", "session_title": "...", "session_agent": "..." }`
- 3–8 items per category; skip empty categories
- Each `content` is a concise self-contained statement in Chinese
- `decision`: architectural, scope, or implementation choices that were made
- `direction`: significant tasks, features, or operations requested
- `correction`: bugs, errors, or inconsistencies that were found or fixed
- `planning`: planning discussions, roadmap items, next steps
- Replace the top-level `human_inputs` with the summarized result

**Step 3 — Show summary to the user:**

Present a concise summary of the collected data:
- Date and author
- Total sessions (broken down by agent)
- Total cost
- Top sessions (name, time range, cost)
- Files changed across repos

**Step 4 — Ask for confirmation:**

> "以上是 <date> 的 AI 日报，是否确认上传？"

Wait for explicit confirmation before proceeding. If the user declines, stop.

**Step 5 — Upload:**
```bash
cawplan ai-session report --file ./ai-daily-<date>.json
```

---

### Mode 2: Collect + summarize (default when no upload intent)

**Step 1 — Collect:**
```bash
# Collect all agents — output defaults to ./ai-daily-<date>.json
cawplan ai-session collect --date <YYYY-MM-DD>

# Collect specific agent(s)
cawplan ai-session collect --date <YYYY-MM-DD> --agent claude-code

# Write to a custom path
cawplan ai-session collect --date <YYYY-MM-DD> --output ~/reports/ai-daily-2026-06-14.json
```

**Step 2 — AI summarize (agent does this directly):**

Same as Mode 1 Step 2: read `ai-daily-<date>.json`, summarize `human_inputs`, overwrite JSON.

After review, upload with:
```bash
cawplan ai-session report --file <path>
```

---

### Mode 3: Upload a pre-existing file

```bash
cawplan ai-session report --file <path>
```

The CLI validates the file contains `author` and `date` fields before uploading.

---

## Agents Supported by Collect

| Agent | Source | Notes |
|-------|--------|-------|
| `claude-code` | `~/.claude/projects/*/` JSONL files | Reads cost, tokens, session names, file changes |
| `cursor-gui` | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` | Reads composer sessions; token data requires `CURSOR_ACCESS_TOKEN` |
| `cursor` | Same as cursor-gui | Alias |
| `codex` | `~/.codex/sessions/` SQLite | Reads Codex CLI sessions |

If `CURSOR_ACCESS_TOKEN` is not set, Cursor cost/token fields will be empty (non-fatal warning).

---

## Rules

- If no `--date` is given, defaults to today.
- Do not fabricate session data. Only report what the agents produce locally.
- If `--file` is used, the file must contain `author` (git username) and `date` (YYYY-MM-DD) fields.

## Confirmation

After uploading, report:

- Report date acknowledged by the server.
- Number of sessions collected per agent.
- Code field (SUCCESS / FAILURE).
- If FAILURE, show the error message.

## References

- `references/CAWPLAN_OPEN_API.md`
