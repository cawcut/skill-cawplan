---
version: 0.2.6
name: cawplan-testcase-import
description: |
  Import QA test cases from CawPlan (Requirement/TestPoint or INLINE session cases) into TestRail with preview-first workflow.
  Use when: SQA wants to push T1-generated cases to TestRail; after test-point generation, expand cases and import; re-import after requirement updates (skip-only, no overwrite).
  NOT for: generating test points (use `cawplan-testpoint-generate`); archiving requirements (use `cawplan-requirement-analyze`); creating Test Plans/Runs (use `cawplan-testplan-layout`); failure-to-defect (use `cawplan-defect-ticket`); release risk (A5).
argument-hint: "[Product portal link or product_id + Requirement link or INLINE cases]"
allowed-tools: Bash
---

# CawPlan TestCase Import — A1 用例导入 TestRail

```bash
cawplan skill check
```

## 硬门禁（MUST）

1. **preview-first** → **框 4 执行闸** → `execute --confirm`；禁止跳闸。
2. **数据源**：已有展开用例 → `INLINE`；仅测试点 → `REQUIREMENT`。禁止 `source.type=VERSION`。
3. **Suite / Version**：preview 前 `mappings get` 校验 Suite；版本冲突先确认。`SUITE_NOT_IN_PROJECT` → 停止。
4. **用户展示**：`ux.md §Glossary`；`preview_id`/`job_id`/UUID 默认隐藏；跟随用户主语言；Agent 自行 `AskUserQuestion`（不写入 `allowed-tools`）。
5. **热接力**：P1/P1b → 自动 `INLINE`，跳过框 0、框 1（`ux.md §Trigger`）。

## Reference 加载（MUST）

| 时机 | Read | 禁止 |
|------|------|------|
| 交互 / 路由 / Preview / 报告 / 错误 | `ux.md` 对应 § | 一次性 Read 全部 references |
| body 字段 / 转换 / CLI / BE 缺口 | `import-rules.md` 对应 § | — |

**禁止**：直连 TestRail API、持有 TestRail Key、跳过 preview。

## 允许命令

| 用途 | 命令 |
|------|------|
| 映射 | `qa-insights testrail mappings get <product_id>` |
| 刷新 Requirement | `api GET .../qa/requirements/<id>`、`.../testpoints`（仅 REQUIREMENT 源） |
| 预览 | `qa-insights testrail import preview <product_id>` |
| 执行 | `qa-insights testrail import execute <product_id> --preview-id <id> --confirm` |
| 异步 | `qa-insights testrail jobs poll|get <product_id> <job_id>`（>50 CREATE） |

## Workflow

| Step | 动作 | Detail |
|------|------|--------|
| **0** | 解析 `product_id`、数据源、`source.type` | `ux §Trigger` · `ux §Intent` · `import-rules §数据源` |
| **0.5** | 缺上下文 → 框 0/1；缺版本/Suite → 框 2/3 | `ux §Prompts` |
| **1** | `mappings get`；Suite 门禁；T1 字段规范化 | `import-rules §Suite` · `§字段` · `§T1` · `§Version` |
| **2** | 组装 body；`source.type` 自检 | `import-rules §body` |
| **3** | `import preview`；展示预览表；存 `preview_id` | `import-rules §CLI` · `ux §Preview`；`to_fail>0` → 框 5，停止 |
| **4** | 框 4 执行闸 | `ux §Prompts` |
| **5** | `import execute --confirm` | `import-rules §CLI` |
| **6** | Job poll（>50 条） | `ux §Prompts` 框 6 · `ux §Errors` |
| **7** | 导入报告 | `ux §Result` |

**T1 衔接**：同会话 `cawplan-testcase-generate` → 本 Skill（INLINE）。Requirement 直导仅无 case 明细时。

## 错误（Agent）

| code | 处理 |
|------|------|
| `TESTRAIL_UNAVAILABLE` | `ux §Errors`；勿重复 execute |
| `PREVIEW_EXPIRED` | 重新 preview |
| `SUITE_NOT_IN_PROJECT` | `ux §Errors`；停止 |
| `validation` / 缺 `source.type` | 自行修复；不向用户暴露 |
| `auth`/403 | `ux §Errors` |
| `UNKNOWN`（Job 超时） | `jobs get` 对账 |
| `CONFIRMATION_REQUIRED` | 补 `--confirm` |

## References

- [ux.md](references/ux.md) — 友好名、路由、AskUserQuestion、Preview、报告、错误
- [import-rules.md](references/import-rules.md) — 数据源、字段、T1 转换、body、CLI、BE 缺口
