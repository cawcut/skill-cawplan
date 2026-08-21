---
version: 0.2.8
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
3. **Suite / Section 确认闸**：`mappings get` 后 **框 3（Suite）→ 框 3.5（Section 归属）**（顺序固定）须用户确认后才可 preview / convert。禁止静默使用 `default_suite_id`（不做推荐标注）或静默复用/推断 `parent_section_id`。`SUITE_NOT_IN_PROJECT`/`SECTION_NOT_IN_SUITE`/`SECTION_NOT_FOUND` → 停止。同会话已确认且未换 Suite/Section → 可复用（`import-rules §ConfirmState`）。框 3.5 **每次导入都问**，仅 Intent 显式命中或 ConfirmState 复用时免弹。**Version 全程无感**：不弹窗、不推断确认，仅 Intent 显式命中或用例自带值才写入，否则不传（结果里注明"未指定版本"）。
4. **用户展示**：`ux.md §Glossary`；`preview_id`/`job_id`/UUID 默认隐藏；跟随用户主语言；Agent 自行 `AskUserQuestion`（不写入 `allowed-tools`）。
5. **热接力**：P1/P1b → 自动 `INLINE`，跳过框 0、框 1（`ux.md §Trigger`）；**不跳过**框 3、框 3.5（除非 `ux §Intent` 显式命中 Suite/Section，或 `§ConfirmState` 复用）；Version 无感，不涉及跳过判断。
6. **INLINE body 组装**：数据来自同会话 `cawplan-testcase-generate` 时，禁止手写 camelCase→snake_case 转换脚本或逐条手算 `source_case_key`/`priority`——须先落一份与 A3 `csv-template-mapping.md` 同构的 interim JSON（camelCase，照抄字段，不做映射），**框 3/3.5 确认后**再用 `scripts/convert_generate_to_import.js` 转换为 body（`import-rules.md §Convert`）。`convert` 因个别用例 `steps`/`expected` 不合规失败时，Agent 可读取 `<out>.errors.json`、**征得用户同意后**从 interim JSON 摘除对应整条用例重跑（只删条目，不改内容值），不属于此处禁止的"手算字段"。
7. **异步 Job**（`to_create > 50`）：`execute` 成功后 **禁止默认 `jobs poll`**；须先走 `ux §AsyncHandoff` + 框 6。仅用户显式选「等到完成」才进入框 6b 等待循环。Job `RUNNING` 时 **禁止** 重复 `execute`。

## Reference 加载（MUST）

| 时机 | Read | 禁止 |
|------|------|------|
| 交互 / 路由 / Preview / 报告 / 错误 / 异步 | `ux.md` 对应 § | 一次性 Read 全部 references |
| body 字段 / 转换 / CLI / BE 缺口 / 异步 / 确认态 | `import-rules.md` 对应 § | — |

**禁止**：直连 TestRail API、持有 TestRail Key、跳过 preview。

## 允许命令

| 用途 | 命令 |
|------|------|
| 映射 | `qa-insights testrail mappings get <product_id>` |
| Section 查找（框 3.5 按名称查找时用） | `qa-insights testrail sections list <product_id> <suite_id> [--refresh]` |
| 新建 Suite（框 3「新增」分支用） | `qa-insights testrail suite-create <product_id> --name <name>` |
| 刷新 Requirement | `api GET .../qa/requirements/<id>`、`.../testpoints`（仅 REQUIREMENT 源） |
| INLINE 转换（同会话 A3 用例） | `node scripts/convert_generate_to_import.js <interim_json> --suite-id <n> [--version-name "x.x.x"] [-o <out.json>]` |
| 预览 | `qa-insights testrail import preview <product_id>` |
| 执行 | `qa-insights testrail import execute <product_id> --preview-id <id> --confirm` |
| 异步 | `jobs get`（默认，查 progress）· `jobs poll`（仅用户明确要求等到完成且接受长时间阻塞） |

## Workflow

| Step | 动作 | Detail |
|------|------|--------|
| **0** | 解析 `product_id`、数据源、`source.type` | `ux §Trigger` · `ux §Intent` · `import-rules §数据源` |
| **0.5** | 缺上下文 → 框 0/1 | `ux §Prompts` |
| **1** | `mappings get`；记录 `suites[]`、`default_suite_id` | `import-rules §Suite` |
| **1.5** | **框 3 Suite** → **框 3.5 Section 归属**（如选「已有」，`sections list` 匹配）（顺序固定；可复用 `§ConfirmState`） | `ux §SuiteConfirm` · `ux §SectionConfirm` · **先于** convert/preview |
| **2** | 组装 body（INLINE + A3 → interim JSON → `convert` 用已确认 `suite_id`/`parent_section_id`，`version_name` 若命中 Intent 或用例自带则一并带上） | `import-rules §body` · `§Convert` · `§Section` · `§Version` |
| **3** | `import preview`；`ux §Preview` 表头含 Suite+版本；存 `preview_id` | `to_fail>0` → 框 5，停止 |
| **4** | 框 4 执行闸（重复 Suite+版本） | `ux §Prompts` · `to_create>50` → `ux §AsyncEstimate` |
| **5** | `import execute --confirm` | 同步 → Step 7；`job_id` → Step 6a |
| **6a** | 异步交付（默认） | `ux §AsyncHandoff` · 框 6 · `import-rules §AsyncJob` |
| **6b** | 等到完成（可选） | `jobs get` 循环 · `ux §AsyncProgress` · `ux §AsyncTimeout` |
| **7** | 导入报告 | `ux §Result` |

**T1 衔接**：同会话 `cawplan-testcase-generate` → 本 Skill（INLINE）。落 interim JSON → **框 3/3.5 确认** → `convert_generate_to_import.js` → preview。Requirement 直导仅无 case 明细时。

**换 Suite / 换 Section 归属**：用户说换 Suite/Section → 清除对应 `§ConfirmState` → 重走框 3（连带清 Section）或框 3.5 → 须新 preview。**换版本**：用户提到新版本 → 直接更新 `confirmed_version_name`（无需弹窗）→ 须新 preview。

**异步续接**：同会话「查导入状态」→ `jobs get`（`ux §Intent`）；须已存 `job_id` + `product_id`。

## 错误（Agent）

| code | 处理 |
|------|------|
| `TESTRAIL_UNAVAILABLE` | `ux §Errors`；勿重复 execute |
| `PREVIEW_EXPIRED` | 重新 preview（Suite/版本仍有效则复用 `§ConfirmState`） |
| `SUITE_NOT_IN_PROJECT` | `ux §Errors`；停止 |
| `SECTION_NOT_IN_SUITE` / `SECTION_NOT_FOUND` | `ux §Errors`；重走框 3.5 |
| `SUITE_CREATE_RATE_LIMITED` / `SUITE_MODE_NOT_SUPPORTED` | `ux §Errors`；改走框 3「已有」分支 |
| `validation` / 缺 `source.type` | 自行修复；不向用户暴露 |
| `auth`/403 | `ux §Errors` |
| `UNKNOWN`（Job 超时） | `jobs get` 对账 · `ux §AsyncTimeout` |
| `CONFIRMATION_REQUIRED` | 补 `--confirm` |
| Job `RUNNING`（6a 后查状态） | `jobs get` → `ux §AsyncProgress`；勿重复 execute |

## References

- [ux.md](references/ux.md) — 友好名、路由、Suite/Section 确认、版本无感规则、Preview、异步、报告、错误
- [import-rules.md](references/import-rules.md) — 数据源、Suite/Section/Version、ConfirmState、body、Convert、CLI、异步 Job、BE 缺口
