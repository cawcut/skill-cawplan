# A7 数据采集

链接见 `publish §Links`。

## §0 上下文

| 输入 | 处理 |
|------|------|
| Ticket URL | 提取 `product_id`、`version_id`、`ticket_id`（或 `display_id`→`search --display_ids`） |
| display_id + 版本名 | `products list` / `versions list` 反查 |
| `report_mode` | 显式 PROGRESS/COMPLETION；缺省 anchor 已完成→建议 COMPLETION |

缺上下文→`publish §Gates` 索取。多匹配停步。落库 `ticket_id`=anchor.`unique_id`。

Step 0 缓存：`portal_base`、`major_version_id`、`product_id`、`version_id`。Step 1 写 `anchor_detail_cache`（热接力复用）。

## §Anchor Step 1

同 anchor+version 且未要求刷新→复用 `anchor_detail_cache`，跳过 get。

```bash
cawplan tickets get <product_id> <version_id> <anchor_id>
```

404 / version 不匹配→停止。`parent_id` 任意。

**`anchor_detail_cache`**：`unique_id`、`display_id`、`description`、`status`、`type`、`priority`、`parent_id`；`children_tree`；`relations`（related/blocked_by/blocking/duplicate）；`parent_ticket`（`data.parent`）；`subtree_stats`（`§Subtree`）。

warning（不阻断）：`ANCHOR_IS_BUGFIX`；`SIBLING_REPORTS_EXIST`。

Notes 父单：优先 `data.parent`；仅 `parent` 缺失且有 `parent_id`→**1 次** `get(parent_id)`。**禁止**再调 `tickets list`、`relate list`。

## §Subtree Step 1b（本地，无额外 API）

anchor=D0，相对 depth 0–3 纳入；不上溯兄弟。与 anchor 绝对层级无关。

```text
flatten(children, depth=1): depth>3 → deeper_excluded+=count_subtree; return
  每节点→scope[D{depth}]；sub_issue_count>0 且无 children → SUBTREE_TRUNCATED
  有 children → flatten(children, depth+1)
```

记录：`unique_id`、`display_id`、`description`、`type`、`status`、`priority`、`parent_id`、`sub_issue_count`、`links[]`。不采集 labels（V2）。

D4+ 不纳入；`deeper_excluded` 仅预览可选展示。open=非完成态（`publish §Rules`）。子树>50 open：PROGRESS→open 全量；COMPLETION→complete 纳入 type 汇总。

## §Relation Step 2

仅读 `anchor_detail_cache.relations`。禁止 `relate list`。

| 类型 | 默认 | 过滤 |
|------|------|------|
| related / blocked_by / blocking | ✅ | `ticket.version_id==目标 version` |
| duplicate | ❌ | — |

跨 version 静默排除。`scope_ids = anchor ∪ D1–D3 ∪ confirmed_relations`（execution、coverage、R1–R8）。**Verification 分桶**另用 `verification_ids = D1 ∪ D2 ∪ D3`（**不含 anchor**、不含 relation）。缺字段罕见时再单条 get。

## §Execution Step 4

每个 `ticket_id ∈ scope_ids` **串行**：

```bash
cawplan qa-insights testrail execution summary <pid> <vid> --ticket-id <id> --refresh
```

单票 `executed/total`；coverage=`Σexecuted/Σtotal`；pass_quality=`(passed+auto_passed+passed_with_issue)/executed`。仅 Manual Run；`total=0`→0/0。汇总 failed/blocked/passed_with_issue、未关闭 BUGFIX（R1/R4）。Coverage% 写入 Test Summary；**禁止**在 Test Approach 追加近似覆盖率脚注。

## §Feature Step 5

**feature_name**：① Requirement→`function_description`/`summary`；② `description` 首行≤120；③ `{display_id} {title}`。

**RequirementLookup**（anchor + D1–D3）：`api GET module-tree` + `requirements?module_tree_node_id=`；按 ticket `unique_id` 过滤。

**TestPoints**（COMPLETION）：`testpoints list`；按 `group` 聚类→`key_test_points` 1–5（核心优先）；PROGRESS 不产出。

## §ModeMatrix（PROGRESS vs COMPLETION 唯一表）

| 维度 | PROGRESS | COMPLETION |
|------|----------|------------|
| Issue A Type Overview | 必出 | 必出 |
| Issue B Module Fragility | 条件；Top2/样本弱→1/无法→隐藏 | 同左 |
| Issue C Collaboration Hotspots | 条件；Dev/QA 各 Top2/1/隐藏 | 同左 |
| Issue D Recommendations | 2 条或 1 条/隐藏 | 3 条 + 可选 Lesson Learned 一句 |
| Verification 桶 | failed·pass_with_issue·active·pending·not_yet | + passed（测试点，无 priority/type） |
| Verification 对象 | **仅** D1–D3 子单；**排除 anchor** 与 relation | 同左 |
| Verification passed | **禁止** HTML/预览列出 | 1–5 `key_test_points` 纯文本 |
| `template_payload` | `issue_summary`+`verification`；禁 `issue_tracking` | +`lesson_learned?` |
| Overall Conclusion | 可选 | 必填 |

**priority 展示**：CRITICAL→Critical(1)…LOW→Low(4)，空→Unspecified(5)。

**type 展示**：BUGFIX→BugFix(1)，FEATURE→Feature(2)，其他原样字母序。

**Verification 桶顺序**（空桶跳过）：failed→pass_with_issue→（COMPLETION：passed/key_test_points）→active_testing→pending_verification→not_yet_submitted。

PROGRESS：`verified_passed` 仍可分桶供 R1–R8/coverage，但**不得**进 Verification HTML/预览 Passed；可选 `verified_passed_count`。

## §IssueSummary Step 5b

质量洞察（非工单清单）。读者规范：`publish §Audience`。

**对象**：D1–D3 + relation BUGFIX；anchor 仅 Part A。

**字段**：type、priority、status、assignees/reporter（**仅计数**）、parent、祖先 FEATURE、`module_tree_node`（RequirementLookup）、`root_cause`（BUGFIX，多来自 anchor get）、execution、links[]。不采集 labels。

**模块 fallback**：① Requirement.module_tree 名 → ② 祖先 FEATURE description≤60 → ③ Unscoped。正文仅可读模块名。

**history（默认不拉）**：仅 REOPEN/BLOCKED 或 CRITICAL/HIGH BUGFIX 或同模块 BUGFIX≥3；上限 20 票→`ISSUE_SUMMARY_HISTORY_CAP`。子任务>80→B/C 仅 Top2→`ISSUE_SUMMARY_LARGE_SCOPE`。

**易损分（内部，不写 details）**：`bugfix×2 + critical_high×3 + reopen×4 + open_bugfix×1 + (failed+pwi)×1.5`

| Part | 必出/隐藏 | 条数 |
|------|-----------|------|
| A Type 计数 | 必出；无链接 | — |
| B 模块易损 | 子任务≥3且BUGFIX≥2且模块≥2→展示；否则 1 模块+BUGFIX≥2→1 条；无→**隐藏整段** | Top2 或 1 |
| C Collaboration Hotspots | 同模块 Dev≥2 / QA≥3；双侧无→隐藏 Part C | 每侧 Top2 或 1 |
| D 建议 | 有 B/C→2(PROGRESS)/3(COMPLETION)；仅 A→1；子任务<3且无 BUGFIX→隐藏 | — |

匿名；默认无链接；必要时每块最多 1 条 BugFix。Insight 1–2 句、基于数字。

**Issue Summary HTML（MUST）**：

| Part | 标题标签 | 标题文案（中/英随 §Locale） |
|------|----------|------------------------------|
| A | `<h5>` | Type Overview / 类型概览 |
| B | `<h5>` | Module Fragility / 模块易损 |
| C | `<h5>` | **Collaboration Hotspots** / 协作热点 — **仅此**，禁 `(Development)`、`(QA)`、`QA Filing` 等括号后缀 |
| D | `<h5>` | Recommendations / 建议 |
| Lesson | `<h5>` 或段内一句 | Lesson Learned（COMPLETION 可选） |

**Part C 结构**（双侧或单侧均适用）：

```html
<h5>Collaboration Hotspots</h5>
<ul>
  <li><strong>Development</strong> …洞察句或子 <ul>…</ul></li>
  <li><strong>QA</strong> …</li>
</ul>
```

- Dev 与 QA **均有**热点 → 同一 `<h5>Collaboration Hotspots</h5>` 下用 **两个** `<li><strong>Development</strong>` / `<li><strong>QA</strong>` 子项（**禁止**拆成两个带括号后缀的 `<h5>`）。
- **仅一侧**有热点 → 仍只一个 `<h5>Collaboration Hotspots</h5>`；可只列对应 `<li><strong>Development</strong>` 或 `<li><strong>QA</strong>`，或直接 `<ul>` 列要点（无 Development/QA 字样亦可）。
- **禁止**：`<h5>Collaboration Hotspots (Development)</h5>`、`<h3>…</h3>`、并列两个 Hotspots 标题。

**`issue_summary` payload**：`type_overview`、`fragile_modules[]`、`dev_hotspots[]`、`qa_hotspots[]`、`recommendations[]`、`lesson_learned?`（数组空→对应 Part 不渲染；HTML 仍遵守上表 `<h5>` 与 Part C 嵌套规则）。

## §Buckets

**分桶对象**：`verification_ids`（D1–D3 子单，**不含 anchor**、不含 relation）。execution/coverage/R1–R8 仍用全 `scope_ids`。

完成态见 `publish §Rules`。优先级：failed > pass_with_issue > passed > status 桶。未映射→`STATUS_UNMAPPED`→`not_yet_submitted`。

| key | HTML | 条件 |
|-----|------|------|
| `verified_failed` | ❌ Verified & Failed | BLOCKED/REOPEN 或完成态+失败突出 |
| `verified_pass_with_issue` | ⚠️ Verified & Passed with Issue | 完成态+pwi>0 或非 CRITICAL 缺陷证据 |
| `verified_passed` | ✅ Verified & Passed | 完成态+执行质量良好 |
| `under_active_testing` | 🔍 Under Active Testing | QA_TESTING |
| `pending_verification` | ⏳ Pending Verification | READY_FOR_QA |
| `not_yet_submitted` | 🚧 Under Development | NOT_STARTED/IN_PROGRESS/NEED_BUILD |

桶内 **priority → type → ticket** 嵌套（已完成桶同样）。禁 Issue Tracking。空层/空桶省略，禁 `（无）`。同组内 ticket 按 `display_id` 序。

渲染：PROGRESS 禁 passed 桶；COMPLETION passed→`key_test_points` `<ul>`；pass_with_issue/failed 排除 total=0 的 BUGFIX。HTML 骨架见 `publish §Template`。

**`verification` payload**：桶→priority→type→uuid[]（uuid **仅**来自 `verification_ids`）；禁 `issue_tracking`。COMPLETION：`key_test_points` 1–5，passed 桶不列 uuid。PROGRESS：`key_test_points=[]`，可选 `verified_passed_count`（计数亦不含 anchor）。
