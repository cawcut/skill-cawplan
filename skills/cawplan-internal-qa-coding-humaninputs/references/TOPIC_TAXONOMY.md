# Human-Input Topic Taxonomy (production, RD Coding Insights, gpt-4o)

Source of truth: `uid.core-product/internal/pkg/genai/ai_session_prompts.go`
(`PromptAISessionTopicDefinitions` + topic routing in `promptAISessionClassifySystemBase`) and
`internal/pkg/genai/ai_session_human_topic_taxonomy.go`. **Full snapshot:**
`references/PRODUCTION_CLASSIFY_PROMPT.md`. This doc mirrors production topic rules. If this doc
and uid.core-product disagree, follow the snapshot.

**Out of scope for this skill:** `search_keywords` only (production also extracts keywords).

This skill returns **`topic`**, **`topic_reason`**, and **`topic_confidence`** (0.0–1.0).

## Task

Given `content` and optional prepared `assistant_message` (first 3 paragraphs, rune-capped),
pick exactly **one** topic — the most specific value that clearly applies.

**Never use `prev_message` for topic.** Topic comes from `content` + prepared `assistant_message`
only.

## Context routing (production v2 base)

| Slot | Topic use |
|------|-----------|
| `content` | **Primary** — always read first |
| `assistant_message` | **Primary signal** alongside content (first 3 paragraphs) |
| `prev_message` | **Never** — ignore for topic |

### Category vs topic (joint rules)

- Derive topic primarily from `content` + `assistant_message`.
- Bare `"commit & push"` / `"commit and push"` → topic is always **`git_ops`** — do **not**
  inherit Slack/integration topic from the session or assistant head.
- **ASKING vs CHANGING:** when the human asks how/why **current** behavior works (`有没有/是不是/
  怎么做的/会带哪些/看下/你打算怎么做`) and requests no change, topic is **`investigation`**
  regardless of subject (Slack, API, UI, etc.).
- Use **`integration_api`** for third-party SDK / cross-service API **wiring** or field/format
  checks (`RFC3339`, curl debugging response shape).
- Slack card / ephemeral / unfurl / Work Object **appearance** → **`design_ui`**.
- Implementing a **new** Slack delivery path (share-link message styling, new watcher push path) →
  **`new_feature`** — even when the message mentions "样式/styling".
- Cawpass session-checkout **display policies** (hide/show fields, status-filter values,
  pagination workarounds) → often **`new_feature`** when defining behavior for a flow; ongoing
  hide/rename/show rules on an existing page → **`design_ui`**.

### Slack-heavy session hints (use with assistant head)

- Optional UI preference (remove toast, tweak visibility) with no broken data → `design_ui`.
- Card copy, Work Object/unfurl visual alignment, ticket-type icons (styling only) → `design_ui`.
- Defect / regression / data loss (comment not saved; refresh drops creator or "from this
  message"; assistant head describes 修复/丢失/没能读出) → **`bug`** — even when the visible symptom is
  UI text. When assistant opening paragraphs describe fixing refresh losing creator/from-this-message
  data, topic is **`bug`**, not `design_ui`.
- New delivery path (response_url reply, chat.unfurl fallback, DM/channel post fallback, hardcoded
  kill switch) → `new_feature`.
- Checking logs / reproducing failure / "查一下日志" with a time window → topic **`bug`** when
  diagnosing a defect; **`investigation`** when explaining mechanics only.
- **Local verify:** `"服务再跑起来我确认一下"` / restart dev server to check → **`config_environment`**
  (NOT `infra`). **`infra`** = production deploy pipelines / what's left to ship to prod.
- **Deploy gap questions:** `"现在前端要部署到线上还差什么"` → topic **`infra`** (NOT
  `investigation`). Follow-up `"第N怎么设计比较合适"` on that checklist → **`infra`** + category
  `planning`.
- Bare screenshot / image hand-off with UI context → **`design_ui`** (NOT `investigation`).
- English system-style relay ("Briefly inform the user about the task result…") with no product ask
  → topic follows assistant head (`new_feature` if assistant discusses in-flight Slack feature work).

### Category-linked topic hints

- "是不是可以X吗。如果可以，帮实现" → when X is Work Object/card appearance, topic **`design_ui`**
  even if category is `question_clarification`.
- prev offers implement + content "直接改" → topic often follows the feature under discussion in
  assistant head (e.g. `new_feature`), not `git_ops`.

## Topics (17 values — pick exactly one)

`other` is a **last resort** (under ~3% of inputs). Before choosing `other`, walk the full list;
if two apply, pick the **more specific** one.

- `bug` — fixing or reporting an actual defect, error, crash, or regression (NOT a general question
  about how existing code works)
- `new_feature` — net-new product capability (new API surface, new session summary field, new skill
  command, new Slack delivery path)
- `refactor` — behavior unchanged: restructure code, improve readability, reduce complexity,
  cleanup without a performance goal; ALSO prompt/skill/taxonomy/classify label alignment ("update
  skill prompt", "human input category", "整理修改方案") when NOT asking for a new product feature
- `performance` — speed, memory, latency, throughput, or cost optimization (NOT "how long did AI
  take")
- `test` — unit/integration tests, coverage, flaky tests, test plans; ALSO explicitly running a
  skill/command to validate classify output or prompt accuracy ("run test skill", "跑skill测试")
- `docs` — documentation files only (README, markdown, comments); NOT API field formatting
- `infra` — production CI/CD, deploy pipelines, cloud resources, release automation, alembic
  revision chain checks (NOT local dev friction)
- `config_environment` — local dev environment, dependencies, build errors on the developer
  machine, version conflicts, npm/go mod issues
- `security` — authentication, authorization, API keys, vulnerability
- `data_migration` — schema changes, data migration, dirty data repair
- `integration_api` — third-party SDK, external API integration, cross-service API wiring; ALSO
  aligning/adding GET API fields, human-input-logs parity, curl API debugging
- `design_ui` — UI, interaction, visual design, styling; Slack card/Work Object appearance
- `investigation` — understanding existing code or root cause with **no change requested** ("why",
  "帮分析原因", "你怎么看", tracing how something works)
- `deprecation_cleanup` — remove dead code, deprecate or retire old features
- `git_ops` — routine version control: commit, branch, push/pull, merge (NOT production deploy =
  `infra`, NOT local build issues = `config_environment`). Bare "commit & push" is always this.
- `revert_rollback` — explicitly undoing to a prior state (revert, go back, restore old logic).
  Independent of `rejection_rollback` **category** — that records rejection intent; this records
  revert **work**
- `other` — acknowledgements, off-topic chat, or nothing else fits

## Worked examples (category / topic pairs)

| Input / context | Category | Topic |
|-----------------|----------|-------|
| "帮实现 share-link message styling with reference JSON" | `requirement` | `new_feature` |
| "帮实现 create-ticket message styling" | `requirement` | `design_ui` |
| "要不加 slack_watcher 字段并支持 Slack 移除 watch" | `requirement` | `new_feature` |
| "commit with prefix & push, also alembic" | `approval` | `git_ops` |
| bare screenshot after UI discussion | `context_supply` | `design_ui` |
| "服务再跑起来我确认一下" | `verification` | `config_environment` |
| "现在前端要部署到线上还差什么" | `question_clarification` | `infra` |
| "string 类型可以看看是不是 RFC3339 格式" | `verification` | `integration_api` |
| "状态过滤需要补上 Purchase Failed" | `direction_constraint` | `new_feature` |
| "透明度是不是哪里有差异" | `question_clarification` | `investigation` |
| "comment没有生效" | `correction_defect` | `bug` |
| prev offers commit + "commit & push" | `decision` | `git_ops` |
| "JIRA可以post message卡片，CawPlan不可以，是什么原因" | `question_clarification` | `investigation` |
| "创建ticket卡片标题去掉display_id" | `requirement` | `design_ui` |
| "查一下slack日志，10:26左右，/path/to/log.json" | `verification` | `bug` |
| "我们能做到回帖到触发会话吗" | `requirement` | `new_feature` |
| prev offers implement + "直接改" | `approval` | `new_feature` |
| "refresh后变成Someone created…，能还是保持原来的xxx created from this message吗" | `correction_intent` | `bug` |
| "Ticket card refreshed.可以不需要有吗" | `correction_intent` | `design_ui` |
| "refresh提示只对发起refresh的user可见" | `direction_constraint` | `design_ui` |
| "在两个人DM分享ticket link,也能回复卡片吗" | `direction_constraint` | `investigation` |
| "为什么postMessage会失败…" | `question_clarification` | `investigation` |
| "fallback对齐上周样式，加硬编码开关" | `direction_constraint` | `new_feature` |
| "频道里Bot未加入，也可以是work Object形态吗。如果可以，帮实现" | `question_clarification` | `design_ui` or `investigation` |
| "work object对齐上周样式，icon对齐本周" | `direction_constraint` | `design_ui` |

## Legacy topic values (cloud read paths)

Older enriched rows may still show legacy topic strings. Normalize before comparing:

| Cloud / legacy | Maps to |
|----------------|---------|
| `improvement` | `refactor` |
| `ux` | `design_ui` |

The classify LLM must emit only the 17 values in the Topics list above, not legacy aliases.

## topic_confidence

Return a float between **0.0** and **1.0**, same as production (`promptAISessionClassifySystemBase`).

Calibration guide:
- **0.85–1.0** — unambiguous (bare `commit & push` → `git_ops`; clear defect → `bug`; explicit
  net-new capability → `new_feature`)
- **0.60–0.84** — best pick is reasonable but another topic was plausible (Slack
  `question_clarification` turns where `investigation` vs `design_ui` both fit; assistant head
  could sway either way)
- **Below 0.60** — weak domain signal — still pick the most specific applicable topic; do **not**
  choose `other` just because confidence is low

`cawplan-internal-qa-coding-humaninputs-test` compares the **topic label** only, not confidence.
