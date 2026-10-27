# A7 规则 · 模版 · 交互 · 落库

与 `collect.md` 配合。

## §Locale

同 SKILL 语言节。

## §Rules COMPLETION 结果 R1–R8

命中取最严重：`failed` > `pass_with_issues` > `pass`。PROGRESS `result` 可 null。

完成态：`COMPLETE`、`CLOSED`、`DONE`、`RESOLVED`、`WONT_FIX`、`CANCELLED`。未关闭 BUGFIX=type=BUGFIX 且不在上表。

| ID | code | 条件 | result |
|----|------|------|--------|
| R1 | CRITICAL_BLOCKER_OPEN | CRITICAL 未关闭 BUGFIX | failed |
| R2 | EXECUTION_FAIL_RATE_HIGH | executed≥10 且 (failed+blocked)/executed≥0.05 | failed |
| R3 | OPEN_BLOCKED_BY | BLOCKED_BY 且 blocker 未完成 | failed |
| R4 | TICKET_OPEN | 未关闭 BUGFIX≥1 或 FEATURE≥1 | pass_with_issues |
| R5 | EXECUTION_ISSUE_RATE | pwi/executed≥0.03 或 failed≥1 | pass_with_issues |
| R6 | ANCHOR_NOT_COMPLETE | COMPLETION 且 anchor 未完成 | pass_with_issues + warning |
| R7 | RELATED_PENDING | RELATED 未验证完 | pass_with_issues |
| R8 | DEFAULT_PASS | 未命中 | pass |

PROGRESS+anchor 已完成→`ANCHOR_ALREADY_COMPLETE`。衍生 phase/readiness；Step 6 可覆盖 `result`。

**warnings[]**：`ANCHOR_NOT_COMPLETE`、`ANCHOR_ALREADY_COMPLETE`、`ANCHOR_IS_BUGFIX`、`SIBLING_REPORTS_EXIST`、`APPROXIMATE_COVERAGE`（仅 meta `warnings[]`/预览闸，**禁止**写入 details HTML）、`NO_MANUAL_RUN`、`MULTIPLE_QA_REPORTS_RESOLVED`、`STATUS_UNMAPPED`、`SUBTREE_TRUNCATED`、`ISSUE_SUMMARY_HISTORY_CAP`、`ISSUE_SUMMARY_LARGE_SCOPE`。

## §Audience details 正文（MUST）

面向 QA/RD/PM：**允许**业务结论、计数、模块名、建议、风险引导；**禁止**推理过程、内部字段名/payload key/warning code、Skill 步骤名、「样本不足/fallback/Top2」等生成规则自述；**禁止**覆盖率近似值/跨工单去重等免责声明脚注（含 Test Approach 末尾「注：…」类句子）。无数据→**隐藏段落**，不写占位。meta JSON 注释可含 payload（Portal 普通读者不见）。

## §Template `ticket-qa-report.1`

`details`=HTML + meta 注释。`topic`=`[Progress]`/`[Completion]`+feature_name。`type=sqa`。

```html
<!-- cawplan-ticket-report-meta {"template_spec_version":"ticket-qa-report.1","report_mode":"PROGRESS","template_payload":{...}} -->
```

**链接**：Ticket `{portal_base}/issue/{display_id}`，文案 `{display_id} — {title}`（≤80字）。Requirement `{portal_base}{requirement.url}`。

**章节**（`<h2>` 连续编号，不用 table）：

1. **Test Summary** — 每项 **独立** `<p>`，**禁止**用 ` · ` 将 Phase/Coverage/Result/Readiness 拼成一行。标签用 `<strong>` 分层（细则见下表）。COMPLETION 另须 **Overall Conclusion**（必填）。

   | 字段 | HTML 模式（MUST） | 说明 |
   |------|-------------------|------|
   | Phase | `<p><strong>Phase: {展示值}</strong></p>` | 标签与值 **同在** `strong` 内 |
   | Coverage | `<p><strong>Coverage: </strong>{百分比}</p>` | 标签在 `strong` 内、值在 `strong` 外；冒号后保留空格 |
   | Result | `<p><strong>Result: </strong>{展示值}</p>` | 同 Coverage |
   | Readiness | `<p><strong>Readiness: </strong>{展示值}</p>` | 同 Coverage |
   | Objective | `<p><strong>Objective: </strong>{anchor 一句}</p>` | 仅 anchor 目标一句 |
   | Critical Risks | `<p><strong>Critical Risks: </strong>{Top 1–2}</p>` | 有则写；无则 **省略整段** |
   | Overall Conclusion | `<p><strong>Overall Conclusion: </strong>{结论}</p>` | **仅 COMPLETION**；必填 |

   ```html
   <h2>Test Summary</h2><p><strong>Phase: In Progress</strong></p><p><strong>Coverage: </strong>100%</p><p><strong>Result: </strong>Failed</p><p><strong>Readiness: </strong>High Risk</p><p><strong>Objective: </strong>…</p><p><strong>Critical Risks: </strong>…</p>
   ```
2. **Test Approach** — **仅**场景叙事（核心/基本核对路径）；**禁止** coverage 百分比重复、免责声明、`注：` 脚注，及「覆盖率为近似值 / 未做跨工单用例去重 / approximate coverage」等任何等价表述
3. **Issue Summary** — `collect §IssueSummary` + `§ModeMatrix`；**子块标题统一 `<h5>`**（禁 `h3`）：Type Overview / Module Fragility / Collaboration Hotspots / Recommendations；COMPLETION 可选 Lesson Learned。Hotspots 结构见 `collect §IssueSummary`
4. **Verification Status** — **仅子单**（D1–D3）；桶 `ol>li>strong` → priority/type `ul>li>strong` → ticket `ol>li` 链接；**禁止**列出 anchor；末桶 Under Development；差异见 `collect §ModeMatrix`
5. **可选链接** — TestRail 等（有 `runs[].url`）
6. **Environment & Dependencies**
7. **Notes** — 父 ticket；Requirement 链接（可无）

**HTML 层级**：主节 `<h2>`；Issue Summary 子块 `<h5>`（禁 `h3`/`h4`）；Verification 桶有序 `ol`；priority/type 无序 `ul`+`strong`；ticket 有序 `ol`；Issue 正文与 Hotspots 子项用 `ul`/`li`；COMPLETION passed 测试点 `ul` 纯文本。空层省略。

**HTML 紧凑（硬性，MUST）**：生成的 HTML **必须**去除标签之间的换行/空白（compact 单行拼接，或落库前 `scripts/validate_report_details.js --minify` 压紧）。**禁止** pretty-print——Portal 富文本渲染器**不折叠**标签间空白，多余的 `\n` 会渲染成空行。完整压紧示例见 `references/html-example.md`；细则见 `§HTML`。

## §HTML details 紧凑格式（MUST）

Portal 富文本渲染器**不折叠**标签间空白；块级标签之间的 `\n`/空白会显示为额外空行。落库 HTML **必须** compact（标签间**零**换行/零垫空白），**禁止** pretty-print。

1. **禁止**标签之间任何换行/垫空白：`></` 之间**不得**出现 `\n` 或空格垫行（❌ `</h2>\n<p>` → ✅ `</h2><p>`）。meta 注释结束后**直接**接第一个 `<h2>`。
2. **禁止**连续空行：不用 `\n\n` 连接相邻块元素。
3. **禁止**空块：不写 `<p></p>`、`<br><br>`、连续 `<br>`、仅含空白的 `<p> </p>`。
4. **段内换行**：同一段落内用单个 `<br>`，**禁止**拆成多个 `<p>` 造成双空行（❌ `<p>A</p><p>B</p>` → ✅ `<p>A<br>B</p>` 或两条 `<li>`）。
5. **列表优先**：多行并列内容用 `<ul>/<ol>/<li>`，不用多个 `<p>` 堆叠。
6. **落库前校验**：`node scripts/validate_report_details.js --body-file report-body.json`；仅压紧换行可用 `--minify -o report-body.json`（**不**补全链接文案）。完整单行示例见 `html-example.md`。

```html
<!-- 正确：meta 与正文无空行间隔；Test Summary 每项独立 <p> + strong -->
<!-- cawplan-ticket-report-meta {...} -->
<h2>Test Summary</h2><p><strong>Phase: In Progress</strong></p><p><strong>Coverage: </strong>42%</p><p><strong>Result: </strong>pass_with_issues</p><p><strong>Readiness: </strong>中</p><p><strong>Objective: </strong>…</p>
<h2>Test Approach</h2><p>核心场景：…<br>基本核对：…</p>
```

```html
<!-- 错误：Portal 会出现多余空白行 -->
<!-- cawplan-ticket-report-meta {...} -->

<h2>Test Summary</h2>

<p>Phase: IN_PROGRESS</p>

<p>Coverage: 42%</p>
```

**`links[]`**：`string[]` 纯 URL（含 anchor、父级、TestRail）。**禁止** `{title,url}` 对象（历史 400）。

模式矩阵与 payload 字段见 `collect §ModeMatrix`、`§IssueSummary`、`§Buckets`。

## §Links

| 对象 | URL |
|------|-----|
| Ticket | `{portal_base}/issue/{display_id}` |
| QA Report | `{portal_base}/product/{pid}/versions/{major_vid}/{vid}/overview/content?report={unique_id}&report-version={vid}` |

预览/落库：报告编号、报告工单 **必须** markdown 链接。

## §Gates

**Relation（Step 2）**：读缓存 `relations`；默认全选同 version 的 RELATED/BLOCKED_BY/BLOCKING；DUPLICATE 不出现。简表：display_id · 类型 · 标题截断。

**details 发布前校验（Step 5→6，MUST，先于正文预览闸）**：组装 `report-body.json` 后 **必须**执行：

```bash
node scripts/validate_report_details.js --body-file report-body.json
```

失败→**停步退回** Step 5 补全，**禁止**进入 Step 6 预览或 Step 7 落库。校验项（脚本强制，非口头自审）：

| code | 条件 | 处理 |
|------|------|------|
| `HTML_TAG_NEWLINE` / `HTML_DOUBLE_NEWLINE` | `></` 间有 `\n` 或 `\n\n` | `--minify` 压紧或手工改 compact |
| `HTML_EMPTY_P` / `HTML_DOUBLE_BR` | 空 `<p>`、连续 `<br>` | 删除/合并 |
| `ISSUE_LINK_INCOMPLETE` | `/issue/` 的 `<a>` 文案**仅**匹配纯 `PREFIX-\d+`（无 ` — title`） | 补全为 `{display_id} — {title}`（≤80字） |
| `ISSUE_LINK_FORMAT` / `ISSUE_LINK_EMPTY_TEXT` | 文案空或不符合 display_id — title | 同上 |
| `TEST_SUMMARY_FLAT_LINE` | Phase/Coverage 等用 ` · ` 拼成一行 | 拆成独立 `<p>` + `<strong>` |
| `TEST_SUMMARY_*_FORMAT` | Phase/Coverage/Result/Readiness/Objective 等未按 §Template 分层 | 对照 `html-example.md` Test Summary 修正 |

对齐 A2 `review-checklist`：**规则写在文档里不够，发布前须有流程/脚本硬闸**。仅 `--minify` 可自动修标签间换行；**链接文案必须 Agent 补全后重跑校验**。

**正文预览闸（Step 6）**：**须先通过上表校验**。类型+feature+anchor；scope（`D1·D2·D3·relation`；`deeper_excluded` 若有则注明）；coverage 百分比（**无**免责声明句）；Summary 核心行；Issue 一行摘要；Verification 桶摘要（**仅子单 D1–D3，不含 anchor**；PROGRESS 无 passed）；result+warnings；update 时报告链接。选项：继续 / 改 result / 改正文 / 不落库。

**落库闸（Step 7）**：发布(`approved`) / 草稿 / 审批 / 取消。默认 approved。

缺上下文 / 多条报告→`publish` 索取或选定（>1 同 anchor 列链接·topic·status）。

## §Upsert

```bash
cawplan qa-reports list-version <product_id> <version_id>
# ticket_id==anchor：0→create，1→update，>1→停步
cawplan qa-reports create <pid> <vid> --body-file report-body.json
cawplan qa-reports update <pid> <vid> <qa_report_id> --body-file report-body.json
```

Body 字段：`topic`、`type=sqa`、`details`（meta+compact HTML，见 `§HTML` · `html-example.md`）、`result`、`status`、`ticket_id`=anchor、`links`（`string[]`）、`date_start`。长 HTML **必须** `--body-file`；写入前 **必须** `validate_report_details.js` 通过。PUT 全量替换，保留 `display_id`。403→权限不足。

## §Result

落库成功表：报告编号、报告工单（链接）、版本、类型、结果、近似覆盖率、操作（语言同 §Locale）。

## §Errors

版本不匹配→换版本/取消；403→开权限；summary 失败→`--refresh`/取消；落库失败→list-version 对账。
