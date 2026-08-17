# A2 UX — 字段友好名与用户引导

跟随用户**最近一条消息**主语言；禁止同段中英双语。Agent 自行 `AskUserQuestion`（不写入 `allowed-tools`）。

## §Glossary

`product_id`/`version_id`/`preview_id`/`job_id` **默认隐藏**。

| 内部 | 展示 |
|------|------|
| `milestone.action` CREATE/REUSE | 新建里程碑 / 复用里程碑 |
| `plan.action` / `runs[].action` CREATE/REUSE | 新建 / 复用已有 |
| `ticket_reuse_strategy` AUTO/CREATE_ALL | 增量编排（默认）/ 全量重建 |
| `run_type` MANUAL/AUTOMATED/SMOKE | 手工 / 自动化 / 冒烟 |
| `to_create_ticket_count` / `to_reuse_ticket_count` | 将新建工单 / 将复用工单 |
| `plan_count` / `run_count` | 将新建计划 / 将新建运行（**不含复用**） |

**意图同义词**：编排/layout plan · 确认执行/execute · 复用里程碑/reuse · 全量重建/CREATE_ALL/重建全部 Run · 取消/cancel · 导入用例/import cases

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
| `NEW_CASES_NOT_IN_RUN` | A1 后又导入 {n} 条用例，尚未纳入已有 Run | 接受复用 / 全量重建重预览 / 取消 |
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
| Milestone REUSE | 复用该里程碑（推荐）/ 新建里程碑 / 先不继续 |
| NEW_CASES 确认 | 接受复用（保留进度）/ 全量重建重预览 / 先不执行 |
| 用户要重建全部 Run | 全量重建重预览 / 保持增量 / 取消 |
| 预览决策闸 | 确认执行 / 调整范围重预览 / 调整策略重预览 / 先不执行 |
| 执行提交闸 | 确认在 TestRail 创建 / 先不创建 |

**框上正文（增量 preview）**：将复用里程碑 **{name}**；**{to_reuse}** 个工单沿用已有 Run，**{to_create}** 个工单将新建；已执行进度不会丢失。

## §Preview 展示

- **中文用户**：`| 工单 | 处理方式 Action | 计划/运行 | 用例数 | 说明 Notes |`
- **英文用户**：`| Ticket | Action | Plan/Runs | Cases | Notes |`

`plan.action`/`warnings` 用 §Glossary。汇总用 `to_reuse`/`to_create`；**勿**把 `plan_count` 当总数。

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
