---
version: 0.2.6
name: cawplan-defect-ticket
description: |
  File or link CawPlan defects from failed/blocked TestRail Results via QA Insights A4.
  Use when: SQA wants to turn a TestRail Failed/Blocked Result into a CawPlan Ticket, paste a tests/view URL to file a defect, review an A4 defect draft, create a BUGFIX/FEATURE ticket, or link an existing ticket back to TestRail defects.
  Cold start with tests/view MUST call execution failures --test-id BEFORE defects draft; never use test_id as the draft path result_id.
  A4 write path (create-ticket) MUST use --body-file or --body JSON — never field flags like --description or --result-id.
  NOT for: importing test cases (use `cawplan-testcase-import`); creating TestRail Plans/Runs (use `cawplan-testplan-layout`); release risk assessment; generating requirements or test points.
argument-hint: "[TestRail tests/view URL or result_id + optional CawPlan/Version links]"
allowed-tools: Bash
---

# CawPlan Defect Ticket — A4 失败转缺陷

```bash
cawplan skill check
```

## 硬门禁（MUST）

1. **`tests/view` → `test_id`，不是 `result_id`**；冷启动必须先 `execution failures --test-id`，再 `defects draft`。
2. **`defects draft` / `create-ticket` / `link-ticket` 的路径 `<result_id>`** 只能来自 Step 0 `items[].result_id`（或 A3 热接力且 `result_id !== test_id`）。
3. **`create-ticket` = `--body-file` + `--confirm`**；禁止 `--description`、`--type`、`--result-id` 等字段 flag。
4. **双确认闸**：Step 2 决策闸 → `--dry-run` → Step 4/5 提交闸 → `--confirm`。禁止跳闸。
5. **用户展示**：友好字段名（`ux.md §Glossary`）；`result_id` 默认隐藏；Agent 自行 `AskUserQuestion`（不写入 `allowed-tools`）。

## Reference 加载（MUST）

| 时机 | Read | 禁止 |
|------|------|------|
| 开场 | 无 | 一次性 Read 全部 references |
| 冷启动 / URL / Step 0–1 | `execution.md` 对应 § | — |
| Step 1.5 | `execution.md §Title` | — |
| Step 2 / 4 / 5 确认与展示 | `ux.md` | — |

## 允许命令

| Step | 命令 |
|------|------|
| 0 | `execution failures … --test-id`；缺 version → `resolve-url` |
| 辅助 | `products list`、`versions list` |
| 1 | `defects draft`（字段 flag） |
| 4 | `defects create-ticket`（`--body-file`） |
| 5 | `defects link-ticket`（`--ticket-id`） |

**禁止**：`cawplan api`、无 `test_id` 的全 Version `failures`、Run 轮询、首轮要 Run 链接、`--include-flaky`（除非明确要求）、未确认写操作。

## Workflow

| Step | 动作 | Detail |
|------|------|--------|
| **0** | 解析上下文；冷启动 `failures --test-id`（首轮无 `--run-id`） | `execution §0` |
| **0.5** | 默认 `items[0]`；多 Result / 无 Result / 已关联 → 交互 | `ux §Prompts` |
| **1** | `defects draft`；占位 remarks → 回 Step 0 | `execution §1` |
| **1.5** | 标题精炼（`CREATE_NEW`）；`SKIP_BUG` 跳过 | `execution §Title` |
| **2** | 预览 + 决策闸（新建/关联/跳过/改标题） | `ux §Prompts` |
| **3** | `CREATE_NEW`→4；`LINK_EXISTING`→5；`SKIP_BUG`→停（可强制新建→4） | — |
| **4** | 组装 body → `--dry-run` → 提交闸 → `--confirm` | `execution §Create` |
| **5** | `link-ticket --dry-run` → 提交闸 → `--confirm` | `execution §Create` |

**可跳过 Step 0**：同会话 A3 `failures` 行含 `result_id`+`comment` 且 `result_id !== test_id`；或用户给的 `result_id` 非 tests/view 解析值。

## 输出

主文禁止默认展示 `result_id`、UUID、`recommendation`/`failure_category` 原始枚举。

```markdown
## 缺陷登记结果

| 项目 | 内容 |
|------|------|
| 用例 | {case_title} |
| TestRail 测试 | [{test_id}]({result_url}) |
| 目标版本 | {version_name} |
| 处理方式 | {新建缺陷 / 关联已有 / 暂不登记} |
| CawPlan 缺陷单 | [{display_id}]({ticket_url}) |
| 缺陷标题 | {final_description} |
| TestRail 回写 | {链接或「已关联」} |
```

用户要「技术详情」时再展开：`result_id`、`created_on`、`case_id`、`run_id`、`product_id`、`version_id`。

## References

- [execution.md](references/execution.md) — URL、Step 0–1、标题精炼、create/link body
- [ux.md](references/ux.md) — 字段友好名、AskUserQuestion、确认闸
