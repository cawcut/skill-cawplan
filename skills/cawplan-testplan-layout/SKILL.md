---
version: 0.2.8
name: cawplan-testplan-layout
description: |
  Orchestrate CawPlan QA Insights TestRail test plans from Version/Ticket-scoped imported cases with preview-first workflow.
  Use when: creating or executing A2 TestRail Plans/Runs for a CawPlan version or one or more CawPlan tickets after cases have been imported.
  NOT for: importing test cases (use `cawplan-testcase-import`); generating test points; execution summaries; defect filing; release risk.
  Do NOT use `cawplan api GET /api/v1/public/openapi/product/{product_id}` to resolve product name — that route does not exist.
argument-hint: "[Product portal link or product_id + version_id + optional ticket_id/ticket_ids]"
allowed-tools: Bash
---

# CawPlan TestPlan Layout — A2 测试计划编排

```bash
cawplan skill check
```

## 硬门禁（MUST）

1. **preview-first**：禁止跳过 preview 直接 `plan execute`。
2. **execute 仅用 `preview_id`**；禁止 execute 前重算范围或改 Milestone / `ticket_reuse_strategy`。
3. **Milestone 名** = `{product_name} {version_name}`（禁止 `{version_name} - QA Execution`）。
4. **Ticket 增量编排**：默认 `ticket_reuse_strategy=AUTO`（BE 默认）；已绑定 Ticket `REUSE` 不新建 Run；全量重建须 preview 时显式 `--ticket-reuse-strategy CREATE_ALL`。
5. **阻断性 gap** → 硬禁止 execute。见 `ux.md §Gaps`。
6. **用户展示**：`ux.md §Glossary`；UUID/`preview_id` 默认隐藏；跟随用户主语言；Agent 自行 `AskUserQuestion`。
7. **双确认闸**：预览决策闸（Step 3）→ 执行提交闸（Step 5 `--confirm`）。
8. **plan-rules set**：仅 SQA 明确要求调整 R1–R7 时执行。

## Reference 加载（MUST）

| 时机 | Read | 禁止 |
|------|------|------|
| Step 0 / preview / execute CLI | `execution.md` | 一次性 Read 全部 references |
| 交互、preview、gap、确认闸 | `ux.md` | — |
| Milestone REUSE / 增量编排 | `execution.md §Incremental` · `ux.md §Prompts` | — |

## 允许命令

- `plan-rules get`（默认）；`plan-rules set`（仅用户明确要求）
- `plan preview`（可选 `--ticket-reuse-strategy`）、`plan execute`
- `products list`、`versions list`

**禁止**：`cawplan api`、链式 `&&`、手动传 `suite_id`、直连 TestRail。

## Workflow

| Step | 动作 | Detail |
|------|------|--------|
| **0** | 解析 `product_id`/`version_id`/名称；编排范围 | `execution.md §0` · 缺信息 → `ux.md §Prompts` |
| **1** | `plan-rules get`；用户要求才 `set` | `execution.md §Rules` |
| **2** | `plan preview`（默认 BE `AUTO`） | `execution.md §Preview` · `§Incremental` |
| **2.1** | `milestone.action=REUSE` → Milestone 交互 | `ux.md §Prompts` |
| **3** | 友好 preview（含 `plan.action`、增量 summary、warnings）→ **预览决策闸** | `ux.md`；`NEW_CASES_NOT_IN_RUN` 须确认 |
| **4** | 无阻断 gap 且过闸 → **执行提交闸** | `ux.md §Prompts` |
| **5** | `plan execute --preview-id … --confirm` | `execution.md §Execute` |

## 输出

主文禁止默认展示 UUID。`plan_count`/`run_count` = **将新建**（不含 REUSE）。

```markdown
## 测试计划编排结果 — {product_name} {version_name}

| 项目 | 内容 |
|------|------|
| 里程碑 | [{milestone.name}]({milestone.url}) |
| 工单范围 | {全版本 / ticket 列表} |
| 复用 | {to_reuse_ticket_count} 个工单沿用已有 Run |
| 新建 | {to_create_ticket_count} 个工单 · {plan_count} 计划 · {run_count} 运行 |

### 按工单
| 工单 | 处理方式 | 计划/运行 | 链接 |
|------|----------|-----------|------|
| {display_id} | 复用/新建 | … | [查看](url) |
```

用户要「技术详情」时再展开：`preview_id`、`plan_mapping_id`、`reused_plan_mapping_ids`、`created_plan_mapping_ids`。

## References

- [execution.md](references/execution.md) — 范围、CLI、Milestone、增量编排、R1–R7、execute
- [ux.md](references/ux.md) — 友好名、确认闸、gap/warning、AskUserQuestion
