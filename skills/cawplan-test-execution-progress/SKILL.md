---
version: 0.2.8
name: cawplan-test-execution-progress
description: |
  Query and summarize CawPlan QA Insights A3 TestRail execution progress for a Version or Run: execution rate, pass quality, deduplicated failure/blocker queue, and per-Ticket progress tables.
  Use when: A3 execution progress, test execution summary, TestRail run progress, execution summary, failure list, pass rate, untested count, status counts, custom status, 查询A3执行进度、查询Version测试进度、查询TestRail Run进度、执行摘要、失败列表、通过率、未执行统计、全status统计。
  NOT for: importing test cases, creating TestRail Plans/Runs, filing defects (use `cawplan-defect-ticket`), or release risk assessment.
argument-hint: "[product_id + version_id + optional run_id/ticket_id/plan_mapping_id]"
allowed-tools: Bash
---

# CawPlan Test Execution Progress — A3 执行进度查询

```bash
cawplan skill check
```

## 硬门禁（MUST）

1. **只读查询**：禁止 A1/A2/A4 写操作、`cawplan api`、直连 TestRail、`failures --test-id`（属 A4）。
2. **summary 默认 `--refresh`**；用户明确要求接受缓存时才省略。
3. **通过质量** = `(passed+auto_passed+passed_with_issue)/executed`；**禁止**展示 API `pass_rate`。
4. **待闭环**基于去重 failures 队列，**禁止**用 `aggregated.failed/blocked` 或 raw `items.length`。
5. **用户展示**：友好字段名（`ux.md §Glossary`）；`result_id`/UUID 默认隐藏；Agent 自行 `AskUserQuestion`（不写入 `allowed-tools`）。
6. **下钻闸**：已输出完整 4 层报告时**不弹**；仅健康度摘要或用户「简单看下」时弹（`ux.md §Prompts`）。
7. **A4 衔接**：行级（用户点行或说登记缺陷）+ 文末一句；**不**强制弹窗、不主动执行 A4。

## Reference 加载（MUST）

| 时机 | Read | 禁止 |
|------|------|------|
| 开场 | 无 | 一次性 Read 全部 references |
| 查询 / 指标 / failures 策略 | `execution.md` | — |
| 交互、输出模板、A4 衔接 | `ux.md` | — |

## 允许命令

- `execution summary`（默认 `--refresh`）
- `execution failures`（列表模式，`--run-id`）
- `products list`、`versions list`

## Workflow

| Step | 动作 | Detail |
|------|------|--------|
| **0** | 解析 product/version；范围闸（未指定时） | `execution.md §0` · `ux.md §Prompts` |
| **1** | `execution summary` | `execution.md §Summary` |
| **2** | 有风险 Run 分别 `failures`；去重排序 | `execution.md §Failures` |
| **3** | 四层报告（见 `ux.md §Output`） | 完整 4 层 → **不弹**下钻闸 |
| **4** | 用户点行/说登记缺陷 → 行级 A4 引导 | `ux.md §A4` |

**禁止**把 A3 总结当作 A5 风险结论。

## 输出概要

四层：① 执行健康度 ② 待处理 ③ 按工单进度 ④ 执行构成（+ 附录按需）。模板见 `ux.md §Output`。

文末固定一句 A4 提示（不弹窗）。用户要「技术详情」再展开 `result_id`、`plan_mapping_id` 等。

## References

- [execution.md](references/execution.md) — CLI、指标、failures、去重
- [ux.md](references/ux.md) — 友好名、按钮、输出、A4
