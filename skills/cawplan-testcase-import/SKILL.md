---
version: 0.2.5
name: cawplan-testcase-import
description: |
  Import QA test cases from CawPlan (Requirement/TestPoint or INLINE session cases) into TestRail with preview-first workflow.
  Use when: SQA wants to push T1-generated cases to TestRail; after test-point generation, expand cases and import; re-import after requirement updates (skip-only, no overwrite).
  NOT for: generating test points (use `cawplan-testpoint-generate`); archiving requirements (use `cawplan-requirement-analyze`); creating Test Plans/Runs (A2, future); failure-to-defect (A4); release risk (A5).
argument-hint: "[Product portal link or product_id + Requirement link or INLINE cases]"
allowed-tools: Bash
---

# CawPlan TestCase Import — A1 用例导入 TestRail

## Bootstrap

```bash
cawplan skill check
```

## 前置条件（导入前自检）

| 检查项 | 命令 / 动作 |
|--------|-------------|
| 已登录且具备 `qa_insights.edit` | `cawplan auth login` |
| Product 已配置 TestRail Link | 向 SQA Lead 确认；失败码 `PRODUCT_TESTRAIL_URL_MISSING` |
| 目标 Suite 已知且属于当前 Product 绑定的 TestRail Project | `cawplan qa-insights testrail mappings get <product_id>` 校验 `default_suite_id` / 已映射 Suite；SQA 指定 `--suite-id` 时也必须先校验 |
| 目标 Version 已确认 | 用户在对话中明确指定版本时，必须写入 `version_name`；若用例数据已有不同 `version_name`，先向用户确认 |
| T1 用例已就绪 | Requirement 已归档 + 测试点已入库（A2）；或本会话 INLINE cases 表格已确认 |

**禁止**：直连 TestRail API、在 Skill 内持有 TestRail Key、跳过 preview 直接 execute。

---

## Workflow（A1）

### 1. 解析上下文

**Product**：门户 URL `/product/{product_id}/...` 或 SQA 提供的 `product_id`。

**数据源（二选一，优先级如下）**：

| 优先级 | 类型 | 条件 |
|--------|------|------|
| 1 | `INLINE` | 本会话/用户输入中已经有展开后的测试用例（含 `title`、`steps`/`expected`、`group`、`test_point_id`/`testPointId`） |
| 2 | `REQUIREMENT` | 只有 Requirement/TestPoint 已归档、但当前上下文**没有**展开后的测试用例时才使用 |

**数据源强制判定**：

- 如果当前会话刚通过 `cawplan-testpoint-generate` 或其他 T1 流程生成了测试用例，必须使用 `source.type=INLINE`，将已生成的 case data 写入 `cases[]` 后 preview。
- 如果用户直接提供了 T1 生成的 JSON / 表格 / Excel 转换结果，只要其中包含 case 级 `title` 与 `steps`/`expected`，也必须使用 `INLINE`。
- 不得在已有展开用例时先尝试 `source.type=REQUIREMENT`。`REQUIREMENT` 源会由后端从 TestPoint 直展，适用于「只有测试点、没有测试用例」的场景；它可能退化为 1 TestPoint = 1 Case，不适合一个 TestPoint 展开多个 TestCase 的会话产物。
- 若不确定上下文中是否已有测试用例，先向用户确认「是否使用上面已生成的用例明细导入」，不要默认走 `REQUIREMENT`。

**VERSION 批量导入**：后端尚未实现（`source.type=VERSION`）→ 勿使用。

刷新 Requirement（REQUIREMENT 源时）：

```bash
cawplan api GET /api/v1/public/openapi/product/<product_id>/qa/requirements/<requirement_id>
cawplan api GET /api/v1/public/openapi/product/<product_id>/qa/requirements/<requirement_id>/testpoints
```

### 2. 必须：读取并校验 TestRail 映射

```bash
cawplan qa-insights testrail mappings get <product_id>
```

记录 `default_suite_id`、`section_mappings`、`case_template_id`（Separate Steps）。

**Suite 门禁（preview 前必须完成）**：

- 未传 `--suite-id`：使用 mappings 返回的 `default_suite_id`；若为空，停止并要求 SQA 配置默认 Suite 或提供有效 Suite。
- 已传 `--suite-id`：必须能在当前 product 的 mappings 结果中确认该 Suite 属于当前 Product 绑定的 TestRail Project（例如命中 `default_suite_id` 或后端返回的 Suite 映射列表）。
- 如果 `--suite-id` 不存在、无法证明属于当前 Project，或后端/CLI 返回 `SUITE_NOT_IN_PROJECT`：**立即停止**，向用户说明「该 Suite 不属于当前 Product 绑定的 TestRail Project，请确认 Product TestRail Link / Suite ID / mappings 配置」，不得继续 preview，也不得 execute/import。

禁止为了“试一下”而跳过 Suite 校验直接调用 preview。

### 2.1 INLINE 用例字段（TestRail 写入约束）

`cases[]` 必须使用 snake_case。Skill 生成 INLINE JSON 时只使用后端支持的字段：

| 字段 | TestRail 写入 | 说明 |
|------|---------------|------|
| `title` | `title` | 必填 |
| `steps[]` | `custom_steps_separated` | Separate Steps；每步 `{ "content", "expected" }` |
| `preconditions` | `custom_preconds` | 前置条件 |
| `version_name` | `custom_case_version` | 用户在对话中指定版本时必填；INLINE 顶层与每条 case 保持一致 |
| `importance` | `custom_importance` | 可选；仅用 `Must Have` / `Should Have` / `Nice to Have` 或 `1` / `2` / `3` |
| `priority` | `priority_id` | 可选；写入 preview body 前统一转换为 `LOW` / `MEDIUM` / `HIGH` / `CRITICAL` |
| `automation_type` / `automation_result` | `custom_automation__*` | 有值才写 |
| `source_case_key` | TestRail `refs` 的 `cawplan:case_*` | 可选但推荐；用于区分同一 TestPoint 展开的多条用例 |
| `tags` | 不写 `label_id` | BE 暂未实现 label 同步，tags 只保留为来源语义 |

`importance` 无法识别时后端会跳过该字段；不要编造 TestRail option id。

`AUTO_BY_GROUP` 是默认 Section 策略。后端会在 Suite 下创建/复用两层 Section：父 Section = T1 Requirement `summary`（为空时按 ticket / 描述 / id 兜底），子 Section = TestPoint `group`（为空时为 `未分组`）。INLINE 源必须尽量携带 `requirement_id`，否则后端无法加载 Requirement summary，会退化为仅 `group` 顶级 Section 并返回 `MISSING_REQUIREMENT_ID` warning。

同一 `test_point_id` 可对应多条 TestRail Case。生成 INLINE JSON 时，若同一 TestPoint 展开多条用例，必须为每条用例提供稳定且不同的 `source_case_key`；未提供时后端会使用 `content_hash` 作为用例级 `case_identity`。不得把 `cawplan:req_*;cawplan:tp_*` 作为唯一幂等 refs。

### 2.2 T1 用例数据转换规则

当输入来自 T1 生成的测试用例数据（如 `cases[].testPointId`、`cases[].requirementId`、`cases[].moduleTreeNodeId`、`cases[].steps` / `expected`、`cases[].priority: "P1"`）时，Skill 在生成 preview body 前必须完成字段规范化：

- 字段名转为 snake_case：`testPointId` → `test_point_id`，`requirementId` → `requirement_id`，`moduleTreeNodeId` → `module_tree_node_id`。
- `tag` 转为 `tags: [tag]`；已有 `tags[]` 时保留数组。
- T1 的 `steps[]` 字符串数组与 `expected[]` 字符串数组按下标合并为 TestRail Separate Steps：`{ "content": steps[i], "expected": expected[i] || "" }`。
- 必须保留 `requirement_id` 与 `group`：`AUTO_BY_GROUP` 依赖 `requirement_id` 获取父 Section summary，并用 `group` 创建子 Section。
- `priority` 必须按下表转换后再写入 preview body，不得把 `P0` / `P1` / `P2` / `P3` / `P4` / `P5` 原样传给后端：

| T1 `priority` | TestRail `priority` |
|---------------|---------------------|
| `P0` | `CRITICAL` |
| `P1` | `HIGH` |
| `P2` | `MEDIUM` |
| `P3` | `LOW` |
| `P4` / `P5` / 大于 `P3` 的 `P{n}` | `LOW` |

若输入已经是 `LOW` / `MEDIUM` / `HIGH` / `CRITICAL`，可直接使用；若为其他无法识别的值，先向用户确认优先级，不得原样 preview。

### 2.3 Version 写入门禁（preview 前必须完成）

当用户在对话中明确指定导入版本（如 `4.3.1`、`v4.3.1`、`version 4.3.1`、`放到 4.3.1 版本下`）时，Skill 必须把该值规范化为 `version_name` 并写入导入数据：

- REQUIREMENT 源：preview 命令必须带 `--version-name "<release_version>"`。
- INLINE 源：body 顶层必须包含 `"version_name": "<release_version>"`，且每条 `cases[]` 也必须包含同样的 `"version_name": "<release_version>"`，确保 TestRail `custom_case_version` 能被写入。
- 若 INLINE `cases[]` 中已有 `version_name`，且与用户对话中指定版本不一致：**立即停止**，向用户展示冲突版本，询问以哪个版本为准；用户确认前不得 preview。
- 若多条 INLINE case 内部存在不同 `version_name`，也必须停止并要求用户确认统一版本或拆分导入。

确认版本后，重新生成 body 再 preview；不得在 preview 后再补改 `version_name`。

### 3. 导入预览（必须）

**REQUIREMENT 源**（仅当当前上下文没有展开后的测试用例时使用）：

执行 preview 前，先完成 §2 的 Suite 门禁、§2.2 的 T1 用例数据转换与 §2.3 的 Version 写入门禁；任一校验未通过时不得运行以下命令。

如果当前会话已存在展开后的测试用例（尤其一个 `test_point_id` 对应多条 Case），停止使用本命令，改走下方 INLINE 源。

```bash
cawplan qa-insights testrail import preview <product_id> \
  --source-type REQUIREMENT \
  --requirement-id <requirement_id> \
  --suite-id <suite_id> \
  --version-name "<release_version>"
```

**INLINE 源**（当前会话已有测试用例时必须使用）：

将用例写入临时 JSON（`cases[]` 结构见 API 契约 §3.1），并在 body 中使用已通过 §2 校验的 `suite_id`、已通过 §2.2 转换后的字段以及已通过 §2.3 确认的 `version_name`，然后：

```bash
cawplan qa-insights testrail import preview <product_id> --body-file /tmp/import-preview.json
```

**向 SQA 展示预览表**（不得省略）：

| # | 标题 | action | section_path | skip_reason | warnings |
|---|------|--------|--------------|------------|----------|
| … | … | CREATE/SKIP/FAIL | `Requirement summary / group` | MAPPING_EXISTS / REFS_EXISTS | … |

汇总 `summary.to_create` / `to_skip` / `to_fail`；若有 `to_fail > 0` 或 `section_creates` 需新建 Section → **停止**，修正后重新 preview。

展示 Section 时优先读 `target_section_path`；若缺失，则用 `target_parent_section_name + target_section_name` 拼出两层路径。若出现 `MISSING_REQUIREMENT_ID` warning，需告知 SQA 该 INLINE case 缺少 `requirement_id`，Section 将不能按 Requirement summary 归档。

保存 stdout 中的 `preview_id`（或 `api.data.preview_id`）。

### 4. SQA 确认

必须明确确认：

- 接受「只跳过、不覆盖」策略（已存在映射的 Case 不会 update）
- 接受 `to_create` 条数与新 Section 创建
- 接受 `AUTO_BY_GROUP` 的 Section 路径（Requirement summary → group）
- `version_name` / Suite 正确

未获确认 → **不得** execute。

### 5. 执行导入

```bash
cawplan qa-insights testrail import execute <product_id> \
  --preview-id <preview_id> \
  --confirm
```

| 响应 | 动作 |
|------|------|
| `status: COMPLETED`（同步） | 输出 `created_cases[].case_url`、`skipped_cases` |
| `status: PENDING/RUNNING` + `job_id`（>50 条 CREATE） | 轮询 Job |

### 6. 异步 Job 轮询（>50 条时）

```bash
cawplan qa-insights testrail jobs poll <product_id> <job_id>
# 或单次查询：
cawplan qa-insights testrail jobs get <product_id> <job_id>
```

`poll` 默认 3s 间隔、10min 超时。`outcome: UNKNOWN`（超时）→ 告知 SQA 用 `jobs get` 手动查，勿盲目重复 execute。

### 7. 导入报告（会话输出）

```markdown
## TestRail 导入结果 — {product} / {requirement or batch}

- Preview ID: …
- Job ID: …
- 创建: N | 跳过: M | 失败: K

### 新建 Case
| test_point_id | case_id | URL |
...

### 跳过（不覆盖）
| test_point_id | case_id | skip_reason |
...
```

---

## 错误处理

| error.type / api_code | 处理 |
|-----------------------|------|
| `testrail` / `TESTRAIL_UNAVAILABLE` | 稍后重试；勿重复 execute |
| `CONFIRMATION_REQUIRED` | 补 `--confirm` |
| `PREVIEW_EXPIRED` | 重新 preview（有效期约 1h） |
| `SUITE_NOT_IN_PROJECT` | Suite 不属于当前 Product 绑定的 TestRail Project；停止流程，请用户确认 Product Link / Suite ID / mappings 后重新开始 |
| `validation` | 修正 body / 缺字段 |
| `auth` / 403 | 检查 RBAC `qa_insights.edit` |
| `UNKNOWN` | 写操作结果不确定；用 `jobs get` 对账，勿盲目重试 execute |

---

## 与 T1 Skill 衔接

推荐路径：**同一会话** `cawplan-testpoint-generate` → 展开步骤为用例表 → `cawplan-testcase-import`（必须走 INLINE preview → execute）。

Requirement 直导（`REQUIREMENT` 源）仅用于尚未生成 case 明细的 Requirement/TestPoint；一旦会话中已经生成 case 明细，必须走 INLINE，避免 1 TestPoint = 1 Case 的直展逻辑覆盖掉「1 TestPoint → 多 TestCase」的真实用例范围。

---

## References

- `references/import-rules.md` — 跳过策略、refs 格式、BE 已知缺口
- API 契约：`CAWPLAN_QA_TESTING_API_CONTRACT.md` §3
