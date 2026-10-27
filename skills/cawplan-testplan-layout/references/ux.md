# A2 UX — 字段友好名与用户引导

跟随用户**最近一条消息**主语言；禁止同段中英双语。Agent 自行 `AskUserQuestion`（不写入 `allowed-tools`）。

## §Glossary

`product_id`/`version_id`/`preview_id`/`job_id` **默认隐藏**。

| 内部 | 展示 |
|------|------|
| `has_mapping` | 已绑定里程碑 / 尚未绑定里程碑 |
| `milestone.action` CREATE/REUSE | 新建里程碑 / 复用里程碑 |
| `milestone_strategy` CREATE | 新建里程碑 |
| `milestone_strategy` REUSE_BY_ID | 绑定已有里程碑 |
| `milestone_id` | TestRail 里程碑 ID |
| `milestone.source` LATEST_MAPPING | 沿用本版本已绑定里程碑 |
| `cross_product_conflict` | 该里程碑已绑定其他产品（禁止跨产品） |
| `plan.action` / `runs[].action` CREATE/REUSE | 新建 / 复用已有 |
| `ticket_reuse_strategy` AUTO/CREATE_ALL | 增量编排（默认）/ 全量重建 |
| `run_type` MANUAL/AUTOMATED/SMOKE | 手工 / 自动化 / 冒烟 |
| `to_create_ticket_count` / `to_reuse_ticket_count` | 将新建工单 / 将复用工单 |
| `plan_count` / `run_count` | 将新建计划 / 将新建运行（**不含复用**） |

**意图同义词**：编排/layout plan · 确认执行/execute · 复用里程碑/reuse · 全量重建/CREATE_ALL/重建全部 Run · 取消/cancel · 导入用例/import cases

## §Intent

自由文本先匹配，命中则不弹对应框（须在 preview 表头回显确认值）：

| 用户表述 | 动作 |
|----------|------|
| 新建里程碑 / create milestone / 新增 milestone | `CREATE` → 跳过框 M；存 `§ConfirmState` |
| milestone 88 / 复用里程碑 88 / 绑定 milestone 88 | `REUSE_BY_ID` id=88 → **跳过框 M 与 validate**；存 `§ConfirmState` |
| 换里程碑 / change milestone | 清 `confirmed_milestone_*` → 重走 Step 1.5 + 框 M |

从 URL `…/milestones/view/88` 解析 ID `88`。

## §ConfirmState

| 字段 | 含义 |
|------|------|
| `confirmed_milestone_strategy` | `CREATE` / `REUSE_BY_ID` |
| `confirmed_milestone_id` | TestRail Milestone ID |
| `confirmed_milestone_name` | 展示用 |

- 换 `product_id` / `version_id` → 清全部
- 「换里程碑」→ 清 milestone 字段 → 框 M
- `PREVIEW_EXPIRED` 重 preview：未改策略则复用；改策略则清 milestone 字段

## §MilestoneFirstConfirm（框 M · Step 1.5a）

**触发（SHALL）**：`mapping-get` → `has_mapping=false`；且 `confirmed_milestone_strategy` 未设置；且 `§Intent` 未命中。

**免弹**：`has_mapping=true`；同会话 ConfirmState 有效且未换 product/version；`§Intent` 命中。

**框上正文**：

> 该版本在 CawPlan 中**尚未绑定 TestRail 里程碑**。请确认：新建里程碑，还是绑定你在 TestRail 已手动创建的里程碑？  
> 新建时默认名称：**{product_name} {version_name}**。

| label | description | 后续 |
|-------|-------------|------|
| 新建里程碑（推荐） | 在 TestRail 创建新里程碑 | `CREATE` preview |
| 绑定已有里程碑 | 提供 TestRail Milestone ID | 二级追问 ID → Step 1.6 validate → `REUSE_BY_ID` |
| 先不继续 | 取消本次编排 | 中止 |

**二级追问（绑定已有）**：

> 请提供 **TestRail Milestone ID**（可从里程碑 URL 获取，如 `…/milestones/view/88` → ID 为 `88`）。

确认后写入 `§ConfirmState`。

## §Gaps 阻断性（硬禁止 execute）

| code | 用户说明 | 选项 |
|------|----------|------|
| `NO_IMPORTED_CASE` | 部分需求尚未导入用例 | 去导入(A1) / 缩小范围 / 取消 |
| `NO_REQUIREMENT_LINKED` | 工单未关联需求 | 去关联 / 换工单 / 取消 |
| `NO_SUITE_MAPPING` | 缺少 Suite 映射 | 检查 A1 / 取消 |
| `NO_VERSION_TICKETS` | 版本下无可编排工单 | 确认版本 / 取消 |

## §Warnings 非阻断（须确认后继续）

| code | 用户说明 | 选项 |
|------|----------|------|
| `DUPLICATE_CASE_ACROSS_TICKETS` | 同一用例被多个工单命中 | 接受并继续 / 单工单重预览 / 取消 |
| `PLAN_PREVIEW_TOO_LARGE` | 编排范围过大 | 单工单 / 分批 / 取消 |
| `NEW_CASES_NOT_IN_RUN` | A1 后又导入 {n} 条用例，尚未纳入已有 Run | 接受复用 / 全量重建重预览 / 先不执行 |
| `STALE_MAPPING` | TestRail 上 Plan/Run 已不存在，将重新创建 | 了解并继续 / 取消 |

`NEW_CASES_NOT_IN_RUN`：展示 `new_case_count`；接受复用保留执行进度；全量重建 → preview 加 `--ticket-reuse-strategy CREATE_ALL`。

未确认 **不得** execute。

## §Prompts

1. 先 1–2 句框上正文，再 `AskUserQuestion`（`header`+`question`+`label`+`description`）
2. 不可用 → 编号降级；勿定义 `Other`
3. 双闸：预览决策闸 → 执行提交闸（`--confirm`）

| 场景 | option labels |
|------|---------------|
| 缺产品/版本 | 粘贴门户链接 / 产品名+版本名 / 提供 ID |
| 编排范围 | 全版本（默认）/ 单个工单 / 多个工单 |
| 首次 Milestone（框 M） | 新建里程碑（推荐）/ 绑定已有里程碑 / 先不继续 |
| Milestone 二次确认（Step 2.1） | 复用该里程碑（推荐）/ 新建里程碑 / 先不继续 |
| NEW_CASES 确认 | 接受复用（保留进度）/ 全量重建重预览 / 先不执行 |
| 用户要重建全部 Run | 全量重建重预览 / 保持增量 / 取消 |
| 预览决策闸 | 确认执行 / 调整范围重预览 / 调整策略重预览 / 先不执行 |
| 执行提交闸 | 确认在 TestRail 创建 / 先不创建 |

**框上正文（增量 preview）**：将复用里程碑 **{name}**；**{to_reuse}** 个工单沿用已有 Run，**{to_create}** 个工单将新建；已执行进度不会丢失。

**框上正文（首次 preview，CREATE）**：将**新建**里程碑 **{product_name} {version_name}**，并为各工单创建 Plan/Run。

**框上正文（首次 preview，REUSE_BY_ID）**：将**绑定**已有里程碑 **{name}（ID {id}）**，并为未绑定工单创建 Plan/Run。

## §Preview 展示

- **中文用户**：`| 工单 | 处理方式 Action | 计划/运行 | 用例数 | 说明 Notes |`
- **英文用户**：`| Ticket | Action | Plan/Runs | Cases | Notes |`

`plan.action`/`warnings` 用 §Glossary。汇总用 `to_reuse`/`to_create`；**勿**把 `plan_count` 当总数。表头或汇总须含 Milestone 策略与名称（框 M / Intent 确认值）。

## §Result 编排完成

| 项目 | 内容 |
|------|------|
| 复用工单 | {to_reuse} 个 |
| 新建工单 | {to_create} 个 · {plan_count} 计划 · {run_count} 运行 |

分表：复用工单（链接）· 新建工单（链接）。技术详情：`reused_plan_mapping_ids` / `created_plan_mapping_ids`。

## §Errors

| 场景 | 选项 |
|------|------|
| 预览已过期 | 重新预览 / 取消 |
| TestRail 不可用 | 稍后重试 / 取消 |
| 工单不在版本 | 换工单或版本 / 取消 |
| Milestone ID 无效 | 重新输入 / 改为新建 / 取消 |
| 跨 Product 冲突 | 换 ID / 改为新建 / 取消 |
| validate 时 TestRail 不可用 | 稍后重试 / 取消 |
