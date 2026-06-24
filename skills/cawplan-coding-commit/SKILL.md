---
version: 0.2.0
name: cawplan-coding-commit
description: |
  Use when the user asks to collect, generate, summarize, submit, upload, or report CawPlan AI coding session daily reports from local agent data or existing ai-daily JSON files.
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

When running this command from Cursor agent tools, request full network access (`required_permissions: ["full_network"]`) because Cursor token/cost collection depends on the Cursor Dashboard API at `cursor.com`.

During collection, `cawplan ai-session collect` may ask the user to assign each session to a CawPlan product and repository using existing product-repo mappings. If no mapping exists, the user can link a GitHub repository URL in the required format `https://github.com/owner/repo`.

In Cursor, agent-run shell commands may not have an interactive TTY. If product/repo assignment is skipped because prompts cannot be shown, or if any `sessions[]` entry lacks `product_id` after collection, complete missing assignments using **Product/repo assignment options** below before reviewing/uploading.

**Step 2 — Review the report with the user:**

Present the full review described in **Review content contract**. Do not show only a stats table.

**Step 3 — Upload:**
```bash
cawplan ai-session report --file ./ai-daily-<date>.json
```

After upload, `cawplan ai-session report` checks the uploaded report's month for missing reports by the current `user_id`; if the CLI cannot resolve the current user, the backfill check fails and reports the error. Missing dates up to today are collected into `ai-daily-YYYY-MM-DD.json` when no local file exists, then uploaded automatically. Use `--no-backfill` only when the user explicitly wants to skip this catch-up step.

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

When running any collect command from Cursor agent tools, request full network access (`required_permissions: ["full_network"]`) because Cursor token/cost collection depends on the Cursor Dashboard API at `cursor.com`.

**Step 2 — Review the report with the user:**

Present the full review described in **Review content contract**. Do not show only a stats table.

Collection may include interactive product/repo assignment prompts. If prompted, use the user's selections; do not fabricate product or repository mappings.

In Cursor, agent-run shell commands may not have an interactive TTY. If product/repo assignment is skipped because prompts cannot be shown, or if any `sessions[]` entry lacks `product_id` after collection, complete missing assignments using **Product/repo assignment options** below before reviewing.

### Mode 3: Upload pre-existing file(s)

Use when the user provides one or more existing report files and asks to upload/submit/report them.

Always inspect and summarize before uploading. Do not wait for a second confirmation after the review; proceed to upload immediately.

**Step 1 — Inspect each file:**
- Confirm the file exists and contains `author` and `date`.
- Present the full review described in **Review content contract** for each report file.
- If any `sessions[]` entry lacks `product_id`, complete **Product/repo assignment options** before uploading.
- Preserve raw `human_inputs`; never rewrite the JSON just to summarize it.

**Step 2 — Upload each file sequentially:**
```bash
cawplan ai-session report --file <path>
```

For multiple files, run one `report --file` command per file. Do not guess alternate command names. The first successful upload may backfill missing reports in the same month automatically; if the user is intentionally uploading an isolated historical file, add `--no-backfill`.

---

## Review content contract

Before asking for upload confirmation, include these sections:

- Basic facts: date, author, total sessions by agent, total cost, files changed, repos touched.
- Overall summary: use the report's `summary` field when present; otherwise write 2-4 sentences from sessions, repos, and human inputs.
- Session review: for each important session, include title/name, agent, time range, cost, repo/files changed, and 1-2 sentences describing what work happened. Do not list only title/time/cost.
- Human input highlights: summarize notable `human_inputs` by category (`decision`, `direction`, `correction`, `planning`) and include representative prompts when useful.
- Data quality notes: mention missing/estimated costs, API warnings, sessions without cost, or empty models.

Use a compact table for numbers if useful, but always include the narrative summary and session review text.

## Product/repo assignment options

Use this flow after collection or inspection when any `sessions[]` entry lacks `product_id`.

There are two supported ways to complete missing assignment. First ask the user to choose Option A or Option B; do not choose on their behalf.

- **Option A — TTY selector assignment:** Use when the user chooses to complete assignment in their own terminal with the CLI's native selector. Tell the user to run `cawplan ai-session assign --file <absolute-ai-daily-file> --tty`; do not run this command from the agent shell. Always provide an absolute report file path so the command works from any current directory. This calls the same cloud-mapping assignment flow used by collection and writes the updated file.
- **Option B — Local Web assignment:** Use when the agent shell has no TTY, the report has many sessions, or the user wants a visual table. Tell the user to run `cawplan ai-session assign --file <absolute-ai-daily-file> --web` in their own terminal, then open the printed `127.0.0.1` URL. The page shows `session / product / repo`, supports product-only assignment, and can link a new GitHub repository URL in the format `https://github.com/owner/repo`.

## Rules

- If no `--date` is given, defaults to today.
- Do not fabricate session data. Only report what the agents produce locally.
- When running `cawplan ai-session collect` from Cursor agent tools, request full network access (`required_permissions: ["full_network"]`) so Cursor Dashboard token/cost data can be fetched from `cursor.com`.
- If product/repo assignment prompts appear during collection, only use explicit user selections or existing mappings.
- Before reviewing or uploading, inspect every `sessions[]` entry. If any session lacks `product_id`, ask the user to choose Option A or Option B, even when the session has no file changes or repository data.
- Product selection is required for every session in both `--tty` and `--web`; repository selection is optional.
- If product/repo assignment is skipped in Cursor because the agent shell is non-interactive, ask the user to choose Option A or Option B. For Option A, tell the user to run `cawplan ai-session assign --file <absolute-ai-daily-file> --tty` in their own terminal, using the report's absolute path. For Option B, tell the user to run `cawplan ai-session assign --file <absolute-ai-daily-file> --web` and open the printed local URL.
- GitHub repository URLs used to create mappings must be in the format `https://github.com/owner/repo`.
- Never create a new product-repo mapping unless the user explicitly selects or confirms the exact product and GitHub repository URL.
- If `--file` is used, the file must contain `author` (git username) and `date` (YYYY-MM-DD) fields.
- After `cawplan ai-session report --file <path>` succeeds, allow its default monthly backfill to run unless the user explicitly asks to skip it.
- Preserve raw fields in `human_inputs` (for example `start_time`, `end_time`, `files_changed`, `lines_added`, `lines_deleted`).
- Never replace raw `human_inputs` with summarized content.

## Confirmation

After uploading, report:

- Report date acknowledged by the server.
- Number of sessions per agent from the reviewed file summary.
- Code field (SUCCESS / FAILURE).
- If FAILURE, show the error message.

## References

- `references/CAWPLAN_OPEN_API.md`
