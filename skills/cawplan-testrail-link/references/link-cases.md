# Workflow A — Link Cases（CSV refs 回链）

> API：契约 §3.4（BE v2 · req+tp 匹配）· CLI：`qa-insights testrail link cases preview|execute`

## §Prerequisites（Step 0）

**Agent 自检**（**不**单独 Ask 用户）：

1. 同会话 `cawplan-testcase-generate` 刚导出 CSV，或用户明确说「已导入 TestRail」→ 假定满足
2. 否则直接走 preview；仅当 `scanned_case_count=0` 且 `refs_missing` 接近全部测试点时，引导检查：
   - A3 导出 **13 列 CSV**（含 `Refs`）
   - TestRail 导入映射含 `Refs` → **References**
3. **未**走 `cawplan-testcase-import` 自动导入（或走了但 Case 无 mapping）— 本 Skill 补 mapping

## §Context（Step 1）

| 字段 | 来源（优先级） |
|------|----------------|
| `product_id` | 门户产品链接 · 同会话绑定 · `products list` 消歧 |
| `requirement_id` | Requirement 链接 · A3 热接力 · `requirements get` |

**热接力（P1）**：同会话 `cawplan-testcase-generate` 刚导出 CSV → 用户说「映射回」「link 导入的用例」→ 复用 `product_id` + `requirement_id`；**跳过框 A1**。

缺字段 → `ux.md §Prompts` 框 A1；**禁止**无 requirement 调 preview。

## §Mappings（Step 2）

```bash
cawplan qa-insights testrail mappings get <product_id>
```

记录：`suites[]`、`default_suite_id`、`testrail_project_url` → 写入 `ux.md §ConfirmState` 的 `testrail_origin`。

## §AutoSuite（Step 2b · 框 A3 压缩）

| 条件 | 动作 |
|------|------|
| `suites.length === 1` | **无感采用**该 Suite；写 `confirmed_suite_id` / `confirmed_suite_name` |
| `§Intent` 命中 suite id / URL / 名称 | 跳过框 A3 |
| `suites.length` 为 2–4 | 框 A3 Ask 消歧 |
| `suites.length > 4` 或 0 匹配 | 请用户收窄（ID / URL / 名称） |

**与 `cawplan-testcase-import` 刻意分叉**：Link **允许**单 Suite 无感采用；import 禁止静默 `default_suite_id`。

框 A3 入参引导（仅需 Ask 时）：

> 请选择要扫描的 **TestRail 用例集（Suite）**。请提供 Suite ID、名称，或粘贴 `/suites/view/{id}` URL。

解析顺序（本地）：纯数字 → URL `/suites/view/(\d+)` → 名称匹配 `suites[]`（精确优先，再包含）。

Link **不提供「新增 Suite」**；仅选已有 Suite。

## §SuiteSection（`parent_section_id` 语义）

| 项 | Link Cases（BE v2） |
|----|---------------------|
| `parent_section_id` | **CSV 导入根目录 anchor**（该 Section **自身 + 全子树**）；BE **不按** requirement summary 精确匹配 |
| 不传 `parent_section_id` | Suite **根级**模糊匹配 requirement 别名（≥0.75）；**深层目录不保证**扫到 |
| 与 import 差异 | import 的 parent = 挂靠父级；link 的 parent = **扫描范围 anchor** |

**禁止**沿用旧文案「缩小子树」「默认扫 Requirement 对应 Section 子树」。

## §AutoScan（Step 3 · 无感，最多 1 次 retry）

```
preview(无 parent_section_id)
  → to_link>0 或 (already_linked>0 且无 conflict) ? 进 Step 4 展示
  → conflict>0 ? 停止（不 retry）
  → 满足 retry 条件 且 尚未带 parent ?
      sections list（按 suite 缓存）
      → 全树匹配：用户话术目录名 / requirement.summary / ticket display_id
      → preview(带 parent_section_id)   【对用户完全无感，不展示第一次失败 preview】
  → 仍失败 → ux.md 框 A3s（3 候选 + Other，仅 1 次）
```

**Retry 条件**（须同时满足：`confirmed_parent_section_id` 为空，且 `conflict===0`）：

- `warnings` 含 `REQUIREMENT_SECTION_NOT_FOUND`；或
- `to_link===0` 且 `refs_missing_in_testrail` ≈ 全部已知测试点；或
- `summary.scanned_case_count === 0`

**禁止**：`conflicts>0` 时 AutoScan retry。

确认后存 `confirmed_parent_section_id` / `confirmed_parent_section_name`（可空 = 根级模糊）。

## §MatchingRules（BE v2 · SHALL）

- **门禁**：refs 中 `requirement_id` + `test_point_id` 匹配当前 preview；**不验证** `cawplan:case_*` hash
- **`matched_refs`**：TestRail 实际 refs（`items[]` / `already_linked[]` / `conflicts[]` 统一字段名）；**禁止**读 `expected_refs`
- **`case_identity`**：取自 refs 的 `case_` 段，或 fallback `link:tr:{case_id}`
- **外 req** refs → **静默跳过**（不进 `orphan_refs_in_testrail`）
- **本 req 无 tp**（如仅 `cawplan:{req}`）→ `orphan_refs_in_testrail` + 可能 `refs_missing`
- **`DUPLICATE_REFS_IN_TESTRAIL`** warning → 信息提示；BE 只 link 最低 `case_id` 的一条
- **一对多**：同测试点下多条 TR Case（不同 `case_*`）→ 全部 `to_link`

## §PreviewCLI（Step 3/4）

**推荐（flag）**：

```bash
cawplan qa-insights testrail link cases preview <product_id> \
  --suite-id <confirmed_suite_id> \
  --requirement-id <requirement_id> \
  [--parent-section-id <confirmed_parent_section_id>]
```

**或 body 文件**：

```json
{
  "suite_id": 335210,
  "source": { "type": "REQUIREMENT", "requirement_id": "<uuid>" },
  "parent_section_id": 4377824
}
```

```bash
cawplan qa-insights testrail link cases preview <product_id> --body-file link-cases-preview.json
```

`source.type` **必须** `REQUIREMENT`。

成功 → 存 `preview_id`（仅内部）；展示 `ux.md §PreviewCases`。

## §PreviewFields

| 字段 | Agent 用途 |
|------|------------|
| `summary.to_link` | 确认闸门槛；Result |
| `summary.already_linked` | `to_link=0` 时成功说明 |
| `summary.conflict` | `>0` 阻断 execute |
| `summary.refs_missing_in_testrail` | 缺 refs 表 + AutoScan 判断 |
| `summary.scanned_case_count` | AutoScan 诊断；Step 0 引导 |
| `summary.scope_section_count` | 表头扫描范围说明 |
| `items[]` | 将链接表；`case_url` **必须用 API 值** |
| `conflicts[]` | 全量展示；读 `message` + `matched_case_id` / `existing_case_id` |
| `refs_missing_in_testrail[]` | **仅** `test_point_id`；节选 + 计数 |
| `orphan_refs_in_testrail[]` | 非零时一句 warning |
| `warnings[]` | `ux.md §PreviewWarnings` |
| `already_linked[]` | 汇总数字；用户追问再展开 |

测试点标题：preview 若无 title，用同会话 `testpoints list` **仅一次** 建 `test_point_id→title` 缓存；无缓存则用短前缀 +「（测试点）」。

**禁止**在 Preview 表展示 `matched_refs` / refs 字符串（降本；用户要「技术详情」再节选）。

## §ExecuteCLI（Step 6）

```bash
cawplan qa-insights testrail link cases execute <product_id> \
  --preview-id <preview_id> \
  --confirm
```

- 无 `--confirm` → `CONFIRMATION_REQUIRED`
- `conflicts` 非空 → `CONFLICT_BLOCKS_EXECUTE`
- `to_link=0` → **不调用** execute
- 成功 → `ux.md §ResultCases`

## §ConfirmState

同 `ux.md §ConfirmState`。

- 换 Suite → 清 `confirmed_parent_section_*` + 须新 preview
- 换 Requirement → 清全部 + 新 preview
- `PREVIEW_EXPIRED` 重 preview：Suite/Section 未变可复用

## §与 testcase-import 边界

| 路径 | 适用 |
|------|------|
| `cawplan-testcase-import` | Skill 自动创建 Case + mapping |
| **本 Skill A** | QA **手工** CSV 导入后，按 refs **补 mapping** |
| 同 Session A3→CSV→手工导入→link | 推荐路径（AutoScan 理想路径仅 1 次确认） |
