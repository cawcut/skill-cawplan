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

In Cursor, agent-run shell commands may not have an interactive TTY. If product/repo assignment is skipped because prompts cannot be shown, complete missing assignments in chat using **Chat-based product/repo assignment** below before reviewing/uploading.

**Step 2 — Review the report with the user:**

Present the full review described in **Review content contract**. Do not show only a stats table.

**Step 3 — Upload:**
```bash
cawplan ai-session report --file ./ai-daily-<date>.json
```

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

In Cursor, agent-run shell commands may not have an interactive TTY. If product/repo assignment is skipped because prompts cannot be shown, complete missing assignments in chat using **Chat-based product/repo assignment** below before reviewing.

### Mode 3: Upload pre-existing file(s)

Use when the user provides one or more existing report files and asks to upload/submit/report them.

Always inspect and summarize before uploading. Do not wait for a second confirmation after the review; proceed to upload immediately.

**Step 1 — Inspect each file:**
- Confirm the file exists and contains `author` and `date`.
- Present the full review described in **Review content contract** for each report file.
- If any important `sessions[]` entry lacks `product_id`, complete **Chat-based product/repo assignment** before uploading.
- Preserve raw `human_inputs`; never rewrite the JSON just to summarize it.

**Step 2 — Upload each file sequentially:**
```bash
cawplan ai-session report --file <path>
```

For multiple files, run one `report --file` command per file. Do not guess alternate command names.

---

## Review content contract

Before asking for upload confirmation, include these sections:

- Basic facts: date, author, total sessions by agent, total cost, files changed, repos touched.
- Overall summary: use the report's `summary` field when present; otherwise write 2-4 sentences from sessions, repos, and human inputs.
- Session review: for each important session, include title/name, agent, time range, cost, repo/files changed, and 1-2 sentences describing what work happened. Do not list only title/time/cost.
- Human input highlights: summarize notable `human_inputs` by category (`decision`, `direction`, `correction`, `planning`) and include representative prompts when useful.
- Data quality notes: mention missing/estimated costs, API warnings, sessions without cost, or empty models.

Use a compact table for numbers if useful, but always include the narrative summary and session review text.

## Chat-based product/repo assignment

Use this flow after collection when any important `sessions[]` entry lacks `product_id`.

There are two supported ways to complete missing assignment. First ask the user to choose Option A or Option B; do not choose on their behalf.

- **Option A — Chat-directed assignment:** Use when the user chooses to complete assignment in the current chat. Query products/mappings, ask the user, then write the exact assignment with `cawplan ai-session assign --file ... --session-id ...`.
- **Option B — TTY selector assignment:** Use when the user chooses to complete assignment in their own terminal with the CLI's native selector. Tell the user to run `cawplan ai-session assign --file <absolute-ai-daily-file> --tty`; do not run this command from the agent shell. Always provide an absolute report file path so the command works from any current directory. This calls the same cloud-mapping assignment flow used by collection and writes the updated file.

For Option A:

1. Inspect the report and list unassigned sessions with `session_id`, `session_name`, `session_title`, `project`, and touched repos.
2. Query products and mappings in chat:
   ```bash
   cawplan ai-session products
   cawplan ai-session product-repos
   ```
3. Ask the user which product and repo should be used. Do not guess missing mappings beyond existing cloud mappings.
4. If the user selects an existing mapping, write it back:
   ```bash
   cawplan ai-session assign --file <ai-daily-file> --session-id <session-id> --product-id <product-id> --repo-name <repo-name>
   ```
5. If the user chooses product-only assignment, write it back:
   ```bash
   cawplan ai-session assign --file <ai-daily-file> --session-id <session-id> --product-id <product-id>
   ```
6. If no mapping exists and the user wants to link a repository, first show the exact product and GitHub repository URL, then wait for explicit confirmation. After confirmation, run:
   ```bash
   cawplan ai-session assign --file <ai-daily-file> --session-id <session-id> --product-id <product-id> --repo-url https://github.com/owner/repo --create-mapping
   ```
7. Re-read the report after assignment and include updated product/repo status in the review.

## Rules

- If no `--date` is given, defaults to today.
- Do not fabricate session data. Only report what the agents produce locally.
- When running `cawplan ai-session collect` from Cursor agent tools, request full network access (`required_permissions: ["full_network"]`) so Cursor Dashboard token/cost data can be fetched from `cursor.com`.
- If product/repo assignment prompts appear during collection, only use explicit user selections or existing mappings.
- If product/repo assignment is skipped in Cursor because the agent shell is non-interactive, ask the user to choose Option A or Option B. For Option A, keep the user in chat and use unfiltered `cawplan ai-session products`, unfiltered `cawplan ai-session product-repos`, and `cawplan ai-session assign` to complete assignment. For Option B, tell the user to run `cawplan ai-session assign --file <absolute-ai-daily-file> --tty` in their own terminal, using the report's absolute path.
- GitHub repository URLs used to create mappings must be in the format `https://github.com/owner/repo`.
- Never create a new product-repo mapping unless the user explicitly confirms the exact product and GitHub repository URL in chat.
- If `--file` is used, the file must contain `author` (git username) and `date` (YYYY-MM-DD) fields.
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
