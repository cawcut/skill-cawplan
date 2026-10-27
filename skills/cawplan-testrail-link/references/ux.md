# UX — 路由、确认闸、Preview/Result、超链接、降本

跟随用户**最近一条消息**主语言；禁止同段中英双语。Agent 自行 `AskUserQuestion`（不写入 `allowed-tools`）。

## §Glossary

默认隐藏：`preview_id`、`mapping_id`、`case_identity`、`test_point_id`、`matched_refs`、UUID。

| 内部 | 展示 |
|------|------|
| `to_link` | 将链接 |
| `already_linked` | 已链接（跳过） |
| `conflict` | 冲突（阻断） |
| `refs_missing_in_testrail` | Requirement 内有测试点，扫描范围内无 Case refs 含该 tp |
| `orphan_refs_in_testrail` | refs 属本需求但测试点无效/已删除（**非**外需求噪音） |
| `scanned_case_count` | 扫描范围内 Case 总数（含无 cawplan refs 的） |
| `scope_section_count` | 扫描范围 Section 数 |
| `supersede_required` | 需替换已有绑定 |
| `plan_id=0` | 仅 Run（无 Plan） |
| `RUN_ONLY_MODE` | 独立 Run 模式 |
| `TICKET_MAPPING_EXISTS` | 工单已有 Plan 映射（须确认替换） |
| `has_mapping` | 版本已绑定里程碑 / 尚未绑定里程碑 |

**意图同义词**：回链/link back · 确认链接/confirm link · 先不/cancel · 重新预览/re-preview · 替换绑定/supersede · 技术详情/technical details

## §Cost（降本 · SHALL）

1. **Reference 懒加载**：仅 Read 当前 Workflow 需要的 §；禁止开场 Read 三份 reference 全文。
2. **缓存**：同会话 `mappings get` 只调一次；`testrail_origin` + `suites[]` 写入 `§ConfirmState`；`sections list` 按 `suite_id` 缓存，用户说「刷新」才 `--refresh`。
3. **少调接口**：AutoScan retry 时 **允许**调一次 `sections list`（按 suite 缓存）；Workflow B 用户已给完整 Plan URL + 工单 → **可不** `resolve-url`。
4. **Preview 截断**：`items` / `linked_cases` 明细 **最多展示 10 行** +「…还有 {n} 条（说「技术详情」展开）」；**汇总行与表头链接不可省略**。
5. **禁止**：为填表重复 `requirements get`（热接力已有五字段时）；Preview 表展示 refs / `matched_refs` 列（用户要「技术详情」再节选）。

## §TestRailLinks（SHALL）

Step `mappings get` 后解析 `testrail_origin`（同 A1）：

1. 优先 `testrail_project_url` 或 `suites[]` 中匹配 `confirmed_suite_id` 的 `url`
2. Origin：`^(https?://[^/]+)`
3. 无法解析时 ID 回退纯文本

| 对象 | URL |
|------|-----|
| Suite | API `url` 或 `{origin}/index.php?/suites/view/{suite_id}` |
| Section | `{origin}/index.php?/suites/view/{suite_id}&group_id={section_id}` |
| Case | API **`case_url` 优先**；否则 `{origin}/index.php?/cases/view/{case_id}` |
| Plan | API **`plan_url` 优先**；否则 `{origin}/index.php?/plans/view/{plan_id}` |
| Run | API **`runs[].url` 优先**；否则 `{origin}/index.php?/runs/view/{run_id}` |

Markdown 惯例：

- Suite：`[{name}（ID [{id}](suite_url)）](suite_url)`
- Case：`[C{case_id}](case_url) — {case_title}`
- Plan：`[P{plan_id}](plan_url) — {name}`（Run-only 无 Plan 行省略）
- Run：`[R{run_id}](run_url) — {name}`

**SHALL 带链接**：Preview/Result 表头 Suite；明细 Case/Plan/Run 列；确认闸正文中的 Suite/Plan。**禁止**仅裸数字 ID。

## §Intent

自由文本先匹配，命中则不弹对应框（须在 Preview 表头回显）：

| 用户表述 | 动作 |
|----------|------|
| 用默认用例集 / default suite | 采用 `default_suite_id` → 跳过框 A3 |
| suite {id} / 用例集 {id} | 匹配 `suites[]` → 跳过框 A3 |
| section id {n} / group_id={n} | `parent_section_id` = **导入根 anchor** → 跳过 AutoScan 首步 |
| 自动扫描 / 默认 | 不传 `parent_section_id` → AutoScan 第一步 |
| 绑定 run {id} / runs/view/{id} | B：`plan_id=0`，`run_ids=[id]` |
| 绑定 plan {id} / plans/view/{id} | B：`plan_id={id}` |
| 换 Suite | 清 `confirmed_suite_*` **及** `confirmed_parent_section_*` → 框 A3 |
| 换导入目录 | 仅清 `confirmed_parent_section_*` → 重走 AutoScan |

## §ConfirmState

| 字段 | 用途 |
|------|------|
| `confirmed_suite_id` / `confirmed_suite_name` | Workflow A |
| `confirmed_parent_section_id` / `confirmed_parent_section_name` | Workflow A 导入根 anchor（空 = 根级模糊匹配） |
| `testrail_origin` | 拼链接 |
| `cached_sections_by_suite` | 避免重复 `sections list` |

换 `product_id` / `requirement_id` → 清全部。`PREVIEW_EXPIRED` 重 preview：Suite/Section 未变可复用。

## §Prompts

1. 先 **1 句**框上正文（说明当前要确认什么、数据从哪来），再 `AskUserQuestion`（`header`+`question`+`label`+`description`）
2. 不可用 → 编号降级；勿自定义 `Other` 以外逻辑
3. 自由输入（Suite ID / Section ID / TestRail URL）：正文写「请在 Other 输入」；选项固定 **2 个**（「先不继续」+「返回上一选择」）— `options < 2` 会报错

| 框 | 触发 | option labels（中 / EN） |
|----|------|--------------------------|
| **0 路由** | A/B 均未命中或双命中 | 链接用例（CSV 导入后）/ Link cases · 绑定计划或运行 / Link plan or run · 先不 / Not now |
| **A1 上下文** | 缺 product 或 requirement（非热接力） | 粘贴 Requirement 链接 / Paste requirement link · 粘贴产品链接 / Paste product link · 先不 / Not now |
| **A3 Suite** | `suites.length` 2–4 且无 Intent | 同 import 框 3（**不新建 Suite**） |
| **A3s 导入目录** | AutoScan retry 仍 `to_link=0` 且无 conflict | **3 个** Section 候选（名称 + ID）+ Other · 先不 / Not now |
| **A-confirm** | `to_link>0` 且 `conflict===0` | 确认链接 / Confirm link · 先不 / Not now |
| **B1 上下文** | 缺 product 或 version | 粘贴版本链接 / Paste version link · 产品名+版本名 / Name lookup · 先不 / Not now |
| **B2 绑定收集** | Milestone 已绑定 | 继续添加一条 / Add another · 开始预览 / Preview now · 先不 / Not now |
| **B-supersede** | `supersede_required>0` | 替换已有绑定 / Replace existing · 先不 / Not now |
| **B-confirm** | preview OK | 确认绑定 / Confirm bind · 先不 / Not now |

**框 A3s 框上正文（SHALL）**：

> 未在默认扫描范围内找到可链接的用例。请选择 **CSV 导入所在的 TestRail 目录**（导入根目录，将扫描该目录及子目录）。  
> 数据来自 `sections list`；也可在 Other 输入 Section ID 或带 `group_id=` 的 URL。

候选规则：从 `sections list` **全树**按 requirement.summary / 用户话术 / ticket display_id 匹配；取得分最高的 **3** 个 + Other。

**框 A-confirm**：仅 `to_link>0` 且 `conflict===0` 时展示。

**框 A-confirm 框上正文（SHALL 含可点击 Suite）**：

> 将把 **{to_link}** 条用例链接到 CawPlan 测试点；已链接 **{already_linked}** 条将跳过；TestRail 未找到 refs **{refs_missing}** 条。  
> 用例集：[{suite_name}（ID [{suite_id}](suite_url)）](suite_url) · 需求：**{requirement_summary}**  
> `conflict>0` 或 `to_link=0` 时 **不展示本框**。

**`to_link=0` 且 `already_linked>0` 且无 conflict**：不弹确认闸；说明「全部已链接，无需执行」。

**框 B-confirm 框上正文**：

> 将为 **{to_link}** 个工单写入 Plan/Run 绑定；其中 **{supersede_required}** 个将替换已有映射。  
> 版本：**{version_name}** · 里程碑：**{milestone_name}**（已绑定）

## §PreviewCases（Workflow A）

**表头（SHALL · 明细之前）**：

```markdown
## 用例链接预览 — {requirement_summary}

| 项目 | 内容 |
|------|------|
| 用例集 | [{suite_name}（ID [{suite_id}](suite_url)）](suite_url) |
| 扫描范围 | {无 parent：根级模糊匹配（{scope_section_count} 个 Section） / 有 parent：[{section_name}（ID [{id}](section_url)）](section_url)（含子树）} |
| 将链接 | **{to_link}** |
| 已链接 | {already_linked} |
| 冲突 | {conflict} |
| TestRail 缺 refs | {refs_missing_in_testrail} |
| TestRail 无效 refs | {orphan_refs_in_testrail}（warning，仅非零时一句） |
```

**`warnings[]` 非空时**（`§PreviewWarnings`）在表头下追加简短提示行。

**将链接（节选 ≤10 行 · 无 refs 列）**：

```markdown
### 将链接
| 测试点 | Case | 目录 |
|--------|------|------|
| {test_point_title 或摘要} | [C{case_id}](case_url) — {case_title} | {target_section_path 末级} |
```

表下可选一句（仅 `to_link>0`）：Refs 中 **需求 ID + 测试点 ID** 正确即可链接，**不要求** hash 与 CawPlan 重算一致。

**冲突（SHALL 全量展示 · 通常条数少）**：

```markdown
### 冲突（须先处理，无法执行）
| 测试点 | TestRail Case | 已映射 Case | 说明 |
| {tp} | [C{matched_case_id}](url) | [C{existing_case_id}](url) 或 — | {§ConflictMessages 中译} |
```

**缺 refs（节选 ≤5 行 + 计数 · 无 refs 列）**：

```markdown
### TestRail 未找到 refs（{n} 条）
请确认 CSV 第 13 列 `Refs` 已映射到 TestRail **References**，且 TestPointId 正确。

| 测试点 |
| {tp_title} |
```

`conflict>0` → 表下加粗：**存在冲突，请先处理后再链接。** 禁止 execute。

## §ConflictMessages

| BE `message` | 用户文案 |
|--------------|----------|
| `TestRail case is already mapped to a different test point` | 该 TestRail Case 已绑定到其他测试点；请核对 CSV 中 TestPointId 或解绑旧 mapping |
| `TestRail case does not match the case already mapped for this test point` | 该测试点已映射到其他 Case |
| `another TestRail case in this preview claims the same test point and case identity` | 本次预览中多条 Case 的 refs 重复，须保留一条 |

D13 场景 API **无** `existing_test_point_id`：**禁止**编造「绑在 TP-X」；仅用上表文案 + Case 链接。

## §PreviewWarnings

| warning 前缀 | 展示（一句） |
|--------------|-------------|
| `DUPLICATE_REFS_IN_TESTRAIL` | 多条 TestRail Case 的 refs 完全相同，将只链接其中一条 |
| `AMBIGUOUS_SECTION_MATCH` | 多个根级目录名与需求匹配，已合并扫描 |
| `REQUIREMENT_SECTION_NOT_FOUND` | 未匹配到根级目录（AutoScan 应已 retry；仍出现则引导框 A3s） |
| `REQUIREMENT_HAS_NO_TESTPOINTS` | 该需求下无测试点，无法链接 |

## §PreviewPlans（Workflow B）

```markdown
## Plan/Run 绑定预览 — {product_name} {version_name}

| 项目 | 内容 |
|------|------|
| 里程碑 | 已绑定（`milestone_mapping_id` 仅技术详情展示） |
| 将绑定 | **{to_link}** 个工单 |
| 需替换 | {supersede_required} |

### 绑定明细
| 工单 | 类型 | Plan / Run | 说明 |
| {ticket_display_id} | Plan / Run-only | [P{plan_id}](plan_url) 或 [R{run_id}](run_url) — {name} | {warnings 友好化} |
```

`TICKET_MAPPING_EXISTS` → 说明列写「将替换已有绑定」；`RUN_ONLY_MODE` → 类型列写「仅 Run」。

## §ResultCases

```markdown
## 用例链接完成 — {requirement_summary}

| 项目 | 结果 |
|------|------|
| 用例集 | [{suite_name}（ID [{suite_id}](suite_url)）](suite_url) |
| 已链接 | **{linked}** |
| 已跳过 | {skipped} |
| 失败 | {failed} |

### 已链接（节选 ≤10）
| 测试点 | Case |
| {tp 摘要} | [C{case_id}](case_url) |
```

无 `linked_cases` 时如实说明。用户要「技术详情」再列 `mapping_id` / `matched_refs` 节选。

## §ResultPlans

```markdown
## Plan/Run 绑定完成 — {product_name} {version_name}

| 项目 | 结果 |
|------|------|
| 已绑定 | **{linked}** 个工单 |
| 已替换 | {superseded} |

### 明细
| 工单 | Plan / Run | 链接 |
| {ticket_display_id} | {Plan 或 Run-only} | [查看](plan_url 或 run_url) |
```

## §Errors

| 场景 | 用户说明 | 选项 |
|------|----------|------|
| CSV 未导入 / 扫描为空 | 请先在 TestRail 导入含 Refs 列的 CSV，并确认 References 映射 | 我去导入 / 取消 |
| 同 Case 跨测试点冲突 | 该 TestRail Case 已绑定其他测试点；核对 CSV TestPointId | 查看冲突表 / 取消 |
| `MILESTONE_NOT_BOUND` | 见 `link-plans.md §MilestoneGate` | 去编排 Milestone / 取消 |
| `CONFLICT_BLOCKS_EXECUTE` | 存在映射冲突 | 查看冲突表 / 取消 |
| `SUPERSEDE_REQUIRED` | 须确认替换 | 确认替换 / 取消 |
| `PREVIEW_EXPIRED` | 预览已过期（约 1h） | 重新预览 / 取消 |
| `TESTRAIL_UNAVAILABLE` | TestRail 暂不可用 | 稍后重试 / 取消 |
| `SUITE_NOT_IN_PROJECT` | 用例集无效 | 重新选用例集 / 取消 |
| `SECTION_NOT_IN_SUITE` | 目录不属于该用例集 | 重选导入目录（框 A3s） / 取消 |
| `PLAN_NOT_FOUND` / `RUN_NOT_FOUND` | Plan/Run 不存在 | 核对 URL / 取消 |
| `TICKET_NOT_IN_VERSION` | 工单不在该版本 | 换工单或版本 / 取消 |
| `auth`/403 | 无权限 | 检查登录 / 取消 |
