# A7 规则 · 模版 · 交互 · 落库

与 `collect.md` 配合。

## §Locale

回复语言 = 用户输入主语言（中/英）。确认闸选项、预览、错误、结果表、A4 引导句均用该语言。**禁止**同段双语。HTML 节标题与回复语言一致。

## §Rules COMPLETION 结果 R1–R8

评估：收集命中规则 → 取最严重 `suggested_result`：`failed` > `pass_with_issues` > `pass`。PROGRESS 的 `result` 可为 null。

**完成态** status：`COMPLETE`、`CLOSED`、`DONE`、`RESOLVED`、`WONT_FIX`、`CANCELLED`。未关闭 BUGFIX = type=BUGFIX 且不在上表。

| ID | code | 条件 | result |
|----|------|------|--------|
| R1 | CRITICAL_BLOCKER_OPEN | CRITICAL 未关闭 BUGFIX | failed |
| R2 | EXECUTION_FAIL_RATE_HIGH | executed≥10 且 (failed+blocked)/executed≥0.05 | failed |
| R3 | OPEN_BLOCKED_BY | 纳入 BLOCKED_BY 且 blocker 未完成 | failed |
| R4 | HIGH_PRIORITY_OPEN | HIGH 未关闭 BUGFIX≥1 | pass_with_issues |
| R5 | EXECUTION_ISSUE_RATE | passed_with_issue/executed≥0.03 或 failed≥1 | pass_with_issues |
| R6 | ANCHOR_NOT_COMPLETE | COMPLETION 且 anchor 未完成 | pass_with_issues + warning |
| R7 | RELATED_PENDING | 勾选 RELATED 未验证完 | pass_with_issues |
| R8 | DEFAULT_PASS | 未命中 | pass |

PROGRESS+anchor 已完成→warning `ANCHOR_ALREADY_COMPLETE`。衍生：`suggested_test_phase`（BLOCKED/IN_PROGRESS/COMPLETED）、`suggested_release_readiness`（HIGH_RISK/PENDING/READY）。Step 6 可覆盖 `result`。

**warnings[]**：`ANCHOR_NOT_COMPLETE`、`ANCHOR_ALREADY_COMPLETE`、`ANCHOR_IS_BUGFIX`、`SIBLING_REPORTS_EXIST`、`APPROXIMATE_COVERAGE`（始终）、`NO_MANUAL_RUN`、`MULTIPLE_QA_REPORTS_RESOLVED`、`STATUS_UNMAPPED`、`SUBTREE_TRUNCATED`（`collect §Subtree`，子树因类型盲区/跨 version/分页被截断）。

## §Template `ticket-qa-report.1`

输出 HTML `details` + meta 注释 JSON。`topic`：`[Progress]`/`[Completion]` + feature_name + 后缀。`type=sqa`。

```html
<!-- cawplan-ticket-report-meta
{"template_spec_version":"ticket-qa-report.1","report_mode":"PROGRESS","template_payload":{...}}
-->
```

**超链接**：`<a href="{portal_base}/issue/{display_id}">{display_id} — {title}</a>`（title=description≤80字）。Requirement 用 `{portal_base}{requirement.url}`。

**章节**（`<h2>` 按实际输出节连续编号，不用 `<table>`）：

1. **Test Summary**：Phase / Coverage（仅百分比）/ Objective（仅 anchor 一句）/ Result / Readiness / Critical Risks（无则写「无」）/ Overall Conclusion（COMPLETION 必填，点出核心场景+结论，禁空泛统计）
2. **Test Approach**：核心/基本核对场景叙事 + coverage 免责声明（**仅此一次**）
3. **Verification Status**：嵌套 `<ol>` 桶 + `<ul>` 逐条 ticket；见 `collect §Buckets`
4. **Issue Tracking**：priority→label→ticket 嵌套 `<ul>`
5. **可选链接**：Performance/JIRA/TestRail/Slack（有 `runs[].url` 则渲染 TestRail）
6. **Environment & Dependencies**
7. **Notes**：有父级→父 ticket 链接；有 Requirement→需求链接。L0 无 Requirement 可省略

**PROGRESS vs COMPLETION**：Passed 桶→ticket 列表 vs 1–5 测试点纯文本；Overall Conclusion 可选 vs 必填。

`links[]` 建议含 anchor、父级、TestRail Plan/Run URL。**元素类型是纯 URL 字符串**（`links: string[]`，如 `["https://portal/issue/CAWP-18593", "https://xxx.testrail.io/index.php?/runs/view/456"]`）——**不是** A4 缺陷单（Ticket 域）用的 `{title, url}` 对象数组，两个域字段形状不同，禁止照抄 A4 的写法（历史 bug：曾传对象数组导致 BE `json: cannot unmarshal object into Go struct field ... links of type string` 400）。

## §Links

| 对象 | URL |
|------|-----|
| Ticket | `{portal_base}/issue/{display_id}` |
| QA Report | `{portal_base}/product/{pid}/versions/{major_vid}/{vid}/overview/content?report={unique_id}&report-version={vid}` |

预览/落库结果中报告编号、报告工单 **必须** `[文字](url)`，禁止纯文本 QA-/CAWP-。

## §Gates

**Relation 确认（Step 2，拉 execution 前）**：默认全选 RELATED/BLOCKED_BY/BLOCKING；DUPLICATE 不出现。简表展示 relation。

**正文预览闸（Step 6）**：展示类型+feature_name+anchor、scope 摘要（D1/D2+relation 数）、coverage+脚注、Summary 核心行、Verification 桶计数+bullet、建议 result+warnings；update 时带报告/工单链接。选项：确认继续 / 改 result / 改正文 / 不落库。

**落库发布闸（Step 7）**：发布(`approved`) / 草稿 / 提交审批 / 取消。默认 approved。

**缺上下文**：缺工单→链接或 display_id；缺版本→链接或版本号；缺产品→列候选。

**多条报告**：同 anchor 匹配>1→列 `[display_id](url)`·topic·status，用户选定后 update。

## §Upsert

```bash
cawplan qa-reports list-version <product_id> <version_id>
```

过滤 `ticket_id==anchor.unique_id`：0→create，1→update，>1→`§Gates` 停步。

```bash
cawplan qa-reports create <product_id> <version_id> --body-file report-body.json
cawplan qa-reports update <product_id> <version_id> <qa_report_id> --body-file report-body.json
```

Body：`topic`、`type=sqa`、`details`（meta+HTML）、`result`、`status`、`ticket_id`=anchor、`links`、`date_start`。长 HTML **必须** `--body-file`。PUT 全量替换，保留 `display_id`。403→权限不足。

**Body 示例**（`links` 为 `string[]`，见 `§Template`）：

```json
{
  "topic": "[Progress] Apple Pass 门禁开门",
  "type": "sqa",
  "details": "<!-- cawplan-ticket-report-meta\n{\"template_spec_version\":\"ticket-qa-report.1\",\"report_mode\":\"PROGRESS\",\"template_payload\":{...}}\n-->\n<h2>Test Summary</h2>...",
  "result": "pass_with_issues",
  "status": "approved",
  "ticket_id": "01a0379f-3be4-7d35-af85-4f70afcf8640",
  "links": [
    "https://portal.example.com/issue/CAWP-18593",
    "https://xxx.testrail.io/index.php?/runs/view/456"
  ],
  "date_start": "2026-08-01"
}
```

## §Result

落库成功表（语言跟随 §Locale）：

| 项 | 内容 |
|----|------|
| 报告编号 | `[QA-xxxxx](report_url)` |
| 报告工单 | `[CAWP-xxxxx](ticket_url)` |
| 版本 / 类型 / 结果 / 近似覆盖率 / 操作 | … |

## §Errors

版本不匹配→换版本/取消；403→开权限；summary 失败→去 `--refresh` 重试/取消；落库失败→list-version 对账后 update/取消。
