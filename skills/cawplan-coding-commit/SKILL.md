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
latest_cawplan_version="$(npm view cawplan version 2>/dev/null)" || { echo "Unable to check latest cawplan version. Run: cawplan upgrade"; exit 1; }
node -e 'const [current, latest] = process.argv.slice(1); process.exit(current === latest ? 0 : 1);' "$cawplan_version" "$latest_cawplan_version" || { echo "cawplan $latest_cawplan_version is available (current: $cawplan_version). Run: cawplan upgrade"; exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

## Workflow

This skill supports two workflows:
- **Single-day workflow:** Collect → Review → Upload → Current-Month Backfill
- **Month-missing workflow:** Query cloud missing dates for a month → collect and upload only missing dates

Use it when the user invokes `cawplan-coding-commit` or `/cawplan-coding-commit`, with or without a date or month argument. Do not use this skill for a plain `git commit` request unless the user explicitly mentions CawPlan, AI report upload, or an `ai-daily-*.json` file.

Supported single-day arguments:
- no date, `today` → today's date
- `yesterday`, `yestoday` → yesterday's date (`yestoday` is accepted as a common typo)
- `YYYY-MM-DD` → the exact report date
- natural-language requests that ask to upload yesterday's daily report → yesterday's date
- natural-language requests that ask to upload the daily report for a specific `YYYY-MM-DD` date → that exact date

Supported month-missing arguments:
- `last month` → the previous calendar month
- `YYYY-MM` → that exact calendar month
- natural-language requests that ask to upload/fill missing daily reports for a specific month → that calendar month

Examples:
- `/cawplan-coding-commit`
- `/cawplan-coding-commit yesterday`
- `/cawplan-coding-commit 2026-06-20`
- `/cawplan-coding-commit last month`
- `/cawplan-coding-commit 2026-06`

If the user provides a single-day argument, resolve it before Step 1 and use that date in every command below. If the user provides a month-missing argument, skip the single-day workflow and follow **Month-missing workflow** below. If the user provides an unsupported argument, ask for a valid date or month instead of guessing.

Always collect and present the AI-summarized review before uploading. Do not wait for a second confirmation after the review; proceed to upload immediately.

## Report File Location

Store every generated `ai-daily-*.json` report in a system temporary directory, not in the current repository.

Before collecting reports, create one workflow-scoped temp directory with Node.js so the same command works on macOS, Linux, and Windows:
```bash
report_dir="$(node -e 'const {mkdtempSync} = require("node:fs"); const {join} = require("node:path"); const {tmpdir} = require("node:os"); console.log(mkdtempSync(join(tmpdir(), "cawplan-ai-daily-")));')"
```

Use absolute file paths under this directory for every subsequent collect, classify, assign, review, and upload step:
```bash
report_file="$report_dir/ai-daily-<YYYY-MM-DD>.json"
```

Do not write generated daily report JSON files into the current working directory unless the user explicitly provides an output path.

### Month-Missing Workflow

Use this workflow when the user asks to upload/fill missing reports for a month, or provides a month argument such as `last month` or `YYYY-MM`.

**Step M1 — Resolve month range:**
- For `last month`, use the first and last day of the previous calendar month.
- For a past `YYYY-MM`, use the first and last day of that month.
- For the current `YYYY-MM`, use the first day of the month through today.
- Never include dates outside the requested month.

**Step M2 — Query cloud missing dates:**
```bash
cawplan ai-session backfill --from <YYYY-MM-01> --to <YYYY-MM-last-or-today> --dry-run
```

Only use `missing_dates` from this dry run. Do not collect or overwrite dates that are already uploaded. If `missing_dates` is empty, tell the user there are no missing reports for the requested month and stop.

**Step M3 — Collect missing dates in parallel:**
```bash
for date in <date1> <date2> ...; do
  cawplan ai-session collect --date $date --output "$report_dir/ai-daily-$date.json" &
done
wait
```

**Step M4 — Classify all newly collected reports and rewrite session titles:**

Classify human inputs from all newly collected `$report_dir/ai-daily-<date>.json` files in a single batch using the same prompt as Step 2 below. Then rewrite `sessions[].session_title` for all newly collected files using the session title rewrite prompt from Step 2. Write both classifications and rewritten titles back before assignment or upload.

**Step M5 — Product/repo assignment:**

Inspect all newly collected files. If any session across these files lacks `product_id`, immediately run the Web assignment command from **Product/repo assignment**. For multiple files, prefer the `--files` form to batch-assign all at once before continuing.

**Step M6 — Upload missing reports:**

Upload each newly collected missing-date file individually in date order:
```bash
cawplan ai-session report --file "$report_dir/ai-daily-<YYYY-MM-DD>.json"
```

After upload, report the requested month, uploaded dates, number of sessions per uploaded report, and each server response code.

### Single-Day Workflow

**Step 1 — Collect:**
```bash
report_file="$report_dir/ai-daily-<YYYY-MM-DD>.json"
cawplan ai-session collect --date <YYYY-MM-DD> --output "$report_file"
```

When running this command from Cursor agent tools, request full network access (`required_permissions: ["full_network"]`) because Cursor token/cost collection depends on the Cursor Dashboard API at `cursor.com`.

During collection, `cawplan ai-session collect` may ask the user to assign each session to a CawPlan product and repository using existing product-repo mappings. If no mapping exists, the user can link a GitHub repository URL in the required format `https://github.com/owner/repo`.

In Cursor, if product/repo assignment is skipped during collection because prompts cannot be shown, complete missing assignments through the Web assignment flow in Step 3.

**Step 2 — Classify human inputs and rewrite session titles (LLM):**

Read `$report_file`. If `human_inputs` is non-empty, classify every entry in a single batch using the prompt below. Write the results back into the JSON file by updating each `human_input`'s `category`, `topic`, `topic_confidence`, `topic_reason`, and `topic_source` fields. If `human_inputs` is empty or absent, skip this step and continue.

Classification prompt to use:

> Classify each AI coding session human input below. Return a JSON array — one object per input — with these exact fields:
> `{ "index": N, "category": "...", "topic": "...", "topic_confidence": 0.0–1.0, "topic_reason": "one sentence" }`
>
> **category** (pick one):
> - `decision` — human chose between options ("agreed", "use X instead of Y")
> - `direction` — human instructed AI what to build (default when nothing else fits)
> - `correction` — human corrected AI output or reported an error ("bug", "fix", "error")
> - `planning` — human planned or designed the approach ("plan", "roadmap", "next step")
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

After receiving the JSON array, write back to `$report_file`: for each entry at `index` N, set:
- `human_inputs[N].category` = classified `category`
- `human_inputs[N].topic` = classified `topic`
- `human_inputs[N].topic_confidence` = classified `topic_confidence`
- `human_inputs[N].topic_reason` = classified `topic_reason`
- `human_inputs[N].topic_source` = `"llm"`

If the classification response is malformed or an error occurs, leave the existing values unchanged and continue.

After classification, rewrite every session's `session_title` from the human inputs that belong to that session. Group `human_inputs` by `session_id`; if a session has no human inputs, leave its existing title unchanged.

Session title rewrite prompt to use:

> Rewrite AI coding session titles from the session-specific human inputs below. Return a JSON array — one object per session — with these exact fields:
> `{ "session_id": "...", "session_title": "...", "title_reason": "one sentence" }`
>
> Rules:
> - Use only the human inputs listed for that session.
> - Create a concise, human-readable title, ideally 4-10 words.
> - Prefer the actual product area, feature, bug, workflow, or document being changed.
> - Avoid generic titles such as "coding session", "daily report", "git commit", or the raw command name unless that is truly the work.
> - Preserve a user's explicit task name when it is already clear and specific.
> - If the inputs are mostly in a non-English language, the title may use that language; otherwise prefer English.
>
> Sessions:
> session_id:"<session_id>" current_title:"<existing_session_title>"
> inputs:
> - category:"<category>" topic:"<topic>" content:"<human_input_content>"
> - ...

After receiving the JSON array, write back to `$report_file`: for each returned `session_id`, find the matching `sessions[]` entry and set:
- `sessions[].session_title` = rewritten `session_title`
- `sessions[].session_title_source` = `"llm"`
- `sessions[].session_title_reason` = returned `title_reason`

If the title rewrite response is malformed or an error occurs, leave existing session titles unchanged and continue.

**Step 3 — Product/repo assignment:**

> **Order is fixed: always complete Step 2 (LLM classification) before this step.** Classification does not depend on product assignment and must not be deferred until after assignment.

Read `$report_file`. If any `sessions[]` entry lacks `product_id`, immediately run the Web assignment command from **Product/repo assignment** and complete all missing assignments before continuing.

**Step 4 — Review the report with the user:**

Present the full review described in **Review content contract**. Do not show only a stats table.

**Step 5 — Upload:**
```bash
cawplan ai-session report --file "$report_file"
```

**Step 6 — Query missing current-month reports:**
```bash
cawplan ai-session backfill --from <YYYY-MM-01> --to <YYYY-MM-DD> --dry-run
```

Use the first day of the report's month as `--from` and the report date as `--to`. Show the returned `missing_dates` to the user. If there are no missing dates, say so and stop.

**Step 7 — Collect each missing date (parallel):**

Launch all missing dates in parallel — do NOT collect sequentially:
```bash
for date in <date1> <date2> ...; do
  cawplan ai-session collect --date $date --output "$report_dir/ai-daily-$date.json" &
done
wait
```
Each date is independent; parallel collection cuts total time to the slowest single date instead of the sum of all dates.

**Step 8 — Classify missing reports' human inputs and rewrite session titles (LLM):**

Classify human inputs from **all** newly collected files in `$report_dir` in a single batch operation using the same prompt as Step 2. Then rewrite `sessions[].session_title` for those files using the same session title rewrite prompt from Step 2. For files with empty `human_inputs`, skip silently. Write results back to all files before moving to Step 9.

**Step 9 — Product/repo assignment for missing reports:**

Inspect all newly collected files. If any session across these files lacks `product_id`, immediately run the Web assignment command from **Product/repo assignment**. For multiple files, prefer the `--files` form to batch-assign all at once before continuing.

**Step 10 — Upload missing reports:**

Upload each file individually in date order:
```bash
cawplan ai-session report --file "$report_dir/ai-daily-<YYYY-MM-DD>.json"
```

Backfill must stay within the uploaded report's current month and must not cross month boundaries.

---

## Review content contract

Before asking for upload confirmation, include these sections:

- Basic facts: date, author, total sessions by agent, total cost, files changed, repos touched.
- Overall summary: use the report's `summary` field when present; otherwise write 2-4 sentences from sessions, repos, and human inputs.
- Session review: for each important session, include title/name, agent, time range, cost, repo/files changed, and 1-2 sentences describing what work happened. Do not list only title/time/cost.
- Human input highlights: summarize notable `human_inputs` by category (`decision`, `direction`, `correction`, `planning`) and include representative prompts when useful.
- Data quality notes: mention missing/estimated costs, API warnings, sessions without cost, or empty models.

Use a compact table for numbers if useful, but always include the narrative summary and session review text.

## Product/repo assignment

Use this flow after collection or inspection when any `sessions[]` entry lacks `product_id`.

Do not ask the user to choose an assignment mode. Always use the local Web assignment flow.

For one report, run:
```bash
cawplan ai-session assign --file <absolute-ai-daily-file> --web
```

For multiple reports, prefer:
```bash
cawplan ai-session assign --web --files <absolute-ai-daily-file-1> --files <absolute-ai-daily-file-2>
```

Run the command from the agent shell immediately so the local assignment page opens automatically in the browser. Keep the command running until the user finishes and saves the assignments in the browser. The page shows `session / human inputs / product / repo`, requires product, supports product-only assignment, and can link a new GitHub repository URL in the format `https://github.com/owner/repo`.

## Rules

- If no `--date` is given, defaults to today.
- Do not fabricate session data. Only report what the agents produce locally.
- When running `cawplan ai-session collect` from Cursor agent tools, request full network access (`required_permissions: ["full_network"]`) so Cursor Dashboard token/cost data can be fetched from `cursor.com`.
- If product/repo assignment prompts appear during collection, only use explicit user selections or existing mappings.
- Before reviewing or uploading, inspect every `sessions[]` entry. If any session lacks `product_id`, immediately run the Web assignment flow. Do this even when the session has no file changes or repository data.
- Product selection is required for every session in the Web assignment flow; repository selection is optional.
- If product/repo assignment is skipped in Cursor because the agent shell is non-interactive, immediately run the `--web` command from the agent shell and open the local assignment page automatically. For one report, use the single-file command with `--file <absolute-ai-daily-file>`. For multiple reports, prefer `--files <absolute-ai-daily-file>` repeated once per JSON file.
- GitHub repository URLs used to create mappings must be in the format `https://github.com/owner/repo`.
- Never create a new product-repo mapping unless the user explicitly selects or confirms the exact product and GitHub repository URL.
- If `--file` is used, the file must contain `author` (git username) and `date` (YYYY-MM-DD) fields.
- After a single-day upload succeeds, follow Steps 6–10: query missing dates in that report's current month with `--dry-run`, then for each missing date collect → classify → assign → upload individually. Do not use `cawplan ai-session backfill` without `--dry-run`.
- Do not automatically backfill previous months or cross-month ranges during the single-day workflow. Only use the month-missing workflow when the user explicitly provides a month argument or asks to upload/fill missing reports for that month.
- Preserve raw fields in `human_inputs` (for example `start_time`, `end_time`, `files_changed`, `lines_added`, `lines_deleted`).
- Never replace raw `human_inputs` with summarized content.
- Rewrite `sessions[].session_title` from that session's own `human_inputs` before review and upload. Do not use human inputs from another session to title a session.

## Confirmation

After uploading, report:

- Report date acknowledged by the server.
- Number of sessions per agent from the reviewed file summary.
- Code field (SUCCESS / FAILURE).
- If FAILURE, show the error message.

## References

- `references/CAWPLAN_OPEN_API.md`
