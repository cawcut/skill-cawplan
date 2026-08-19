---
version: 0.2.8
name: cawplan-requirement-analyze
description: |
  Analyze SQA requirement inputs into five structured fields plus a display summary, and archive a Requirement to CawPlan QA Insights.
  Use when: the user explicitly asks to analyze requirements, structure requirement fields, produce a five-field draft with display summary and open-questions list, recommend a QA module-tree node, archive a Requirement, or update an existing Requirement in QA Insights — including when they provide a ticket link or ID together with requirement-analysis intent (e.g. "需求分析", "analyze this ticket", screenshots + ticket).
  Do not auto-select when the message is only a bare CawPlan issue URL with no requirement-analysis wording; prefer `cawplan-ticket-context` for coding-session ticket loading.
  NOT for: loading a ticket into the coding session only, writing or editing code, uploading AI daily reports, creating tickets, or generating test points.
argument-hint: "[requirement text, ticket URL/ID (optional), screenshots (optional)]"
allowed-tools: Bash
---

# CawPlan Requirement Analyze

## Bootstrap

```bash
cawplan skill check
```

## Read discipline (lazy-load)

**上下文判定**：模型**无法可靠感知**静默裁剪。凡跨**用户消息**（新 invoke）且将进入 P4 / P1b / P2′ / P5 / P6，**一律 presume 所需 reference 不在上下文**，须 Read；**禁止**凭「本会话 earlier 读过」免读。
**唯一可免读**：本 agent **同一响应内**刚通过 Read 工具载入该文件全文，且尚未结束该响应。
**拿不准**是否仍在上下文 → 按**不在**处理，Read。
行为上 step 6 **始终** Re-run steps 3–5（422 行）；免读只省 Read 工具，**不省**重跑行为。

**禁止**在判定工作路径之前批量读取 `references/`。

**Read 条件**（与上默认一致，细化路径）：

1. **新 invoke** 且路径为 P3/P4/P1b/P2′/P5/P6 → **Read** 路径表所列文件（P4 等**默认必读** analysis + rules，除非满足上段「同一响应内刚 Read」）。
2. **同一会话、同一 agent 响应内**刚 Read 过且全文仍在该响应上下文 → 可不重复 Read；仍须 Re-run 3–5 与复用首次措辞（159 行）。
3. ~~「全文仍确定在当前上下文」由 Agent 自行认定~~ → **删除**；改用上「默认安全侧」。

| 路径 | 条件 | Read（跨用户消息时 **默认必读**；仅「同一响应内刚 Read」可免） |
|------|------|----------------------------------------------------------------|
| **P0 · 零素材早停** | step 1 判定无任一素材 | **不读**；`stop` |
| **P1 · 冷交接（仅载入）** | 延续已归档，本条不改字段 | `workflow-archive.md` |
| **P1b · 冷交接后编辑** | P1 后 SQA 改字段 | analysis + rules + revise + Output；重跑 3–5 |
| **P2 · 接力直归档** | `resume_intent`，本条不改草稿 | save + archive + rules + confirmation |
| **P2′ · 接力后改草稿** | `resume_intent` + 改字段 | 同 **P4**（新 invoke **必读** analysis + rules） |
| **P3 · 新分析** | 有素材、非冷交接 | step1-material → analysis → rules → Output |
| **P4 · 修订** | 改字段/摘要，未触发保存闸 | **新 invoke 必读** analysis + rules + revise + Output；同响应内可免重复 Read |
| **P5 · 保存** | 保存意图闸 / `resume_intent` | save + archive + rules + confirmation |
| **P6 · UNKNOWN** | `pending_write` / UNKNOWN | archive + rules + confirmation；**始终 Read** |

**路径重判**：每条用户消息开始时重判路径。

**归档后测试点热交接（优先于 step 1）** — 本条为「马上生成测试点」（或同义，见 `cawplan-testpoint-generate` P2），且会话已有有效 binding（`product_id` + `requirement_id` / `bound_requirement_id`）？

- **是** → 读 `cawplan-testpoint-generate` skill，按 P2 热交接续跑（**stop** 本 skill 后续步骤）。
- **否** → 继续下方 Workflow。

## Workflow

### 1. Collect requirement material

**入口路由前置检查（先判此项，再收素材）** — SQA 的意图是**延续 / 修改一条已归档的 Requirement**（给出 requirement `id`、Requirement 链接，或说「接着上次那条改」）？

- **是** → 走 step 10 **Cold handoff** 载入服务端五字段作为草稿基线，**不要从头重分析**。理由：归档比对（`reconcile` strong match 与 `requirements update` 的 snapshot diff）是 **trim 后逐字节精确比对**，从头重分析必然产生措辞漂移，会让 reconcile 误判 `no_match`（重复建单风险）或 PATCH 误报变更键。
- **否**（新需求分析）→ 继续本步收集素材。

**零素材早停（新增）** — 判定本条消息是否带有**任一**素材：用户文字、工单（URL / display ID / unique ID）、截图。（**Product info 不计入素材** — 仅有 overview、无任何上述三类 → 仍走零素材早停。）

- **全无** → **只**输出下方引导文案，然后 **`stop`**；**禁止**进入 step 2–5（否则会产出全「（素材未提及）」废稿）。
- **有任一** → 继续下方 `Accept any mix of`，不弹窗。

**输出纪律（零素材分支）** — 内部脚手架，**不**呈现给 SQA：

- **只**输出引导文案块本身——**禁止**在其前或其后加任何说明、过渡句或复述判定过程。
- **禁止**出现类似：「根据入口路由检查…」「当前会话没有素材…」「按照流程规则，我需要先请求素材…」「零素材早停」等字样。
- 不要解释你在检查什么、为什么停下；SQA 只看到引导文案，与下方示例一致。

引导文案（**仅此块**逐字输出给用户，保留编号列表格式）：

> 想分析需求？给我下面任一样就能开始：
> 1. 需求文字描述
> 2. 工单链接 / 工单号
> 3. 相关截图 / 设计稿（可多张）
>
> 三样都给，信息会更完整，我会先整理成一份完整需求给你确认。

（结尾不提归档/保存。纯文字，不用 AskUserQuestion。）

**边界**：只贴工单链接 = 有素材，按下方 ticket 解析；裸 issue URL 且无分析意图 → 仍走 Rules **Trigger boundary**（`cawplan-ticket-context`），不走零素材分支。

### Workflow index + Read hooks

Before step N: on each new user message, read `references/<file>.md` unless you loaded it via Read in this same agent response already; then apply step N rules.

| Step | 摘要 | Read hook |
|------|------|-----------|
| 1（有素材） | 收素材 | 新 invoke：read `references/workflow-step1-material.md` |
| 1 冷交接 | 载入已归档 | 新 invoke：read `references/workflow-archive.md`；随后编辑 → P1b |
| 2–5b | 出稿管线 | 新 invoke：read `references/workflow-analysis.md` + `references/rules-global.md` |
| 6 | 修订 | **Re-run 3–5 必选**。新 invoke：read analysis + rules + revise |
| 7–9 | 保存准备 | 新 invoke：read `references/workflow-save.md` |
| 10–11 | 绑定/归档 | 新 invoke：read `references/workflow-archive.md`；P6 **始终 read** |
| 输出 | 呈现格式 | 新 invoke：read `references/output-confirmation.md` 对应节 |

#### Step → File 定位表（交叉引用补全，不改原文指称）

| 文内指称 | 所在 reference |
|----------|----------------|
| step 2 / Numeric cross-source check | `references/workflow-analysis.md` |
| step 3 / 固定措辞表 / 表外句式 | `references/workflow-analysis.md` |
| step 4 / 展示摘要 | `references/workflow-analysis.md` |
| step 4b / 漏测自检 | `references/workflow-analysis.md` |
| step 5 / 判据 1 / 数值限制型存疑 / walkthrough | `references/workflow-analysis.md` |
| step 5b / 呈现尾巴 | `references/workflow-analysis.md` |
| step 6 修订正文 | `references/workflow-revise.md`；保存意图闸 → **主文件** |
| step 7–9 / §8 模块树 | `references/workflow-save.md` |
| step 10–11 / Table A/B / Command outcomes | `references/workflow-archive.md` |
| Rules **总则** / **红线 0** / **枚举完整性** / Failures / API scope | `references/rules-global.md` |
| Rules **Trigger boundary** / **跨 skill 接力** | **主文件**（热路径） |
| Output / Confirmation | `references/output-confirmation.md` |

Before step 1 (有素材 branch): on each new user message, read `references/workflow-step1-material.md` unless you loaded it via Read in this same agent response already; then apply step 1 material rules.

Before step 1 (冷交接 branch): on each new user message, read `references/workflow-archive.md` unless you loaded it via Read in this same agent response already; then apply step 10 Cold handoff rules.

### 2–5b. Analysis pipeline (steps 2–5b)

Before steps 2–5b: on each new user message, read `references/workflow-analysis.md` and `references/rules-global.md` unless you loaded them via Read in this same agent response already; then apply steps 2–5b rules.

Detail: `references/workflow-analysis.md` — Tag sources (step 2), five-field draft (step 3), display summary (step 4), 漏测自检 (step 4b), open-questions list (step 5), 五字段呈现尾巴 (step 5b).

Before analysis Output: on each new user message, read `references/output-confirmation.md` (Output section) unless you loaded it via Read in this same agent response already.

### 6. Revise from SQA feedback

Before step 6: on each new user message, read `references/workflow-analysis.md`, `references/rules-global.md`, and `references/workflow-revise.md` unless you loaded them via Read in this same agent response already; then apply step 6 rules. **Re-run steps 3–5 + step 5b tail** after each revision round.

Detail: `references/workflow-revise.md`.

**保存意图闸** — enter steps 7+ **only** when one of these holds:

| Path | Condition |
|------|-----------|
| **口头** | SQA says 「保存到 CawPlan」or synonymous 「存到 CawPlan」「保存需求」 |
| **识别兼容**（recognize, not prompt SQA to say） | `可以了`、`存吧`、`提交`、`归档` |
| **接力入站** | Session has `resume_intent` (`testpoint` \| `testcase`) — Rules **跨 skill 接力**; **not** an A1 verbal trigger |

**Do not** list `马上保存` as an A1 verbal trigger — that is A2/A3 框2 option label; it routes via `resume_intent` relay, not standalone A1 speech.

Until save intent is triggered: **do not** call `products list`, **do not** `qa-insights module-tree get`, **do not** recommend a mount node.

Display layer: five-field tail and guidance use 「保存到 CawPlan」; recognition layer may accept legacy phrases.

### 7–9. Save preparation (steps 7–9)

Before steps 7–9: on each new user message, read `references/workflow-save.md` unless you loaded it via Read in this same agent response already; then apply steps 7–9 rules.

Detail: `references/workflow-save.md` — Resolve product (step 7), 推荐挂载位置 (step 8), Create module-tree node (step 9).

### 10–11. Bind and archive (steps 10–11)

Before steps 10–11: on each new user message, read `references/workflow-archive.md` unless you loaded it via Read in this same agent response already; then apply steps 10–11 rules. **P6 UNKNOWN: always read** `references/workflow-archive.md`.

Detail: `references/workflow-archive.md` — Bind requirement context (step 10), Reconcile (step 10b), Archive or update (step 11), Command outcomes, Write body rules.

Before archive Confirmation: on each new user message, read `references/output-confirmation.md` (Confirmation section) unless you loaded it via Read in this same agent response already.

## Rules (hot path — full rules in `references/rules-global.md`)

- **Trigger boundary**: this skill is for SQA requirement analysis and QA Insights archiving — not for loading a ticket into a coding session. If the user only pasted a CawPlan issue URL with no analysis intent, stop and use `cawplan-ticket-context` instead. Ticket links are **material** here only when the user also wants five-field analysis or archive.
- **跨 skill 接力（入站 / 出站）**:
  - **入站**（来自「生成测试点」或「生成用例」框，且会话已有五字段草稿）：**跳过 step 1–6**，直接从 step 7（Resolve product）/ 归档闸 step 11 继续；**不得**从头重分析（措辞漂移会破坏 reconcile / snapshot diff）。入站（`resume_intent`）本身即保存意图；**不在入站前**向 SQA 重复五字段尾巴里的保存引导。
  - **入站挂载节点**：若接力已带 `module_tree_node_id`，按方案「已确定挂载节点直接用,不重问」— 跳过 §8 选位置闭环，直接进入 step 11（**保留** step 11 乙式确认闸，因无 §8 确认）。
  - **入站冷启动**（无五字段草稿）：从 step 1 正常收素材。
  - **出站**：归档或更新 `outcome: SUCCESS` 后，若会话存在 `resume_intent`（`testpoint` | `testcase`），回写 `product_id` + `requirement_id`（= `bound_requirement_id`），**读取并清除** `resume_intent`，回到发起方 skill 从其 **§2 refresh** 续跑；**不追加** §6 测试点引导（已自动回流）；不停在本 skill 等下一条指令。
  - **归档后测试点引导**：§6 成功回执末尾可选追加一句（见 `output-confirmation.md` §6 末尾引导）；用户回「马上生成测试点」→ 读 `cawplan-testpoint-generate` skill（P2 热交接）；不接茬则不重复提示。
  - §8 选位置确认后（`location_confirmed`）→ step 11 **跳过**乙式保存/更新确认，直接写入；§8 被跳过的路径（接力已带节点、冷交接未重选位置）→ **保留** step 11 乙式确认闸。
> **入站「跳过 step 1–6」的范围**：仅指接力入站后**首轮自动路由**至 step 7 / step 11（保存），**不是**禁止 step 6。若 SQA 在保存确认前提出五字段/摘要/存疑修改 → 仍走 **step 6（P2′ / P1b）**，`Re-run steps 3–5`；**不是**从素材重分析（对照 step 1 第 27 行、Rules 920「不得从头重分析」）。

## References

### Skill references（Mandatory read — 见 Read discipline）

- `references/workflow-step1-material.md` — step 1 素材：ticket lookup、截图、Product info
- `references/workflow-analysis.md` — steps 2–5b：五字段、展示摘要、漏测自检、存疑清单、呈现尾巴、固定措辞表
- `references/workflow-revise.md` — step 6：SQA 修订轮（须与 analysis + rules 同读）
- `references/workflow-save.md` — steps 7–9：产品解析、模块树闭环、建节点
- `references/workflow-archive.md` — steps 10–11、Command outcomes、Write body rules；Cold handoff；P6 reconcile
- `references/rules-global.md` — 总则、红线 0、枚举完整性、Failures、API scope 等（全文 889–924）
- `references/output-confirmation.md` — 分析 Output 格式；归档 Confirmation 文案

### Repository references

- `references/CAWPLAN_OPEN_API.md` — §15 QA Insights APIs (field/schema reference only — invoke via `cawplan qa-insights` CLI); §2 Product APIs (**Get Product Overview** → `cawplan products overview`; product resolution at save) and §4 Ticket APIs for ticket material.
