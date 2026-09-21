---
version: 0.2.9
name: cawplan-testcase-generate
description: |
  Expand archived test points into executable test cases: Markdown title-state preview first, expand steps on demand, export team CSV when SQA actively requests after review (read-only — does not write to CawPlan).
  Use when: generating test cases (preview first), expanding executable steps in Markdown preview, exporting CSV when SQA asks to export, or hot handoff after A2 ("按上面的生成用例", "generate test cases from above", or similar); cold handoff via Requirement link or requirement_id.
  NOT for: test-point coverage outlines (use `cawplan-testpoint-generate`); requirement analysis or archiving (use `cawplan-requirement-analyze`); viewing or editing archived test points in Test Suites (web UI); unarchived five-field drafts only (archive via A1 first).
argument-hint: "[Requirement link or requirement_id, '生成测试用例', '按上面的生成用例' / 'generate test cases from above']"
allowed-tools: Bash
---

# CawPlan TestCase Generate

跟随用户主语言回复；同一段不同时输出中英文。用例内容本身跟测试点/五字段语言走。

## Bootstrap

```bash
cawplan skill check
```

## 最高优先级：源值保真

- Title / Preconditions / Step / Expected 中的具体文案、错误码、阈值、次数、长度和枚举只能来自测试点或五字段。
- 源里逐字给出则原样带入 Title / Expected，不抽象、不意译、不挂诚实尾巴；源里没有则使用方向描述或写作规范定义的固定尾巴，不编硬值。
- 详细判定和固定尾巴见 `references/testcase-writing-spec.md`；设计方法不得越过本规则。

## 按动作读取 Reference

每次请求按当前动作读取一次整份文件，不要逐 TestPoint 重读：

| 当前动作 | 读取内容 |
|---|---|
| 从 TestPoint 生成或重新生成 Case 集 | `references/test-design-methods.md` + `references/testcase-writing-spec.md` |
| 只展开已有 Case 的详情 | `references/testcase-writing-spec.md` |
| 触发框 1～框 5 | 完整读取 `references/interaction-prompts.md`，使用对应框 |
| `as_is` 导出 | `references/csv-template-mapping.md` |
| `fill_then_export` | 写作规范 + CSV mapping；除非重建 Case 集，否则不重读设计方法 |

CSV 列布局的最终模板是 `assets/testcase-template.csv`。

### 交互框执行契约

命中框 1～框 5 时，在任何用户可见回复前完整读取 `references/interaction-prompts.md`，并按对应框实际调用 AskUserQuestion；不得用普通聊天中的编号选项代替弹窗。仅当当前运行环境未提供 AskUserQuestion，或工具调用明确失败时，才使用该 Reference 中对应的逐字 fallback。下文“渲染框 N”均指执行本契约。

## Workflow

### 1. Resolve target Requirement

每次生成请求按顺序 fall through：

| 优先级 | 条件 | 动作 |
|---|---|---|
| P1 | 显式 Requirement 链接、`requirement_id` 或切换目标 | Cold handoff，整体 rebind |
| P2 | 热接力话术且已有有效 binding | 使用当前 binding |
| P3 | 会话有 Requirement 或 TestPoint 草稿，但无有效 `requirement_id` | 触发框 3 |
| 兜底 | 无链接、无有效 binding、无草稿 | 触发框 1 |

有效 binding 必须同时包含 `product_id` 和 `requirement_id`。热接力包括“马上生成测试用例”“按上面的生成用例”“接着生成/展开用例”及等价英文；没有 binding 时继续 fall through。未归档 fast-path 不受支持，不得带草稿进入 GET。

#### 框 1 · 锁定 Requirement

无目标且无草稿时，读取交互文案 Reference 并渲染框 1；有效 P1/P2 不触发。不得增加“用上面出好的”选项。

- “已有 Requirement 链接” → 等待链接；收到后按下文解析，无法解析则复述选项或请重选。
- “没有 Requirement” → 写入 `resume_intent = testcase`，读取 `cawplan-requirement-analyze` Skill 接力。

#### 框 3 · 需求还没保存

P3 或测试点草稿/表存在但无 `requirement_id` 时，读取交互文案 Reference 并渲染框 3。

- “马上保存” → 写入 `resume_intent = testcase`，走 `cawplan-requirement-analyze` 的保存/归档及原确认闸；成功后回 §2。
- “先不保存” → stop。
- Other / 自由回复 → 按说明处理或复述。

#### 路由与解析

- 测试点大纲/覆盖面/“生成测试点” → `cawplan-testpoint-generate`。
- 分析需求/五字段/归档 Requirement → `cawplan-requirement-analyze`。
- 生成、展开或导出测试用例 → 本 Skill。
- 已有 `cases[]` 时再次模糊说“生成用例”，先问“重新生成”还是“在现有基础上调整/展开”，避免覆盖 SQA 编辑。

Portal URL 只解析字符串，绝不请求页面：

```text
/product/{product_id}/qa-insights/test-suites/requirements/{requirement_id}
```

不得对 Portal 路径调用 `cawplan api` 或 HTTP。只有 `requirement_id` 时追问 `product_id` 或完整链接，不扫描产品。显式新目标替换完整上下文；同时只绑定一个 Requirement。

#### 跨 Skill 接力

- 框 1“没有 Requirement”、框 3“马上保存”和框 2“马上生成测试点”出站前写 `resume_intent = testcase`。
- A1/A2 完成后按该 intent 回 §2。A2 只生成并呈现测试点，不自动归档；SQA 确认归档后才继续。仅说“看着不错”未归档时，刷新后仍应再次触发框 2。
- A2 成功回执后，在有效 binding 下说“马上生成测试用例”直接走 P2 → §2，无需重贴数据。

### 2. Refresh before expand

Cold/hot handoff 都必须静默拉取最新数据，库中数据是真相源：

```bash
cawplan qa-insights requirements get <product_id> <requirement_id>
cawplan qa-insights testpoints list <product_id> <requirement_id>
```

- Requirement `SUCCESS`：使用 `data` 中五字段、`module_tree_node_id` 和 metadata。
- TestPoints `SUCCESS`：按 `data.test_points[].sort_order` 使用；映射 `id` → TestPointId、`title` → TestPointTitle、`tags[]` → `/` 拼接 Tag、`group` → Group。
- 404 / `not_found`：如实报告，不使用陈旧会话数据。
- `FAILURE` 或 `UNKNOWN`：如实报告；不假成功、盲重试或猜测。
- 五字段尤其 `constraints` 与测试点创建时相比发生变化：展开前输出一条轻量存疑，不静默忽略。

### 3. Hard stop without TestPoints

刷新后 `test_points.length === 0` 时不得创造 Case，读取交互文案 Reference 并渲染框 2；该分支与未归档框 3 互斥。

- “马上生成测试点” → 写 `resume_intent = testcase`，读取 `cawplan-testpoint-generate`；归档成功后回 §2。
- “先看看需求内容” → 展示 §2 已拉取的五字段，再等决定。
- Other / 自由回复 → 按说明处理或复述。

### 4. Build and expand `cases[]`

`cases[]` 是会话内工作真相源。首轮先生成标题态 Case 集；后续只按 SQA 点名展开详情。

#### Case 准入不变量

- 一个 Case 是一个连贯、可独立执行的核心验证场景；一个 TestPoint 可展开为多个 Case。一个 Case 可包含多个 Step/Expected，不得仅因检查点多就拆 Case。
- 输入、边界、异常、角色、入口、环境和状态只要直接影响父 TestPoint 的路径、边界或预期结果，即可作为必要具体化；只保留最小充分场景，不做机械笛卡尔积。
- 每条 Case 必须挂到已有父 TestPoint，且归档主路径的 `testPointId` 非空。无法归属的覆盖缺口进入存疑并回 A2，不进入 `cases[]`、预览或导出；SQA 口头新增 Case 也遵守此规则。
- 拆合、EP、多对象、离散/连续和字段写法以写作规范为准。主动场景构造属于 Steps；每个 Step 恰好对应一条非空、可判定的 Expected，信号不限 UI。

无父测试点时的存疑文案跟随会话语言：

> 这一块没有对应的测试点,回去补一条测试点、刷新后再展开。
> There's no matching test point for this — go back and add one, then refresh and expand it.

#### Per-TestPoint Completion Criterion

同一父 TestPoint 未同时满足以下条件前，不处理下一个：

1. 源明确的值、分支、约束和状态均已处理；源明确要求覆盖的离散值或类别已逐项各成一条 Case，未用“分别/各/与所选一致”合并。
2. 直接相关且必要的等价类、边界、异常和状态迁移已用最小充分场景覆盖，无组合爆炸。
3. 每个候选都是可独立执行的连贯核心场景；同一次执行的顺序检查点仍在同一 Case 内配对。
4. 同一失败模式的重复已按写作规范合并；父目标外候选已移到存疑/A2。

### 5. Content state and expansion routing

| 状态 | 输出 | 触发 |
|---|---|---|
| Title only | 按 Group 分块的四列标题表 | 默认首轮 |
| Partial | 只输出本次点名 Case 的展开块 | “展开第 X 条”等 |
| Full | 补齐尚未展开 Case 后，输出当前全部 Case 的展开块 | SQA 主动说“全部展开” |

详情的 Preconditions / Steps / Expected 必须按 Case 一起生成；Partial 不主动替 SQA 选择 Case。

#### 大批量分流

Partial 的 `batchCount` 是本次点名数；Full 是当前尚未展开数，与池子总量和已展开数无关。

1. `batchCount <= 10`：直接展开，不问。
2. `batchCount > 10` 且请求里没有强于“全部展开”的免分流表态：读取交互文案 Reference，只渲染框 4，禁止先铺步骤。“全部展开”本身只选择 Full 档位，不算免分流。
3. 用户已明确“不管多长全铺、别问全展开”等：视为“全部铺开”，不触发框 4。

框 4 落点：

| 选择 | 动作 |
|---|---|
| 全部铺开 | 展开本批 Markdown，随后输出 Partial/Full hint |
| 全部带步骤导出 | 不铺对话；静默补齐未展开 Case，设 `exportMode = fill_then_export`，自检后直接导出并回执，跳过框 5 |
| 先不展开 | stop，等待更小范围 |

框 4 是载体分流，不是确认闸；不得改成“是否继续”。

### 6. Preview and review

#### 唯一渲染规则

- 预览只用对话内 Markdown，不使用 artifact、交互组件或 HTML。
- Title/Partial/Full 都必须按 Group 分块，即使只有一个 Group。块首为 `### {Group}`；标题表固定列为 `# / 用例标题 / 优先级 / 父测试点`，不得增加“分组”列。
- Partial/Full 在对应 Group 下用 `####` 标题行，保留编号、Title、Priority、父测试点，再列 Preconditions / Step / Expected。
- “父测试点”列固定取 `cases[].testPointTitle`，不得显示 `testPointId`、`display_id` 或其他 ID。每个 Group 首行必须写完整 `testPointTitle`；仅当本行不是块首，且与本块紧邻上一行的 `cases[].testPointTitle` 逐字相同，显示层才可写“同上”。块边界归零，禁止“同第 N 条”。
- `cases[]`、interim JSON 和 CSV 始终保存完整 `testPointTitle` 与 `group`；“同上”只属于 Markdown。
- SQA 修改后只重绘受影响区域：改标题重绘该 Group 标题表；改步骤只重绘该 Case 展开块。已有展开内容仍留在 `cases[]`。

#### Preview self-check

渲染前先修复确定性错误，再输出：

- 父测试点列显示 ID、为空，或 Group 首行写“同上/同第 N 条” → 直接用该 Case 的完整 `testPointTitle` 硬修。
- `steps` / `expected` 不等长或有空元素 → 按写作规范硬修；若源不足以可靠配对则停下并请 SQA 修正。
- 标题丢失源逐字值或错挂诚实尾巴 → 硬修 `cases[].title`。展开态 Expected 疑似未保留源值时只标 `⚠源已有文案未保留`，不自动覆写；长源句只保留与该步相关片段可能合法。
- 父测试点或五字段明确要求覆盖多个离散值/类别，却被“分别/各/与所选一致”等概括为一条 Case → 按写作规范逐项拆开后再渲染；源只给示例或无法判定是否要求逐项时不擅自扩展。

其余软提示：错误“同上”引用标 `⚠同上引用错误`；Step 混入验证动词标 `⚠疑似预期混入步骤`；Expected 使用疑似无来源具体值标 `⚠具体值待核`。父标题只有疑似多取值信号但无法确认是否为必测离散清单时，回写作规范复核并可标 `⚠疑似未展开取值清单`；`Config/Idea/Storyboard` 等流程阶段名不因此误拆。

#### Self-review timing

在标题态首次预览前，以及组装导出 JSON 前各执行一次。`fill_then_export` 的第二次检查必须在静默补齐后。检查 Completion Criterion、源值保真、无孤儿 Case，并引用写作规范核对拆合与字段契约；不向 SQA 展示检查清单。

SQA 编辑的行首标签为 `【已调整】` / `【新增】` / `【存疑】`。删除项在预览末尾“已移除”区保留痕迹，内存标记 `status: 'removed'`。存疑清单使用“〔指向哪〕+〔为什么疑〕+〔建议动作〕”，无则写“无”。

Priority 按写作规范推 P0–P3。

### 7. Confirmation boundary

| 动作 | 是否确认 |
|---|---|
| 标题态或展开预览 | 否 |
| SQA 主动导出 CSV | 不加文件写入确认，但先走框 5；框 4 已选导出除外 |
| 删除、改标题或 SQA 指定调整 | 否；更新内存并局部重绘，不自动导出 |
| 重新生成整个 Case 集 | 是；会清空 `cases[]` 和所有手工编辑/删除痕迹，再从 GET 数据重建 |

### 8. Export

仅当 SQA 主动要求导出，或框 4 选择“全部带步骤导出”时写 CSV。直接说“导出 CSV”时读取交互文案 Reference 并渲染框 5；不得跳过。

框 5 落点：

- “导出当前草稿” → `exportMode = as_is`；保持未展开 Case 为 `steps: []` / `expected: []`，回执说明不是最终可执行用例。
- “全部带步骤导出” → `exportMode = fill_then_export`；按写作规范静默补齐所有未展开 Case，更新 `cases[]`，不在对话铺开，再执行导出前自检。

模式处理后：

1. 过滤 `status: 'removed'`；不把 removed 行或 `status` 写入 snapshot。
2. 对展开态 Step/Expected 进行最终兜底检查；先修复 `cases[]`，只有无法可靠修复时才拒绝导出并请 SQA 在预览中修齐，不能直接倾倒 stderr。
3. 读取 `references/csv-template-mapping.md`，按其中 interim JSON 契约调用 `scripts/export_to_csv.js`。不得手写 CSV、内联 CSV 或临时改写导出逻辑。
4. 脚本失败时如实报告 stderr，修复上游 JSON 后重试。导出不锁定工作态，可多次执行。

### 9. Present

#### 进场静默

从解析目标、执行两个 GET 到首次标题清单前，不输出内部过程或 ID。缺 `product_id`、404/读取失败、框 1/2/3 硬停和五字段漂移存疑除外。

成功进入标题首轮时，第一条可见输出逐字使用以下一种，`{N}` 为 TestPoint 数量，不插入 Requirement 显示标题：

> 已读取需求与 {N} 条测试点,先按测试点列出用例标题(未展开步骤):
> Read the requirement and {N} test points — listing test case titles by test point first (steps not yet expanded):

输出对应 Markdown 预览、一个状态 hint 和存疑清单。不得主动铺开全部 Case；Full 是否放行只按 §5“大批量分流”的结果判断。

Hints（按会话语言二选一）：

- Title：`要改就直接说(改标题、增删);想看某条用例步骤说「展开第 X 条」;要导出就说「导出 CSV」。` / `Just tell me if you want changes (edit title, add/remove); say "expand case X" to see its steps; say "export CSV" to export.`
- Partial：`这 N 条的步骤已展开。想看别的就说「展开第 X 条」或「全部展开」;要导出就说「导出 CSV」(未展开条目只有标题,属于草稿)。` / `Steps for these N cases are now expanded. Say "expand case X" or "expand all" to see more; say "export CSV" to export (un-expanded entries have titles only and remain draft items).`
- Full：`全部 N 条已展开完毕。要导出就说「导出 CSV」。` / `All N cases are now expanded. Say "export CSV" to export.`

导出后只输出薄回执和存疑清单，不输出 Case 正文：

- 状态：`已导出:<路径>。` / `Exported: <路径>.`
- Refs：`CSV 已含 Refs 列;导入 TestRail 时映射到 References 后,可用 testrail-link 回链用例。` / `The CSV includes a Refs column; map it to References when importing into TestRail, then use testrail-link to link cases.`
- `fill_then_export` 追加：`已把未展开用例补齐步骤后导出(对话未铺开)。` / `Un-expanded cases had their steps auto-filled before export (not expanded inline in this conversation).`
- `as_is` 且仍有未展开条目时追加：`这是当前草稿;未展开条目只有标题,不作为最终可执行用例。` / `This is the current draft; un-expanded entries have titles only and are not final executable cases.`

不得向 SQA 使用“脚本/script”作为产品话术。CSV 是导出快照，Markdown 是会话工作态。

## Session state

- Binding：`product_id`、`requirement_id`、最新五字段、`module_tree_node_id`、GET 得到的 TestPoints。
- Draft：内存 `cases[]`。Partial 回合只渲染本次点名行，可附“已展开: #1,#3”；之前展开内容继续保留。
- 无磁盘状态：不建 `.memory` 或跨会话缓存；interim JSON 只在导出瞬间存在于 `/tmp/`，随后删除。
- v1 不支持离线 CSV 编辑回传，无 `is_edited`；A3 不 POST/PATCH CawPlan。

## References

- `references/test-design-methods.md` — 从父 TestPoint 发现必要候选场景
- `references/testcase-writing-spec.md` — 字段、拆合、优先级和校准例
- `references/interaction-prompts.md` — 框 1～框 5 完整双语文案与 fallback
- `references/csv-template-mapping.md` — interim JSON、13 列、脚本调用与导出格式
