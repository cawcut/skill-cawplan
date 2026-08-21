# A2 Execution Rules

契约 §4.0、§4.1、§4.1a、§4.2。与 `ux.md` 配合。

---

## §0 上下文与范围

**名称**：`milestone_name = "{product_name} {version_name}"`（preview 前必须确定）。

| 输入 | 动作 |
|------|------|
| 门户 URL | 提取 `product_id`、`version_id` |
| 仅 product 名 | `products list --search`；多匹配 → `ux.md` |
| 编排范围 | `version_id`=全版本；`+ticket_id`=单工单；`+ticket_ids`=多工单（互斥） |

**禁止** `cawplan api GET …/product/{id}`。

Preview 固化快照；execute **只**用 `preview_id`。

---

## §Rules 编排规则（Step 1）

默认 `plan-rules get <product_id>`。仅 SQA 明确要求时 `plan-rules set`。

| 规则 | 含义 |
|------|------|
| R1–R7 | 见 SKILL 契约；在 Ticket 候选 Case 集内执行 |

---

## §MilestoneProbe 绑定探测（Step 1.5）

在 `plan preview` **之前**调用；与 BE `AUTO` 判定同源。

```bash
cawplan qa-insights testrail milestone mapping-get <product_id> <version_id>
```

- 零 Query；读 envelope `meta.has_mapping` 与 `api.data`
- `has_mapping=true` → **跳过** `ux.md` 框 M；Step 2 使用 `--milestone-strategy AUTO`
- `has_mapping=false` → 进入 `ux.md §MilestoneFirstConfirm`（或 `§Intent` / `§ConfirmState`）
- `has_mapping=false` 时**禁止**直接 `--milestone-strategy AUTO` preview

---

## §MilestoneValidate ID 校验（Step 1.6）

仅当框 M 选「绑定已有」且 **未** 由 `§Intent` 命中 `REUSE_BY_ID` 时执行。

```bash
cawplan qa-insights testrail milestone validate <product_id> <milestone_id> \
  --version-id <version_id>
```

| 响应 / meta | 动作 |
|-------------|------|
| `valid=true` | 写入 `§ConfirmState` → Step 2 `REUSE_BY_ID` preview |
| `already_mapped_to_current_version=true` | 视为已绑定；清框 M 路径 → Step 2 `AUTO` |
| `cross_product_conflict=true` | `ux.md §Errors`；禁止 `REUSE_BY_ID` preview |
| `valid=false`（非跨 Product） | 重新输入 ID / 改新建 / 取消 |
| `TESTRAIL_UNAVAILABLE` | 稍后重试 / 取消 |

**Intent 命中 `REUSE_BY_ID`**：跳过本步，直接 Step 2 `REUSE_BY_ID`（仍须在 preview 表头回显 milestone id）。

---

## §MilestoneFirstLayout preview 策略（Step 2）

| 来源 | CLI |
|------|-----|
| `has_mapping=true`（Step 1.5） | `--milestone-strategy AUTO --milestone-name "<product_name> <version_name>"` |
| 框 M / Intent「新建」 | `--milestone-strategy CREATE --milestone-name "<product_name> <version_name>"` |
| 框 M「绑定已有」+ validate 通过 | `--milestone-strategy REUSE_BY_ID --milestone-id <testrail_milestone_id>` |
| Intent `REUSE_BY_ID`（免 validate） | `--milestone-strategy REUSE_BY_ID --milestone-id <id>` |

`milestone_strategy=CREATE` 时 `ticket_reuse_strategy` 无效，所有 Ticket `CREATE`。

---

## §Preview 编排预览（Step 2）

```bash
cawplan qa-insights testrail plan preview <product_id> \
  --version-id <version_id> \
  --milestone-strategy <AUTO|CREATE|REUSE_BY_ID> \
  --milestone-name "<product_name> <version_name>" \
  [--milestone-id <n>] \
  [--ticket-id <id> | --ticket-ids <id1,id2>] \
  [--ticket-reuse-strategy AUTO|CREATE_ALL] \
  [--start-date YYYY-MM-DD --end-date YYYY-MM-DD]
```

- `--milestone-name`：`CREATE` / `AUTO` 时使用；`REUSE_BY_ID` 可省略
- `--milestone-id`：仅 `REUSE_BY_ID` 必填
- 省略 `--ticket-reuse-strategy` → BE 默认 `AUTO`
- 全量重建 Run → `--ticket-reuse-strategy CREATE_ALL`（须重新 preview）
- 禁止传 `suite_id`、`run_templates`；`ticket_id` 与 `ticket_ids` 互斥

---

## §Incremental Ticket 增量编排（§4.1a）

| `ticket_reuse_strategy` | 行为 |
|-------------------------|------|
| `AUTO`（默认） | Milestone `REUSE` 时：已在该 Milestone 绑定 Plan/Run 的 Ticket → `plan.action=REUSE`；未绑定 → `CREATE` |
| `CREATE_ALL` | 忽略绑定，每 Ticket 均 `CREATE`（`is_latest` 翻转；旧 Run 进度从 A3 默认视图脱离） |

`milestone_strategy=CREATE` 时 `ticket_reuse_strategy` 无效，全 `CREATE`。

**Preview 必读**

| 字段 | 说明 |
|------|------|
| `milestone.source` | `NEW` / `LATEST_MAPPING` / `REQUESTED_ID` |
| `tickets[].plan.action` / `runs[].action` | `CREATE` / `REUSE` |
| `summary.to_create_ticket_count` / `to_reuse_ticket_count` | 将新建 / 将复用工单数 |
| `summary.plan_count` / `run_count` | **仅将新建**（不含 REUSE） |
| `tickets[].warnings[].code` | `NEW_CASES_NOT_IN_RUN`（非阻断）· `STALE_MAPPING` |

**Execute**：`REUSE` Ticket 不写 TestRail、不新建 PlanMapping、不翻转 `is_latest`。响应 `mapping.reused_plan_mapping_ids` / `created_plan_mapping_ids`。

---

## §Milestone 二次确认（Step 2.1）

| strategy | 行为 |
|----------|------|
| `AUTO` | 有 latest mapping → `REUSE`，否则 `CREATE` |
| `CREATE` | 强制新建 Milestone |
| `REUSE_BY_ID` | 显式绑定已有 TestRail Milestone |

**Step 2.1 触发（SHALL）**：`milestone_strategy=AUTO` **且** `milestone.action=REUSE` **且** `milestone.source=LATEST_MAPPING` → `ux.md` Milestone 二次确认后进决策闸。

**跳过 Step 2.1**：Step 1.5a 框 M 已确认；preview 使用 `CREATE` / `REUSE_BY_ID`；`validate` 返回 `already_mapped_to_current_version=true`。

`AUTO` + `ticket_reuse_strategy=AUTO`：已绑定 Ticket 复用 Run，**不**为二次编排重复创建 Run。

---

## §ConfirmState（同会话复用）

与 `ux.md §ConfirmState` 同步；Agent 内存维护，不落盘。

| 字段 | 含义 |
|------|------|
| `confirmed_milestone_strategy` | `CREATE` / `REUSE_BY_ID` |
| `confirmed_milestone_id` | `REUSE_BY_ID` 时的 TestRail ID |
| `confirmed_milestone_name` | 展示用（validate / preview 后回填） |

- 换 `product_id` / `version_id` → 清全部 ConfirmState
- 用户「换里程碑」→ 清 milestone 字段 → 重走 Step 1.5 + 框 M
- `PREVIEW_EXPIRED` 重 preview：milestone 确认仍有效则复用；用户改策略则清 milestone 字段

---

## §Execute 执行（Step 5）

```bash
cawplan qa-insights testrail plan execute <product_id> \
  --preview-id <preview_id> \
  --confirm
```

仅 `CREATE` Ticket 调用 TestRail 写接口；`REUSE` 回显已有链接。CLI `meta` 含 `reused_plan_mapping_ids` / `created_plan_mapping_ids`（若有）。

---

## 异常码（Agent）

| code | 动作 |
|------|------|
| `PREVIEW_EXPIRED` | 重新 preview（milestone ConfirmState 仍有效可复用） |
| `CONFIRMATION_REQUIRED` | 补 `--confirm` |
| `PLAN_PREVIEW_TOO_LARGE` | 缩小范围 → `ux.md` |
| `TESTRAIL_UNAVAILABLE` | 稍后重试 |
| `MILESTONE_NOT_FOUND` / `MILESTONE_NOT_IN_PROJECT` | validate 失败 → `ux.md §Errors` |
| `MILESTONE_CROSS_PRODUCT_CONFLICT` | `ux.md §Errors`；禁止 `REUSE_BY_ID` |
| `NOT_FOUND`（mapping-get version） | 换版本 / 取消 |
| 阻断 gap | `ux.md §Gaps` |
