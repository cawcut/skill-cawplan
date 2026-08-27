---
version: 0.2.8
name: cawplan-ticket-report-generate
description: |
  Generate and upsert a Ticket-scoped QA Report (PROGRESS or COMPLETION) for any CawPlan Ticket (anchor) + Version: collect anchor-relative subtree/relation/execution data, apply result rules, render ticket-qa-report.1 template, and persist via existing Portal qa_report POST/PUT.
  Use when: SQA asks for a test progress or completion QA report for a ticket and version (Story, requirement sub-ticket, or BUGFIX); republish/update an existing linked report; include related/blocking tickets in report scope.
  NOT for: Version Quality Report or AQA automation rollup; release risk assessment (use A5 separately); importing cases (A1), plan layout (A2), or defect filing (A4).
  V1 zero-BE: Agent-side upsert; approximate coverage; anchor-relative subtree depth ≤ 3.
argument-hint: "[ticket portal link or display_id + version link or name + optional PROGRESS|COMPLETION]"
allowed-tools: Bash
---

# CawPlan Ticket QA Report — A7

```bash
cawplan skill check
```

## 语言（MUST）

按用户本轮主语言回复（中/英）；确认闸、预览、错误、结果表一致。**禁止**同段双语。HTML 节标题跟随回复语言。同义词：进度→`PROGRESS`；完成/sign-off→`COMPLETION`；更新/republish→PUT；发布→`status=approved`。

## 硬门禁（MUST）

1. **anchor** + `version_id`；任意层级/type 不阻断。
2. 落库仅 `qa_report` POST/PUT（`publish §Upsert`）；禁止 DB 新列/服务端 upsert。
3. Upsert：`list-version` 按 `ticket_id==anchor`；0→POST、1→PUT、>1→停步。
4. 子树：anchor **一次** `tickets get` + 本地展平 `children`（depth≤3）；depth≥4 静默裁剪；`sub_issue_count>0` 且无 `children`→`SUBTREE_TRUNCATED`。**禁止** `tickets list` 建子树。
5. 执行：scope **串行** `execution summary --refresh`；用 `pass_quality`；禁止 `pass_rate`/AQA。
6. coverage：`Σexecuted/Σtotal` 不去重；Coverage% **仅** Test Summary。**禁止**在 Test Approach 或 details 正文写覆盖率免责声明/脚注（如「注：覆盖率为近似值，按 Σ已执行/Σ总用例计算，未做跨工单用例去重。」及英文等价句）。
7. **Labels 延后（V2）**：分组仅用 `type`+`priority`；禁止为 labels 调 `tickets list`/批量 get。
8. Issue Summary / Verification / payload 细则见 `collect §ModeMatrix`、`§IssueSummary`、`§Buckets`；details 读者与 HTML compact 见 `publish §Audience`、`§HTML`、`html-example.md`。**Verification Status 仅统计子单 D1–D3，排除 anchor**（coverage/R1–R8 仍用全 `scope_ids`）。
9. Notes：优先 `data.parent`；缺失时 **1 次** `get(parent_id)`。
10. **双确认闸** Step 6→7；禁止跳闸。
11. **details 硬校验**：Step 5 组装 body 后 **MUST** `node scripts/validate_report_details.js --body-file …`；失败退回补全，**禁止** Step 6 预览/Step 7 落库（`publish §Gates` · `html-example.md`）。
12. 预览/落库：报告编号、报告工单 **必须**超链接（`publish §Links`）；隐藏 UUID。
13. 不得用 A5 作最终 Release Readiness。
14. **热接力**：同 anchor+version 未要求刷新→复用 `anchor_detail_cache`；execution 可复用，预览注明。

## Reference 加载（MUST）

**仅 Read 当前 Step 对应 §**（用 `## §` 标题定位）；**禁止** Read 全文 references。

| Step | Read |
|------|------|
| 0–2 | `collect` §0 · §Anchor · §Subtree · §Relation |
| 3, 7–8 | `publish` §Upsert · §Links · §Result · §Errors |
| 4 | `collect` §Execution |
| 5 | `collect` §Feature · §IssueSummary · §Buckets · §ModeMatrix · `publish` §Rules · §Template · §Audience · §HTML · `html-example.md` |
| 6 | `publish` §Gates（含 details 脚本校验闸） |

## 允许命令

`products list` · `versions list` · `config env` · `versions get` · `tickets get` · `tickets search --display_ids`（仅 Step 0）· `qa-insights requirements get` · `qa-insights testpoints list` · `api GET .../qa/module-tree` · `api GET .../qa/requirements` · `qa-reports list-version|create|update` · `qa-insights testrail execution summary --ticket-id --refresh` · `tickets history`（可选，见 `collect §IssueSummary`）· `node scripts/validate_report_details.js`（Step 5→6，MUST）

**禁止**：`tickets list`、`tickets relate list`、直连 TestRail、`cawplan api` 落库（Requirement 读除外）、`qa-insights` 写、A5 写入、静默跳闸。

## Workflow

| Step | 动作 | Detail |
|------|------|--------|
| **0** | 上下文；`portal_base`；`major_version_id` | `collect §0` |
| **1** | `tickets get` anchor→展平 children D1–D3、`relations`、`parent`→`anchor_detail_cache` | `collect §Anchor` · `§Subtree` |
| **2** | Relation 确认闸（读缓存；排除跨 version） | `collect §Relation` · `publish §Gates` |
| **3** | `list-version`→POST/PUT | `publish §Upsert` |
| **4** | 串行 execution；聚合 coverage | `collect §Execution` |
| **5** | feature_name、Issue Summary、分桶、R1–R8、compact HTML+payload；**`validate_report_details.js` 通过** | `collect §Feature` · `§IssueSummary` · `§Buckets` · `§ModeMatrix` · `publish §Rules` · `§Template` · `§Audience` · `html-example.md` |
| **6** | 预览 + 正文预览闸（**须 Step 5 校验已通过**） | `publish §Gates` |
| **7** | 落库发布闸 → `--body-file` | `publish §Upsert` |
| **8** | 落库结果 | `publish §Result` |

**Republish**：Step 3 命中→Step 7 PUT。**PROGRESS→COMPLETION**：同条 PUT，重跑 4–7。

## References

- [collect.md](references/collect.md)
- [publish.md](references/publish.md)
- [html-example.md](references/html-example.md) — compact 单行 HTML 完整示例（Step 5 排版参照）
