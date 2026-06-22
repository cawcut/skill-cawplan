---
version: 0.2.0
name: cawplan-coding-commit
description: |
  Use when the user asks to collect, generate, summarize, submit, upload, or report CawPlan AI coding session daily reports from local agent data or existing ai-daily JSON files, including team daily report submission.
  NOT for: git commits, viewing insights, querying costs, or searching tickets.
argument-hint: "[date, file path, or agent name]"
allowed-tools: Bash
---

# CawPlan Coding Commit

## Bootstrap

```bash
command -v cawplan >/dev/null || { echo "cawplan is not installed. Run: npm install -g cawplan@0.0.3"; exit 1; }
[ "$(cawplan --version)" = "0.0.3" ] || { echo "cawplan 0.0.3 is required. Run: npm install -g cawplan@0.0.3"; exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

## Workflow

There are three modes. Choose by this priority:

1. User invokes `/cawplan-coding-commit` with no additional prompt or arguments → Mode 1
2. User asks to **upload / submit / report / 上传 / 提交** without file paths → Mode 1
3. User asks to **generate / collect / summarize / 生成 / 收集 / 总结** without upload intent → Mode 2
4. User provides one or more file paths and asks to **upload / submit / report / 上传 / 提交** → Mode 3

Do not use this skill for a plain `git commit` request unless the user explicitly mentions CawPlan, AI report upload, or an `ai-daily-*.json` file.

---

### Mode 1: Collect → Review → Upload

Use when the user explicitly asks to upload or submit the report, or when the user invokes `/cawplan-coding-commit` with no additional prompt or arguments.

Always collect and present the AI-summarized review before uploading. Do not wait for a second confirmation after the review; proceed to upload immediately.

**Step 1 — Collect:**
```bash
cawplan ai-session collect --date <YYYY-MM-DD>
# output defaults to ./ai-daily-<date>.json
```

**Step 2 — Review the report with the user:**

Present the full review described in **Review content contract**. Do not show only a stats table.

**Step 3 — Upload:**
```bash
cawplan ai-session report --file ./ai-daily-<date>.json
```

**Step 4 — Sync legacy uid-team-skills report:**

After a successful upload, run **Default dual-write: uid-team-skills report sync** for the report date.

---

### Mode 2: Collect + Review (default when no upload intent)

**Step 1 — Collect:**
```bash
# Collect all agents — output defaults to ./ai-daily-<date>.json
cawplan ai-session collect --date <YYYY-MM-DD>

# Collect specific agent(s)
cawplan ai-session collect --date <YYYY-MM-DD> --agent claude-code

# Write to a custom path
cawplan ai-session collect --date <YYYY-MM-DD> --output ~/reports/ai-daily-2026-06-14.json

```

**Step 2 — Review the report with the user:**

Present the full review described in **Review content contract**. Do not show only a stats table.

### Mode 3: Upload pre-existing file(s)

Use when the user provides one or more existing report files and asks to upload/submit/report them.

Always inspect and summarize before uploading. Do not wait for a second confirmation after the review; proceed to upload immediately.

**Step 1 — Inspect each file:**
- Confirm the file exists and contains `author` and `date`.
- Present the full review described in **Review content contract** for each report file.
- Preserve raw `human_inputs`; never rewrite the JSON just to summarize it.

**Step 2 — Upload each file sequentially:**
```bash
cawplan ai-session report --file <path>
```

For multiple files, run one `report --file` command per file. Do not guess alternate command names.

**Step 3 — Sync legacy uid-team-skills report(s):**

After successful upload, run **Default dual-write: uid-team-skills report sync** once for each distinct report `date` from the inspected files.

---

## Review content contract

Before asking for upload confirmation, include these sections:

- Basic facts: date, author, total sessions by agent, total cost, files changed, repos touched.
- Overall summary: use the report's `summary` field when present; otherwise write 2-4 sentences from sessions, repos, and human inputs.
- Session review: for each important session, include title/name, agent, time range, cost, repo/files changed, and 1-2 sentences describing what work happened. Do not list only title/time/cost.
- Human input highlights: summarize notable `human_inputs` by category (`decision`, `direction`, `correction`, `planning`) and include representative prompts when useful.
- Data quality notes: mention missing/estimated costs, API warnings, sessions without cost, empty models, or legacy sync blockers.

Use a compact table for numbers if useful, but always include the narrative summary and session review text.

---

## Default dual-write: uid-team-skills report sync

For Mode 1 and Mode 3, CawPlan Cloud upload is not the end of the workflow. After each successful upload, also generate the legacy team daily report from the developer's local `uid-team-skills` repository.

Developers do **not** need to run `/cawplan-coding-commit` from inside `uid-team-skills`. Resolve the repository path in this order:

1. If the current working directory is the `uid-team-skills` repository, use it.
2. Else if `UID_TEAM_SKILLS_DIR` is set, use that path.
3. Else try common sibling locations from the current repo, such as a nearby `uid-team-skills` checkout in the same workspace tree.
4. If not found, stop and ask the developer to set:
   ```bash
   export UID_TEAM_SKILLS_DIR=/path/to/uid-team-skills
   ```

Before running legacy commands, confirm the resolved directory contains `.agents/skills/ai-coding-reports/scripts/cli.py`.

Run this per report date:

```bash
cd <resolved-uid-team-skills-dir>
python3 .agents/skills/ai-coding-reports/scripts/cli.py collect --date <YYYY-MM-DD>
python3 .agents/skills/ai-coding-reports/scripts/cli.py prepare chunks --date <YYYY-MM-DD>
# Write per-session summaries from Outputs/reports/<date>/chunks/ into Outputs/reports/<date>/summaries/
python3 .agents/skills/ai-coding-reports/scripts/cli.py render --date <YYYY-MM-DD>
```

Summary rules:
- For each session, read only generated `chunk-1.txt` and `chunk-2.txt` when present.
- Write `summaries/{agent}-{session_id[:8]}.json` with:
  ```json
  {
    "session_title": "1-2行中文标题",
    "human_input": {
      "decisions": [],
      "direction": [],
      "bugs": [],
      "planning": []
    },
    "summary": "2-3句中文摘要",
    "next_steps": []
  }
  ```
- Write `summaries/_overall.json` before render.
- Do not fabricate missing session data.

Git commit rule in `uid-team-skills`:
1. Run `git status --short`.
2. Commit only the final Markdown report generated by render, under `Reports/`.
3. Do not commit `Outputs/`, chunks, summaries, JSON files, or other intermediate artifacts.
4. If the only relevant change is the final `Reports/**/*.md` report for the target date, commit that Markdown file:
   ```bash
   git add <final-report.md>
   git commit -m "daily report: <one-line summary>"
   ```
5. If `git status --short` shows any non-Markdown report changes, or Markdown changes unrelated to the target report date/user, stop and report the status. Do not auto-commit.
6. After a successful commit, run `git push` automatically.
7. Report the `git push` result to the developer. If `git push` fails, show the failure and tell the developer the local commit was created but not pushed.

For multiple uploaded dates, complete collect/prepare/summarize/render and the final-Markdown-only commit check separately for each date.

---

## Rules

- If no `--date` is given, defaults to today.
- Do not fabricate session data. Only report what the agents produce locally.
- Upload/submit/report requests default to dual-write: CawPlan Cloud plus legacy `uid-team-skills` report sync.
- If `--file` is used, the file must contain `author` (git username) and `date` (YYYY-MM-DD) fields.
- Preserve raw fields in `human_inputs` (for example `start_time`, `end_time`, `files_changed`, `lines_added`, `lines_deleted`).
- Never replace raw `human_inputs` with summarized content.

## Confirmation

After uploading, report:

- Report date acknowledged by the server.
- Number of sessions per agent from the reviewed file summary.
- Code field (SUCCESS / FAILURE).
- If FAILURE, show the error message.
- Legacy `uid-team-skills` report path and git commit hash when created.
- `git push` result for the legacy `uid-team-skills` report commit.
- If legacy sync stops because non-final-report files changed, show the status and do not claim completion.

## References

- `references/CAWPLAN_OPEN_API.md`
