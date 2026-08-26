---
version: 0.2.8
name: cawplan-ticket-report-generate
description: |
  Generate and upsert a Ticket-scoped QA Report (PROGRESS or COMPLETION) for any CawPlan Ticket (anchor) + Version: collect anchor-relative subtree/relation/execution data, apply result rules, render ticket-qa-report.1 template, and persist via existing Portal qa_report POST/PUT.
  Use when: SQA asks for a test progress or completion QA report for a ticket and version (Story, requirement sub-ticket, or BUGFIX); republish/update an existing linked report; include related/blocking tickets in report scope.
  NOT for: Version Quality Report or AQA automation rollup; release risk assessment (use A5 separately); importing cases (A1), plan layout (A2), or defect filing (A4).
  V1 zero-BE: Agent-side upsert; approximate coverage; anchor-relative subtree depth ≤ 2.
argument-hint: "[ticket portal link or display_id + version link or name + optional PROGRESS|COMPLETION]"
allowed-tools: Bash
---

# CawPlan Ticket QA Report — A7

```bash
cawplan skill check
```

## 语言（MUST）

按**用户本轮输入主语言**回复（中文或英文）；确认闸、预览、错误、落库结果表与之一致。**禁止**同段中英双语并列。报告 HTML 节标题跟随回复语言（中文团队默认中文，如 `测试摘要` / `Test Summary` 二选一）。

意图同义词：进度/progress/测试进度→`PROGRESS`；完成/completion/sign-off→`COMPLETION`；更新/republish→PUT 同条；发布/publish→`status=approved`。

## 硬门禁（MUST）

1. **anchor** + `version_id`；任意层级、`FEATURE`/`BUGFIX` 均可（不阻断）。
2. 落库仅 Portal `qa_report` **POST/PUT**（`publish §Upsert`）；禁止假设 DB 新列或服务端 upsert。
3. Upsert：`list-version` 按 `ticket_id==anchor`；0→POST、1→PUT、>1→停步；允许多 anchor 并存。
4. 子树：**始终**相对 anchor **depth≤2**（anchor+D1+D2）——与 anchor 自身在工单树里的绝对层级无关，**不按绝对层级封顶**；跨 version 排除；DUPLICATE 永不纳入。D1 中 `sub_issue_count>0` 但未被 D2 查询覆盖到 → `SUBTREE_TRUNCATED`（`collect §Subtree`），不静默丢数据。
5. 执行：scope 内 ticket **串行** `execution summary --refresh`；用 `pass_quality`，禁止 `pass_rate`/AQA。
6. coverage：`Σexecuted/Σtotal` 不去重；正文标注近似覆盖率（Disclaimer 仅 Test Approach 一次）。
7. Labels：用 `tickets list/get` 的 `labels[].name`；**禁止** `tickets search` 取 labels。
8. Verification：桶级 `<ol>`、ticket 逐条 `<ul><li>`；空桶省略；末桶 `🚧 Under Development:`；COMPLETION Passed 为 1–5 测试点。
9. Notes：anchor 有 `parent_id` 时默认附直接父级链接。
10. **双确认闸**：正文预览闸（Step 6）→ 落库发布闸（Step 7）；禁止跳闸。
11. 预览/落库结果：报告编号、报告工单 **必须**门户超链接（`publish §Links`）；默认隐藏 UUID。
12. 不得引用 A5 风险结论作最终 Release Readiness。

## Reference 加载（MUST）

| 时机 | Read | 禁止 |
|------|------|------|
| Step 0–5 采集/聚合/分桶 | `collect.md` 对应 § | 一次性 Read 全部 references |
| Step 5–8 规则/模版/交互/落库 | `publish.md` 对应 § | — |

## 允许命令

`products list` · `versions list` · `config env` · `versions get` · `tickets get|list|search|relate list` · `qa-insights requirements get` · `qa-insights testpoints list` · `api GET .../qa/module-tree` · `api GET .../qa/requirements` · `qa-reports list-version|create|update` · `qa-insights testrail execution summary --ticket-id --refresh`

**禁止**：直连 TestRail、`cawplan api` 落库、`qa-insights` 写接口、A5 写入报告、静默跳过确认闸。

## Workflow

| Step | 动作 | Detail |
|------|------|--------|
| **0** | 解析上下文；`config env`→`portal_base`；`versions get`→`major_version_id` | `collect §0` · `publish §Links` |
| **1** | `tickets get` 校验 anchor；有 `parent_id` 则 get 父级 | `collect §Anchor` |
| **2** | 相对子树 depth≤2 + `relate list` → Relation 确认闸 | `collect §Subtree` · `§Relation` · `publish §Gates` |
| **3** | `qa-reports list-version` → POST vs PUT | `publish §Upsert` |
| **4** | 串行 `execution summary --refresh`；聚合 coverage | `collect §Execution` |
| **5** | feature_name、分桶、Issue Tracking、R1–R8、`template_payload`+HTML | `collect §Feature` · `§Buckets` · `§Issue` · `publish §Rules` · `§Template` |
| **6** | 预览 + **正文预览闸** | `publish §Gates` · `§Preview` |
| **7** | **落库发布闸** → `qa-reports create|update --body-file` | `publish §Upsert` |
| **8** | 落库结果（带超链接） | `publish §Result` |

**Republish**：Step 3 命中该 anchor → Step 7 仅 PUT。**PROGRESS→COMPLETION**：同条 PUT，重跑 Step 4–7。**热接力**：同会话已拉 summary 且未要求刷新 → 可复用，预览注明缓存。

## References

- [collect.md](references/collect.md) — 上下文、子树、relation、执行、labels、分桶
- [publish.md](references/publish.md) — 规则、模版、链接、确认闸、落库
