---
version: 0.2.0
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
command -v cawplan >/dev/null || { echo "cawplan is not installed. Run: npm install -g cawplan"; exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

## Workflow

Fetch the relevant views in parallel based on what the user is asking for. Use `--date` for a single day; use `--from`/`--to` for a range.

---

### Workspace Overview

**Total cost, tokens, active members:**
```bash
cawplan ai-session overview --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Daily trend (cost and tokens over time):**
```bash
cawplan ai-session trend --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Available report dates (for date picker):**
```bash
cawplan ai-session dates
```

---

### Cost Breakdown Dimensions (workspace-wide)

**By member:**
```bash
cawplan ai-session by-member --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**By AI model (Claude Opus, Sonnet, Haiku, etc.):**
```bash
cawplan ai-session by-model --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**By model + token type (input / output / cache):**
```bash
cawplan ai-session by-model-dimension --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**By AI coding agent (Claude Code, Cursor, Codex, etc.):**
```bash
cawplan ai-session by-agent --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**By git project/repository:**
```bash
cawplan ai-session by-project --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**By CawPlan product (requires product-repo mapping):**
```bash
cawplan ai-session by-product --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

All breakdown commands support `--page-num` and `--page-size` for pagination.

---

### Member Views

**List all members with data:**
```bash
cawplan ai-session members
```

**Full detail for one member:**
```bash
cawplan ai-session member-detail --member <git-username>
```

**Personal session drill-down (overview + session list):**
```bash
# First resolve your user_id if needed
cawplan users query --email <your-email>

cawplan ai-session my-sessions --user-id <user_id> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Personal prompt quality summary:**
```bash
cawplan ai-session user-human-inputs --user-id <user_id> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

---

### Product-Scoped Views

Requires product unique_id. Resolve it first:
```bash
cawplan products list --search "<product name>"
```

**Product cost overview:**
```bash
cawplan ai-session product-overview --product-id <id> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Product daily trend:**
```bash
cawplan ai-session product-trend --product-id <id> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Product breakdown by member:**
```bash
cawplan ai-session product-by-member --product-id <id> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Product breakdown by model:**
```bash
cawplan ai-session product-by-model --product-id <id> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Product prompt quality summary:**
```bash
cawplan ai-session product-human-inputs --product-id <id> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

---

### Human Input (Prompt Quality) Analysis

**Workspace prompt summary (categories, topics, quality):**
```bash
cawplan ai-session human-input-summary --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Prompt quality score distribution:**
```bash
cawplan ai-session human-input-quality --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Prompt count and quality by product:**
```bash
cawplan ai-session human-input-by-product --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

**Paginated prompt list with filters:**
```bash
cawplan ai-session human-inputs \
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
cawplan ai-session conversation --entry-id <entry_id>
```

---

## Date Range Rules

- "last week" → `--from <last Monday> --to <last Sunday>`
- "this month" → `--from <first of month> --to <today>`
- "today" / "yesterday" → use `--date <YYYY-MM-DD>`
- If no date is specified, default to the last 7 days.
- Use `cawplan ai-session dates` to discover which dates actually have data.

## Output

Structure the response based on what was requested:

- **Summary**: total cost (USD), total tokens, active members in the period.
- **Trend**: daily cost table if more than 2 days were requested.
- **Top members**: top 5 by cost with token count.
- **By model/agent**: rank by cost, show % of total.
- **By product/project**: list with session count and cost.
- **Prompt quality**: category breakdown and quality score distribution if human-input data was fetched.
- **Key observations**: 1–3 notable patterns (high cost days, top contributor, unusual model spend, etc.).

## Notes

- All endpoints are **prd-only**. The proto environment returns 404.
- `by-product` requires product-repo mappings to be configured (`cawplan ai-session product-repo`).
- `product-*` commands require a product `unique_id`, not a name.

## References

- `references/CAWPLAN_OPEN_API.md`
