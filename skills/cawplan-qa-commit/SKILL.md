---
version: 0.2.8
name: cawplan-qa-commit
description: |
  Use when the user asks to collect, submit, upload, or summarize CawPlan QA session daily JSON — e.g. 提交 QA 日报, QA 日报, 测试日报, 提交测试日报, QA 会话上报, or /cawplan-qa-commit.
  NOT for: coding/代码日报 (use cawplan-coding-commit), git commits, viewing insights, querying costs, or searching tickets.
argument-hint: "[date or YYYY-MM-DD]"
allowed-tools: Bash
---

# CawPlan QA Commit

## Bootstrap

```bash
cawplan skill check
```

## Workflow

This skill covers a **single-day QA daily** workflow: Collect → Assign → Review → Upload.

Supported date arguments:
- no date, `today` → today's date
- `yesterday`, `yestoday` → yesterday's date (`yestoday` is accepted as a common typo)
- `YYYY-MM-DD` → the exact daily date

Examples:
- `/cawplan-qa-commit`
- `/cawplan-qa-commit yesterday`
- `/cawplan-qa-commit 2026-08-20`

If the user mentions both QA and coding dailies in one request, **ask once** which they want (QA only / coding only / both). Do not run both skills by default.

Always collect and present the review summary before uploading. Proceed to upload after the user confirms the review (or immediately after assignment when the review is already shown inline).

## Permission Minimization

- Run each logical phase as one shell block when possible.
- Store every generated `qa-daily-*.json` file in the QA temp directory, not in the current git working tree:
  ```bash
  qa_daily_dir="${TMPDIR:-/tmp}/cawplan-qa-daily"
  mkdir -p "$qa_daily_dir"
  daily_file="$qa_daily_dir/qa-daily-<YYYY-MM-DD>.json"
  ```
- Reuse the same `daily_file` path for collect, assignment, review, and upload in one workflow.

### Single-Day Workflow

**Step 1 — Collect:**
```bash
daily_file="$qa_daily_dir/qa-daily-<YYYY-MM-DD>.json"
cawplan session collect --date <YYYY-MM-DD> --mode qa --output "$daily_file"
```

**Step 2 — Product/ticket assignment:**

Open the QA assignment confirmation page (no git-project column — product and tickets only):
```bash
cawplan session collect --date <YYYY-MM-DD> --mode qa --output "$daily_file" --assign
```

Run `--assign` as a **background** shell task. The command waits for the user to click **Save assignments** or **Close** in the browser (up to 10 minutes). Do not start a second `--assign` while one is still running.

The page lets the user:
- Confirm collected QA sessions (session id, agent, skill layers — may be empty, testpoint counts, requirements)
- Adjust **one product per session** via dropdown
- Edit ticket display IDs
- **Optionally** add sessions from the commit-only / empty exclusion list (no manual session-id typing)

**Step 3 — Review:**

Present the review described in **Review content contract** before upload.

**Step 4 — Upload:**
```bash
cawplan session qa-upload --file "$daily_file"
```

Echo the server response, including any `report_id` UUID returned on success.

---

## Review content contract

Before upload, include:

- Basic facts: date, author, total QA sessions, agents, total cost.
- Per session: `session_title`, `agent`, `skill_layers` (empty `[]` is normal for discussion-only sessions), `requirement_ids` count, `testpoint.added` / `testcase.added`, `product_id`, ticket display IDs when present.
- Assignment notes: sessions optionally added from the supplement list, or sessions left without a product (allowed — backend accepts empty `product_id`).
- Data quality: count of sessions with empty `skill_layers` or missing `product_id`; excluded sessions printed during collect (commit-only or empty only, if any) and whether the user supplemented any on the assignment page.

Do not summarize `human_inputs` with coding-only fields such as `category` or `topic` — the QA payload does not include them.

## Product/ticket assignment

- Always use `--mode qa --assign` for web confirmation. Do **not** use `cawplan session assign --web` (that is the coding flow with git-project mapping).
- Product selection uses the same CawPlan product catalog as coding insights, but **without** git-project linking.
- One session maps to at most one product. Empty product is allowed when the user cannot determine it yet.

## Rules

- Every collect command in this skill **must** include `--mode qa`.
- Do not fabricate session data. Only include what local agents produce plus explicit user edits on the assignment page.
- Do not use coding temp paths (`cawplan-ai-daily` / `ai-daily-*.json`) for QA dailies.
- If `--file` / `daily_file` is used, the JSON must contain `schema: "qa-session.1"`, `author`, and `date`.
- Preserve raw `human_inputs` fields that the QA schema allows (`content`, `assistant_message`, `session_id`, `start_time`, `end_time`). Never add `category`, `topic`, or related coding-only keys.
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
