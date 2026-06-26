---
version: 0.2.1
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
command -v cawplan >/dev/null || { echo "cawplan is not installed. Run: npm install -g cawplan@latest"; exit 1; }
cawplan_version="$(cawplan --version)"
node -e 'const [current, required] = process.argv.slice(1); const parse = (v) => v.split(".").map(Number); const [a, b, c] = parse(current); const [x, y, z] = parse(required); process.exit(a > x || (a === x && (b > y || (b === y && c >= z))) ? 0 : 1);' "$cawplan_version" "0.0.7" || { echo "cawplan >= 0.0.7 is required. Run: npm install -g cawplan@latest"; exit 1; }
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

### Mode 1: Collect → Review → Upload → Current-Month Backfill

Use when the user explicitly asks to upload or submit the report, or when the user invokes `/cawplan-coding-commit` with no additional prompt or arguments.

Always collect and present the AI-summarized review before uploading. Do not wait for a second confirmation after the review; proceed to upload immediately.

**Step 1 — Collect:**
```bash
cawplan ai-session collect --date <YYYY-MM-DD>
# output defaults to ./ai-daily-<date>.json
```

When running this command from Cursor agent tools, request full network access (`required_permissions: ["full_network"]`) because Cursor token/cost collection depends on the Cursor Dashboard API at `cursor.com`.

During collection, `cawplan ai-session collect` may ask the user to assign each session to a CawPlan product and repository using existing product-repo mappings. If no mapping exists, the user can link a GitHub repository URL in the required format `https://github.com/owner/repo`.

In Cursor, agent-run shell commands may not have an interactive TTY. If product/repo assignment is skipped because prompts cannot be shown, complete missing assignments in Step 3.

**Step 2 — Classify human inputs (LLM):**

Read `./ai-daily-<date>.json`. If `human_inputs` is non-empty, classify every entry in a single batch using the prompt below. Write the results back into the JSON file by updating each `human_input`'s `category`, `topic`, `topic_confidence`, `topic_reason`, and `topic_source` fields. If `human_inputs` is empty or absent, skip this step and continue.

Classification prompt to use:

> Classify each AI coding session human input below. Return a JSON array — one object per input — with these exact fields:
> `{ "index": N, "category": "...", "topic": "...", "topic_confidence": 0.0–1.0, "topic_reason": "one sentence" }`
>
> **category** (pick one):
> - `decision` — human chose between options ("定了", "agreed", "use X instead of Y")
> - `direction` — human instructed AI what to build (default when nothing else fits)
> - `correction` — human corrected AI output or reported an error ("bug", "fix", "报错")
> - `planning` — human planned or designed the approach ("计划", "roadmap", "下一步")
>
> **topic** (pick one):
> - `bug` — fixing a defect or regression
> - `ux` — UI, interaction, or visual design
> - `security` — authentication, authorization, or vulnerability
> - `performance` — speed, memory, latency, or throughput
> - `new_feature` — adding new functionality
> - `improvement` — refactor, cleanup, or enhancement of existing code
> - `docs` — documentation, README, or comments
> - `infra` — CI/CD, build, deploy, or environment
> - `other` — does not fit any category above
>
> Inputs (truncate content to 200 chars if needed):
> [0] session:"<session_title>" content:"<human_input_content>"
> [1] ...

After receiving the JSON array, write back to `./ai-daily-<date>.json`: for each entry at `index` N, set:
- `human_inputs[N].category` = classified `category`
- `human_inputs[N].topic` = classified `topic`
- `human_inputs[N].topic_confidence` = classified `topic_confidence`
- `human_inputs[N].topic_reason` = classified `topic_reason`
- `human_inputs[N].topic_source` = `"llm"`

If the classification response is malformed or an error occurs, leave the existing values unchanged and continue.

**Step 3 — Product/repo assignment:**

Read `./ai-daily-<date>.json`. If any `sessions[]` entry lacks `product_id`, ask the user to choose **Option A** or **Option B** from **Product/repo assignment options** and complete all missing assignments before continuing.

**Step 4 — Review the report with the user:**

Present the full review described in **Review content contract**. Do not show only a stats table.

**Step 5 — Upload:**
```bash
cawplan ai-session report --file ./ai-daily-<date>.json
```

**Step 6 — Query missing current-month reports:**
```bash
cawplan ai-session backfill --from <YYYY-MM-01> --to <YYYY-MM-DD> --dry-run
```

Use the first day of the report's month as `--from` and the report date as `--to`. Show the returned `missing_dates` to the user. If there are no missing dates, say so and stop.

**Step 7 — Collect each missing date:**

For each date in `missing_dates`, collect its report:
```bash
cawplan ai-session collect --date <YYYY-MM-DD>
# output defaults to ./ai-daily-<date>.json
```

**Step 8 — Classify missing reports' human inputs (LLM):**

For each newly collected `./ai-daily-<date>.json`, classify human inputs using the same batch prompt as Step 2 and write results back.

**Step 9 — Product/repo assignment for missing reports:**

Inspect all newly collected files. If any session across these files lacks `product_id`, ask the user to choose **Option A** or **Option B**. For multiple files, prefer the `--files` form to batch-assign all at once before continuing.

**Step 10 — Upload missing reports:**

Upload each file individually in date order:
```bash
cawplan ai-session report --file ./ai-daily-<YYYY-MM-DD>.json
```

Backfill must stay within the uploaded report's current month and must not cross month boundaries.

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

**Step 2 — Classify human inputs (LLM):**

Read `./ai-daily-<date>.json`. If `human_inputs` is non-empty, classify every entry in a single batch using the prompt below. Write the results back into the JSON file by updating each `human_input`'s `category`, `topic`, `topic_confidence`, `topic_reason`, and `topic_source` fields. If `human_inputs` is empty or absent, skip this step and continue.

Classification prompt to use:

> Classify each AI coding session human input below. Return a JSON array — one object per input — with these exact fields:
> `{ "index": N, "category": "...", "topic": "...", "topic_confidence": 0.0–1.0, "topic_reason": "one sentence" }`
>
> **category** (pick one):
> - `decision` — human chose between options ("定了", "agreed", "use X instead of Y")
> - `direction` — human instructed AI what to build (default when nothing else fits)
> - `correction` — human corrected AI output or reported an error ("bug", "fix", "报错")
> - `planning` — human planned or designed the approach ("计划", "roadmap", "下一步")
>
> **topic** (pick one):
> - `bug` — fixing a defect or regression
> - `ux` — UI, interaction, or visual design
> - `security` — authentication, authorization, or vulnerability
> - `performance` — speed, memory, latency, or throughput
> - `new_feature` — adding new functionality
> - `improvement` — refactor, cleanup, or enhancement of existing code
> - `docs` — documentation, README, or comments
> - `infra` — CI/CD, build, deploy, or environment
> - `other` — does not fit any category above
>
> Inputs (truncate content to 200 chars if needed):
> [0] session:"<session_title>" content:"<human_input_content>"
> [1] ...

After receiving the JSON array, write back to `./ai-daily-<date>.json`: for each entry at `index` N, set:
- `human_inputs[N].category` = classified `category`
- `human_inputs[N].topic` = classified `topic`
- `human_inputs[N].topic_confidence` = classified `topic_confidence`
- `human_inputs[N].topic_reason` = classified `topic_reason`
- `human_inputs[N].topic_source` = `"llm"`

If the classification response is malformed or an error occurs, leave the existing values unchanged and continue to Step 3.

**Step 3 — Review the report with the user:**

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

For multiple files, run one `report --file` command per file. Do not guess alternate command names. Do not run historical backfill for pre-existing file uploads unless the user explicitly asks for missing monthly reports to be collected and uploaded.

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

- **Option A — TTY selector assignment:** Use when the user chooses to complete assignment in their own terminal with the CLI's native selector. For one report, tell the user to run `cawplan ai-session assign --file <absolute-ai-daily-file> --tty`. For multiple reports, tell the user to run `cawplan ai-session assign --tty --files <absolute-ai-daily-file-1> --files <absolute-ai-daily-file-2>`. Do not run these commands from the agent shell. Always provide absolute report file paths so the command works from any current directory. This calls the same cloud-mapping assignment flow used by collection and writes the updated file(s).
- **Option B — Local Web assignment:** Use when the agent shell has no TTY, the report has many sessions, the user wants a visual table, or multiple historical reports need assignment. For one report, tell the user to run `cawplan ai-session assign --file <absolute-ai-daily-file> --web` in their own terminal. For multiple reports, prefer `cawplan ai-session assign --web --files <absolute-ai-daily-file-1> --files <absolute-ai-daily-file-2>`. The page shows `session / human inputs / product / repo`, requires product, supports product-only assignment, and can link a new GitHub repository URL in the format `https://github.com/owner/repo`.

## Rules

- If no `--date` is given, defaults to today.
- Do not fabricate session data. Only report what the agents produce locally.
- When running `cawplan ai-session collect` from Cursor agent tools, request full network access (`required_permissions: ["full_network"]`) so Cursor Dashboard token/cost data can be fetched from `cursor.com`.
- If product/repo assignment prompts appear during collection, only use explicit user selections or existing mappings.
- Before reviewing or uploading, inspect every `sessions[]` entry. If any session lacks `product_id`, ask the user to choose Option A or Option B, even when the session has no file changes or repository data.
- Product selection is required for every session in both `--tty` and `--web`; repository selection is optional.
- If product/repo assignment is skipped in Cursor because the agent shell is non-interactive, ask the user to choose Option A or Option B. For one report, provide the single-file command with `--file <absolute-ai-daily-file>`. For multiple reports, prefer `--files <absolute-ai-daily-file>` repeated once per JSON file with either `--web` or `--tty`.
- GitHub repository URLs used to create mappings must be in the format `https://github.com/owner/repo`.
- Never create a new product-repo mapping unless the user explicitly selects or confirms the exact product and GitHub repository URL.
- If `--file` is used, the file must contain `author` (git username) and `date` (YYYY-MM-DD) fields.
- After upload succeeds in Mode 1, follow Steps 6–10: query missing dates with `--dry-run`, then for each missing date collect → classify → assign → upload individually. Do not use `cawplan ai-session backfill` without `--dry-run` in Mode 1.
- Do not automatically backfill previous months or cross-month ranges during daily Mode 1. Only use a previous-month or custom range when the user explicitly asks to collect/upload that historical range.
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
