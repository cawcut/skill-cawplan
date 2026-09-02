# Human-Input Category Taxonomy (v2 production, CWP-19829 / gpt-4o)

Source of truth: `uid.core-product/internal/pkg/genai/ai_session_prompts.go`
(`promptAISessionClassifySystemBase` + `promptAISessionClassifyCategoryDefinitions` +
`promptAISessionClassifyGapAnalysisGuard`) and `internal/pkg/genai/ai_session_classify_context.go`.
**Full snapshot:** `references/PRODUCTION_CLASSIFY_PROMPT.md` (sync via
`scripts/sync-classify-prompt-from-core-product.mjs`). This doc mirrors the **category** half.
Pair with `TOPIC_TAXONOMY.md`. If this doc and uid.core-product disagree, follow the snapshot.

**Out of scope for this skill:** `search_keywords` only.

This skill classifies **category** + **topic** (+ `topic_reason`, `topic_confidence`).

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

**Ignore for classification:** `in-app-browser-context` blocks, Files-mentioned-by-user wrappers,
Response-annotations — use only the human's actual request (typically after `My request:`).

**Do not** infer category from what the assistant already did or verified.

### Category vs topic routing (production mid-base)

- **NEW-vs-EXISTING:** `"帮实现/帮加/新增/帮调整 + deliverable"` → `requirement`, even on a
  follow-up turn. Only narrowing/restyling/hiding/renaming something the assistant **already built
  in this thread** without a new capability → `direction_constraint`. Do NOT default follow-up
  turns to `direction_constraint`.
- **SHAPE REFINEMENT** without evaluative judgment (`"改成/对齐/迁移/改名/隐藏/只留/去掉"`) →
  `direction_constraint`, NOT `correction_*` unless the human says wrong/broken/不符合预期/有问题.
- **GUARD — correction vs shape:** `"帮改成 X"`, `"对齐 JIRA"`, `"迁移到 index"`, `"只留三项"`,
  `"Assign To 改成 Assignee"` → `direction_constraint` unless paired with evaluative complaint
  (错了/不对/有问题/不符合预期) or a factual defect symptom.

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
  build-task verbs (`帮加`, help implement, help adjust styling, wire a new Slack message path) —
  **even on a follow-up turn**. **EXCEPTION — status-inventory deliverable:** explicit help-me
  organize/summarize of what currently exists (`帮我整理`, `整理目前`, `目前支持`) → `requirement`
  (deliverable is the organized list), NOT `question_clarification`. If instead the human adjusts
  something that **already exists** in this thread (remove/rename/reorder/drop/narrow/restyle),
  that is `direction_constraint`, not `requirement`. Adding a genuinely new sub-capability
  (`slack_watcher` field, share-link card styling) is `requirement` — discriminator is
  new-vs-existing, not big-vs-small.
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

**GUARD:** do NOT use `correction_*` for shape/layout refinements without saying prior output was
wrong — see SHAPE REFINEMENT above.

- `correction_defect` — behavior, data, or logic is factually wrong (crash, wrong data, broken
  display; e.g. "状态过滤里面 Processing 没有数量").
- `correction_intent` — runs without error but result/order/flow/wording isn't wanted; feature flow
  feels wrong (not code structure). `"帮我对齐JIRA"` / align existing Slack card semantics to a
  reference product → `correction_intent`, NOT `requirement`.
- `correction_quality` — works and outcome OK, but code/architecture over-engineered or poorly
  organized.
- `rejection_rollback` — short evaluative judgment that something doesn't work/fit ("不合适", "不行",
  "doesn't fit") or explicit rollback **without** replacement. NOT imperative prohibition + replacement
  (that's `direction_constraint` or `decision`). When evaluative judgment **and** replacement both
  present, both apply — `rejection_rollback` wins by priority.
- A question is NOT a correction unless it explicitly reports a defect or complaint.

**Judgment**

- `decision` — human **explicitly picked** one option ("use X", "go with option B"). Choosing after
  the assistant offered alternatives (`那就统一不要显示数量`, "then do it uniformly that way") →
  `decision`, NOT `direction_constraint`. Interim workaround until backend ships (`你可以先这么做，等
  /purchase/lines 支持分页`) → `decision`. `需要迁移` when choosing to proceed with migration the
  assistant offered → `decision`. Routine `"commit & push"` → `approval` or `process_control`, NOT
  `decision`. `"you decide"` is NOT `decision`.
- `approval` — positive evaluation or accepting word ("looks good", "可以", "同意", "that works, go
  ahead"). Bare "continue"/"继续" without evaluative word → `process_control`.
- `verification` — testing, validation, self-check ("add a unit test", "verify this works"). Post-deploy
  / post-restart retries (`再试试`, "retry the flow above" in `My request:`) → `verification`, NOT
  `process_control`. RFC3339 / field-format checks → `verification` + topic `integration_api`.

**Reverse acquisition**

- `question_clarification` — explains/facts about something that **already exists**; status quo,
  no change requested. **Gap-analysis** (`哪些没有实现`, `缺什么`, `还缺什么`) with NO help-me
  organize verb → `question_clarification`, NOT `requirement`. NOT hypothetical-change probes (see
  `exploration`).
- `exploration` — proposes a hypothetical **change** or soft suggestion (`要不加一个…吧？`) —
  only when NOT a concrete build ask; `"要不加 slack_watcher 字段"` with implementation detail →
  `requirement`, NOT `exploration`.

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

## Gap-analysis guard (production tail)

- Help-me organize/summarize current support (`帮我整理`, `整理目前`, `目前支持`) →
  `requirement` (NOT `question_clarification`).
- Which-parts-missing questions (`哪些没有实现`, `缺什么`) with NO implement-now verb →
  `question_clarification` + topic `investigation` (NOT `new_feature`).
- Do not let another batch item's assistant "missing modules" list override ASKING vs CHANGING on
  the current item.

## Worked examples (category / topic)

See `TOPIC_TAXONOMY.md` for the topic column. Category primary only:

| Input / context | Primary category |
|-----------------|------------------|
| "帮实现 share-link message styling with reference JSON" | `requirement` |
| "要不加 slack_watcher 字段并支持 Slack 移除 watch" | `requirement` |
| "commit with prefix [CWP-xxx] & push, also alembic" | `approval` |
| "重新执行一遍，不要把 LineBarListCard 放在 costCard 导出" | `correction_intent` |
| "需要迁移" (after assistant admitted incomplete migration) | `approval` or `correction_intent` |
| "Request 改名 Approval ID，然后去掉#号" | `direction_constraint` |
| "merge Approval state and Terminal state into Status + rules" | `requirement` |
| "状态过滤里面 Processing 没有数量" | `correction_defect` |
| ambient + My request "api-gw restarted, retry flow" | `verification` |
| ambient + My request `再试试` after deploy/smoke | `verification` |
| bare `帮实现` after assistant proposed feature | `requirement` |
| "Briefly inform the user about the task result…" | `other_meta` |
| "那就统一不要显示数量" (after assistant offered count vs no-count) | `decision` |
| "string 类型可以看看是不是 RFC3339 格式" | `verification` |
| "第6怎么设计比较合适" (follow-up to deploy checklist) | `planning` |
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
| attached API doc + "帮我review整理…方案" (review only, no code yet) | `planning` |
| prev offers plan + content "开始执行" | `approval` |
| adjust voice-to-text end-of-recording UI (send+mic buttons, manual send) | `direction_constraint` |
| PR link + curl to simulate STT/API | `requirement` |
| "分别修复吧" (fix two repos separately) | `decision` |
| pasted iOS allow-dialog symptom narrative (no question) | `context_supply` |
| "你加好后发我" (implement CSP fix) | `requirement` |
| CloudFront CSP policy length limit error | `correction_defect` |

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
