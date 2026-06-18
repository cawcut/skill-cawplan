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

### Mode 1: Collect → review raw details → confirm → upload

Use **only** when the user explicitly asks to upload or submit the report.

**Do not upload directly.** Always collect, AI-summarize, then confirm before uploading.

**Step 1 — Collect:**
```bash
cawplan ai-session collect --date <YYYY-MM-DD>
# output defaults to ./ai-daily-<date>.json
```

**Step 2 — Show summary to the user:**

Present a concise summary of the collected data:
- Date and author
- Total sessions (broken down by agent)
- Total cost
- Top sessions (name, time range, cost)
- Files changed across repos

**Step 3 — Ask for confirmation:**

> "Ready to upload the AI report for <date>. Confirm?"

Wait for explicit confirmation before proceeding. If the user declines, stop.

**Step 4 — Upload:**
```bash
cawplan ai-session report --file ./ai-daily-<date>.json
```

---

### Mode 2: Collect + summarize (default when no upload intent)

**Step 1 — Collect API JSON:**
```bash
# Collect all agents — output defaults to ./ai-daily-<date>.json
cawplan ai-session collect --date <YYYY-MM-DD>

# Collect specific agent(s)
cawplan ai-session collect --date <YYYY-MM-DD> --agent claude-code

# Write to a custom path
cawplan ai-session collect --date <YYYY-MM-DD> --output ~/reports/ai-daily-2026-06-14.json

```

**Step 2 — Show summary to the user:**

Present a concise summary of the collected data:
- Date and author
- Total sessions (broken down by agent)
- Total cost
- Top sessions (name, time range, cost)
- Files changed across repos
---

### Mode 3: Upload a pre-existing file

```bash
cawplan ai-session report --file <path>
```

The CLI validates the file contains `author` and `date` fields before uploading.

---

## Rules

- If no `--date` is given, defaults to today.
- Do not fabricate session data. Only report what the agents produce locally.
- If `--file` is used, the file must contain `author` (git username) and `date` (YYYY-MM-DD) fields.
- Preserve raw fields in `human_inputs` (for example `start_time`, `end_time`, `files_changed`, `lines_added`, `lines_deleted`).
- Never replace raw `human_inputs` with summarized content.

## Confirmation

After uploading, report:

- Report date acknowledged by the server.
- Number of sessions collected per agent.
- Code field (SUCCESS / FAILURE).
- If FAILURE, show the error message.

## References

- `references/CAWPLAN_OPEN_API.md`
