# QA Insights English Terminology (frozen)

本文件在 `cawplan-requirement-analyze`（A1）/ `cawplan-testpoint-generate`（A2）两个 skill 的 `references/` 下各存一份**内容完全相同**的拷贝（非引用，因跨 skill 目录引用在本仓库的分发机制下不可行）。两份由 `scripts/validate-skills.sh` 做逐字节比对，任何一份被单独改动都会导致 CI 失败。**修改前须在两处同步改**。`cawplan-testcase-generate`（A3）不存本文件——A3 只读、不解析五字段/tags 语言，其 Title/Expected 保真尾巴的中英对照直接内嵌在 A3 `SKILL.md` 红线 0 里。

冻结时间：2026-08-27。第 2/3/4/5 节为落库锚点，投产后**不可再改已有行**（可新增新场景的行）；第 1 节为展示层但同属共用身份约定，同样冻结。

---

## 1. 五字段标题（展示层 section heading，不落库，三 skill 共用身份约定）

| Key | 中文标题（现状，不可动） | English |
|---|---|---|
| `function_description` | 功能描述 | Function Description |
| `entry_trigger` | 操作入口 / 触发条件 | Entry Point / Trigger Condition |
| `normal_expectation` | 正常预期行为 | Expected Behavior (Happy Path) |
| `constraints` | 约束与规则 | Constraints & Rules |
| `out_of_scope` | 不测范围 | Out of Scope |

---

## 2. 推断标记（落库，参与逐字节比对，一旦上线不可再改）

| 中文标记（现状） | English | 备注 |
|---|---|---|
| `（惯例推断）` | `(Convention-inferred)` | 附加在业界通用惯例推断句前 |
| `（界面推断）` | `(UI-inferred)` | 附加在截图/界面强暗示推断句前 |
| `（素材未提及）` | `(Not mentioned in material)` | 整字段无素材时的占位 |

---

## 3. 存疑分类词（不落库，纯展示，但三 skill 需统一）

| 中文（现状） | English | 含义 |
|---|---|---|
| 需补充 | Needs Detail | 维度已写进字段，只是缺具体取值（阈值/文案/错误码等） |
| 待确认 | To Be Confirmed | 维度存在性依赖产品具体选择，需 SQA 当场拍板 |
| 需澄清 | Needs Clarification | 素材间有冲突或范围歧义，需要澄清后才能定 |

---

## 4. 固定措辞整句表（落库，参与逐字节比对，一旦上线不可再改）

| 场景 | 中文固定措辞（现状） | English |
|---|---|---|
| 跨场景 · 必填拦截 | `（惯例推断）必填项未满足或校验未通过时应拦截提交并给出明确提示` | `(Convention-inferred) Submission should be blocked with a clear message when required fields are unmet or validation fails` |
| 跨场景 · 删除确认 | `（惯例推断）破坏性或删除操作应经二次确认后方可执行` | `(Convention-inferred) Destructive or delete actions should require a confirmation step before execution` |
| 跨场景 · 上限拦截 | `（惯例推断）超出长度或数量上限的输入应被拦截并给出明确提示` | `(Convention-inferred) Input exceeding a length or count limit should be blocked with a clear message` |
| 跨场景 · 格式校验 | `（惯例推断）有格式约束的字段应校验格式，不符时应拦截并给出明确提示（具体规则以产品规范为准）` | `(Convention-inferred) Fields with a format constraint should be validated, blocking submission with a clear message on mismatch (exact rules per product spec)` |
| 跨场景 · 一致性校验 | `（惯例推断）需二次确认的输入应与原输入一致，不一致时应拦截提交并给出明确提示` | `(Convention-inferred) A confirmation input should match its original input, blocking submission with a clear message on mismatch` |
| 跨场景 · 失败反馈 | `（惯例推断）操作失败时应有明确失败反馈` | `(Convention-inferred) A clear failure message should be shown when an action fails` |
| 跨场景 · 成功反馈 | `（惯例推断）操作成功后应有明确成功反馈或进入后续页面（具体页面以产品为准）` | `(Convention-inferred) A clear success message should be shown or the user should proceed to the next page after a successful action (exact page per product)` |
| 跨场景 · 空态展示 | `（惯例推断）列表或结果为空时应有明确空态展示` | `(Convention-inferred) A clear empty-state should be shown when a list or result set is empty` |
| 跨场景 · 网络异常 | `（惯例推断）网络异常或超时时应有明确失败反馈，且不应停留在无反馈的中间态` | `(Convention-inferred) A clear failure message should be shown on network error or timeout, without leaving the UI in a stuck state with no feedback` |
| 注册 · 必填 | `（惯例推断）用户名、邮箱、密码、确认密码为必填项` | `(Convention-inferred) Username, email, password, and confirm password are required fields` |
| 注册 · 格式校验 | `（惯例推断）须校验用户名、邮箱、密码格式（具体规则以产品规范为准）` | `(Convention-inferred) Username, email, and password format should be validated (exact rules per product spec)` |
| 注册 · 确认密码 | `（惯例推断）确认密码应与密码一致，不一致时应拦截提交并给出明确提示` | `(Convention-inferred) Confirm password should match password, blocking submission with a clear message on mismatch` |
| 注册 · 提交门槛 | `（惯例推断）必填项未填或校验未通过时不应完成注册` | `(Convention-inferred) Registration should not complete when required fields are unmet or validation fails` |
| 注册 · 成功反馈 | `（惯例推断）注册成功后应有明确成功反馈或进入后续页面（具体页面以产品为准）` | `(Convention-inferred) A clear success message should be shown or the user should proceed to the next page after successful registration (exact page per product)` |
| 界面 · 按钮禁用 | `（界面推断）必填项未填全时提交按钮呈不可用状态` | `(UI-inferred) The submit button should appear disabled when required fields are not fully filled` |

**表外句式模板（仅限 `（界面推断）`，非固定表内行，可按结构自拟）**：

- 中文模板：`（界面推断）<页面/控件状态>时<控件或页面>应<呈不可用状态 / 呈错误态 / 显示提示 / 保持禁用>`
- English template: `(UI-inferred) <control/page> should <appear disabled / show an error state / display a message / remain disabled> when <page/control state>`

---

## 5. A2 测试点 `tags` 词表（落库，写入 body，已冻结）

| 中文（现状） | English |
|---|---|
| 正向 | Positive |
| 边界 | Boundary |
| 异常 | Exception |
| 逆向 | Reverse Action |
| 幂等 | Idempotency |
| 角色权限 | Role & Permission |
| 一致性 | Consistency |
| 并发 | Concurrency |
| 存量兼容 | Backward Compatibility |
| 环境兼容 | Environment Compatibility |
| 性能 | Performance |
| 可观测 | Observability |
| 安全审计 | Security Audit |
| 交互反馈 | Interaction Feedback |
| 输入类型 | Input Type |
| 状态迁移 | State Transition |
| 来源入口 | Source Entry |
| 结果有效性 | Result Validity |
| 指令遵循 | Instruction Compliance |
| 事实依据 | Factual Grounding |
| 输出稳定性 | Output Stability |
| 上下文 | Context |
| Agent 执行 | Agent Execution |
