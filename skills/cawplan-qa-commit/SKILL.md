---
version: 0.2.8
name: cawplan-qa-commit
description: |
  Use when the user asks to collect, submit, upload, or summarize CawPlan QA session daily JSON — e.g. 提交 QA 日报, QA 日报, 测试日报, 提交测试日报, QA 会话上报, or /cawplan-qa-commit.
  NOT for: coding/代码日报 (use cawplan-coding-commit), git commits, viewing insights, querying costs, or searching tickets.
argument-hint: "[date, YYYY-MM-DD, or YYYY-MM]"
allowed-tools: Bash
---

# CawPlan QA Commit

## Bootstrap

```bash
cawplan skill check
```

## Workflow

This skill supports two workflows:
- **Single-day workflow:** Collect → Assign → Review → Upload
- **Month-missing workflow:** Query cloud missing QA dates for a month → collect, assign, review, and upload only missing dates

**Out of scope for this skill (do not improvise):**
- `cawplan session backfill` — that command checks **coding** dailies (`ai-session-usage`), not QA. Use `cawplan session qa-backfill --dry-run` instead.
- `cawplan session qa-backfill` without `--dry-run` — batch upload is not implemented in the CLI yet; never omit `--dry-run` on `qa-backfill`.
- Ticket progress write-back (`cawplan tickets update --progress_comment`).
- `cawplan session assign --web` (coding flow with git-repo mapping).
- Current-month auto backfill after a single-day upload (no Step 7–11 equivalent).

Supported **single-day** arguments:
- no date, `today` → today's date
- `yesterday`, `yestoday` → yesterday's date (`yestoday` is accepted as a common typo)
- `YYYY-MM-DD` → the exact daily date

Supported **month-missing** arguments:
- `last month` → the previous calendar month
- `YYYY-MM` → that exact calendar month
- natural-language requests that ask to upload/fill missing **QA** daily reports for a specific month → that calendar month

Examples:
- `/cawplan-qa-commit`
- `/cawplan-qa-commit yesterday`
- `/cawplan-qa-commit 2026-08-20`
- `/cawplan-qa-commit last month`
- `/cawplan-qa-commit 2026-08`

If the user provides a single-day argument, resolve it before Step 1 and follow **Single-day workflow** below. If the user provides a month-missing argument, skip the single-day workflow and follow **Month-missing workflow** below. If the user provides an unsupported argument, ask for a valid date or month instead of guessing.

If the user mentions both QA and coding dailies in one request, **ask once** which they want (QA only / coding only / both). Do not run both skills by default.

Always collect and present the review summary before uploading. Proceed to upload after the user confirms the review (or immediately after assignment when the review is already shown inline).

## Permission Minimization

- Run each logical phase as one shell block instead of many tiny commands.
- When using Cursor agent shell tools for any collection phase, request full network access once for the whole shell block (`required_permissions: ["full_network"]`), because collection may call the Cursor Dashboard API at `cursor.com`.
- Store every generated `qa-daily-*.json` file in a system temporary directory, not in the current repository. This avoids repository write prompts and keeps generated report files out of the working tree.
- Reuse the same workflow-scoped temp directory for collect, assign, review, and upload.

Before collecting, create one workflow-scoped QA temp directory (matches the CLI default for `collect --mode qa` when `--output` is omitted):
```bash
qa_daily_dir="${TMPDIR:-/tmp}/cawplan-qa-daily"
mkdir -p "$qa_daily_dir"
daily_file="$qa_daily_dir/qa-daily-<YYYY-MM-DD>.json"
```

Use absolute paths under `qa_daily_dir` for every subsequent collect, assign, review, and upload step. Do not write generated QA daily JSON into the current working directory unless the user explicitly provides an output path.

Collect also writes `qa-daily-<YYYY-MM-DD>.excluded.json` beside each daily file; `qa-assign` reads that sidecar for the supplement list. Do not hand-edit or delete the sidecar unless you are intentionally discarding excluded-session context.

### Month-Missing Workflow

Use this workflow when the user asks to upload/fill missing **QA** reports for a month, or provides a month argument such as `last month` or `YYYY-MM`.

**Step M1 — Resolve month range:**
- For `last month`, use the first and last day of the previous calendar month.
- For a past `YYYY-MM`, use the first and last day of that month.
- For the current `YYYY-MM`, use the first day of the month through today.
- Never include dates outside the requested month.

**Step M2 — Query cloud missing dates:**
```bash
cawplan session qa-backfill --from <YYYY-MM-01> --to <YYYY-MM-last-or-today> --dry-run
```

Only use `missing_dates` from this dry run. Do not collect or overwrite dates that are already uploaded. If `missing_dates` is empty, tell the user there are no missing QA reports for the requested month and stop.

`missing_dates` is a calendar gap list (weekends and holidays are not excluded). Present the list to the user; they may skip dates they did not work.

**Step M3 — Collect missing dates with bounded concurrency:**
```bash
collect_concurrency="${CAWPLAN_COLLECT_CONCURRENCY:-5}"
i=0
for date in <date1> <date2> ...; do
  cawplan session collect --date $date --mode qa --output "$qa_daily_dir/qa-daily-$date.json" &
  i=$((i + 1))
  if [ $((i % collect_concurrency)) -eq 0 ]; then
    wait
  fi
done
wait
```

Use bounded concurrency because each collection may call the Cursor Dashboard API. The default concurrency is 5; reduce `CAWPLAN_COLLECT_CONCURRENCY` only when the network or Cursor API is unstable.

**Step M4 — Product/ticket assignment:**

Run **Product/ticket assignment** for each newly collected missing-date file **in date order**, one `qa-assign` at a time. Wait for each assignment command to finish before starting the next date (QA assignment currently supports one file per command).

**Step M5 — Review:**

For every missing date you will upload, present the full review described in **Review content contract** before upload. Do not show only a stats table.

**Step M6 — Upload missing reports:**

Upload each newly collected missing-date file individually in date order:
```bash
cawplan session qa-upload --file "$qa_daily_dir/qa-daily-<YYYY-MM-DD>.json"
```

After upload, report the requested month, uploaded dates, number of QA sessions per uploaded report, and each server response code. Do not cross month boundaries.

### Single-Day Workflow

**Step 1 — Collect:**
```bash
daily_file="$qa_daily_dir/qa-daily-<YYYY-MM-DD>.json"
cawplan session collect --date <YYYY-MM-DD> --mode qa --output "$daily_file"
```

**Step 2 — Product/ticket assignment:**

Open the QA assignment confirmation page from the collected file (no git-project column — product and tickets only):
```bash
cawplan session qa-assign --file "$daily_file"
```

Run `qa-assign` as a **background** / non-blocking shell task (e.g. Bash `run_in_background: true`), never as a plain foreground call — the command idles for up to 10 minutes waiting on browser input, and a foreground call left waiting can get suspended by the shell's job control before the user finishes, leaving a dead process still holding the port.

Keep exactly one `qa-assign` command running until the user finishes in the browser. The command exits when the user clicks **Save assignments**, clicks **Close**, presses Ctrl+C in the terminal, or the local assignment server reaches its 10-minute timeout.

Do not rerun `qa-assign` while a previous assignment command is still running for the same `daily_file`, even if it has been waiting for a long time. Long waits mean the page is waiting for user action, not that the command failed. If you need to report progress, tell the user to finish the already-open assignment page by saving or closing it, then wait for the existing command to exit or time out before continuing.

If the assignment page fails to load or a previous run seems stuck, check for a stopped process first (`ps aux | grep "session qa-assign"`; a `STAT` of `T` means it was suspended and is no longer serving) before assuming the command failed. Only kill and restart when the process is actually stopped, not merely still waiting.

The page lets the user:
- Confirm collected QA sessions (session id, agent, skill layers — may be empty, testpoint counts, requirements)
- Adjust **one product per session** via dropdown
- Edit ticket display IDs
- **Optionally** add sessions from the commit-only / empty exclusion list (no manual session-id typing)

**Step 3 — Ticket context check:**

Do not ask the user to manually provide ticket IDs during reporting. `cawplan session collect --mode qa` parses explicit ticket refs from session `human_inputs`, including CawPlan issue URLs and display IDs; the assignment page resolves display IDs to internal `ticket_ids` when the user saves.

When reviewing `$daily_file`, mention any `sessions[].ticket_ids` and `sessions[].ticket_display_ids` already present after assign. Ticket context must come from explicit human-input refs or assignment-page edits; do not keyword-search or guess tickets.

**Step 4 — Review:**

Present the full review described in **Review content contract** before upload. Do not show only a stats table.

**Step 5 — Upload:**
```bash
cawplan session qa-upload --file "$daily_file"
```

Echo the server response, including any `report_id` UUID returned on success. Do **not** run a current-month missing-date query or additional backfill after this upload.

---

## Review content contract

Before upload, include:

- Basic facts: date, author, total QA sessions, agents, total cost.
- Overall summary: write 2–4 sentences on what QA work happened across sessions (requirements exercised, test points/cases produced, tickets touched). The QA payload has no top-level `summary` field — derive this from sessions and `human_inputs[].content`.
- Session review: for each important session, include `session_title`, agent, `display_time_range` when present, cost, `skill_layers`, requirement/testpoint/testcase counts, `product_id`, and ticket display IDs. Add 1–2 sentences on what work happened; do not list only title and counts.
- Assignment notes: sessions optionally added from the supplement list, or sessions left without a product (allowed — backend accepts empty `product_id`).
- Data quality notes: count of sessions with empty `skill_layers` or missing `product_id`; excluded sessions printed during collect (commit-only or empty only, if any) and whether the user supplemented any on the assignment page; collect stderr warnings; sessions without cost; unresolved ticket display IDs on the assignment page.

Do not summarize `human_inputs` with coding-only fields such as `category` or `topic` — the QA payload does not include them.

## Product/ticket assignment

- Always use `cawplan session qa-assign --file <absolute-qa-daily-file>` for web confirmation. Do **not** use `collect --mode qa --assign` (that re-collects) or `cawplan session assign --web` (coding flow with git-project mapping).
- Product selection uses the same CawPlan product catalog as coding insights, but **without** git-project linking. The product picker (same source as `cawplan session products`) excludes products whose `controls` array does not include `coding-insights` — if the product the user wants is missing, tell them it has not enabled coding insights; do not guess a substitute or hand-edit `product_id` in the JSON.
- One session maps to at most one product. Empty product is allowed when the user cannot determine it yet.
- On save, the assignment page resolves ticket display IDs to internal `ticket_ids` via Cloud; unresolved display IDs fail save with an error — surface that error to the user instead of uploading a stale file.

## Rules

- Every collect command in this skill **must** include `--mode qa`.
- Do not fabricate session data. Only include what local agents produce plus explicit user edits on the assignment page.
- Do not use coding temp paths (`cawplan-ai-daily` / `ai-daily-*.json`) for QA dailies.
- If `--file` / `daily_file` is used, the JSON must contain `schema: "qa-session.1"`, `author`, and `date`.
- Preserve raw `human_inputs` fields that the QA schema allows (`content`, `assistant_message`, `session_id`, `start_time`, `end_time`). Never add `category`, `topic`, or related coding-only keys.
- Never replace raw `human_inputs` with summarized content in the JSON file. Summaries belong only in the conversational review before upload.
- Do not keyword-search or guess tickets, products, or requirements beyond what collect and the assignment page resolve.
- Do not use `cawplan session report`, `cawplan session backfill`, or `cawplan session assign --web` in this workflow.
- Use `cawplan session qa-backfill` **only** with `--dry-run` for gap detection. Upload missing dates via collect → qa-assign → review → `qa-upload` per date; do not call `qa-backfill` without `--dry-run`.
- Do not run current-month auto backfill after a single-day upload.
- When the user says only 「提交日报」 without QA/测试 wording, **do not** use this skill — route to `cawplan-coding-commit` instead.

## Confirmation

After uploading, show:

- Daily date acknowledged by the server.
- Number of QA sessions from the uploaded file.
- `report_id` when the server returns one.
- Code field (SUCCESS / FAILURE).
- If FAILURE, show the error message verbatim.

## References

- `references/CAWPLAN_OPEN_API.md`
- `docs/bedoc/qa-session-report-openapi-api.md` — QA session daily upload (`POST /qa-session-usage/reports`) and read APIs
