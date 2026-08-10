# A1 用例导入规则与 BE 缺口（cawplan-testcase-import 必读）

## 已确认产品规则

| 规则 | Skill 行为 |
|------|------------|
| 只跳过、不覆盖 | preview 中 `SKIP` 不向 SQA 提供「强制更新」选项 |
| refs 幂等 | `cawplan:req_xxx;cawplan:tp_xxx;cawplan:case_xxx` — 只在完整用例级身份命中时 SKIP |
| Suite 门禁 | preview 前必须确认 `suite_id` 属于当前 Product 绑定的 TestRail Project；不通过则停止，不调用 preview/import |
| Version 门禁 | 用户明确指定导入版本时，preview 前必须写入 `version_name`；用例内版本冲突时先确认，不调用 preview/import |
| T1 priority 映射 | `P0→CRITICAL`、`P1→HIGH`、`P2→MEDIUM`、`P3/P4/P5/更低→LOW`；不得原样传 `P1` 到 preview |
| Milestone/Plan | A1 不涉及；A2 每次新建 |
| 自动化 Case | `automation_type` / `automation_result` 任一有值即写入自动化字段 |
| 重要性 | `importance` 仅使用 `Must Have` / `High` / `Medium` / `Low` 或 `1` / `2` / `3` / `4`；后端映射到 TestRail `custom_importance` 选项 ID |

## BE 实现状态（2026-08-06）

| 项 | 状态 | Skill 应对 |
|----|------|------------|
| `source.type=VERSION` | ❌ | 不用；按 Requirement 逐个导入 |
| `CONTENT_UNCHANGED` 跳过 | ❌ | 后续实现时必须限定在同一 `requirement_id + test_point_id + case_identity` 下 |
| tags → TestRail Label | ❌ | 不承诺 Label 同步；忽略 label 相关 warnings |
| Public Open API | ❌ | 使用 `cawplan qa-insights testrail`（Internal JWT） |
| 异步 Job >50 条 | ✅ | 必须 poll |
| `case_template_id` | ✅ | mappings get 可查看 |
| `SUITE_NOT_IN_PROJECT` | ✅ | 视为阻断错误；提示用户确认 Product Link / Suite ID / mappings |

## TestRail Case 字段写入

| INLINE 字段 | TestRail 字段 | 备注 |
|-------------|---------------|------|
| `title` | `title` | 必填 |
| `steps[]` | `custom_steps_separated` | Separate Steps |
| `preconditions` | `custom_preconds` | 可选 |
| `version_name` | `custom_case_version` | 用户在对话中指定版本时必填；INLINE 顶层与每条 case 保持一致 |
| `importance` | `custom_importance` | 后端将标签映射为整数 ID |
| `priority` | `priority_id` | Skill 先将 T1 `P0-Pn` 转为 LOW/MEDIUM/HIGH/CRITICAL |
| `automation_type` / `automation_result` | `custom_automation__*` | 有值才写 |
| `tags` | `label_id` | 未实现，不作为验收承诺 |

## TestPoint 一对多导入约束

- 一个 `test_point_id` 可展开为多条 TestRail Case，`test_point_id` 不能单独作为 SKIP / 幂等键。
- INLINE 用例建议提供稳定的 `source_case_key`；未提供时后端使用 `content_hash` 作为 `case_identity`。
- `REFS_EXISTS` 只有在 TestRail refs 同时包含 `cawplan:req_xxx`、`cawplan:tp_xxx`、`cawplan:case_xxx` 时才可跳过。
- `CONTENT_UNCHANGED` 只表示同一 `case_identity` 内容未变，不允许因为同一 TestPoint 已有任意 Case 而跳过其他用例。

## T1 用例数据转换

- T1 输入字段为 camelCase 时，写入 preview body 前必须转为 snake_case。
- `testPointId` → `test_point_id`；`requirementId` → `requirement_id`；`moduleTreeNodeId` → `module_tree_node_id`。
- `tag` → `tags: [tag]`。
- T1 的 `steps[]` 与 `expected[]` 按下标合并为 `{ "content", "expected" }`。
- `priority` 映射：`P0=CRITICAL`、`P1=HIGH`、`P2=MEDIUM`、`P3=LOW`；`P4`、`P5` 或任何大于 `P3` 的 `P{n}` 都映射为 `LOW`。
- 无法识别的 priority 值必须先向用户确认，不得原样发送到 preview。

## preview 字段说明

- preview 前必须先执行 `mappings get` 校验 Suite；如果用户指定的 `suite_id` 不在当前 Product 映射的 Project 下，直接向用户报错并停止，不能发起 preview。
- preview 前必须确认 `version_name`：用户对话中指定版本时，REQUIREMENT 源使用 `--version-name`，INLINE 源写入 body 顶层和每条 `cases[]`；若 case 内已有不同版本，先让用户确认正确版本。
- `action=FAIL`：必须修正数据后重新 preview，不得 execute
- `section_creates`：将新建 TestRail Section，需 SQA 确认命名
- `warnings`：展示但不阻断（除非伴随 FAIL）

## CLI 命令速查

```bash
cawplan qa-insights testrail mappings get <product_id>
cawplan qa-insights testrail import preview <product_id> [--source-type|--body-file]
cawplan qa-insights testrail import execute <product_id> --preview-id <id> --confirm
cawplan qa-insights testrail jobs get|poll <product_id> <job_id>
```
