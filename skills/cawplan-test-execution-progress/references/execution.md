# A3 Execution Rules

契约 §5.1、§5.2。与 `ux.md` 配合；**禁止** workflow 开场与 `ux.md` 一并 Read。

---

## §0 上下文与范围

| 输入 | capability 参数 |
|------|-----|
| 门户 URL | 提取 `product_id`、`version_id`；名称用页面/用户口述或 list 反查 |
| 全版本（默认） | summary 仅 `version_id` |
| 单工单 | `ticket_id` |
| 单 Run | 先 summary，failures 仅 `run_id` |
| 编排批次 | `plan_mapping_id` 或 `plan_mapping_ids` |
| 全 status 含 0 | `include_zero_statuses` |
| 不要 refresh | 省略 `refresh` |

缺 product → `ux.md` 入口交互。多匹配 → 停步选候选，禁止猜测。

### 版本解析（SHALL）

- **当前版本 / 未指定版本**：用户说「当前版本」或只给产品不给版本时，用已确认产品在 capability `products.list` 返回行中的 `inprogress_version_id` / `inprogress_version_name`，不再追问版本；回答中写明所用版本名（如「当前版本：{inprogress_version_name}」）。
- 该产品行的 `in_progress_versions` 多于一个时，在回答中列出其余进行中版本的名称，告知用户可指定切换；不自动逐个查询。
- `inprogress_version_id` 为空 → 告知该产品当前没有进行中版本，按 `ux.md` 入口交互请用户指定版本。
- **具名版本**：capability `versions.list`（`product_id`）按版本名精确匹配；多匹配 → 停步选候选。

### 范围闸（SHALL）

- 用户请求已点名版本（含「当前版本」，例：「当前版本的 A3 执行进度」）→ 范围即**全版本**，**不弹**范围闸，直接 Step 1。
- 仅当请求未表明范围、且可能需要按工单 / Run / 编排批次收窄时才弹范围闸（`ux.md §Prompts`）。

**TestRail 链接**：Test 优先 `result_url`，fallback `…/tests/view/{test_id}`；Run 优先 `runs[].url`，fallback `…/runs/view/{run_id}`。文案：test_id / run_id 数字。

---

## §Summary 执行摘要（Step 1）

capability `qa.testrail.execution.summary`：`product_id`、`version_id`、`refresh`=true；可选 `ticket_id` | `plan_mapping_id` | `plan_mapping_ids`（三者至多传一个）；可选 `include_zero_statuses`。

读 `aggregated`、`runs[]`、`statuses[]`（CLI 路由的返回包在 `api` 里：从 `api.data` 读；MCP 路由直接是 `data`）。

### 指标口径（SHALL）

| 指标 | 计算 |
|------|------|
| 执行进度 | `executed / total` |
| 通过质量 | `(passed + auto_passed + passed_with_issue) / executed` |
| 待闭环 | 去重 failures 队列统计（§Failures） |

```
auto_passed       = aggregated.status_counts?.auto_passed ?? 0
passed_with_issue = aggregated.status_counts?.passed_with_issue ?? 0
quality_passed    = aggregated.passed + auto_passed + passed_with_issue
pass_quality_rate = executed > 0 ? quality_passed / executed : 0
```

展示 `{quality_passed}/{executed} ({rate}%)`；不展开子项。主文**禁止** `stale`/`cached_at`/`pass_rate`。

---

## §Failures 失败列表（Step 2）

**触发**：`aggregated.failed>0` 或 `blocked>0`，或用户要失败详情。

1. 从 `runs[]` 筛 `stats.failed>0` 或 `stats.blocked>0` 的 `run_id`。
2. **每风险 Run 单独调用**（默认不传全 Version）：

capability `qa.testrail.execution.failures`：`product_id`、`version_id`、`run_id`、`limit`=20、`offset`=0。

3. `executed=0` 且无 failed/blocked 的 Run 不调 failures。
4. 无 `run_id` 全 Version 查询：仅风险 Run≤2、总量小且用户明确要求时。
5. **flaky**：默认不传 `include_flaky`；用户明确要求时对目标 Run 传 `include_flaky`=true（较慢），附录展示。
6. failures 无服务端缓存；不必单独强调 refresh。

**去重**：按 `test_id` 分组，保留 `created_on` 最大；其余→附录。

**排序**：priority Critical>High>Medium>Low → status → `created_on` 降序。

**原因摘要**：有 `comment` 截取 80 字；无 comment 则 BLOCKED/FAILED 固定短句（见 ux 模板）。

**待闭环计数**（去重后，不得用 aggregated 或 raw length）：

| 项 | 规则 |
|----|------|
| `n_failed` / `n_blocked` | 去重后各 status 条数 |
| `u_failed` / `u_blocked` | 去重且 `linked_ticket_id` 为空 |

健康度待闭环文案见 `ux.md §Output`。

### 工单进度状态标签

| 条件 | 标签 |
|------|------|
| `executed=0` | 未开始 |
| Failed/Blocked 且 Critical/High 未关联缺陷 | **有风险** |
| `executed<total` 且无高危未闭环 | 进行中 |
| `executed=total` 且无 Failed/Blocked | 可接受 |

### 执行构成 Top3

`status_counts` 降序 Top3；**排除** `auto_passed`、`passed_with_issue`；每项独立一行；label 用 `statuses[]`。

---

## 异常

| 场景 | 动作 |
|------|------|
| `stale=true` 已 `refresh` | 简短说明，不进健康度卡 → `ux.md` |
| `total=0` | 引导确认是否已 A2 → `ux.md` |
| summary 返回 `E_U_CORE_PRM_NOT_FOUND`（msg `NOT_FOUND`） | 该版本尚未关联 TestRail 测试计划（A2 编排未完成）。CLI：`outcome`=FAILURE 且 `api.code`=E_U_CORE_PRM_NOT_FOUND；MCP：工具错误，内容为同一 `{code,msg,data}`。该错误本身即表示未关联，不另调其他 capability 确认（`qa.testrail.mappings.get` 只返回产品级 TestRail 配置，无法判断单个版本是否关联）。随后按 `ux.md §Errors` 告知用户并给选项；**禁止**自行逐个换版本重试；不输出四层报告与文末 A4 句 |
| `run_id` 不在 summary | 确认 Version/PlanMapping |
| failures 超 20 条 | `offset` 分页或提示加载更多 |
| tests/view 要建缺陷 | 转 A4，不走 A3 `test_id` 模式 |
