---
version: 0.2.9
name: cawplan-testpoint-generate
description: |
  Generate test-point coverage outlines from an archived CawPlan Requirement (five fields), with an open-questions list, and batch-archive test points after SQA confirmation.
  Use when: an archived Requirement needs test points or a coverage outline; cold handoff (Requirement link or id); hot handoff after A1 archive ("generate test points for this requirement"); incremental test-point supplements on an existing Requirement.
  NOT for: structuring or archiving Requirements (use `cawplan-requirement-analyze`); expanding test points into step-by-step cases or Excel (A3); viewing or editing archived test points or review in Test Suites (use the web UI); unarchived five-field drafts only (archive via A1 first).
argument-hint: "[Requirement link or requirement_id, or 'continue the requirement just archived']"
allowed-tools: Bash
---

# CawPlan TestPoint Generate

**跟随用户主语言**生成文案；禁止同一段中英各写一遍。

## 全局可见性契约

适用于本 Skill 的所有路径和每一次工具调用：用户不需要关注内部执行过程。除本 Skill 明确规定的最终结果、需要 SQA 确认/补充的信息及下一步操作外，保持静默。

- 不得在工具调用前后输出进度播报或过程说明，包括但不限于：正在检查/修复/重试、JSON 字段或文件格式、状态核验、后台任务、本地 Review 服务启动/重启/关闭。
- 内部可自行验证和重试；成功后直接输出该阶段规定的用户可见结果，不复述内部操作、命令输出或重试次数。
- 仅当无法自动恢复且需要 SQA 行动时，简要说明用户可感知的阻塞及所需操作；不要暴露内部实现细节。

## Bootstrap

```bash
cawplan skill check
```

## Workflow

**归档后用例热交接（优先于 §1）** — 本条为「马上生成测试用例」（或同义，见 `cawplan-testcase-generate` P2），且会话已有有效 binding（`product_id` + `requirement_id`）？

- **是** → 读 `cawplan-testcase-generate` skill，按 P2 热交接续跑（**stop** 本 skill 后续步骤）。
- **否** → 继续下方 §1。

### 1. Resolve target Requirement (entry priority)

On each **generate test points** request, resolve the target in this order (**fall through** until one row matches):

| Step | Condition | Action |
|------|-----------|--------|
| **P1** | This message has an explicit reference (Requirement link / `requirement_id` / switch to another Requirement) | **Cold handoff** — rebind; ignore prior session binding |
| **P2** | Hot-handoff phrasing matches **and** session has **valid binding** (`product_id` + `requirement_id` both present) | **Hot handoff** — use current session binding |
| **P3** | Session has a requirement **draft** (five-field draft from analysis) but **no** valid `requirement_id` (not saved yet) | → **框2「需求还没保存」** below. **Do not** call APIs or show a test-point table |
| **兜底** | None of the above (no link, no valid binding, no draft) | → **框1「锁定 Requirement」** below |

**P2 话术（同义，须先满足有效 binding 才走热交接）**：`马上生成测试点` / `生成测试点` / `补测试点` / `按上面那条` / `按上面那条生成测试点` / `接着刚才那条` 等。

**有效 binding** = `product_id` and `requirement_id` both present in session. Phrasing alone without binding → **fall through** to P3 or 兜底.

#### 框1 · 锁定 Requirement（入口 / 兜底）

**触发**：上表 **兜底**（无 Requirement 链接 / 无有效 binding / 无草稿）。P1 或有效 P2 → **不弹**。

**禁止**在选项中出现「用刚归档那条」（属有效 P2 热交接，自动走）。

**优先 AskUserQuestion**（**两个选项，每项须带 `label` + `description`**；工具会自动追加 Other 自由输入行，**标题/占位不可自定义**——**不要**在 skill 里定义或手写 Other / 自由输入行；**跟随会话语言**整框二选一，不同时输出）：

| 字段 | 中文值 | English value |
|------|-----|-----|
| `header` | 锁定 Requirement | Lock Requirement |
| `question` | 生成测试点前，先确定是哪条 Requirement？ | Before generating test points, let's confirm which Requirement this is |
| option 1 · `label` | 已有 Requirement 链接 | I have a Requirement link |
| option 1 · `description` | 把链接发我 | Send me the link |
| option 2 · `label` | 没有 Requirement | No Requirement yet |
| option 2 · `description` | 马上生成并保存到 CawPlan | Generate and save to CawPlan now |

**AskUserQuestion 不可用时** — 纯文字降级（逐字；**跟随会话语言**二选一，不同时输出）：

```text
锁定 Requirement
生成测试点前，先确定是哪条 Requirement？
1. 已有 Requirement 链接 —— 选这个，把 Requirement 链接发我
2. 没有 Requirement —— 马上生成并保存到 CawPlan
请回复序号，或直接粘贴 Requirement 链接、或直接说你想怎么做。
```

```text
Lock Requirement
Before generating test points, let's confirm which Requirement this is
1. I have a Requirement link — pick this, then send me the link
2. No Requirement yet — generate and save to CawPlan now
Reply with a number, paste the Requirement link directly, or just tell me what you'd like to do.
```

**落点**：

- 选「已有 Requirement 链接」→ **请对方发 Requirement 链接**（一句即可）；拿到 Requirement 链接后（下条消息，或工具自动 Other 框里直接粘贴）→ 按下方 **Portal URL** 规则解析（只解析、不 fetch）；仅 `requirement_id` 缺 `product_id` → 用大白话追问补 `product_id` 或完整 Requirement 链接。无法解析为 Requirement 链接 → 复述两项，请重选或补 Requirement 链接。
- 选「没有 Requirement」→ 读 `cawplan-requirement-analyze` skill，按 **跨 skill 接力**：会话写 `resume_intent = testpoint`；有草稿则跳过分析直达归档闸，无草稿则从收素材开始。

#### 框2 · 需求还没保存

**触发**：上表 **P3**（有需求草稿、无 `requirement_id`）。有效热交接 / 已给 Requirement 链接 → **不弹**。

**优先 AskUserQuestion**（**两个选项，每项须带 `label` + `description`**；Other 行由工具自动追加，**勿定义**；**跟随会话语言**整框二选一，不同时输出）：

| 字段 | 中文值 | English value |
|------|-----|-----|
| `header` | 需求还没保存 | Requirement Not Saved Yet |
| `question` | 这份需求还没保存到 CawPlan，先保存再来生成测试点 | This requirement hasn't been saved to CawPlan yet — save it first, then generate test points |
| option 1 · `label` | 马上保存 | Save now |
| option 1 · `description` | 存好再接着生成测试点 | Save it, then continue to generate test points |
| option 2 · `label` | 先不保存 | Not yet |
| option 2 · `description` | 先停一下，我再看看这份需求 | Pause for now, I'll review this requirement again |

**AskUserQuestion 不可用时** — 纯文字降级（逐字；**跟随会话语言**二选一，不同时输出）：

```text
需求还没保存
这份需求还没保存到 CawPlan，先保存再来生成测试点
1. 马上保存 —— 存好再接着生成测试点
2. 先不保存 —— 先停一下，我再看看这份需求
请回复序号，或直接说你想怎么做。
```

```text
Requirement Not Saved Yet
This requirement hasn't been saved to CawPlan yet — save it first, then generate test points
1. Save now — save it, then continue to generate test points
2. Not yet — pause for now, I'll review this requirement again
Reply with a number, or just tell me what you'd like to do.
```

**落点**：

- 「马上保存」→ 读 `cawplan-requirement-analyze` skill，会话写 `resume_intent = testpoint`，走保存/归档流程（**确认闸照旧**）；`SUCCESS` 后回到本 skill **§2 refresh** 续跑。
- 「先不保存」→ **stop**；保留草稿，不生成测试点。
- 若 SQA 用工具自动 Other 或自由回复 → 按内容判断（换目标 / 补充说明）；无法理解则复述两项选项。

**Portal URL** (parse only — never fetch):

`/product/{product_id}/qa-insights/test-suites/requirements/{requirement_id}`

- Extract `product_id` + `requirement_id` from the string only.
- **Forbidden**: `cawplan api GET {url}`, HTTP fetch, or any request to the portal path.

**Only `requirement_id`, missing `product_id`**: ask for `product_id` or a full Requirement link. **Do not** guess the product or scan product lists.

**Rebind** replaces the whole context (`product_id`, `requirement_id`, five fields, test-point stubs). One active Requirement at a time. Same `requirement_id` as current binding = refresh same row, not rebind. Contradictory messages (new URL + "还是刚才那条") → ask; do not guess.

### 跨 skill 接力

- **出站**（框1「没有 Requirement」、框2「马上保存」）：接力前写入 `resume_intent = testpoint`。
- **入站回归**：需求分析归档 `SUCCESS` 后，发起方从 **§2 refresh** 继续。
- **A1 §6 引导入站**：需求分析 §6 成功回执后 SQA 说「马上生成测试点」→ 有效 binding 下 P2 热交接，直跑 §2 refresh（无需再贴需求）。
- **出站回归（`resume_intent = testcase`）**：测试点归档 `SUCCESS`（或 §10 `count_matched` 确认已落库）后，若会话存在 `resume_intent = testcase`，**读取并清除** `resume_intent`，读 `cawplan-testcase-generate` skill 从其 **§2 refresh** 续跑；**不追加** §9.5 用例引导；不停在本 skill 等下一条指令。
- **归档后用例引导**：§9.5 成功回执末尾可选追加一句（见 §9.5 末尾引导）；用户回「马上生成测试用例」→ 读 `cawplan-testcase-generate` skill（P2 热交接）；不接茬则不重复提示。
- **框1「已有 Requirement 链接」解析成功** → 按 P1 冷交接继续，**不弹**框2。

### 2. Refresh before generate (always)

Before generating or supplementing test points (cold or hot), pull live data:

```bash
cawplan api GET /api/v1/public/openapi/product/<product_id>/qa/requirements/<requirement_id>
```

Use `data` directly for the five fields + `url` (single `QARequirement` object; no list filter).

```bash
cawplan api GET /api/v1/public/openapi/product/<product_id>/qa/requirements/<requirement_id>/testpoints
```

`data.test_points.length` is the already-archived count N used by §3's incremental gate and §6's incremental-scope closure. **This skill no longer tracks it as a reconcile baseline** — `testpoint-review start` (§7.1) records it into the Review State's own `count_before` at creation time, and the page advances it after every successful Save to CawPlan; the count-reconcile flow now runs entirely page-side (§10), so Chat has no `write_outcome`/`count_before` state of its own to maintain.

| Result | Action |
|--------|--------|
| Requirement found (`code: SUCCESS`) | Use **latest** five fields silently; do not diff against chat cache |
| Requirement missing (`404` or explicit not-found) | Report "这条 Requirement 已不存在" / "This Requirement no longer exists"（**跟随会话语言**二选一）; do not generate from stale context |

Use five fields for generation only. Do not track `module_tree_node_id`, `review_status`, or `ticket_id` for A2 logic.

### 3. Incremental gate (§9.3)

Check in this order (**library-empty check first — do not evaluate intent wording before this**):

1. **`testpoints` is empty** → **generate directly**. **Do not** ask, regardless of how vague the phrasing is (e.g. "生成测试点" alone). This is the most common case (first-time generation) and must never fall into step 2.
2. **`testpoints` is non-empty** and intent is vague ("生成测试点" only, no indication of supplement vs. review) → stop and ask:
   - Supplement a few more on top of existing?
   - Show what's already archived first?
3. **`testpoints` is non-empty** and intent is clear ("再补两条并发的" / "看看已有的") → proceed directly.

### 4. Read coverage references (required)

Before discovering obligations, use the file-reading tool to **read both files completely**; do not rely on memory or hardcoded rules in this skill. Do not enter Step 1 until both reads have returned successfully. If either file cannot be read, stop and report the missing reference instead of generating a draft.

- `references/coverage-dimensions.md` — discovery knowledge used in Steps 1–2.
- `references/review-checklist.md` — terminal checklist applied only in Step 5; reading it here does not make it a second generator.

**After both reads succeed, go straight to Step 5.** Do not call any tool and do not pause for confirmation between finishing these reads and starting Step 5 — in particular, do not call `AskUserQuestion` here; there is nothing to ask at this point.

### 5. Generate test points (no write)

**目标顺序**：覆盖完整度优先（Recall > Precision）；允许多生成可删的方向性测试点，但**红线 0 永远优先**。先把候选完整展开，再统一分流与收敛；不得在发现阶段挑“代表性场景”。

候选先各自独立列出，逐条判断最终归入测试点或存疑；不需要另建状态表、账本字段或覆盖矩阵——来源判断随手做，不建表，也不呈现、不落库。

#### Step 1 — 发现

1. 将五字段**逐句完整读到末尾**，按对象、操作、关系、约束、变化、不变量拆出彼此独立的验证候选；已发现若干项也不得提前收尾。
2. 对每个命中的值、状态、条件、来源、角色、适用层级、前后变化与不受影响对象分别发现候选。若多个分区可能有不同结果，先分别列出，不得先合并——是否属于同一验证目标、是否应合并成一行是 Step 4 的判断，本步骤只管展开不管收敛，不得因为"反正最后会合并"就提前用一句话跨分区、跨对象归纳掉候选。
   **排除性/口径声明句必须单独展开**：五字段中出现"仅统计 X，不与 Y 合并"「不包含 / 不影响 / 独立于 / 与…无关」这类**没有显式动作、只是在给某个概念划边界或排除歧义**的句子时，不得因为它读起来像背景说明或定义就跳过——必须单独产出一条候选，验证"该口径/边界在实际行为中确实被遵守"（例如"其他类型端口的连接数变化不应影响图片上限判断"）。
3. 逐项使用 `references/coverage-dimensions.md` 的路径类型和 A→B→C→D 变化轴作为**发现提示**。C/D 八轴必须逐项读到，不能因需求无关键词提前停止；是否有正面排除证据在 Step 3 统一判断。
4. 基本盘方向只要与功能形态相符就进入候选：正常主路径；外部输入的异常；存在范围时的合法边界；存在取消/撤销/回退时的逆向。需求没写失败细节不等于不适用。
5. 五字段**完全无法形成操作 + 方向性预期**时停止并请 SQA 补充；薄但可测时继续，缺口进入存疑。

   **停止后话术**（纯文字，逐字；**跟随会话语言**二选一，不同时输出）：
   > 这份需求的信息还不够生成测试点（缺操作或预期方向），麻烦补充一下具体是做什么、期望什么结果，我再继续。
   > This requirement doesn't have enough detail to generate test points yet (missing the operation or expected direction) — please add what it does and what's expected, and I'll continue.

#### Step 2 — 补齐关系分区与有意义组合

1. 若需求存在真实关系语义，按 `coverage-dimensions.md` 的关系知识补齐分区候选；不得只覆盖需求举出的单侧关系（数量比较通常检查 `< / = / >`，具体预期仍由 Step 3 按证据分流）。
2. 两个因素组合后，只要可能改变**可用性、结果、状态、副作用、反馈、影响范围或恢复行为**，就展开组合候选；默认只检查二元组合，只有需求明确三因素联动、或任一二元检查都无法表达风险时才展开三元组合。
3. 禁止无意义全量笛卡尔积；仅“同时出现”但不会改变行为的因素不组合。拿不准是否影响行为时，保留该组合候选交 Step 3 分流，不得静默丢弃。

#### Step 3 — 每项按证据分流

每条候选最终且只能归入以下一类：

- **测试点**：方向唯一，能在不编造细节的前提下写出“操作/条件 + 方向性预期”。只是“要不要纳入本轮”未拍板，但功能形态明显适用时，也生成方向性测试点，并在标题末尾加“（范围待确认）”。
- **存疑**：存在多种合理实现或预期；缺少必要触发条件；或必须补充具体规则后才能断言。格式为：〔指向哪〕+〔为什么疑〕+〔建议动作〕。
- **排除**：仅限五字段明确列入 out_of_scope、功能形态直接正面证明不可能成立，或类型/状态/业务约束明确不可达；记录简短理由。不得用“需求没提”“感觉不重要”“已有相似点”作为排除理由。

**C/D 不对称硬规则**：对 `幂等 / 并发 / 一致性 / 存量兼容 / 环境兼容 / 性能 / 安全审计 / 可观测` 八轴逐项应用 `coverage-dimensions.md` 的正面形态门槛。只有门槛正面证明不适用时才可排除；否则该轴必须贡献至少一条“测试点”或“存疑”。多轴指向同一缺口时可合并存疑文案，但不得因此遗漏轴名或去向。A/B 轴若功能形态明确不涉及可不产生候选。

**红线 0 — 防臆造（最高优先级）**：

- 标题只能使用五字段已有的具体事实，以及“应成功 / 应失败 / 应拦截 / 应有明确反馈”等方向性预期。
- 五字段未提供时，禁止编造具体数值、阈值、次数、超时时长、文案、错误码、产品隐藏规则或实现方式。
- 若候选只有具体部分缺证据，优先拆成“方向性测试点 + 具体细节存疑”；不得因细节未知把可测方向整项丢掉。
- 五字段已给出的数值、枚举、文案或规则可以直接使用。
- Recall 优先只允许增加**有依据的方向**，不允许增加虚构细节。

**存疑纪律**：

- “素材未提及 / 需补充”不能单独构成存疑；必须指出具体覆盖方向、缺少的决策及建议动作。
- 多种合理实现（如入口隐藏或点击后拦截）必须存疑，不猜其中一种。
- 产品特有联动、隐藏规则、跨功能归属和主观体验只能作为能力边界提示，不得假装已覆盖。

#### Step 4 — 全部分流后统一收敛

只有所有候选都完成 Step 3 后，才允许生成最终标题、合并和批内去重。**禁止用 representative 场景替代候选。**数量由覆盖空间决定，无固定上下限。

**颗粒度与合并规则**：

1. 一行 = 一个 verification goal（测什么），不写前置条件 + 步骤序列 + 逐值 Expected；可执行脚本属于 A3。候选的颗粒度允许比最终 Test Point 更细——Step 1 展开的多条候选合并成一行，是本步骤的正常产出，不是发现阶段的失败。
2. **合并判据（先判差异性质，再判是否同一行为）**：
   - 两条候选的差异，是否**仅**来自同一个 verification goal 下的 partition 取值（具体对象/位置如首位/中间/末位、比较关系取值 `< / = / >`、边界值、输入值、状态值，以及套餐/权限/状态本身就是该 goal 要覆盖的分区时，例如"免费版/付费版执行同一操作，结果应保持一致"）？
     - **操作类型**（删除/新增/替换/提交……）相同、只是**作用对象**不同（作用在哪个位置/哪一项）→ 属于 partition。
     - 前置条件是否可并入 partition，看它是否引入了不同的产品行为或规则：若只是同一行为在不同前置下的结果一致性验证，前置就是 partition；若前置改变了被验证的产品行为本身（例如付费版解锁了免费版完全没有的功能分支），则不是。
     - 只要有任一处差异不满足"仅来自 partition 取值"（操作类型不同、被验证的属性/行为不同、前置引入了新的产品行为）→ **不得合并**，不得为了凑合并重新定义"这也算一种分区"。
   - 确认是 partition-only 差异后，把具体取值抽换成占位符做语义层面（非字符串层面）比较：抽掉 partition、归一化措辞后，是否仍在验证**同一对象上的同一产品行为/属性**？是则合并；归一化后发现对象或行为其实不同，退回不合并。
   - 不得先认定"最终想合并成一行"再倒推着把不同验证目标包装成同一 goal 的分区；必须先判差异性质，再决定要不要合并，不能反过来。
3. 仅测试数据不同的同一目标合并为一行，并在标题中**列全关键值/状态/位置/条件/来源/范围**；默认项不可省略。
   **口径/边界声明类候选默认不合并**：由 Step 1「排除性/口径声明句」规则产生的候选（如"某类统计口径不与其他类型合并"），默认保留独立成行，除非能明确证明合并后的标题仍完整保留该口径的验证意图。拿不准时优先保留独立条目，不得为了表格简洁或凑数硬合并导致该口径的验证意图消失。
4. **合并守恒**：合并不得改变最终归类；每条合并前的测试点候选都必须映射到至少一条最终标题，且能从标题反查其关键分区。做不到就不合并（详细复查见 §6「上限三方向 + 分区值列全」及 `references/review-checklist.md` §三）。
5. 批内去重只处理本轮无 id 草稿。不得按语义删除已归档行；跨批仅以 id 区分。增量展示可由“已存 N + 新增 M”的整体集合证明覆盖，但归档仍只提交 M。
6. 为每条最终测试点填写 `group`、`tags`、`priority`；标签规则以 `coverage-dimensions.md` 为准。

**标题形态**：前置条件 + 被测行为 + 方向性预期；一个标题只表达一个验证目标。

Good: Free plan 已有 50 个 workflow 时再 Duplicate 应提示超过上限且无法复制

Good: 选择各 Duration 挡位（5s/10s/15s，含默认 15s）后，导出视频时长应与所选挡位一致

Bad: 测试复制功能

Bad: 打开配置 → 分别选择各挡位 → 逐档导出并检查（这是 A3 步骤）

**Priority rules（每条测试点必填）**：

| 判断依据 | priority |
|---|---|
| 正向主路径，或涉及资金、权限、数据丢失风险 | HIGH（默认档） |
| 核心链路的异常 / 边界 | MEDIUM |
| 非核心、辅助性、UI 细节 | LOW |

- AI 不主动生成 CRITICAL；SQA 可在修订时指定。
- priority 必须逐字符等于 CRITICAL / HIGH / MEDIUM / LOW 之一。
- 存疑不是测试点，不需要 priority。

### 6. Step 5 — 覆盖闭合与一次需求特异性反查

Step 4 形成草稿后、首次呈现前执行一次。若 Step 1 判定五字段完全不可测，则跳过。

**对照 §4 已完整读取的 `references/review-checklist.md` 从头到尾走一遍**（不得跳过，也不得凭记忆替代）：逐条检查覆盖闭合（来源 / 关系分区 / 行为组合 / 去向）、收敛守恒（合并映射、标题可反查）、红线与输出契约；发现缺口就补候选并回 Step 3 分流，发现错合并就拆回独立标题。以下四项是本轮最容易漏、必须显式确认的重点，不因为已过完清单就跳过：

- **C/D 八轴每轴都有去向**：幂等/并发/一致性/存量兼容/环境兼容/性能/安全审计/可观测，逐轴确认要么有正面排除证据，要么已归入测试点或存疑，不留空轴。
- **上限三方向 + 分区值列全**：涉及比较或配置/容量切换的候选，`< / = / >`（或变小/不变/变大）三态是否齐全；已合并标题里的具体分区值（位置、状态、比较结果等）是否逐字保留，没有被"任意/某个/某种"这类抽象词糊掉。
- **红线 0 不越界**：所有标题只用五字段已有事实和方向性预期，没有编造数值、次数、文案、错误码。
- **输出契约**：每条测试点一个目标、合法主标签、priority 枚举正确、英文会话用术语表词、补充标签至多一个且只在 tags[1]。

完成后**一次需求特异性反查**：丢开清单，把五字段原文与草稿并排重读一遍，只问"这份表最可能漏掉哪项本需求特有的风险"，剩余特异性语句扫到末尾；新发现项走 Step 3 分流，再做一次来源/去向/合并守恒确认即可，不必再次通读整份清单。

**Incremental scope**：闭合时用“已归档 N + 本轮新增 M”整体判断覆盖，已有标题可承接候选；只为缺口生成 M，绝不修改或重发 N。只在本轮首次呈现前执行一次，SQA 修订后不自动重跑，除非明确要求重新生成。

**Internal only, one version**：不得输出候选、排除理由、检查过程、勾选表或来源标记。完成五步后只产出一版最终列表交给 §7 建 Review；本阶段新增行进入 Review 时 `status` 为 `unchanged`（未经 SQA 改动），归档时对应 `is_edited: false`（§9）。

### 7. Present to SQA

**输出纪律**：呈现时**不铺测试点表格**——测试点内容的呈现、编辑、删除、新增全部交给 Review 页面（§7.1）；Chat 只给「哪条需求 + 摘要 + 存疑清单 + 打开页面的方式」。**禁止**复述内部过程——不得出现「轴遍历 / 自查 / 覆盖维度清单 / 已按…完成 / 五字段已读取 / 核对完毕」等字样。第一句直接进正题。

#### 7.1 建 Review、拿 `review_id`（Step 5 完成后立即执行，早于任何 Chat 输出）

Step 5 产出最终测试点列表后，**在向 Chat 输出任何内容之前**先建 Review：

1. 把 Review 初始内容写成 JSON，可选带上五字段快照。输入契约如下：
   - **本轮新增草稿**：`{title, group, tags, priority}`；不得带 `id`，`archived` 省略（或为 `false`）。
   - **CawPlan 已归档测试点**（仅增量场景）：`{id, title, group, tags, priority, archived: true}`；`id` 必须使用 §2 refresh 返回的服务端原值，不得改写或生成。
   - `testpoint-review start` 只把 `archived: true` 的条数作为 Review State 的 `count_before`；输入总数不是 reconcile 基线。页面隐藏这些已归档行，Save to CawPlan 永远只提交未归档草稿。
2. 调用：

   ```bash
   cawplan qa-insights testpoint-review start --product-id <id> --requirement-id <id> \
     --lang <会话语言 zh|en> --test-points-file <path> [--requirement-file <path>]
   ```

   （`--test-points`/`--requirement` 为同形状的内联 JSON 版本，二选一即可。）

3. 命令返回 `{review_id, file, draft_count, archived_count, group_count, count_before}`。记录 `review_id` 到 session binding（与 `product_id`/`requirement_id` 同级，见 Session state）；Chat 数量只读 `draft_count`/`group_count`，不得从输入或页面自行重数。
4. 用 Agent 的**托管后台任务**启动页面服务（不得在前台等它退出）：

   ```bash
   cawplan qa-insights testpoint-review open --review-id <id> --no-browser
   ```

   必须使用 Agent 工具的托管后台能力（例如 Bash `run_in_background: true`），保留该任务句柄；**禁止**用 `nohup`、`&`、`disown` 或终端复用器把服务脱离当前 Claude 对话。读取启动输出中的 `Open this URL to review test points: <url>`，记录完整的 `review_url` 与后台任务句柄；只等 URL 出现就继续 Chat 输出，不等服务结束。页面服务仍在运行时禁止为同一 `review_id` 再启动第二个 `open`。

   **页面 Ask AI 的自动主流程**：SQA 点击 Ask AI to Optimize 后，页面会锁定并关闭本地服务；这会让上述**托管后台任务**在当前 Claude 对话中结束。收到该任务完成事件后，先立即输出 `正在优化，请稍候…` / `Optimizing, please wait…`（跟随会话语言二选一），再读取最新 Review State：若 `review_status` 是 `pending_optimize` 或 `optimizing`，直接从 §8 step 2 继续，不得再次调用 `request-optimize`。完成 `apply-optimization` 后按 §8 step 5 打开下一 Round 的 Review 页面。

**不存在**"先在 Chat 展示、SQA 确认后才建 review"这种中间态——只要 Step 5 完成，Review 就已经创建。

**增量场景**（库里已有归档测试点）：先按 §2 refresh 读到的已归档 N 条（逐条保留服务端 `id` 并标 `archived: true`）+ 本轮新增 M 条（不带 `id`），一并作为 `--test-points-file` 的输入建。创建结果必须满足 `archived_count = N`、`draft_count = M`、`count_before = N`，且待保存集合只含 M；任一条件不符都停止，不得打开页面或提交。（或续用同一个 `review_id`，取决于是否为同一 Review 的后续补充轮——原则与 §3 Incremental gate 一致：延续同一份 Review 数据，不为每轮增量单独开一份新 Review。）

#### 7.2 Chat 呈现（摘要 + 存疑清单，不出表格）

**开场**（`〔需求名〕` = `summary` → truncate `function_description` → `requirement_id`，与保存确认等处显示名规则一致；`N` = `testpoint-review start` 返回的 `draft_count`，`M` = 返回的 `group_count`，**只从命令输出读取，不自行数行**）：

- **首批**（库为空，逐字；**跟随会话语言**二选一，不同时输出）：
  > 需求「〔需求名〕」已生成 N 条测试点草稿，按 M 个分组，详情和编辑请打开 Review 页面：
  > Drafted N test points for requirement "〔需求名〕" across M groups — open the Review page for details and editing:

- **增量**（库里已有，逐字；**跟随会话语言**二选一，不同时输出）：
  > 需求「〔需求名〕」本轮新增 N 条测试点草稿，详情和编辑请打开 Review 页面：
  > Drafted N new test points for requirement "〔需求名〕" this round — open the Review page for details and editing:

紧接一行可点击链接（逐字，填入完整 `review_url`；**跟随会话语言**二选一，不同时输出）：
> Review 页面：[点这里打开](<review_url>)
> Review page: [Open it here](<review_url>)

**断链恢复提示**（仅首次呈现；**跟随会话语言**二选一，不同时输出）：
> **注意：** 此链接仅在当前 Claude 运行期间有效，草稿会自动保存。链接失效后，直接发送 **「恢复 Review 页面」** 即可。
> **Note:** This link is only available while the current Claude session is running. Your draft is saved automatically. If the link stops working, just send **"Restore the Review page"**.

SQA 发送「恢复 Review 页面」（或对应英文）时：使用当前 binding 的 `review_id`；若页面服务已关闭，按本节的既有规则在后台重新执行一次 `testpoint-review open --review-id <id> --no-browser`，然后只返回新的 `review_url`。不得新建 Review、重新生成测试点或覆盖现有 Review State。

**禁止退化成只给命令或只给 `review_id`。** `review_url` 是本机临时地址；页面服务存活时复用同一链接。服务已关闭才重新后台启动一次 `open --no-browser` 并替换为新 URL，禁止同时运行两个相同 Review 服务。普通 Review 不设固定时长过期；10 分钟阈值只用于识别点击 Ask AI 后长期未回调的优化请求，并提示 SQA 手动继续优化。

然后是**存疑清单**（§5）：〔指向哪〕+〔为什么疑〕+〔建议动作〕；无覆盖勾选矩阵；若没有存疑，明确说明"没有存疑项"/"no open questions"。存疑清单只在 Chat 呈现，不写入 Review 数据（页面数据模型没有这个概念）。

**尾巴**（存疑清单之后，**仅首次呈现**逐字输出；修订轮改走 §8 的精简输出契约；**不做弹框**；**跟随会话语言**二选一，不同时输出）：
> 有修改意见可以直接在这里说，或者去 Review 页面编辑；确认没问题后，请在 Review 页面点击 Save to CawPlan 完成提交。
> Tell me your changes here, or edit them directly on the Review page; once it looks good, click Save to CawPlan on the Review page to submit.

**Do not state draft totals beyond N/M above** — 除了开场这一句用命令返回值报的 N/M，其余场合（修订后重展、催问进度等）不再重复报数，避免和"N/M 只来自命令输出"这条纪律冲突而被误用成手数。

### 8. Revise from SQA feedback

**Review State（`review_id` 对应的持久化数据）是测试点的唯一事实源。** Chat 和 Review 页面都是输入入口，但都不在会话里各自维护一份测试点数据——任何一轮处理前先读最新 Review State，不能假设 Chat 记得的内容和页面当前状态一致（页面上可能已经有 QA 直接做的 Edit/Delete/Add）。

**Chat 里任何形式的修订意见，统一走同一条路径**，不区分"回复存疑" / "自然语言整体修订"（如"补充超过上限的边界场景"）/ 看起来机械的单条操作（如"删除第 3 条"）——都视为针对当前 Review 的新一轮 AI 输入，不单独开一条"直连编辑、不占用 Round"的快速通道：

1. 调用 `cawplan qa-insights testpoint-review request-optimize --review-id <id>` 锁定当前 Review（效果等价于页面点击 "Ask AI to Optimize"：整页锁定、`review_status` 变 `pending_optimize`，但不需要页面已打开）。
2. 读取最新 Review State（页面编辑、删除、新增和评论均以此为准）：

   ```bash
   cawplan qa-insights testpoint-review show --review-id <id>
   ```

   用输出的完整 State（尤其是 `test_points[].current`、`status`、`comments`、`global_comments` 和 `requirement`）作为本轮 AI 推理的唯一页面输入，不得只使用 Chat 里旧的测试点内容。
3. 把「最新 Review State + 本轮 Chat 输入」交给 AI 推理，产出下一 Round 的修改/新增。写入 `apply-optimization` 前，输出 JSON **必须**是以下形状（每条 `modified` 与 `added` 都须提供完整的 `title` / `group` / `tags` / `priority`）：

   ```json
   {
     "modified": [
       {
         "id": "tp_001",
         "fields": {
           "title": "...",
           "group": "...",
           "tags": ["..."],
           "priority": "HIGH"
         }
       }
     ],
     "added": [
       {
         "title": "...",
         "group": "...",
         "tags": ["..."],
         "priority": "HIGH"
       }
     ]
   }
   ```

   `Review State` 中的 `current` 只是现状快照，**不是** `modified` 的输出字段；也不能把 `title` / `group` / `tags` / `priority` 平铺在 `modified` 条目上，必须放进 `fields`。
4. 调用 `apply-optimization` 落盘，命令必须使用 `--output-file`：

   ```bash
   cawplan qa-insights testpoint-review apply-optimization --review-id <id> --output-file <absolute-json-path>
   ```

   该命令是**原子操作**：任一条输出不合法时，会明确报出字段路径，且不会应用任何条目、清评论、改变状态或推进 Round；此时保持原来的 `pending_optimize`，修正**同一份** JSON 后直接重试 `apply-optimization`，不得再次调用 `request-optimize`。全部校验通过后才 round + 1、页面恢复可编辑。

**Fallback trigger**：SQA 在 Claude Chat 发送 `继续优化 Review 页面` 或 `Continue optimization` 时，先执行本节 step 2 的 `show`，再根据该 State 推理；若它处于 `pending_optimize` 或 `optimizing`，直接从本节 step 3 继续，不能再调用 `request-optimize`。`恢复 Review 页面` 仍只按 §7 的恢复规则重开页面；即使页面处于 pending，也不在该触发词下自动推进优化。
5. 确认当前页面服务是否仍存活：存活则复用 `review_url`（服务会从 Review State 重新读取最新 Round）；已关闭则后台重新执行一次 `open --no-browser` 并记录新 URL。禁止同时运行两个相同 Review 服务。
6. 更新会话中的 `open_questions`：
   - 用户本轮已明确回答、且已据此修改/新增测试点的存疑 → 移除；
   - 用户未回答的旧存疑 → 保留**完整原文**，不得缩成轴名、关键词或数量；
   - 本轮新产生的存疑 → 以「指向哪 + 为什么疑 + 建议动作」完整加入；
   - 修订后得到的 `open_questions` = **当前全部未解决存疑**，不是只记录本轮新增项。

#### 修订后 Chat 输出契约

修订成功后，按以下顺序输出，正文只保留这三块；措辞可自然表达，**不要求逐字照抄示例**：

1. **最新 Review 链接**：每轮必须给一次、且只给一次可点击的 `review_url`。不得只给命令或 `review_id`；无需再写 Round 编号或“Round 已更新”等页面已有信息。
2. **完整剩余存疑清单**：逐条输出 `open_questions` 的完整内容；不得只说“还剩 N 条”，不得只列主题/轴名。没有存疑时明确说明没有剩余存疑。
3. **简短引导**：只表达“有修改可继续在 Chat 说或去页面编辑；没问题就在页面 Save to CawPlan”。文案可自然调整，不写死，不再重复链接、Round、测试点数量或存疑数量。

**禁止额外成功摘要**：不要复述或改写 `apply-optimization` 的成功输出；不要输出“应用了 N 条”“当前共 N 条”“round N”“0 skipped”，也不要在 Chat 重列本轮新增/修改的测试点——详情由 Review 页面承载。校验失败不会产生新的 Review 结果，须按上方原子操作规则修正同一份 JSON 后重试；成功结果的 `skipped_count` 必为 `0`，保持静默。

结构示例（仅示意结构与信息，不是固定文案）：

```text
Review 页面：[打开最新版本](<review_url>)

存疑清单：
1. 〔指向哪〕为什么疑；建议动作。
2. 〔指向哪〕为什么疑；建议动作。

有修改可以继续说，或直接在 Review 页面编辑；没问题就在页面点击 Save to CawPlan。
```

**Ambiguous edits → ask**，不猜测具体所指。

**SQA insists on keeping two similar rows** → keep both; 这属于交给 AI 推理时的一条明确指令，AI 处理下一 Round 时不应对这两条重新合并。

**Never auto-save / auto-submit.** Chat 里的修订只推进 Round，不触发归档；"看着不错"之类的认可 ≠ 保存到 CawPlan（归档路径见 §9）。

### 9. Archive (write — page-only, Chat never calls `testpoints archive` directly)

**归档只有 HTML Review 页面一个入口。** SQA 在 Chat 里说 保存 / 存 / 入库 / `保存到 CawPlan` / 确认提交 时，**不要**在 Chat 里弹确认框或直接调用归档命令：

1. 若 §7 已启动的页面服务仍存活，复用该后台任务与 `review_url`，**不得再启动第二个 `open`**。
2. 若服务已关闭，后台重新执行一次 `cawplan qa-insights testpoint-review open --review-id <id> --no-browser`，拿到新 URL。
3. 输出可点击链接，并等待当前 `open` 后台任务结束；SQA 在页面点击 Save to CawPlan 成功后，页面会关闭 Server，等待中的 Agent 即可继续输出成功回执。

引导文案（逐字，填入完整 `review_url`；**跟随会话语言**二选一，不同时输出）：

> Review 页面：[点这里打开](<review_url>)。请点击 Save to CawPlan 完成提交。
> Review page: [Open it here](<review_url>). Click Save to CawPlan to submit.

这样确保 archived 状态、排除 deleted、未处理反馈拦截、重复提交保护等逻辑始终只有一套（页面侧 `/api/save-to-cawplan`），不产生 Chat / 页面两条归档路径。

**保存前置条件**：若页面仍有任一测试点 Comment 或 Overall Feedback，且尚未被一次成功的 Ask AI 优化消费，Save to CawPlan 必须拒绝提交并提示先 Ask AI；没有确认弹窗或强制提交入口。仅 Edit / Delete / Add（没有上述未处理反馈）可以直接按当前页面状态保存。

**成功回执自动触发，不需要 SQA 回报**：SQA 在页面点击 Save to CawPlan 成功后，页面会关闭本地 Server；Agent 刚才那条挂起的 `open` 调用随之结束，读取最终 Review State 里本轮新增的 `archived: true` 条目数，**自动**在 Chat 输出成功回执（§9.5 格式，逐字文案与追加条件均保留不变），不需要 SQA 再回 Chat 说一遍"保存好了"。

**唯一前提（⚠️ 需要同一对话）**：页面服务必须由当前 Agent 对话在后台启动并保留任务句柄，归档时才能等待它结束并自动回执。SQA 不需要、也不应再去终端手动运行 `open`。如果中途换了新对话，新对话没有旧后台任务句柄，应先确认旧服务已停止，再启动一次并返回新链接。

**Success receipt (§9.5)** — **only place SQA sees a count**. **Two lines** when `url` is present; otherwise line 1 only. Use **`N` = 本轮 Review State 中新增 `archived: true` 的条目数**（从页面 Save 成功后的最终 Review State 读取，不自行数行）。`〔需求名〕` = `summary` → truncate `function_description` → `requirement_id`.

- **Line 1**（逐字；**跟随会话语言**二选一）：`已保存 N 条测试点到需求「〔需求名〕」下。` / `Saved N test points under requirement "〔需求名〕."`
- **Line 2**（仅当 refresh 返回非空 `url`；**单独一行**，不接到 line 1 句末；逐字；**跟随会话语言**二选一）：`Requirement 链接:{url}` / `Requirement link: {url}`

**If `url` is missing or null** — output line 1 only; say nothing about links — never construct portal URLs, never note that `url` was unavailable.

**Forbidden in success receipt**: per-row tables; title lists; `id` lists; re-generated or summarized titles; any line about missing `url`; **apology or post-hoc recount explanations**。

**§9.5 末尾引导（可选追加，逐字与追加条件原样保留）** — 满足**全部**条件时，在成功回执**最后**另起一行逐字追加（不弹框、不追问、**仅本轮一次**；**跟随会话语言**二选一，不同时输出）：

> 想继续生成测试用例？说「马上生成测试用例」，我会在当前会话直接生成。
> Want to generate test cases next? Say "generate test cases now" and I'll do it right in this session.

**追加条件**（须同时满足）：

- 本轮 Save to CawPlan 结果为成功（页面返回 `archived_count > 0` 且非 `NOOP`/失败）
- 会话**无** `resume_intent`（非跨 skill 入站接力后的自动出站回归）
- 非保存失败 / 冲突（409）路径

**不追加**：`NOOP`（没有可提交内容）、页面返回 409/502 失败；出站 `resume_intent = testcase` 自动回流 `cawplan-testcase-generate`（已自动续跑，无需再引导）。SQA 未接茬、去做别的 → **顺其自然，不重复提示**。

**用户接茬**：SQA 说「马上生成测试用例」→ 以会话 `product_id` + `requirement_id` 读 `cawplan-testcase-generate` skill，当前会话 P2 热交接直跑 §2 refresh，**无需**再贴需求或测试点。

**失败/冲突时**（页面返回 409 未处理反馈、409 整页锁定、502 归档失败）：如实报告页面返回的错误信息，引导 SQA 回页面处理（如先处理未解决评论、或稍后重试），不假装成功、不代 SQA 重试。

### 10. UNKNOWN write outcome

**This step now runs page-side, not in Chat.** The `/api/save-to-cawplan` route (triggered by the page's Save to CawPlan button) calls `testpoints archive`; if that returns `outcome: UNKNOWN` (transport failure / post-write 5xx, result indeterminate), the page itself runs the count-reconcile (`testpoints reconcile` with the Review's tracked baseline) and branches on `reconcile.decision` — `count_matched` marks the batch archived without re-submitting, `retry_same_batch`/`count_unexpected` report a failure without silently re-archiving. Chat never sees `UNKNOWN` directly and never calls `testpoints reconcile` itself; it only reports whatever the page's final result was (§9's failure branch) or posts the success receipt (§9.5) when the page succeeded.

### 11. Archived row edits

SQA wants to change/delete a row **with `id`** → direct them to Test Suites UI. A2 only appends; no PATCH/DELETE.

## Session state (in-conversation only)

**Binding**: `product_id`, `requirement_id`, `review_id`, `review_url`, Review 页面后台任务句柄/存活状态, five-field snapshot, `url`.

**Open questions**: `open_questions` 保存当前全部未解决存疑的完整文字。首次呈现时写入 §7.2 展示的完整清单；每次修订按 §8 step 6 做移除 / 保留 / 新增，再把更新后的完整清单输出。存疑不属于 Review 页面数据，不能只依赖 Review State 或临时聊天概括来恢复。

**测试点内容本身不在这份 session state 里维护**——Review State（`review_id` 对应的持久化数据）是唯一事实源（§8）。这份 session state 只记"当前在跟哪个 Requirement / 哪个 Review 打交道"，不记录草稿内容、谁改了哪行、`is_edited` 等——这些都从 Review State 读取或由页面/`apply-optimization` 计算，不在 Chat 会话里重复维护一份。

**这是相对 v1 的一次真正删除，不是精简描述**：v1 曾维护「① Binding / ② Work set（原稿快照、touched-row 标记、当前草稿、归档 stub）/ ③ Write（`pending_write`、`write_outcome`）」三组状态，因为 Chat 自己直接呈现表格、接收修订、调用归档，需要自己算 `is_edited`、自己追踪原稿。**这套机制在页面接入后整体退休**：呈现交给页面（§7.1）、修订统一走 Review State + `apply-optimization`（§8）、归档只在页面触发、`is_edited` 由页面按 `status !== "unchanged"` 计算（不再由 Chat 推断）、归档结果由页面同步回传（§9），Chat 不再需要自己的写状态机。

Refresh binding 前先确认 `review_id` 仍指向同一份 Review；Rebind（P1 冷交接切换 Requirement）清空全部 binding，包括 `review_id`——切换到新 Requirement 视为开始一次新的 Review。

## Walkthrough example (workflow Duplicate — requirement `019fb63e-d5ad-7cb7-8b5f-761ceeb50c0a`)

**五字段（节选）**：workflow 项目 Duplicate；入口为项目卡片更多菜单；正常预期为生成副本、列表可见、新窗口打开；约束含仅 workflow 类型、他人分享不可复制、命名 `Copy of xxx`、125 字符上限、素材一并复制、Free plan 50 个上限等。

**obligation 发现（节选）**：本人拥有 / 他人分享、workflow / 其他类型、成功复制、命名与素材保持、50 个数量边界、125 字符长度边界、连续触发幂等、列表写后可见等先分别进入同一清单；50 个配额与并发操作可能改变结果，因此保留组合 obligation。C/D 其余轴若未被形态门槛正面排除，均归入测试点或存疑，不维护独立判轴表。

**批内去重示例**：已有「Free plan 达 50 个 workflow 时 Duplicate 应提示超限」→ 不再单独生成「第 51 次点击 Duplicate 仍提示超限」（同验证目标，仅状态不同）。

**样例测试点（草稿）**：

**1. 复制与命名**

| 序号 | 标题 | 标签 | 优先级 |
|------|------|------|--------|
| 1.1 | 本人拥有的 workflow 项目点击 Duplicate 后应在列表出现名为「Copy of 原项目名」的副本 | `正向` | `HIGH` |
| 1.2 | Free plan 账号已有 50 个 workflow 时再 Duplicate 应提示超过最大限制且无法复制 | `边界` | `MEDIUM` |
| 1.3 | 连续快速点击 Duplicate 应仅创建一份副本 | `幂等` | `HIGH` |
| 1.4 | Duplicate 进行中应有进行中态，且完成前入口不可重复触发 | `交互反馈` | `LOW` |

**存疑（节选；不同缺口不合并）**：

1. 约束未明确 AD Video / Story 类型是否隐藏 Duplicate 入口——建议在需求 `out_of_scope` 标明，或确认 UI 层入口不可见即可。
2. 〔并发 × 50 个上限〕并发 Duplicate 可能改变配额判断与创建结果，但需求未给出并发预期——建议确认是否纳入，并补充应拦截还是允许部分成功。
3. 〔存量兼容〕改动既有 workflow 能力，但老项目或历史数据表现未明确——建议确认本次兼容范围。
4. 〔环境兼容〕功能经 Web 客户端发起，但网络中断后的反馈与恢复方向未明确——建议确认是否覆盖弱网 / 中断恢复。

其余未被形态门槛正面排除的 C/D obligation 也必须各有测试点或存疑去向；本节只展示标题格式，不表示已静默排除。

## Walkthrough example (login — baseline vs 红线 0)

**五字段（节选）**：账号 + 密码登录；入口为登录页；正常预期为登录成功并进入首页；约束未写账户锁定策略。

**生成（草稿）**：

**1. 登录校验**

| 序号 | 标题 | 标签 | 优先级 |
|------|------|------|--------|
| 1.1 | 正确账号和密码登录应成功并进入预期页面 | `正向` | `HIGH` |
| 1.2 | 错误账号或密码登录应失败并给出明确提示 | `异常` | `MEDIUM` |

**存疑（可选一条）**：连续登录失败是否触发账户锁定 — 五字段未写策略，请确认是否在本次范围内。

**不生成**：「第 3 次失败锁定账户」「提示应为『用户名或密码错误』」等需具体次数/文案的测点（红线 0）。

## Walkthrough example (video config — granularity / Duration merge)

**五字段（节选）**：导出前可在视频配置面板设置 Duration 挡位 5s / 10s / 15s（默认 15s）与 Resolution；正常预期为导出视频时长与所选 Duration 一致；约束未写 4K 是否需要付费套餐。

**颗粒度**：Duration 三挡 → 一条列全值、不拆三条、不塞步骤 — 见 §5 Step 4 与 Good/Bad 示例。若五字段写明「4K 仅付费套餐可用」→ `4K` 与普通分辨率是**不同前置/预期** → 单独成条或进存疑。

**样例测试点（草稿，节选）**：

**1. 导出与时长**

| 序号 | 标题 | 标签 | 优先级 |
|------|------|------|--------|
| 1.1 | 选择各 Duration 挡位（5s/10s/15s，含默认 15s）后，导出视频时长应与所选挡位一致 | `正向` | `HIGH` |

## Rules Index

Authoritative rules live in **Workflow**; this section is navigation only. On conflict: **红线 0** > Recall 优先 > 收敛规则。

| Rule | Authority |
|------|-----------|
| **红线 0** — 防臆造 | §5 Step 3 **红线 0** + §6 输出契约检查 |
| **Obligation discovery** | §5 Step 1–2; knowledge → `references/coverage-dimensions.md` |
| **Disposition / C-D asymmetry** | §5 Step 3 |
| **Granularity + merge conservation** | §5 Step 4; recheck → §6 |
| **Priority** — 每条测试点必填 CRITICAL/HIGH/MEDIUM/LOW | §5 **Priority rules** |
| **存疑清单** — format、会话状态与每轮完整输出 | §5 **存疑清单纪律**; 首次呈现 → §7.2；修订 → §8 step 6 + 输出契约 |
| **Double closure + requirement-specific review** | §6 Step 5; output checks → `references/review-checklist.md` |
| **Review 创建 + Chat 呈现** — 不铺表格，摘要 + 存疑清单 + 每轮可点击页面链接 | §7 |
| **Draft totals** — N/M 只来自 `testpoint-review start` 返回值，不自行数行 | §7.2 |
| **修订（Chat 或页面）** — 统一走 Review State，锁定 → AI → 下一 Round；Chat 只出链接 + 完整剩余存疑 + 简短引导 | §8 |
| **Archive / confirm / receipt** | §9（页面触发、Chat 只报结果）; UNKNOWN reconcile 页面侧处理 → §10 |
| **Batch-internal dedup** | §5 Step 4（跨 Round 的 `id` 唯一性由 Review State 的 `next_seq` 保证，不在 Chat session state 里维护） |
| **API** | 生成期读 → `cawplan api GET`（§2）；Review 相关 → `cawplan qa-insights testpoint-review *`（§7.1/§8/§9）；`references/CAWPLAN_OPEN_API.md` §15 |
| **Trigger boundary** | §1 决策树 P3 → 框2；兜底 → 框1；ticket URL without test-point intent → not this skill |
| **Failures** | §9 失败/冲突分支；Review State 保留，不丢草稿 |

## Output & Confirmation

- **Generate + 建 Review + Chat 呈现（不归档）** → §5–§7
- **Chat 修订** → §8（锁定 → AI → 下一 Round，不在 Chat 直接改测试点内容）
- **归档** → §9（仅页面 Save to CawPlan，Chat 只引导 + 报回执）；UNKNOWN reconcile 页面侧处理 → §10

## References

- `references/CAWPLAN_OPEN_API.md`
- `references/coverage-dimensions.md`
- `references/review-checklist.md`
