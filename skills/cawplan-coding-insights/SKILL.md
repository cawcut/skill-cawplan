---
version: 0.2.6
name: cawplan-coding-insights
description: |
  Show AI coding usage insights: cost, tokens, session activity, and breakdowns by member, model, agent, project, product, or prompt quality.
  Use when: the user asks about coding costs, AI usage stats, team session activity, model spend, agent usage, prompt quality, or productivity metrics.
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
