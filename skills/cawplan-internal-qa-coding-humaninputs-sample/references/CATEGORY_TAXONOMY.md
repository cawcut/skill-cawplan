# Human-Input Category Taxonomy (v2 production, CWP-19828/19829)

Source of truth: `uid.core-product/internal/pkg/genai/ai_session_prompts.go`
(`promptAISessionClassifySystemBase` + `promptAISessionClassifyCategoryDefinitions`) and
`internal/pkg/genai/ai_session_classify_context.go` (assistant/prev preprocessing). This doc
mirrors the **category** half of that prompt so this skill stays faithful to production. Pair with
`TOPIC_TAXONOMY.md` for the topic dimension. If this doc and uid.core-product ever disagree,
treat the Go prompt as authoritative and update this doc.

**Out of scope for this skill:** `search_keywords`, `topic_confidence` — production emits both;
this skill classifies **category** + **topic** (+ `topic_reason`).

## Task

Given `content`, optional prepared `assistant_message` (first 3 paragraphs, rune-capped), and
optional prepared `prev_message` (last paragraph of the previous assistant reply), pick every
category that clearly applies, ordered by priority below. The first element is the primary
category.

## Context routing (production v2 base)

Each slot is **not** interchangeable:

| Slot | Category use |
|------|----------------|
| `content` | **Primary** — always read first |
| `prev_message` | **Only** on bare follow-ups: `decision` vs `approval` (see SKILL.md step 4). Never for other categories. Never treat as prior human task text. |
| `assistant_message` | **Secondary only** when `content` is a bare URL/file/screenshot/log hand-off with no intent words |

**Do not** infer category from what the assistant already did or verified.

### Feasibility / capability questions (disambiguate 我们 vs 也能)

- "我们能做到X吗" / "是不是可以X" — product CAN add a **new** behavior end-to-end →
  `requirement` (primary), NOT `question_clarification`.
- "也能X吗" / "…也…吗" — an **additional** scenario should get the **same** card/unfurl behavior →
  `direction_constraint` (scope/boundary), NOT `question_clarification` — even with 吗.
- "为什么X会失败" / "是什么原因" / "JIRA是不是自动加入DM" / "response_url是不是通用" / "也有适配吗"
  → `question_clarification` when seeking to understand existing behavior.
- "是不是可以X吗。如果可以，帮实现" → `question_clarification` primary (吗-clause dominates); do
  NOT jump to `requirement` just because 帮实现 appears after the question.
- "直接改" / bare "帮我改" after the assistant proposed an implementation → `approval` (generic) or
  `decision` (picking a named option), not `requirement`.

### Correction vs direction (Slack card copy and similar)

- `correction_intent`: action **works** but outcome/text is wrong — especially "能还是保持原来的…吗"
  / "还能保持…吗" / "想保持原来的…" after showing what it wrongly became (e.g. refresh succeeds but
  card line changes to generic "Someone created a Ticket" instead of "<@user> created … from this
  message"). This is `correction_intent`, NOT `direction_constraint` and NOT
  `question_clarification` — **even though the sentence ends with 吗**.
- `direction_constraint`: scope/style rule without "it works but shows the wrong thing" framing —
  e.g. "ephemeral 只对发起 refresh 的用户可见".
- `requirement`: one-off concrete change for the **first time** — e.g. "创建ticket卡片标题帮去掉
  display_id 前缀".
- Do NOT use `direction_constraint` when the human contrasts wrong current output vs desired
  original output and asks to keep the original.

## Categories (15 leaves in 6 groups)

Use these exact snake_case strings (not shortened forms).

**Definition work**

- `requirement` — introduces a deliverable, capability, screen, endpoint, or behavior that
  **does not exist yet**. Test: "does this ask bring something new into existence?" Includes
  switching/replacing ONE named thing scoped to this task, even with soft guidance referencing an
  existing pattern for the **same** feature. If instead the human adjusts something that **already
  exists** (remove/rename/reorder/drop/narrow/restyle a column, field, parameter, component,
  layout), that is `direction_constraint`, not `requirement` — even when short and scoped to this
  one task. A follow-up turn that modifies what the assistant just produced is almost always
  `direction_constraint`. Adding a genuinely new sub-capability ("add an export button") is still
  `requirement` — discriminator is new-vs-existing, not big-vs-small.
- `direction_constraint` — scope/style boundary on **existing** work (see above). **GUARD:** this
  existing-artifact rule only decides between `requirement` and `direction_constraint`. It never
  overrides correction, decision, or rejection. Also covers explicit **breadth/scope** signals
  ("uniformly go through X", "across the board", "from now on", "统一走", "所有地方都用X", blanket
  "never use X"), OR a **separate clause** constraining a different aspect than the main build ask
  (e.g. "add feature A; for storage, use the warehouse" — storage clause is
  `direction_constraint` primary). Without breadth word or separate-aspect clause, a switch/change/use
  for THIS task is `requirement`. Distinguish from `decision`: `direction_constraint` is a standing
  rule with no menu of named options; `decision` is picking ONE named option.
- `planning` — design/plan/approach **before** implementation with genuine "figure out how first"
  framing. "first + do this concrete task" is task sequencing, not planning — classify by the task
  itself (usually `requirement` or `direction_constraint`).

**Supplementary information**

- `context_supply` — pasted fact the AI could not access (error stack, log, API docs, screenshot
  description) with no separate instruction. If the same message also gives an instruction,
  `context_supply` is secondary only.

**Correction** (pick ONE subtype when correction applies; rhetorical "is this X?" complaint about
existing output counts as correction, not question)

- `correction_defect` — behavior, data, or logic is factually wrong (crash, wrong data, broken
  display).
- `correction_intent` — runs without error but result/order/flow/wording isn't wanted; feature flow
  feels wrong (not code structure).
- `correction_quality` — works and outcome OK, but code/architecture over-engineered or poorly
  organized.
- `rejection_rollback` — short evaluative judgment that something doesn't work/fit ("不合适", "不行",
  "doesn't fit") or explicit rollback **without** replacement. NOT imperative prohibition + replacement
  (that's `direction_constraint` or `decision`). When evaluative judgment **and** replacement both
  present, both apply — `rejection_rollback` wins by priority.
- A question is NOT a correction unless it explicitly reports a defect or complaint.

**Judgment**

- `decision` — human **explicitly picked** one option ("use X", "go with option B", "commit & push"
  after assistant offered it). "you decide" is NOT `decision`.
- `approval` — positive evaluation or accepting word ("looks good", "可以", "同意", "that works, go
  ahead"). Bare "continue"/"继续" without evaluative word → `process_control`.
- `verification` — testing, validation, self-check ("add a unit test", "verify this works").

**Reverse acquisition**

- `question_clarification` — explains/facts about something that **already exists**; status quo,
  no change requested. NOT hypothetical-change probes (see `exploration`).
- `exploration` — proposes a hypothetical **change** or named alternative ("what if we used
  microservices?", "should we try X instead").

**Process control**

- `process_control` — bare conversation advance/pause only ("continue", "stop", "pause") with no
  evaluative content and no concrete task.
- `other_meta` — off-topic chat, thanks, or concrete routine dev-tooling/git action with no
  feature-level content ("commit the code", "switch branches", "pull latest"). NOT
  `process_control` when it's a concrete tool command.

## Priority order (highest → lowest)

```
rejection_rollback > correction_quality > correction_intent > correction_defect >
direction_constraint > planning > decision > requirement > verification > approval >
question_clarification > exploration > context_supply > process_control > other_meta
```

## Worked examples (category / topic)

See `TOPIC_TAXONOMY.md` for the topic column. Category primary only:

| Input / context | Primary category |
|-----------------|------------------|
| "comment没有生效" | `correction_defect` |
| prev ends with "需要我 commit & push 吗？" + content "commit & push" | `decision` |
| prev offers to implement + content "直接改" | `approval` |
| "JIRA可以post message卡片，CawPlan不可以，是什么原因" | `question_clarification` |
| "创建ticket卡片标题去掉display_id" | `requirement` |
| "查一下slack日志，10:26左右，/path/to/log.json" | `verification` |
| "我们能做到回帖到触发会话吗" | `requirement` |
| "refresh后变成Someone created…，能还是保持原来的xxx created from this message吗" | `correction_intent` |
| "Ticket card refreshed.可以不需要有吗" | `correction_intent` |
| "refresh提示只对发起refresh的user可见" | `direction_constraint` |
| "在两个人DM分享ticket link,也能回复卡片吗" | `direction_constraint` |
| "为什么postMessage会失败，不是可以获取到DM channel link么" | `question_clarification` |
| "fallback对齐上周样式，加硬编码开关" | `direction_constraint` |
| "频道里Bot未加入，也可以是work Object形态吗。如果可以，帮实现" | `question_clarification` |
| "work object对齐上周样式，icon对齐本周" | `direction_constraint` |

## Legacy taxonomy (pre-v2 cloud rows)

Before CWP-19829 shipped, `category` only held 6 flat values: `decision` / `direction` /
`requirement` / `correction` / `planning` / `other`. If fresh classification picks a v2 leaf in
the same legacy bucket as the cloud value, that is a **taxonomy-version mismatch**, not a real
disagreement.

| v2 leaf | Legacy bucket |
|---------|---------------|
| `requirement` | `requirement` |
| `direction_constraint` | `direction` |
| `planning` | `planning` |
| `context_supply`, `question_clarification`, `exploration`, `process_control`, `other_meta` | `other` |
| `correction_defect`, `correction_intent`, `correction_quality`, `rejection_rollback` | `correction` |
| `decision` | `decision` |
| `approval`, `verification` | `decision` |

## Devtool prompt testing

To iterate on the classify prompt against production API without editing uid.core-product until
validated:

```http
POST /api/v1/devtool/ai-session-usage/human-input-classify/test
```

Supports `system_prompt_base`, `system_prompt_tail`, `prev_turns`, `assistant_max_runes`,
`prev_max_runes`. After a winning variant ships, paste into `ai_session_prompts.go` and update
this doc to match.
