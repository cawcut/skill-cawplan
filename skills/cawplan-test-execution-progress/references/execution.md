# A3 Execution Rules

契约 §5.1、§5.2。与 `ux.md` 配合；**禁止** workflow 开场与 `ux.md` 一并 Read。

---

## §0 上下文与范围

| 输入 | CLI |
|------|-----|
| 门户 URL | 提取 `product_id`、`version_id`；名称用页面/用户口述或 list 反查 |
| 全版本（默认） | summary 仅 `--version-id` |
| 单工单 | `--ticket-id` |
| 单 Run | 先 summary，failures 仅 `--run-id` |
| 编排批次 | `--plan-mapping-id` 或 `--plan-mapping-ids` |
| 全 status 含 0 | `--include-zero-statuses` |
| 不要 refresh | 省略 `--refresh` |

缺 product/version → `ux.md` 入口交互。多匹配 → 停步选候选，禁止猜测。

**TestRail 链接**：Test 优先 `result_url`，fallback `…/tests/view/{test_id}`；Run 优先 `runs[].url`，fallback `…/runs/view/{run_id}`。文案：test_id / run_id 数字。

---

## §Summary 执行摘要（Step 1）

```bash
cawplan qa-insights testrail execution summary <product_id> <version_id> --refresh \
  [--ticket-id <id> | --plan-mapping-id <id> | --plan-mapping-ids <id1,id2>] \
  [--include-zero-statuses]
```

读 `aggregated`、`runs[]`、`statuses[]`。

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

```bash
cawplan qa-insights testrail execution failures <product_id> <version_id> \
  --run-id <run_id> --limit 20 --offset 0
```

3. `executed=0` 且无 failed/blocked 的 Run 不调 failures。
4. 无 `run_id` 全 Version 查询：仅风险 Run≤2、总量小且用户明确要求时。
5. **flaky**：默认不加 `--include-flaky`；用户明确要求时对目标 Run 加 `--include-flaky`（较慢），附录展示。
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
| `stale=true` 已 `--refresh` | 简短说明，不进健康度卡 → `ux.md` |
| `total=0` | 引导确认是否已 A2 → `ux.md` |
| `run_id` 不在 summary | 确认 Version/PlanMapping |
| failures 超 20 条 | `--offset` 分页或提示加载更多 |
| tests/view 要建缺陷 | 转 A4，不走 A3 `test_id` 模式 |
