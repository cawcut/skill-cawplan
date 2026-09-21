# CawPlan TestCase Generate 瘦身实施方案

> 状态：已确认，已实施
>
> 审核基线：`skills/cawplan-testcase-generate` 当前 `0.2.9`，HEAD `7018e1e`
>
> 目标：降低 Agent 每次执行时必须读取、理解和交叉比对的内容，同时保持现有行为不变。
>
> 非目标：不借瘦身调整测试用例数量策略、交互流程、导出格式、版本策略或产品文案。
>
> 存放位置：仓库级设计文档，不属于运行时 Skill 资源。

## 1. 审核结论

当前主要成本不是文件行数本身，而是三类信息干扰：

1. `SKILL.md` 常驻了五个条件分支的完整双语交互文案，即使本次请求不会进入这些分支也必须读取。
2. Expand、Preview self-check、Self-review、Export 和 Walkthrough 多次解释同一规则，Agent 需要判断这些表述是否完全一致。
3. 正常生成路径会同时读取 `SKILL.md`、`test-design-methods.md` 和 `testcase-writing-spec.md`；这两个 Reference 内部也有重复总结和示例，因此仅把主文件内容搬到 Reference 并不能降低总成本。

本次应采用以下顺序：

1. 先冻结行为基线和规则归属。
2. 删除真正重复的解释与示例。
3. 压缩同一文件内的重复表达。
4. 只把确实条件式加载的内容移出主文件。
5. 不为了缩短主文件继续拆出大量小 Reference。

## 2. 当前读取成本与执行路径

当前文件规模仅作为分析输入，不作为验收目标：

| 文件 | 当前大小 | 是否通常由 Agent 阅读 |
|---|---:|---|
| `SKILL.md` | 约 52 KB | 每次调用必读 |
| `references/testcase-writing-spec.md` | 约 27 KB | 标题生成和步骤展开需要 |
| `references/test-design-methods.md` | 约 5 KB | 从 TestPoint 建模 Case 集时需要 |
| `references/csv-template-mapping.md` | 约 5.5 KB | 仅导出时需要 |
| `scripts/export_to_csv.js` | 约 9 KB | 正常只执行，不需要模型阅读 |

当前典型路径：

| 请求路径 | 当前需要理解的内容 |
|---|---|
| 有效 Requirement，首次生成标题清单 | 完整 `SKILL.md` + 设计方法 + 写作规范 |
| 展开已有 Case 的步骤 | 完整 `SKILL.md` + 写作规范；现有措辞还可能诱导重复读取设计方法 |
| 缺 Requirement / 未保存 / 无 TestPoint | 完整 `SKILL.md`，其中其余四个交互框和全部生成、导出规则均无关 |
| 导出当前草稿 | 完整 `SKILL.md` + CSV mapping |
| 补齐步骤后导出 | 完整 `SKILL.md` + 写作规范 + CSV mapping |

瘦身后的目标读取路径：

| 请求路径 | 目标读取内容 |
|---|---|
| 首次生成标题清单 | 精简后的 `SKILL.md` + 设计方法（一次）+ 写作规范（一次） |
| 展开已有 Case 的步骤 | 精简后的 `SKILL.md` + 写作规范；不再读取不需要的四法说明 |
| 入口硬停或条件问询 | 精简后的 `SKILL.md` + 完整交互文案 Reference |
| 导出当前草稿 | 精简后的 `SKILL.md` + 完整交互文案 Reference + CSV mapping |
| 补齐步骤后导出 | 精简后的 `SKILL.md` + 写作规范 + 完整交互文案 Reference + CSV mapping |

Reference 的读取规则改为“每次请求按所处阶段读取一次”，不得再写成“每个测试点前读取”。

**Reference 读取成本按整文件计算。** 一旦某个 Reference 被当前动作选中，应假定 Agent 会读完整文件；本方案不把“只读取框 1 小节”或“只读取写作规范某一节”计算为收益。`interaction-prompts.md` 的主要价值是让正常生成、正常展开等不触发问询的路径完全不加载五个框，而不是让触发框 1 的路径只读框 1。触发任一框时读取整份交互文案 Reference，并且不继续拆成五个小文件。

## 3. 行为基线（瘦身前先冻结）

以下行为是本次瘦身的不可变契约。

### 3.1 入口与数据源

- 显式 Requirement 引用优先于会话绑定；有效热接力继续使用当前 binding。
- 未归档草稿不得直接进入 A3；无 TestPoint 时不得自行创造 Case。
- 每次展开前通过具名 `cawplan qa-insights` CLI 刷新 Requirement 和 TestPoint。
- Portal URL 只解析，不请求 Portal 页面。
- 读取失败、404、`FAILURE`、`UNKNOWN` 均不得假装成功或从陈旧上下文继续。

### 3.2 TestPoint → TestCase 建模

- 测试用例不是测试点的一对一改写；一个 TestPoint 可以展开为多个可独立执行的具体场景。
- 一个 Case 对应一个连贯、可独立执行的核心验证场景。
- 一个 Case 可以有多个顺序 Step 和多个一一对应的 Expected；不得仅因 Expected 数量多就拆 Case。
- 必要具体化可涉及输入、边界、异常、角色、入口、环境和状态，只要它直接影响父测试点的执行路径、边界或预期结果。
- 补充范围必须保持最小充分，不做角色、入口、环境、状态等维度的机械笛卡尔积。
- 所有 Case 必须挂到已有父 TestPoint；无父测试点的覆盖缺口进入存疑并回 A2，不生成孤儿 Case。
- 当前 EP、BVA、离散/连续、多对象等具体拆合语义保持不变；如需调整，另开行为变更方案，不混入本轮瘦身。

### 3.3 字段与可执行性

- 源中明确给出的具体文案、错误码、阈值、枚举等必须保真；源未给出的具体值不得编造。
- Preconditions 只放 Case 开始前已经成立、且本 Case 不负责建立过程的外部既有条件。
- 添加节点、上传素材、建立连接、输入数据、切换选项、触发状态等主动场景构造属于 Steps。
- 每个保留的 Step 必须恰好对应一条非空 Expected。
- Expected 必须是明确可判定的测试信号，不限于 UI；接口/请求响应、数据状态、任务状态、生成物、事件、日志等均合法。
- 不得使用“数据准备完成”等无实际观察价值的文字机械占位。
- 每个 TestPoint 的 Completion Criterion 必须满足后才能处理下一个 TestPoint。

### 3.4 预览与会话状态

- 首轮只输出按 Group 分块的标题态 Markdown 预览，不主动铺开全部步骤。
- Partial 只展开用户点名的 Case；Full 仅在用户主动请求后进入。
- 大批量展开的 `batchCount > 10` 分流逻辑、免分流语义和三个选项保持不变。
- `cases[]` 是会话内工作真相源；用户修改后只重绘受影响部分。
- Markdown 中的“同上”只属于显示层；`cases[]`、interim JSON 和 CSV 始终保存完整父测试点标题。
- 删除、调整、新增和存疑的显示语义保持不变。

### 3.5 导出

- 只有 SQA 主动要求导出，或在大批量分流中明确选择“全部带步骤导出”，才写 CSV。
- `as_is` 允许标题态和半展开草稿混排，并明确它不是最终可执行用例。
- `fill_then_export` 静默补齐未展开 Case，再做导出前自检，不在对话中铺开。
- 导出前排除 `status: removed` 行。
- CSV 仍由 `export_to_csv.js` 生成，不允许 Agent 手写 CSV 或临时重写导出逻辑。
- 13 列、跨行布局、Refs、CRLF、UTF-8 无 BOM、时间戳文件名和回执行为保持不变。
- 脚本对必填字段、Step/Expected 等长和非空的硬校验全部保留。

### 3.6 交互行为

- 框 1～框 5 的触发条件、选项数、选项语义、跳转落点和中英文文案保持不变。
- AskUserQuestion 可用时继续优先使用；Other 由工具自动提供，不手写。
- AskUserQuestion 不可用时继续提供当前纯文本 fallback。
- 会话语言与用例数据语言的分工保持不变。

## 4. 目标职责划分

### 4.1 `SKILL.md` 保留什么

主文件只保留每次调用都需要知道的控制流和少量最高优先级不变量：

1. Frontmatter、触发边界、语言规则和 bootstrap。
2. Requirement 解析优先级、热/冷接力、未归档拦截和 rebind 规则。
3. CLI 刷新命令、结果分支和无 TestPoint 硬停。
4. 三档内容状态、批量展开分流条件和状态转换。
5. 一条核心场景、最小充分、不得产生孤儿 Case等 Case 准入不变量。
6. Per-TestPoint Completion Criterion。
7. Step/Expected 一一对应、Preconditions/Steps 边界的简短硬约束；详细写法只引用写作规范。
8. Preview 的唯一渲染规则、会话状态和局部重绘规则。
9. 导出触发、两种模式、写文件授权边界和错误处理。
10. 按阶段读取哪些 Reference 的路由表。

主文件中的一句硬约束可以指向详细 Reference，但不得再次展开完整判断算法。简短不变量和详细规则属于不同层级，不视为重复定义。

### 4.2 `testcase-writing-spec.md` 继续负责什么

该文件是 Case 内容和字段语义的唯一权威：

- Title 提炼与源值保真。
- Preconditions、Step、Expected 的字段边界。
- Step 粒度和 Step/Expected 契约。
- 核心场景拆合、EP、多对象、离散/连续区间的具体判定。
- Priority 和继承列写法。
- 真正需要对照才能理解的最小正反例。

它不再承担 Workflow、预览分流、导出步骤或用户交互文案。

该文件约 27 KB，且标题生成、步骤展开和 `fill_then_export` 都可能整份读取，因此它本身也是本轮瘦身重点，不能只把主文件内容迁入后维持现状。实施时优先在文件内部做以下压缩：

1. 同一规则只保留一次完整定义，后续总结改为短引用。
2. 合并拆/合章节中反复出现的顶层判据、生成后自问和防过度展开总结，但保留当前语义。
3. 删除末尾“不得出现”中已经由前文章节完整定义的逐条复述，只保留独有硬约束。
4. 删除普通正向示例、完整 JSON 和已由规则直接推出的长解释。
5. 保留只靠抽象规则容易误判的最小正反例，具体清单见 §5.7。
6. 不把本文件继续拆成 Title、Steps、拆合等多个小 Reference；这些内容在 Case 写作时高度共现，拆分只会增加路由和交叉读取成本。

### 4.3 `test-design-methods.md` 继续负责什么

该文件只负责从父 TestPoint 发现必要候选场景：

- EP、BVA、ST、EG 的用途和适用边界。
- 不得脱离父 TestPoint 发明正交覆盖面。
- 必要具体化和最小充分的判断。
- 具体值仍受防臆造规则约束。

它不再重复用例数量、字段写法和最终拆合裁决；这些只引用 `testcase-writing-spec.md`。

### 4.4 `csv-template-mapping.md` 继续负责什么

该文件仅在导出时读取，并成为导出数据契约的文档真相源：

- interim JSON 字段契约。
- 13 列映射、首行/续行布局和标题态草稿规则。
- Refs 生成职责和不可手填约束。
- 导出命令、临时 JSON 生命周期、默认输出目录和文件格式。
- 脚本失败后的处理方式。

把目前 `SKILL.md` 中的 JSON 字段表和脚本调用细节移到这里，不会增加普通生成路径的阅读量；导出路径本来就必须读取本文件。

### 4.5 新增且仅新增一个条件式 Reference

新增 `references/interaction-prompts.md`，集中保存框 1～框 5 的：

- AskUserQuestion `header`、`question`、label、description；
- 中文和英文逐字文案；
- 纯文本 fallback；
- 通用的 Other 和语言选择规则。

该文件只负责“怎么说”，不负责“何时触发”和“选择后去哪”。触发条件与业务落点仍只在 `SKILL.md`，避免形成第二套流程真相源。

这是本轮唯一建议新增的运行时 Reference。五个交互框属于同一种条件式 UI 资源，合并为一份文件比拆成五份更符合 Progressive Disclosure。

运行成本按整文件计算：触发任一框时读取完整 `interaction-prompts.md`。主要收益是未触发框 1～5 的正常生成/展开路径完全不读取这些文案；不主张、也不依赖按小节局部读取。即使单次问询只用到一个框，也不得为了该路径再拆成五个小 Reference。

## 5. 当前主要冗余及处理方案

### 5.1 Expand 与拆合规则

当前重复位置：

- `SKILL.md` Expansion boundary；
- `SKILL.md` One test point → N cases；
- Per-test-point Completion Criterion；
- Self-review 第 1～2 项；
- `testcase-writing-spec.md` 拆/合规则；
- Walkthrough 中的同页合并、跨页拆分和多对象示例。

处理：

- `testcase-writing-spec.md` 保留完整拆合算法和必要对照例，作为唯一规则源。
- `SKILL.md` 只保留“一 Case 一核心场景、多个 Expected 不等于多个 Case、最小充分”和 Completion Criterion。
- Self-review 只写“未满足 Completion Criterion 则继续建模”，不再重述拆合条件。
- 删除 Walkthrough 中对拆合规则的再次演示。
- 不在瘦身中修改当前 EP、离散值或多对象的具体语义。

### 5.2 Preconditions、Step、Expected

当前重复位置：

- Expand 的详情生成规则；
- Preview self-check 的硬修规则；
- Self-review 的独立可执行检查；
- Export 前兜底重查；
- Interim JSON 和 Script hard gates；
- 写作规范、CSV mapping 和脚本实现。

处理：

- 写作规范保留字段定义、步骤粒度、非 UI 测试信号和机械占位禁令。
- `SKILL.md` Expand 只保留一条生成时硬约束：主动构造在 Steps；Step/Expected 等长、逐条非空、信号可判定。
- Preview self-check 不再重复同一规则，只说明“不合格时先修复 `cases[]`，再渲染”。
- Self-review 删除字段规则复述，改为引用 Expand 的硬约束。
- Export 删除完整规则解释，只保留“调用前修复；无法可靠修复则拒绝导出”。
- CSV mapping 记录导出数据要求；脚本继续作为最终硬门。脚本校验属于执行保障，不算文档重复。

### 5.3 源值保真与防臆造

当前重复位置：

- 主文件红线 0；
- Preview self-check 的保真回归长段；
- Self-review 的保真分拣；
- Walkthrough 的逐字文案示例；
- 写作规范的通用底线、Title 两步门、对照表和末尾禁令；
- 已完成的 `plans/diff-title-source-fidelity.md`。

处理：

- 主文件保留简短、最高优先级的双向红线：“源有则保真，源无则不编”。固定尾巴的详细映射保留在写作规范。
- 写作规范 Title 节保留完整判断算法和一个能区分“源有逐字文案”与“仅方向描述”的对照例。
- Preview self-check 只保留动作差异：Title 问题硬修；展开态 Expected 的歧义只提示、不擅自覆写。识别标准直接引用 Title 节。
- Self-review 只引用该检查，不重新解释。
- 删除主文件 Walkthrough 中的保真示例。
- 实施时删除已执行完成的旧计划文件；历史由 Git 保留，不再随 Skill 分发。

### 5.4 Preview 与 Present

当前重复位置：

- Preview carrier；
- Three-tier output rhythm；
- 本批展开分流；
- 预览呈现格式；
- Preview self-check；
- §9 Preview state；
- Walkthrough 表格；
- Output & Confirmation 摘要。

处理：

- `SKILL.md` 保留一个连续的 Preview/Present 状态机：状态选择 → 大批量分流 → 渲染 → hint。
- Group 分块、四列、块首父测试点全称和块内“同上”只定义一次。
- §9 不再重复 `batchCount > 10` 的准入条件，只负责 opening、当前状态对应的输出和 receipt。
- 删除普通标题表、完整 `cases[]` JSON 和多 Group Walkthrough。
- 删除末尾 `Output & Confirmation`，因为它只是对 §5～§9 的再次摘要。

### 5.5 Export

当前重复位置：

- 框 5；
- When to export；
- export 前兜底；
- Interim JSON contract；
- Script hard gates；
- shell 调用示例；
- §9 receipt；
- Walkthrough Step C；
- Output & Confirmation；
- CSV mapping 和脚本。

处理：

- `SKILL.md` 保留导出触发、`as_is`/`fill_then_export` 状态转换、removed 过滤、失败分支和 receipt 路由。
- 框 5 文案移到交互文案 Reference。
- interim JSON、脚本命令、输出目录和文件细节移到现有 CSV mapping。
- 删除 Walkthrough Step C 和末尾重复摘要。
- 脚本与现有单元测试不改；它们继续负责确定性布局和硬校验。

### 5.6 交互文案

当前每个框都重复：

- AskUserQuestion 优先；
- label/description 要求；
- Other 自动追加；
- 跟随会话语言；
- 中文 fallback；
- 英文 fallback。

处理：

- 通用载体规则在交互文案 Reference 顶部定义一次。
- 五个框保留各自逐字内容，禁止为了压缩而改写文案。
- `SKILL.md` 只在分支处写“触发框 N，读取完整 `interaction-prompts.md` 并渲染框 N”，并保留选择后的业务落点。
- 行为验收要求现有中英文输出逐字等价，选项数与顺序不变。
- 不把单框局部读取计作收益，也不继续拆出框 1～框 5 五个小 Reference。

### 5.7 `testcase-writing-spec.md` 内部压缩与校准例

该文件是高频整读 Reference，压缩优先级不低于主 `SKILL.md`。实施时按以下顺序审核每一段：

1. 是否在同文件前文已有等价规则；有则删除复述或改为一句引用。
2. 是否只是对紧邻规则再次总结；不会改变决策则删除。
3. 示例是否提供了抽象规则无法稳定表达的分界；没有则删除。
4. 解释是否属于历史修补背景、维护备注或普通常识；不影响当前决策则删除。
5. 删除后是否仍能直接判断 Done/Not Done；不能则保留判据而不是保留整段叙事。

删除主 Skill 的完整 Walkthrough 后，以下五类最小校准例必须留在对应 Reference 中。它们用于校准易误解边界，不承担新规则：

| 校准点 | 最小正例 | 最小反例 | 保留位置 |
|---|---|---|---|
| 一个 Case 可有多个检查点 | 同一次连贯执行中，页面跳转、请求成功和最终数据落库分别形成多组 Step/Expected，但仍为一个 Case | 仅因有三个 Expected 就拆成三个 Case | `testcase-writing-spec.md` 拆/合规则 |
| 场景构造属于 Steps | Case 执行时添加节点、上传素材、建立连接并输入数据，均写入 Steps | 因为这些动作是“准备工作”就批量塞入 Preconditions | `testcase-writing-spec.md` Preconditions/Steps |
| TestPoint 合并描述必须具体展开 | TestPoint 同时描述 Audio/Video 等对象时，在 Case 或 Steps 中逐对象实际执行并分别配 Expected；若路径/失败模式独立则拆成独立 Case | 继续写“Audio 或 Video 均应……”而没有逐对象执行 | `testcase-writing-spec.md` 多对象与拆/合规则 |
| 最终 Expected 相同不自动合并 | 两条路径最终都显示“失败”，但起始条件、业务分支或失败模式不同，仍分别执行 | 只因最终文案相同就合并不同路径 | `testcase-writing-spec.md` 拆/合规则 |
| 必要边界仍受父目标限制 | 父 TestPoint 明确数值范围时补充直接相关的界内/界外边界 | 从该范围测试继续泛化出弱网、安全、浏览器等无父目标支撑的覆盖面 | `test-design-methods.md` BVA/EG 边界 |

这些示例应各自保持一正一反或一组紧凑对照，不恢复端到端流程、完整 Markdown 表格、完整 JSON 或多轮对话 Walkthrough。示例中的具体数值仍受现有防臆造说明约束。

## 6. 可以直接删除的内容

### 从 `SKILL.md` 删除

- 完整 Walkthrough；其中普通登录、标题表、完整 `cases[]` JSON、Group 示例和导出流程均已被正式规则覆盖。
- `Output & Confirmation` 整节。
- Preview self-check、Self-review、Export 中重复解释的拆合、字段边界、配对和保真规则，改为短引用或单一动作说明。
- §9 中对 §5 大批量准入规则的再次展开。
- 末尾不存在于 Skill 目录、运行流程也未使用的 `references/CAWPLAN_OPEN_API.md` 条目。具名 CLI 命令和实际返回数据继续是运行依据。

### 从 References 删除或合并

- `testcase-writing-spec.md` 末尾与前文逐条重复的禁止项；只保留前文没有定义的独立硬约束。
- 拆合章节中连续多次表达同一顶层判据的段落；保留一次算法、一次完成问句和必要校准例。
- 普通正向示例、重复 JSON/表格和不改变决策的长解释；§5.7 五类校准例不得随 Walkthrough 一起删除。
- `test-design-methods.md` 末尾与各方法正文完全重复的禁止项；独有约束保留。
- CSV mapping 中已经由同一文件前文和脚本明确保证的重复总结，但不删除人工理解 JSON/CSV 契约所需的信息。

### 从 Skill 目录删除

- `plans/diff-title-source-fidelity.md`：已执行完成、非运行依赖、内容又复制了现行规则。新瘦身方案保存在仓库级 `docs/`，不再把实施计划放进运行时 Skill 包。

## 7. 只保留引用的位置

下列位置不得再写第二份完整规则：

| 调用位置 | 只保留的内容 | 权威来源 |
|---|---|---|
| Expand | 核心不变量 + 完成标准 | 写作规范的拆合与字段章节 |
| Preview self-check | 发现问题后的硬修/软提示动作 | 写作规范对应字段规则 |
| Self-review | 是否满足 Completion Criterion | Expand 中唯一 Completion Criterion |
| Export | 调用前验证与失败处理 | CSV mapping + 导出脚本 |
| Present | 渲染当前状态 | Preview 唯一渲染规则 |
| Walkthrough | 删除，不再承担规则 | 正式规则与最小对照例 |

## 8. Reference 路由调整

实施后主文件中的 Reference 路由表应按动作而不是按文件罗列：

| 当前动作 | 读取内容 |
|---|---|
| 从 TestPoint 生成或重新生成 Case 集 | `test-design-methods.md` + `testcase-writing-spec.md`，本次请求各读一次 |
| 只展开已有 Case 的 Preconditions/Steps/Expected | 只读 `testcase-writing-spec.md` |
| 渲染框 1～框 5 | 读取完整 `interaction-prompts.md`，再使用本次触发框的文案 |
| `as_is` 导出 | `csv-template-mapping.md`；无需读取设计方法 |
| `fill_then_export` | 写作规范 + CSV mapping；无需重新读取设计方法，除非 Case 集本身需要重建 |

不得出现“before expanding each test point”之类可能要求逐 TestPoint 重读文件的措辞。

上表中的“读取”均指整份 Reference。`interaction-prompts.md` 不提供按小节节省读取量的假设；它的收益只来自未触发问询的路径完全不加载。`testcase-writing-spec.md` 在被选中时同样按整文件计算，因此 §5.7 的内部压缩是降低标题生成、步骤展开和 `fill_then_export` 成本的必要组成，而不是可选清理。

## 9. 实施顺序

1. 在本方案的行为基线基础上建立改前验收样例，不改行为预期。
2. 先按 §5.7 整理 `testcase-writing-spec.md`，再清理 `test-design-methods.md` 内部重复；确保规则仍有唯一完整版本，五类校准例仍在。
3. 将导出数据契约和调用步骤集中到现有 `csv-template-mapping.md`。
4. 新增唯一的条件式 `interaction-prompts.md`，逐字迁移框 1～框 5 文案；按整文件读取设计，不拆单框文件。
5. 精简 `SKILL.md`：删除重复解释，保留状态机、硬不变量和明确 Reference 路由。
6. 删除 Walkthrough、重复输出摘要和已完成旧计划。
7. 不修改导出脚本及其测试，除非实施中发现文档与当前脚本真实行为不一致；若发现，停止并单独报告，不借瘦身顺手改变脚本。
8. 运行结构校验、现有脚本测试和改前/改后行为对比。

## 10. 瘦身前后行为验证清单

### 10.1 入口和接力

- [ ] 无目标时仍进入框 1，选项、顺序、文案和落点不变。
- [ ] 有未保存草稿时仍进入框 3，不误走 GET 或框 2。
- [ ] 已保存 Requirement 无 TestPoint 时仍进入框 2。
- [ ] 有效热接力继续直接 refresh；显式新链接继续整体 rebind。
- [ ] Portal URL 仍只解析，缺 `product_id` 仍追问且不扫描产品。

### 10.2 Case 建模

- [ ] 一个 TestPoint 能展开为多个独立可执行场景，而不是一对一改写。
- [ ] 同一次连贯执行中的多个检查点保留在一个 Case，可有多个 Step/Expected。
- [ ] 源显式值、分支、约束和状态全部被处理。
- [ ] 直接相关的边界、异常、状态迁移得到最小充分补充。
- [ ] 直接影响父目标的角色、入口、环境和状态允许进入；无直接关系的候选进入存疑。
- [ ] 当前 EP、BVA、离散/连续、多对象拆合结果与改前一致。
- [ ] 同一次连贯执行即使包含多个 Step/Expected，也不会仅因检查点数量被拆成多个 Case。
- [ ] TestPoint 中的合并对象会落实为逐对象执行；若路径或失败模式独立，仍按现行规则拆开。
- [ ] 最终 Expected 文案相同但起始条件、路径或失败模式不同的场景不会被误合并。
- [ ] 必要边界补充仍限定在父 TestPoint 目标内，不演变成 A3 重新生成覆盖面。
- [ ] 无父 TestPoint 的候选不进入 `cases[]`、预览或导出。

### 10.3 Preconditions、Steps、Expected

- [ ] 外部既有条件留在 Preconditions。
- [ ] 添加节点、上传素材、建立连接、输入数据等主动构造仍在 Steps。
- [ ] 每条 Step 恰好有一条非空 Expected。
- [ ] 同一 Step 的多个关联测试信号仍可写在同一 Expected 中。
- [ ] API/请求、数据、任务、生成物、事件、日志仍被接受为测试信号。
- [ ] “数据准备完成”等机械占位继续被拒绝。
- [ ] 源明确文案、错误码、阈值和枚举继续保真；源缺失时不编造。

### 10.4 Preview

- [ ] 首轮仍为按 Group 分块的四列标题表。
- [ ] 块首父测试点仍为全称，块内相邻同父项才可显示“同上”。
- [ ] Partial 只绘制本次点名 Case；已有展开内容继续保存在 `cases[]`。
- [ ] `batchCount <= 10` 直接展开；`> 10` 且未免分流时仍只显示框 4。
- [ ] “全部展开”与“明确不管多长全铺”的区分保持不变。
- [ ] 用户编辑后仍只重绘受影响区域。

### 10.5 Export

- [ ] 直接说“导出 CSV”仍先进入框 5。
- [ ] `as_is` 保留 `[]/[]` 标题态草稿，并在回执中明确非最终可执行用例。
- [ ] `fill_then_export` 静默补齐后再导出，不在对话中铺开。
- [ ] removed 行继续被过滤。
- [ ] interim JSON 字段、13 列、Refs、跨行布局和文件编码不变。
- [ ] 空 `testPointId`、空 `requirementId`、空标题、Step/Expected 不等长或空元素继续被脚本拒绝。
- [ ] 导出回执和后续 TestRail References 提示不变。

### 10.6 交互文案

- [ ] 框 1～框 5 的中英文 AskUserQuestion 内容逐字等价。
- [ ] fallback 的标题、问题、选项、描述和回复提示不变。
- [ ] Other 继续由工具自动添加，不在文案中重复定义。
- [ ] 用例内容语言继续跟源数据，交互文案继续跟会话语言。
- [ ] 触发任一框时允许读取整份交互文案 Reference；正常生成/展开路径不读取该文件。

## 11. 工程验证

实施后执行：

```bash
node skills/cawplan-testcase-generate/scripts/export_to_csv.test.js
node skills/cawplan-testcase-generate/scripts/refs_utils.test.js
bash scripts/validate-skills.sh
git diff --check
```

另外做以下文档结构检查：

- 每条关键行为在“规则归属表”中只有一个完整 Source of Truth。
- 主文件中的引用都能在安装后的 Skill 目录内解析。
- 普通标题生成不会加载交互文案或 CSV mapping。
- 不以“只读取 `interaction-prompts.md` 某一小节”作为验收条件；触发任一框时按整文件成本计算。
- 只展开已有 Case 时不会加载设计四法。
- `as_is` 导出不会加载设计四法和无关写作章节。
- `testcase-writing-spec.md` 内部重复规则、重复总结和无校准价值的长示例已压缩，§5.7 五类最小校准例仍可定位。
- Scripts 可直接执行，Agent 无需阅读实现才能完成导出。

当前仓库存在与本方案无关的全仓校验问题：根 `VERSION` 为 `0.2.8`，本 Skill 为 `0.2.9`，且其他 Skill 也存在版本或 marketplace 不一致。本轮瘦身不自行决定升版或降版；验证报告需区分本次引入的问题与既有仓库问题。

## 12. 完成判据

只有同时满足以下条件，才算瘦身完成：

1. 第 3 节行为基线全部保持。
2. 第 10 节行为验证通过，尤其是 Case 拆合、Step/Expected、交互文案和导出结果无漂移。
3. 普通生成路径不再读取五个交互框、完整 Walkthrough、导出 JSON/CSV 细节和重复自检解释。
4. Partial 展开不再读取与既有 Case 建模无关的设计四法。
5. 高频整读的 `testcase-writing-spec.md` 已完成内部去重和示例压缩，同时保留 §5.7 五类校准边界。
6. 同一规则只有一个完整定义；主流程只保留必要的不变量、动作和引用。
7. 除一份集中式交互文案 Reference 外，不新增其他运行时 Reference，也不把它拆成五个单框文件。
8. 导出脚本及其硬校验保持不变并通过现有测试。
