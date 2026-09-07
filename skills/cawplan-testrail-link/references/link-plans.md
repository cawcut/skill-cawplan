# Workflow B — Link Plans（手工 Plan/Run 绑 Ticket）

> API：契约 §4.5 · CLI：`qa-insights testrail link plans preview|execute`

## §Context（Step 0）

| 字段 | 来源 |
|------|------|
| `product_id` | 门户链接 · `products list` |
| `version_id` | 版本链接 · `versions list` · 门户 Version URL |

缺 → `ux.md §Prompts` 框 B1。

## §MilestoneGate（Step 1 · SHALL）

```bash
cawplan qa-insights testrail milestone mapping-get <product_id> <version_id>
```

| `has_mapping` | 行为 |
|---------------|------|
| `true` | 继续 Step 2 |
| `false` | **停止**；展示固定文案（SHALL 逐字，可跟随用户语言二选一） |

**中文**：

> 当前版本尚未绑定 TestRail Milestone，无法关联 TestPlan/TestRun。请先通过「测试计划编排」（`cawplan-testplan-layout`）绑定或新建 Milestone，再执行 Plan/Run 链接。

**English**：

> This version is not bound to a TestRail Milestone yet. Use **Test Plan Layout** (`cawplan-testplan-layout`) to bind or create a Milestone first, then link Plan/Run.

**禁止**在 `has_mapping=false` 时调用 `link plans preview`。

API 若直接返回 `MILESTONE_NOT_BOUND`（HTTP 200）→ 同上文案。

## §CollectBindings（Step 2 · 框 B2）

**一次可收集 1 条或多条**；每条绑定需要：

| 入参 | 来源引导（框上正文） |
|------|----------------------|
| `ticket_id` | CawPlan 工单链接 · 门户 Ticket URL · `display_id`（如 CAWP-14460）→ `tickets search` **仅当**无法从 URL 解析时 |
| TestRail 目标 | Plan URL `/plans/view/{id}` · Run URL `/runs/view/{id}` · 或用户直接给 plan_id / run_id |

**解析规则（本地优先 · 降本）**：

```text
/plans/view/(\d+)     → plan_id={id}；run_ids 可空（BE 取 Plan 下全部 Run）
/runs/view/(\d+)      → plan_id=0；run_ids=[{id}]（Run-only）
用户只说 run 901       → plan_id=0；run_ids=[901]
用户只说 plan 55       → plan_id=55
```

**可选** `resolve-url`（仅 URL 复杂或需 Version 上下文时）：

```bash
cawplan qa-insights testrail resolve-url <product_id> --url "<testrail_url>"
```

**框 B2 循环**：

1. 追问一条：工单 + TestRail 链接（Other 输入）
2. 解析并入 `bindings[]` 草稿
3. `AskUserQuestion`：继续添加 / 开始预览 / 先不

**禁止**在未收集至少 1 条完整 binding 前调 preview。

## §BindingRules

| `plan_id` | 模式 | `run_ids` |
|-----------|------|-----------|
| `> 0` | Plan | 可选；空 = Plan 下全部 Run |
| `0` | Run-only | **必填**、非空 |

每条 binding JSON：

```json
{ "ticket_id": "<uuid>", "plan_id": 55, "run_ids": [201, 202] }
```

```json
{ "ticket_id": "<uuid>", "plan_id": 0, "run_ids": [305] }
```

## §PreviewCLI（Step 4）

**单条（flag 快捷）**：

```bash
cawplan qa-insights testrail link plans preview <product_id> \
  --version-id <version_id> \
  --ticket-id <ticket_id> \
  --plan-id <plan_id> \
  [--run-ids 901,902]
```

**多条（body 文件 · 推荐）**：

```json
{
  "version_id": "<version_uuid>",
  "bindings": [
    { "ticket_id": "<t1>", "plan_id": 55, "run_ids": [201] },
    { "ticket_id": "<t2>", "plan_id": 0, "run_ids": [305] }
  ]
}
```

```bash
cawplan qa-insights testrail link plans preview <product_id> --body-file link-plans-preview.json
```

成功 → 存 `preview_id`；展示 `ux.md §PreviewPlans`。

## §Supersede（Step 5–7）

当 `summary.supersede_required > 0` 或 binding 含 `TICKET_MAPPING_EXISTS` warning：

1. **框 B-supersede**（SHALL）：说明将替换哪几个工单的既有映射
2. 用户确认后 execute 加 `--supersede`

```bash
cawplan qa-insights testrail link plans execute <product_id> \
  --preview-id <preview_id> \
  --confirm \
  --supersede
```

未加 `--supersede` → `SUPERSEDE_REQUIRED`。

## §ExecuteCLI

```bash
cawplan qa-insights testrail link plans execute <product_id> \
  --preview-id <preview_id> \
  --confirm \
  [--supersede]
```

成功 → `ux.md §ResultPlans`；`plan_mapping_ids` 仅技术详情展示。

## §与 testplan-layout 边界

| Skill | 职责 |
|-------|------|
| `cawplan-testplan-layout` | **创建** Milestone / Plan / Run（A2 编排） |
| **本 Skill B** | TestRail **已手工存在**的 Plan/Run → **写** `PlanMapping` |
| Milestone 未绑定 | 必须先 layout，**不能**用本 Skill 绕过 |

## §下游

绑定成功后，`cawplan-test-execution-progress` 的 `execution/summary` 可聚合 Run-only（`plan_id=0`）记录。
