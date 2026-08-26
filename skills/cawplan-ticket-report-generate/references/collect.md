# A7 数据采集

与 `publish.md` 配合。链接拼接见 `publish §Links`。

## §0 上下文

| 输入 | 处理 |
|------|------|
| Ticket URL | 提取 `product_id`、`version_id`、`ticket_id`（或 `display_id`→`tickets search --display_ids`） |
| display_id + 版本名 | `products list` / `versions list` 反查 |
| `report_mode` | 用户显式 PROGRESS/COMPLETION；缺省 anchor 已完成→建议 COMPLETION，否则 PROGRESS |

缺 product/version/anchor → `publish §Gates` 索取。多匹配停步，禁止猜测。

**anchor**：用户指定报告工单；落库 `ticket_id` = anchor.`unique_id`。

Step 0 缓存：`portal_base`（`config env` Portal 行去尾 `/`）、`major_version_id`（`versions get` → `major_id ?? major_version_id ?? major_info.major_id ?? version_id`）、`product_id`、`version_id`、`anchor.*`。

## §Anchor Step 1

```bash
cawplan tickets get <product_id> <version_id> <anchor_id>
```

| 检查 | 失败 |
|------|------|
| 存在 | 404→停止 |
| `version_id` 匹配 | 不匹配→停止 |
| `parent_id` | 任意值允许 |

记录：`display_id`、`description`、`status`、`type`、`parent_id`、`label_names[]`（`§Labels`）。

**warning**（`template_payload.warnings[]`，不阻断）：`ANCHOR_IS_BUGFIX`（type=BUGFIX）；`SIBLING_REPORTS_EXIST`（同 Story/兄弟已有报告）。

有 `parent_id` → `tickets get` 父级，记 `parent_ticket`（Notes 用；L1 典型附 Story 链接）。

## §Subtree Step 2

以 anchor 为 D0，**始终**纳入相对 depth 0–2（anchor + 最多两代后代）；不上溯兄弟/叔辈。这条规则相对 anchor 生效,**不按 anchor 在整棵工单树里的绝对层级封顶**——不管 anchor 本身是 Story、L1 还是 L2/BUGFIX，都统一按"anchor+D1+D2"下探两代,而不是"anchor 越深、纳入越少"。

D1、D2 都须显式查询,不能只查 D1 就止步：

```bash
# D1：parent_id == anchor.unique_id
cawplan tickets list <product_id> <version_id> --type FEATURE [--page_size 100 --page_num N]
cawplan tickets list <product_id> <version_id> --type BUGFIX [--page_size 100 --page_num N]
# 本地过滤 parent_id == anchor.unique_id → D1[]

# D2：parent_id ∈ D1[].unique_id（对每个有 sub_issue_count>0 的 D1 工单都要覆盖到）
cawplan tickets list <product_id> <version_id> --type FEATURE [--page_size 100 --page_num N]
cawplan tickets list <product_id> <version_id> --type BUGFIX [--page_size 100 --page_num N]
# 本地过滤 parent_id ∈ D1[].unique_id → D2[]
```

均须同 version。`tickets search` 仅辅助过滤 `parent_ids`，**必须**用 list 按 `unique_id` 合并 `labels` 等字段。

**截断信号（`SUBTREE_TRUNCATED`，warning，不阻断）**：D1（或 D2）中任意工单响应自带 `sub_issue_count > 0`，但对应子单没有出现在下一层查询结果里——常见原因：子单类型不在 `FEATURE`/`BUGFIX`（见下）、跨 version、或分页未取全——记下该工单 ID，正文/预览须提示"范围已截断，遗漏 N 条子单"，不允许悄悄丢数据。

**类型盲区**：上面两条 `tickets list --type` 目前只覆盖 `FEATURE`/`BUGFIX`；若子单实际类型是 TASK/STORY 等其他类型,不管 depth 规则怎么定都会被整个漏查。遇到 `sub_issue_count>0` 但两种类型查询都没找到对应子单时，同样计入 `SUBTREE_TRUNCATED`。

子树 >50 open：PROGRESS→open 全量、complete 仅 `by_depth` 计数；COMPLETION→complete 纳入 Labels 总结。open = status 不在完成态（`publish §Rules`）。

## §Labels

`labels` 为对象数组：`label_names = labels.map(l=>l.name).filter(Boolean)`。**禁止**当 string[]；**禁止**用 `ticket.type` 或 `behavior` 作分组名。search **不返回** labels。空 labels → `tickets get` 补拉 → 仍无则「未分类」。

## §Issue

scope 内 `type=BUGFIX`：`priority`（CRITICAL→LOW）→ `label name` → ticket 超链接。多 label 各桶各列。写入 `issue_tracking.by_priority`。生成前抽查 1 条已知有 label 的 BUGFIX，若全「未分类」→ 停步回查。

## §Relation

```bash
cawplan tickets relate list <product_id> <version_id> <anchor_id>
```

| type | 默认 |
|------|------|
| RELATED / BLOCKED_BY / BLOCKING | ✅ 纳入 |
| DUPLICATE | ❌ 丢弃 |

纳入 relation 须 `tickets get` 校验同 product/version。`scope_ids = {anchor} ∪ D1 ∪ D2 ∪ confirmed_relations`。

## §Execution Step 4

对每个 `ticket_id ∈ scope_ids` **串行**：

```bash
cawplan qa-insights testrail execution summary <product_id> <version_id> --ticket-id <id> --refresh
```

| 指标 | 计算 |
|------|------|
| 单 ticket | `aggregated.executed/total` |
| 近似 coverage | `Σexecuted/Σtotal`（不去重 Case） |
| 通过质量 | `(passed+auto_passed+passed_with_issue)/executed` |

仅 Manual Run（`ticket_id` scoped）；不拉 AQA。`total=0`→记 0/0，预览标「无绑定 Manual Run」。汇总 `failed_sum`、`blocked_sum`、`passed_with_issue`、未关闭 BUGFIX（R1/R4 用）。

## §Feature Step 5

**feature_name**：① anchor 绑定 Requirement→`function_description` 或 `summary`；② 否则 `description` 首行≤120 字；③ 否则 `{display_id} {title}`。

**RequirementLookup**（anchor 优先，D1/D2 各自绑定也查）：

```bash
cawplan api GET .../qa/module-tree
cawplan api GET .../qa/requirements --query "module_tree_node_id=<node_id>"
```

按 ticket `unique_id` 过滤；缓存 module 列表。

**TestPoints**（命中 Requirement 的 scope ticket）：

```bash
cawplan qa-insights testpoints list <product_id> <requirement_id>
```

按 `group` 聚类。启发式：条数多+主路径标签→核心场景；条数少+技术轴标签→基本核对。COMPLETION：`key_test_points` 1–5 条（核心场景优先，去重精炼）；PROGRESS 不产出。

## §Buckets

scope ticket（含 relation）分桶（完成态见 `publish §Rules`）：

| key | 条件 |
|-----|------|
| `verified_failed` | BLOCKED/REOPEN 或完成态+失败突出 |
| `verified_pass_with_issue` | 完成态+`passed_with_issue>0` 或非 CRITICAL 缺陷证据 |
| `verified_passed` | 完成态+执行质量良好 |
| `under_active_testing` | QA_TESTING |
| `pending_verification` | READY_FOR_QA |
| `not_yet_submitted` | NOT_STARTED/IN_PROGRESS/NEED_BUILD |

优先级：failed > pass_with_issue > passed > status 桶。未映射 status→warning `STATUS_UNMAPPED`，默认 `not_yet_submitted`。

**渲染**：空桶整段省略，禁止 `（无）`；ticket 逐条 `<ul><li>` 超链接；PROGRESS 各桶列 ticket；COMPLETION Passed 用 `key_test_points` `<ul>` 纯文本（0 条整桶省略），pass_with_issue/failed 列 ticket（排除 total=0 的 BUGFIX）。

`template_payload.verification`：PROGRESS→`verified_passed[]` 有值、`key_test_points=[]`；COMPLETION 反之。
