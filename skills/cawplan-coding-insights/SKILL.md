---
version: 0.2.6
name: cawplan-coding-insights
description: |
  Show AI coding usage insights: cost, tokens, session activity, and breakdowns by member, model, agent, project, product, or prompt quality. Also finds who on a Team (CawPlan product line) hasn't submitted their daily coding report, rolls up a Team's cost, flags high-cost/low-diff sessions, and flags a member's cost growth.
  Use when: the user asks about coding costs, AI usage stats, team session activity, model spend, agent usage, prompt quality, productivity metrics, which team members haven't submitted/committed a coding report, a Team's total coding cost, sessions with disproportionately high cost vs code changed, or whether someone's coding cost has grown notably.
  NOT for: submitting reports, creating tickets, product health metrics, or release tracking.
argument-hint: "[date range, member, product, model, agent, dimension]"
allowed-tools: Bash
---

# CawPlan Coding Insights

## Bootstrap

```bash
cawplan skill check
```

## Workflow

Fetch the relevant views in parallel based on what the user is asking for. Use `--date` for a single day; use `--from`/`--to` for a range.

If the user provides no prompt or only invokes `/cawplan-coding-insights`, default to the current user's report for today:

```bash
today="$(date +%F)"
cawplan session my-sessions --date "$today"
cawplan session user-human-inputs --date "$today"
```

Use this default output to summarize the user's own sessions, cost, tokens, files changed, and human input highlights for today.

---

### Workspace Overview

**Total cost, tokens, active members:**
```bash
cawplan session overview --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Daily trend (cost and tokens over time):**
```bash
cawplan session trend --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Available report dates (for date picker):**
```bash
cawplan session dates
```

---

### Cost Breakdown Dimensions (workspace-wide)

**By member:**
```bash
cawplan session by-member --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**By AI model (Claude Opus, Sonnet, Haiku, etc.):**
```bash
cawplan session by-model --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**By model + token type (input / output / cache):**
```bash
cawplan session by-model-dimension --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**By AI coding agent (Claude Code, Cursor, Codex, etc.):**
```bash
cawplan session by-agent --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**By git project/repository:**
```bash
cawplan session by-project --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**By CawPlan product (requires product-repo mapping):**
```bash
cawplan session by-product --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

All breakdown commands support `--page-num` and `--page-size` for pagination.

---

### Member Views

**List all members with data:**
```bash
cawplan session members
```

**Full detail for one member:**
```bash
cawplan session member-detail --member <git-username>
```

**Personal session drill-down (overview + session list):**
```bash
# First resolve your user_id if needed
cawplan users query --email <your-email>

cawplan session my-sessions --user-id <user_id> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Personal prompt quality summary:**
```bash
cawplan session user-human-inputs --user-id <user_id> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

---

### Product-Scoped Views

Requires product unique_id. Resolve it first:
```bash
cawplan products list --search "<product name>"
```

**Product cost overview:**
```bash
cawplan session product-overview --product-id <id> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Product daily trend:**
```bash
cawplan session product-trend --product-id <id> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Product breakdown by member:**
```bash
cawplan session product-by-member --product-id <id> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Product breakdown by model:**
```bash
cawplan session product-by-model --product-id <id> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Product prompt quality summary:**
```bash
cawplan session product-human-inputs --product-id <id> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

---

### Human Input (Prompt Quality) Analysis

**Workspace prompt summary (categories, topics, quality):**
```bash
cawplan session human-input-summary --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Prompt quality score distribution:**
```bash
cawplan session human-input-quality --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Prompt count and quality by product:**
```bash
cawplan session human-input-by-product --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Paginated prompt list with filters:**
```bash
cawplan session human-inputs \
  --from <YYYY-MM-DD> --to <YYYY-MM-DD> \
  [--member <name>] \
  [--product <name>] \
  [--category <name>] \
  [--topic <name>] \
  [--q <search text>] \
  [--needs-review] \
  [--limit 25] [--offset 0]
```

---

### Session Conversation Drill-down

```bash
cawplan session conversation --entry-id <entry_id>
```

---

### Team Submission Gap ("who hasn't submitted")

"Team" here means a CawPlan **product line** (`cawplan product-lines ...` — the CLI's own `init` prompt literally calls this "Select CawPlan Team"). "Coding commit" means an uploaded AI daily session report (`cawplan-coding-commit`), not a git commit.

There is no direct "who's on this team" API — only the reverse (`session user-products`: products assigned to *one* user). Building the roster means checking every user, which is expensive. Be upfront about the cost before running it.

1. Resolve the Team name to a `product_line_id` (page and match by name client-side, same as `cawplan-product-report`'s Team workflow):
   ```bash
   cawplan product-lines list --page_size 100
   ```
   Ask the user to disambiguate if more than one name matches.

2. Resolve the team's products:
   ```bash
   cawplan products list --product_line_id <product_line_id>
   ```

3. Build the roster. Page through every user, then check each one's assigned products:
   ```bash
   cawplan users list --page_size 100
   cawplan session user-products --user-id <user_id>   # once per user
   ```
   Keep a user only if at least one returned product is in the team's product set (step 2). **This is one call per workspace user.** If `users list` returns more than ~30 people, stop and tell the user the exact call count, then **wait for an explicit go-ahead** before firing them — a heads-up notice is not enough, this needs a yes/no. Offer narrowing scope (e.g. a smaller team) as the alternative.

4. Resolve the target date the same way as the rest of this skill (`today="$(date +%F)"`, or the exact date/range the user gave — don't pass a literal "today" string). Find who actually submitted in that window — session data only exists because someone ran the `cawplan-coding-commit` upload flow (there's no passive/automatic collection in this CLI), so a `user_id` appearing here means they submitted, not just "was active":
   ```bash
   cawplan session product-by-member --product-id <pid> --date <date> --page_size 100
   # or --date-from/--date-to for a range; page through if a product has more submitters than one page
   ```
   Run once per product from step 2; `session by-member`'s response shape (`member`, `user_id`, `user_display_name`, per `references/CAWPLAN_OPEN_API.md`) is a direct join to the same `user_id` as `users list` — not a fuzzy name match. Union the `user_id`s across all results — this is the "submitted" set.

5. **Diff**: roster (step 3) minus submitted (step 4) = who hasn't submitted for that window. Report by `user_display_name`.

Caveat to state alongside the result: `session user-products` returns products a workspace admin has configured as assigned to that user — it is a config record, not a usage record. Someone who should be on this team but was never configured with a product assignment won't appear in the roster at all, so this workflow can't flag that specific gap (it will look like they don't exist rather than like they're missing a submission).

---

### Team Cost Rollup

There's no `product_line_id` parameter on any `session` cost command — only `--product-id`. Roll it up yourself:

1. Resolve the Team to `product_line_id` and its products, same as Team Submission Gap steps 1-2.
2. For each product:
   ```bash
   cawplan session product-overview --product-id <pid> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
   cawplan session product-by-model --product-id <pid> --from <YYYY-MM-DD> --to <YYYY-MM-DD>   # only if the user asked for a model breakdown
   ```
3. Sum cost/tokens across products for the total. For the model breakdown, sum matching model names across products rather than reporting per-product tables, unless the user asked to see it per-product. If the summed by-model total doesn't match the `product-overview` total (e.g. a model bucket the by-model endpoint doesn't categorize), report both numbers rather than silently picking one — don't assume they'll always reconcile.

This is one or two calls per product on the team — mention the count if the team has an unusually large number of products, same spirit as the roster-cost warning above (though this is normally much cheaper than the per-user roster walk).

---

### Cost/Diff Anomaly Detection ("high cost, low diff")

Uploaded reports carry `files_changed` / `files_added` / `files_deleted` per session alongside cost — this flags sessions where the two are out of proportion.

1. Determine scope from the request:
   - **A member** → `cawplan session member-detail --member <git-username>` — check the response for whether it accepts/returns a date range; if it doesn't, say the check covers that member's full available history, not just "recent," rather than silently implying it's date-scoped.
   - **A product** → `cawplan session product-sessions --product-id <id>` (add `--from`/`--to` if the API's date filters apply; check the actual response for the exact field names since this hasn't been run against live data yet — confirm `files_changed` is present before relying on it)
   - **The whole workspace** → same cost/scale problem as Team Submission Gap: `cawplan session members` then `member-detail` per member. Apply the identical rule — tell the user the call count and get an explicit go-ahead before firing more than ~30 calls.
2. Don't invent a fixed cost or diff threshold (e.g. "cost > $50") — the org's normal range is unknown to you. Instead, rank the fetched sessions by cost descending and by `files_changed` ascending, and surface whichever sessions sit disproportionately in both directions at once — with small result sets (roughly under ~10 sessions) don't force a strict quartile cutoff, since it can mechanically exclude an obvious outlier by a hair; use the ranking as a guide and flag the standout(s) with their numbers shown, noting when a flagged session narrowly misses a strict quartile cut. State that the flagging is relative to the fetched set, not an absolute cutoff, and show the actual cost/files_changed numbers so the user can judge for themselves.
3. Don't treat a session with zero files_changed as automatically suspicious without checking — legitimate non-coding sessions (planning, research, review-only) can have real cost and no diff. Say what the session's `session_name`/project looks like alongside the numbers rather than just flagging it as an anomaly.

---

### Cost Growth Detection (member)

1. Resolve the member (same pattern as other member-scoped views in this skill).
2. Pick two comparable, non-overlapping periods of equal length. Default to "last 30 days" vs. "the 30 days before that" if the user doesn't specify; cap the total lookback at 3 months unless they explicitly ask for more.
   ```bash
   cawplan session user-trend --user-id <user_id> --from <period1_start> --to <period1_end>
   cawplan session user-trend --user-id <user_id> --from <period2_start> --to <period2_end>
   ```
3. Compute percent change in cost between the two periods. Report the actual number (e.g. "+340% vs. the prior period, $42 → $185") rather than a vague "significant increase" — don't apply your own judgment threshold for what counts as "growth"; state the number and let the user decide if it's notable. If the prior period's cost was $0, percent change is undefined — report the raw before/after numbers ("$0 → $X, new activity this period") instead of computing a percentage or dividing by zero.

---

## Date Range Rules

- "last week" → `--from <last Monday> --to <last Sunday>`
- "this month" → `--from <first of month> --to <today>`
- "today" / "yesterday" → use `--date <YYYY-MM-DD>`
- If no prompt is specified, default to the current user's report for today.
- If the prompt asks for a metric but omits a date, default to today unless the wording implies a broader period.
- Use `cawplan session dates` to discover which dates actually have data.

## Output

Structure the response based on what was requested:

- **Summary**: total cost ($), total tokens, active members in the period.
- **Trend**: daily cost table if more than 2 days were requested.
- **Top members**: top 5 by cost with token count.
- **By model/agent**: rank by cost, show % of total.
- **By product/project**: list with session count and cost.
- **Prompt quality**: category breakdown and quality score distribution if human-input data was fetched.
- **Key observations**: 1–3 notable patterns (high cost days, top contributor, unusual model spend, etc.).

## Notes

- All endpoints are **prd-only**. The proto environment returns 404.
- `by-product` requires product-repo mappings to be configured (`cawplan session product-repos`).
- `product-*` commands require a product `unique_id`, not a name.

## References

- `references/CAWPLAN_OPEN_API.md`
