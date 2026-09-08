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

**Record `data.test_points.length` as `count_before`** (session state ③). This is the baseline `testpoints reconcile` needs if an archive comes back `UNKNOWN` — the command **refuses to derive it**, because a second GET could pick up rows someone else added in between and silently corrupt the comparison. Re-record it on every refresh; a stale baseline is worse than none.

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

**目标顺序**：覆盖完整度优先（Recall > Precision）；允许多生成可删的方向性测试点，但**红线 0 永远优先**。先发现完整覆盖义务（obligation），再统一分流与收敛；不得在发现阶段挑“代表性场景”。

**唯一内部工作结构**：只维护一份临时 obligation 清单，每项只有三个语义字段：

- **obligation**：需要被明确覆盖或解释去向的最小验证义务。
- **basis**：来自哪条五字段语句、适用维度知识、关系分区或行为影响组合。
- **disposition**：最终只能是“测试点 / 存疑 / 排除”之一，并附对应标题或理由。

因素、轴、分区、关系和组合只是发现 obligation 的知识，**不得另建独立状态表、三态轴表或覆盖矩阵**。清单不呈现、不落库。

#### Step 1 — 发现原子 obligation

1. 将五字段**逐句完整读到末尾**，按对象、操作、关系、约束、变化、不变量拆出彼此独立的验证义务；已发现若干项也不得提前收尾。
2. 对每个命中的值、状态、条件、来源、角色、适用层级、前后变化与不受影响对象分别发现 obligation。若多个分区可能有不同结果，不得先合并。**本步骤只负责展开、不负责收敛**：obligation 的独立展开用于保证覆盖，不代表最终必须分别呈现成 Test Point——是否属于同一 verification goal、是否应合并成一行，是 Step 4 的判断，Step 1 不得预判"反正最后会合并"而提前用一句话跨分区、跨对象、跨属性归纳掉候选；拿不准算不算同一 goal 时，先分别列出，交 Step 4 判断。
   **排除性/口径声明句必须单独展开**：五字段中出现"仅统计 X，不与 Y 合并"「不包含 / 不影响 / 独立于 / 与…无关」这类**没有显式动作、只是在给某个概念划边界或排除歧义**的句子时，不得因为它读起来像背景说明或定义就跳过——必须单独产出一条 obligation，验证"该口径/边界在实际行为中确实被遵守"（例如"其他类型端口的连接数变化不应影响图片上限判断"）。
3. 逐项使用 `references/coverage-dimensions.md` 的路径类型和 A→B→C→D 变化轴作为**发现提示**。C/D 八轴必须逐项读到，不能因需求无关键词提前停止；是否有正面排除证据在 Step 3 统一判断。各轴不维护独立状态，也不做笛卡尔积。
4. 基本盘方向只要与功能形态相符就进入候选：正常主路径；外部输入的异常；存在范围时的合法边界；存在取消/撤销/回退时的逆向。需求没写失败细节不等于不适用。
5. 五字段**完全无法形成操作 + 方向性预期**时停止并请 SQA 补充；薄但可测时继续，缺口进入存疑。

   **停止后话术**（纯文字，逐字；**跟随会话语言**二选一，不同时输出）：
   > 这份需求的信息还不够生成测试点（缺操作或预期方向），麻烦补充一下具体是做什么、期望什么结果，我再继续。
   > This requirement doesn't have enough detail to generate test points yet (missing the operation or expected direction) — please add what it does and what's expected, and I'll continue.

#### Step 2 — 补齐关系分区与有意义组合

1. 若需求存在真实关系语义，按 `coverage-dimensions.md` 的关系知识补齐分区 obligation；不得只覆盖需求举出的单侧关系。例如数量比较通常检查 `< / = / >`，但具体预期仍由 Step 3 按证据分流。
2. 两个因素组合后，只要可能改变以下任一项，就展开组合 obligation：**可用性、结果、状态、副作用、反馈、影响范围、恢复行为**。
3. 默认只检查**二元组合**。只有需求明确三因素联动，或任一二元检查都无法表达风险时，才展开三元组合。
4. 禁止无意义全量笛卡尔积；仅“同时出现”但不会改变行为的因素不组合。拿不准是否影响行为时，保留一条组合 obligation，交 Step 3 分流，不得静默丢弃。

#### Step 3 — 每项按证据分流

每条 obligation 必须且只能有一种 disposition：

- **测试点**：方向唯一，能在不编造细节的前提下写出“操作/条件 + 方向性预期”。只是“要不要纳入本轮”未拍板，但功能形态明显适用时，也生成方向性测试点，并在标题末尾加“（范围待确认）”。
- **存疑**：存在多种合理实现或预期；缺少必要触发条件；或必须补充具体规则后才能断言。格式为：〔指向哪〕+〔为什么疑〕+〔建议动作〕。
- **排除**：仅限五字段明确列入 out_of_scope、功能形态直接正面证明不可能成立，或类型/状态/业务约束明确不可达；记录简短理由。不得用“需求没提”“感觉不重要”“已有相似点”作为排除理由。

**C/D 不对称硬规则**：对 `幂等 / 并发 / 一致性 / 存量兼容 / 环境兼容 / 性能 / 安全审计 / 可观测` 八轴逐项应用 `coverage-dimensions.md` 的正面形态门槛。只有门槛正面证明不适用时才可排除；否则该轴必须贡献至少一条“测试点”或“存疑” obligation。多轴指向同一缺口时可合并存疑文案，但不得因此遗漏轴名或去向。A/B 轴若功能形态明确不涉及可不产生 obligation。

**红线 0 — 防臆造（最高优先级）**：

- 标题只能使用五字段已有的具体事实，以及“应成功 / 应失败 / 应拦截 / 应有明确反馈”等方向性预期。
- 五字段未提供时，禁止编造具体数值、阈值、次数、超时时长、文案、错误码、产品隐藏规则或实现方式。
- 若 obligation 只有具体部分缺证据，优先拆成“方向性测试点 + 具体细节存疑”；不得因细节未知把可测方向整项丢掉。
- 五字段已给出的数值、枚举、文案或规则可以直接使用。
- Recall 优先只允许增加**有依据的方向**，不允许增加虚构细节。

**存疑纪律**：

- “素材未提及 / 需补充”不能单独构成存疑；必须指出具体覆盖方向、缺少的决策及建议动作。
- 多种合理实现（如入口隐藏或点击后拦截）必须存疑，不猜其中一种。
- 产品特有联动、隐藏规则、跨功能归属和主观体验只能作为能力边界提示，不得假装已覆盖。

#### Step 4 — 全部分流后统一收敛

只有所有 obligation 都完成 Step 3 后，才允许生成最终标题、合并和批内去重。**禁止用 representative 场景替代 obligation。**数量由覆盖空间决定，无固定上下限。

**颗粒度与合并规则**：

1. 一行 = 一个 verification goal（测什么），不写前置条件 + 步骤序列 + 逐值 Expected；可执行脚本属于 A3。obligation 的颗粒度允许比最终 Test Point 更细——Step 1 展开的多条 obligation 合并成一行，是本步骤的正常产出，不是发现阶段的失败。
2. **合并判据（两步判断，顺序不可颠倒）**：
   - **第一步——先判断差异性质**：两条 obligation 之间的差异，是否**仅**来自同一个 verification goal 下的 partition 取值？Partition 包括但不限于：具体对象/位置（如首位/中间/末位）、比较关系取值（`< / = / >`）、边界值、输入值、状态值，以及**当套餐/权限/状态本身就是该 goal 要覆盖的分区时**（例如"免费版/付费版用户执行同一操作，结果应保持一致"）。
     - 判断"操作"是否相同时，区分**操作类型**（删除/新增/替换/提交……）与**操作作用的具体对象**（作用在哪个位置/哪一项）：操作类型相同、只是作用对象不同，属于 partition，不算差异。
     - 判断"前置条件"是否可合并时，看这个前置条件是否**引入了不同的产品行为或规则**（例如付费版解锁了免费版完全没有的功能分支）：若只是同一行为在不同前置下的**结果一致性**验证，前置本身就是 partition；若前置改变了被验证的产品行为本身，则不是 partition-only 差异。
     - 只要存在任一处差异不满足"仅来自 partition 取值"（操作类型不同、被验证的属性/行为不同、前置引入了新的产品行为），到此为止，**不得合并**，不得为了凑合并去重新定义"这也算一种分区"。
   - **第二步——仅当第一步确认是 partition-only 差异后**，才可以把这些具体取值抽换成占位符，做**语义层面**（而非字符串层面）的归一化比较：抽掉 partition、归一化措辞差异后，是否仍在验证**同一对象上的同一产品行为/属性**？是则合并为一行；若归一化后发现验证的对象或行为其实不同，说明第一步判断有误，退回不合并。
   - **常见误用提醒**：不得先认定"最终想合并成一行"，再倒推着把不同验证目标包装成"同一 goal 的分区"；应先独立完成第一步的差异性质判断，再决定要不要进入第二步，不能反过来。
3. 仅测试数据不同的同一目标合并为一行，并在标题中**列全关键值/状态/位置/条件/来源/范围**；默认项不可省略。
   **口径/边界声明类 obligation 默认不合并**：由 Step 1「排除性/口径声明句」规则产生的 obligation（如"某类统计口径不与其他类型合并"），默认保留独立成行，不与其他 obligation 合并，除非能明确证明合并后的标题仍完整保留该口径的验证意图。拿不准时优先保留独立条目（少合并、不漏），不得为了表格简洁或凑数硬合并导致该口径的验证意图消失。
4. **合并守恒**：合并不得改变 disposition；每条合并前的测试点 obligation 都必须映射到至少一条最终标题，且能从标题反查其关键分区。做不到就不合并。
5. 批内去重只处理本轮无 id 草稿。不得按语义删除已归档行；跨批仅以 id 区分。增量展示可由“已存 N + 新增 M”的整体集合证明覆盖，但归档仍只提交 M。
6. 为每条最终测试点填写 `group`、`tags`、`priority`；标签规则以 `coverage-dimensions.md` 为准。obligation 到标题的承接关系直接保留在 disposition 中，不新增 mapping 状态字段。

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

1. **应用终检清单**：使用 §4 已完整读取的 `references/review-checklist.md`；不得跳过，也不得凭记忆替代。
2. **来源闭合**：逐句反查五字段，并反查已触发的维度方向、关系分区与行为影响组合；每个来源都必须已形成 obligation。发现遗漏时补 obligation，并立即执行 Step 3。**本条只检查"是否有该展开而没展开"**：若某个五字段语句、维度方向或分区从未形成过任何 obligation，判定 Step 1 展开不足，补 obligation 并执行 Step 3；不判断已展开的 obligation 是否被正确合并（那是第4条的职责）。
   **比较关系三态齐全检查（机械式，逐条过）**：凡本轮存在"比较关系"或"数量关系"类 obligation（`coverage-dimensions.md` 五、比较关系 / 数量关系），必须逐条列出该关系当前覆盖了 `< / = / >`（或 `低于/等于/高于上限`）中的哪几态；只要不是三态齐全，且需求形态未正面证明其余态不适用，判定展开不足，补齐缺失的态再执行 Step 3。**尤其是"配置/容量/上限发生切换"场景**（如切换选项导致上限变化）：变小、不变、变大三种方向必须逐一确认是否都已形成 obligation，不得因两态规则相近就只覆盖其中一态。
3. **去向闭合**：每条 obligation 必须且只能归入最终测试点、存疑或有正面证据的排除；不得悬空或重复分流。逐项确认 C/D 八轴满足“不排除则测试点/存疑”。
4. **合并守恒反查**：每条测试点 obligation 均能反查到最终标题；标题保留所有被合并 obligation 的关键分区。只写抽象总称、无法反查时，恢复分区信息或拆行。**本条同时检查"是否有错误合并"**：对每条已合并的最终标题，用 Step 4 第2条的两步判据倒推一遍——差异是否确属 partition-only，语义归一化后是否仍验证同一对象上的同一产品行为/属性；若发现是把不同验证目标强行包装成"同一 goal 的分区"而合并的，判定为 Step 4 错合并（不是 Step 1 展开不足），拆回独立标题。
   **逐词反查（机械式，不得凭印象判断）**：对每条由多条 obligation 合并而成的标题，列出这些 obligation 各自的关键取值词（如具体位置、比较结果、状态值、角色等）；逐个检查该取值词是否**逐字**出现在最终标题里。只要有任意一个取值词被替换成了模糊说法（如把"首位/中间/末位"写成"任意位置"或"某张"、把"变小/不变/变大"写成"发生变化"），判定为合并守恒违反，必须把被抽象掉的取值词逐一写回标题，不得以"语义上已包含"为由保留模糊表述。
5. **一次需求特异性反查**：完成上述清单式闭合后，丢开通用清单，把五字段原文与当前草稿并排重读一遍，只围绕本需求特有的对象、规则、变化、不变量和交互关系，问“这份表最可能漏掉哪项本需求特有的风险？”并把**剩余特异性语句完整扫到末尾**。新发现项仍进入同一 obligation 清单并执行 Step 3；随后只再做一次来源/去向/合并守恒确认。不得限定只找 1–2 项，也不得使用“直到再也想不到”为终止条件，不新建状态表。
6. **输出契约检查**：每条测试点一个目标、至少一个合法主标签、priority 枚举拼写正确；英文会话使用术语表正式英文标签；补充标签至多一个且只能在 tags[1]；所有标题再次通过红线 0。

**Incremental scope**：闭合时用“已归档 N + 本轮新增 M”整体判断覆盖，已有标题可承接 obligation；只为缺口生成 M，绝不修改或重发 N。只在本轮首次呈现前执行一次，SQA 修订后不自动重跑，除非明确要求重新生成。

**Internal only, one version**：不得输出 obligation、排除理由、检查过程、勾选表或来源标记。完成五步后只向 SQA 呈现一版最终表；本阶段新增行仍是 AI 原稿，归档时 is_edited 为 false。

### 7. Present to SQA

**输出纪律**：呈现时**只给「哪条需求 + 表」**（首批加「草稿」、增量按状态列区分）；**禁止**复述内部过程——不得出现「轴遍历 / 自查 / 覆盖维度清单 / 已按…完成 / 五字段已读取 / 核对完毕」等字样。第一句直接进正题。

**开场**（`〔需求名〕` = `summary` → truncate `function_description` → `requirement_id`，与保存确认等处显示名规则一致）：

- **首批**（库为空，逐字；**跟随会话语言**二选一，不同时输出）：
  > 需求「〔需求名〕」的测试点草稿如下（这条之前还没有测试点）：
  > Draft test points for requirement "〔需求名〕" (no existing test points yet):

- **增量**（库里已有，逐字；**跟随会话语言**二选一，不同时输出）：
  > 需求「〔需求名〕」的测试点如下（已有的标「已存」、本轮新增标「新增」）：
  > Test points for requirement "〔需求名〕" (existing ones marked "Saved," new ones this round marked "New"):

紧接下方分节表；**不要**在开场前另加覆盖面叙述或其它过程说明。

1. **测试点清单 — 按 `group` 分节呈现（硬性要求，每次必做）**

   **禁止**把全部测试点挤进一张无分节的连续表。即使 `group` 字段已在各行有值，也**不得**只靠 `N.M` 序号暗示分组——**必须先打出组标题行，再跟该组的小表**。

   **分节规则**（仅排序与分表呈现；**不改** `group` 取值或分组逻辑）：

   - 按各行已有 `group` 字段归并；空 `group` → 组名显示为 `未分组`，且**永远排在最后一节**。
   - 节序号 N = 第 N 组（从 1 起）；组内行序号 N.M（M 从 1 递增）。

   **每一节固定两块输出**（节与节之间空一行）：

   ```text
   **N. {组名}**

   | 序号 | 标题 | 标签 | 优先级 |
   |------|------|------|--------|
   | N.1 | … | … | … |
   | N.2 | … | … | … |
   ```

   - **组标题格式（硬性）**：单独一行，形如 `**1. 分享创建**`、`**2. 权限与访问控制**`。`{组名}` = 该节 `group` 字段原文（空则用 `未分组`）。**每一组都必须有标题行**——单组时也输出 `**1. …**`，不得省略。
   - **每节一张小表**：表内只放该 `group` 的行；**禁止**跨组合并成一张大表。
   - **每次呈现都要分节**：首次生成、SQA 修订后重展、增量合并展示——规则相同，组标题不可漏。
   - **组内顺序不变**：加 `优先级` 列**不改**组内行序，不按 priority 重排。

   **列定义**：

   - **First batch** (library empty): `序号 | 标题 | 标签 | 优先级` — no status column; no row bolding.
   - **Incremental** (library has archived rows): `序号 | 标题 | 标签 | 优先级 | 状态` — see rules below.
   - **已存行（无 `priority` 字段的老数据）**：`优先级` 列显示 `—`，不臆造、不补算。

2. **存疑清单** after **all** group sections (§5): 〔指向哪〕+〔为什么疑〕+〔建议动作〕; no coverage checkbox matrix. If none: say so explicitly.

3. **尾巴**（草稿表 + 存疑清单之后，逐字；首次呈现与 §8 修订后重展均输出；**不做弹框**；**跟随会话语言**二选一，不同时输出）：
   > 要改就直接说（增删，或改标题/标签/分组）；没问题就说一声「保存到 CawPlan」。
   > Just tell me if you want changes (add/remove, or edit title/tags/group); if it looks good, say "save to CawPlan."

**Do not state draft totals** before save (no `共 N 条草稿`, no N in save prompts). SQA reviews the tables; **the only count SQA sees is in the post-POST success receipt** (§9.5).

**Incremental merged display** (only when library already has test points — N archived + M new drafts):

Per §7 step 1: **one section per `group`** (group title line + small table). Within each group, merge archived + new into **one** table; **continuous numbering** (archived first in API order, new drafts appended). 存疑清单覆盖 **full** N+M set（**不要**另加覆盖面叙述）。Archive only drafts without `id`; edit/delete archived rows → Test Suites UI.

**Distinguish 新增 vs 已存** (two means — status column is required; bold is optional):

1. **Status column** (primary, plain text): `已存` (has `id`, read-only) or `新增` (this round's draft, no `id`). This column alone must make the distinction clear even if other formatting fails.
2. **Bold entire rows** (enhancement): status `新增` → bold all five cells (`**…**`); `已存` rows not bold. May write `🆕 新增` in the status column.

**No count summary after tables** — do **not** write `本轮新增 M 条` / `其余 K 条为已存` / `共 N 条` (agents cannot reliably count rows; see Rules Index · Draft totals). Optional **non-numeric** footer after all group sections（**跟随会话语言**二选一，不同时输出）: `已存的标「已存」（只读，改/删请去 Test Suites 后台）；「新增」为本轮新测试点，确认后只保存新增的。` / `Items marked "Saved" are read-only here (edit/delete via the Test Suites console); items marked "New" are this round's new test points — only the new ones will be saved once confirmed.`

**Rendering discipline**:

- **Group title lines are a hard requirement** — same priority as the incremental status column. Never skip them to save space or because `group` is already on each row internally.
- Bold and emoji in tables are **enhancements only** — some clients may not render `**` or emoji inside tables. **Status column text** (incremental) and **group title lines** must carry meaning without relying on table-only formatting.
- Never rely on bold/emoji alone to tell 新增 from 已存.

### 8. Revise from SQA feedback

Natural language: add / delete drafts / edit title, tags, group / adopt 存疑 items. Ambiguous edits → ask.

**Adopting 存疑 → new test-point rows** counts as a revision round (same as add): re-show full table, recompute 序号.

After **any** revision round → **re-show the full 分节清单** (every group title + per-group table, §7 step 1) with recomputed numbers; refresh 存疑 as needed; **re-output §7 尾巴**. Prompt: review by title content, not old numbers only (§4.4).

**SQA insists on keeping two similar rows** → keep both; do not re-run §2.2 merge on those rows.

**Never auto-save.** "看着不错" ≠ save → ask e.g. `要现在保存，还是再调调？` / `Save now, or keep adjusting?`（**跟随会话语言**二选一） — **no draft count** in this prompt.

**原稿** = 本轮完成 Step 5 后首次呈现给 SQA 的完整表；五步内部草稿不计。Step 5 补充行属于原稿。Track which draft rows SQA touched for `is_edited` (§9).

### 9. Archive (write — explicit confirm only)

Proceed only when SQA clearly says 保存 / 存 / 入库 / `保存到 CawPlan`.

**Save confirm** (§9.4) before POST — **AskUserQuestion**; **no draft count**. AskUserQuestion 无「框上正文」字段 → **先输出一行路径正文，再弹框**（勿把路径塞进 question）。

`〔需求名〕` = `summary` → truncate `function_description` → `requirement_id`.

#### 首批保存

框上方正文（逐字，填入 `〔需求名〕`；**跟随会话语言**二选一，不同时输出）：

> 将测试点保存到需求「〔需求名〕」下。
> These test points will be saved under requirement "〔需求名〕."

**优先 AskUserQuestion**（**两个选项，每项须带 `label` + `description`**；工具若自动追加 Other 行，**勿在 skill 里定义 Other**；**跟随会话语言**整框二选一，不同时输出）：

| 字段 | 中文值 | English value |
|------|-----|-----|
| `header` | 确认保存 | Confirm Save |
| `question` | 确认保存这批测试点? | Confirm saving this batch of test points? |
| option 1 · `label` | 确认保存 | Confirm save |
| option 1 · `description` | 存到 CawPlan | Save it to CawPlan |
| option 2 · `label` | 先不保存 | Not yet |
| option 2 · `description` | 先留着草稿 | Keep it as a draft for now |

**AskUserQuestion 不可用时** — 纯文字降级（逐字；**跟随会话语言**二选一，不同时输出）：

```text
将测试点保存到需求「〔需求名〕」下。 确认保存这批测试点? 1. 确认保存 2. 先不保存(回序号)
```

```text
These test points will be saved under requirement "〔需求名〕." Confirm saving this batch of test points? 1. Confirm save 2. Not yet (reply with a number)
```

#### 增量保存（库里已有，仅存本轮新增）

框上方正文（逐字，填入 `〔需求名〕`；**跟随会话语言**二选一，不同时输出）：

> 将本轮新测试点保存到需求「〔需求名〕」下（已存的不动）。
> This round's new test points will be saved under requirement "〔需求名〕" (existing ones are untouched).

**优先 AskUserQuestion**（**两个选项，每项须带 `label` + `description`**；工具若自动追加 Other 行，**勿在 skill 里定义 Other**；**跟随会话语言**整框二选一，不同时输出）：

| 字段 | 中文值 | English value |
|------|-----|-----|
| `header` | 确认保存 | Confirm Save |
| `question` | 确认保存本轮新测试点? | Confirm saving this round's new test points? |
| option 1 · `label` | 确认保存 | Confirm save |
| option 1 · `description` | 存到 CawPlan | Save it to CawPlan |
| option 2 · `label` | 先不保存 | Not yet |
| option 2 · `description` | 先留着草稿 | Keep it as a draft for now |

**AskUserQuestion 不可用时** — 纯文字降级（逐字；**跟随会话语言**二选一，不同时输出）：

```text
将本轮新测试点保存到需求「〔需求名〕」下（已存的不动）。 确认保存本轮新测试点? 1. 确认保存 2. 先不保存(回序号)
```

```text
This round's new test points will be saved under requirement "〔需求名〕" (existing ones are untouched). Confirm saving this round's new test points? 1. Confirm save 2. Not yet (reply with a number)
```

**「先不保存」回执**（纯文字，逐字；**跟随会话语言**二选一，不同时输出）：
> 好的，先不保存。测试点草稿还在，你可以继续改；想好了说一声「保存到 CawPlan」。
> Okay, not saving for now. The test point draft is still here — keep editing, and just say "save to CawPlan" when you're ready.

**Before POST**: build `test_points` from the last full table in display order — **one body entry per draft row without `id`**, same order as shown. Do not skip or duplicate rows.

POST **only drafts without `id`**, in display order:

```bash
cawplan qa-insights testpoints archive <product_id> <requirement_id> \
  --body-file <path>   # {"test_points":[{"title":"...","tags":["边界"],"group":"...","priority":"HIGH","is_edited":false}]}
```

**Never pipe this command through `head`/`tail`/other output-truncating filters** (e.g. `... | head -30`) — the full stdout JSON receipt is the only source for the `outcome` branch below and for the archived-count downstream (`Test points added` in QA daily reports). A truncated receipt can't be parsed and silently counts as zero, even when the batch actually landed.

Body per item (skill/agent): **only** `title`, `tags`, `group`, `priority`, `is_edited`. `priority` is required, one of `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` (§5 **Priority rules**) — the command hard-rejects a missing or invalid value. The Skill/agent must not submit `category_code` manually. The CLI injects `is_ai_generated: true` and `category_code` on **each** item before POST — do not put either field in `--body-file`. `category_code` is calculated once, only when the test point is created; later Skill-side changes to `tags` do not trigger recalculation, and the stored `category_code` remains unchanged. The command rejects the batch and sends nothing if an item carries anything else (an `id` here usually means an already-archived row is being re-posted).

**`is_edited`**: `false` if untouched since 原稿 (includes rows added during Step 5 — AI-generated, no source tag); `true` if SQA edited or added (including adopting 存疑). Incremental batch: only for **new** M drafts vs their 原稿; archived N rows excluded. The command passes this through verbatim — **it never infers the value**, so getting it right is this skill's job.

Branch on `outcome`:

| `outcome` | Action |
|-----------|--------|
| `SUCCESS` | The command already verified the envelope and that the returned count equals what was sent. Store `api.data.test_points[].id` as session stubs (§10); **do not** list them to SQA → **success receipt (§9.5)** |
| `FAILURE` | Report `error.message` honestly (§9.6). `validation` = the body was built wrong; fix and resend. Do **not** fake success, do **not** blind-retry |
| `UNKNOWN` | The batch may or may not have landed. **Never re-archive on a guess** → §10 |

**Success receipt (§9.5)** — **only place SQA sees a count**. **Two lines** when `url` is present; otherwise line 1 only. Use **`N` = `body.test_points.length`** (or response `test_points.length` on SUCCESS). `〔需求名〕` = `summary` → truncate `function_description` → `requirement_id`.

- **Line 1**（逐字；**跟随会话语言**二选一）：`已保存 N 条测试点到需求「〔需求名〕」下。` / `Saved N test points under requirement "〔需求名〕."`
- **Line 2**（仅当 refresh 返回非空 `url`；**单独一行**，不接到 line 1 句末；逐字；**跟随会话语言**二选一）：`Requirement 链接:{url}` / `Requirement link: {url}`

**If `url` is missing or null** — output line 1 only; say nothing about links — never construct portal URLs, never note that `url` was unavailable.

**Forbidden in success receipt**: per-row tables; title lists; `id` lists; re-generated or summarized titles; any line about missing `url` (e.g. "未返回 url"/"无法附 Requirement 链接"); **apology or post-hoc recount explanations** (e.g. "之前误算成 13 条").

**§9.5 末尾引导（可选追加）** — 满足**全部**条件时，在成功回执**最后**另起一行逐字追加（不弹框、不追问、**仅本轮一次**；**跟随会话语言**二选一，不同时输出）：

> 想继续生成测试用例？说「马上生成测试用例」，我会在当前会话直接生成。
> Want to generate test cases next? Say "generate test cases now" and I'll do it right in this session.

**追加条件**（须同时满足）：

- 本轮测试点归档结果为 `SUCCESS`（含 §10 `count_matched` 确认已落库后下接 §9.5 式回执）
- 会话**无** `resume_intent`（非跨 skill 入站接力后的自动出站回归）
- 非「先不保存」回执路径
- 非保存失败 / UNKNOWN / `pending_write` 未定态

**不追加**：保存失败、结果未定、`先不保存`；出站 `resume_intent = testcase` 自动回流 `cawplan-testcase-generate`（已自动续跑，无需再引导）。SQA 未接茬、去做别的 → **顺其自然，不重复提示**。

**用户接茬**：SQA 说「马上生成测试用例」→ 以会话 `product_id` + `requirement_id` 读 `cawplan-testcase-generate` skill，当前会话 P2 热交接直跑 §2 refresh，**无需**再贴需求或测试点。

On failure → report `error.message` (and `api.code` / `api.msg` when present) honestly (§9.6). Do not fake success or blind-retry.

### 10. UNKNOWN write outcome (§9.4)

Archive returned `outcome: UNKNOWN` → set `write_outcome = UNKNOWN`, then run:

```bash
cawplan qa-insights testpoints reconcile <product_id> <requirement_id> \
  --count-before <§2 刷新时记录的基线> --batch-size <本批条数>
```

`--count-before` is the baseline recorded at the §2 refresh, **before** the archive. The command will not guess it. Read-only — it never writes.

Same rule as §9: **never pipe this command through `head`/`tail`/other output-truncating filters** — the full stdout JSON receipt is what the `reconcile.decision` branch below reads.

| `reconcile.decision` | Action |
|----------------------|--------|
| `count_matched` | The batch already landed. Tell SQA it is saved; clear UNKNOWN; merge stubs on the next refresh. **Do not archive again.** → 下接 **§9.5** 成功回执（含末尾引导，条件同 §9.5） |
| `retry_same_batch` | Nothing landed. Read-back, then archive the **same** batch — not a regenerated one. |
| `count_unexpected` | The count is neither unchanged nor `+batch`. Someone may have appended concurrently, or the data is inconsistent. **Stop and ask SQA to check Test Suites**; archive nothing. |

**Never** re-archive a batch on ambiguity.

### 11. Archived row edits

SQA wants to change/delete a row **with `id`** → direct them to Test Suites UI. A2 only appends; no PATCH/DELETE.

## Session state (in-conversation only)

**① Binding**: `product_id`, `requirement_id`, five-field snapshot, `url`.

**② Work set**: 原稿 snapshot; touched-row marks; current drafts; archived stubs from last refresh.

**③ Write**: `pending_write` after save confirm; `write_outcome` SUCCESS / failure / UNKNOWN.

Refresh binding + stubs before each generate. Rebind clears all. After successful archive, merge new `id`s into stubs; new supplement round gets a **new** 原稿 for the M drafts.

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
| **存疑清单** — format & discipline | §5 **存疑清单纪律**; presentation → §7 step 3 |
| **Double closure + requirement-specific review** | §6 Step 5; output checks → `references/review-checklist.md` |
| **Presentation** — 分节、状态列 | §7 |
| **Draft totals** — SQA 只看保存后条数 | §7 · §9.5 · §9 save confirm（禁草稿/保存前计数） |
| **Archive / confirm / receipt** | §9; UNKNOWN → §10 (`testpoints reconcile`, needs `count_before` from §2) |
| **Cross-batch identity / batch-internal dedup** | §10 (`id` stubs); batch-internal → §5 Step 4 |
| **API** | Writes → `cawplan qa-insights` (§9 archive, §10 reconcile); reads → `cawplan api GET` (§2); `references/CAWPLAN_OPEN_API.md` §15 |
| **Trigger boundary** | §1 决策树 P3 → 框2；兜底 → 框1；ticket URL without test-point intent → not this skill |
| **Failures** | §9 On failure; keep drafts |

## Output & Confirmation

- **Generate / revise (no archive)** → §5–§7
- **Save confirm + POST** → §9; UNKNOWN reconcile → §10

## References

- `references/CAWPLAN_OPEN_API.md`
- `references/coverage-dimensions.md`
- `references/review-checklist.md`
