# A2 Execution Rules

契约 §4.1、§4.1a、§4.2。与 `ux.md` 配合。

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

## §Preview 编排预览（Step 2）

```bash
cawplan qa-insights testrail plan preview <product_id> \
  --version-id <version_id> \
  --milestone-strategy AUTO \
  --milestone-name "<product_name> <version_name>" \
  [--ticket-id <id> | --ticket-ids <id1,id2>] \
  [--ticket-reuse-strategy AUTO|CREATE_ALL] \
  [--start-date YYYY-MM-DD --end-date YYYY-MM-DD]
```

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
| `tickets[].plan.action` / `runs[].action` | `CREATE` / `REUSE` |
| `summary.to_create_ticket_count` / `to_reuse_ticket_count` | 将新建 / 将复用工单数 |
| `summary.plan_count` / `run_count` | **仅将新建**（不含 REUSE） |
| `tickets[].warnings[].code` | `NEW_CASES_NOT_IN_RUN`（非阻断）· `STALE_MAPPING` |

**Execute**：`REUSE` Ticket 不写 TestRail、不新建 PlanMapping、不翻转 `is_latest`。响应 `mapping.reused_plan_mapping_ids` / `created_plan_mapping_ids`。

---

## §Milestone 策略（Step 2.1）

| strategy | 行为 |
|----------|------|
| `AUTO` | 默认；有 latest mapping → `REUSE`，否则 `CREATE` |
| `CREATE` | 强制新建 Milestone |
| `REUSE_LATEST` / `REUSE_BY_ID` | 显式复用 |

`AUTO` 且 `action=REUSE` → **必须** `ux.md` Milestone 交互后进决策闸。

`AUTO` + `ticket_reuse_strategy=AUTO`：已绑定 Ticket 复用 Run，**不**为二次编排重复创建 Run。

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
| `PREVIEW_EXPIRED` | 重新 preview |
| `CONFIRMATION_REQUIRED` | 补 `--confirm` |
| `PLAN_PREVIEW_TOO_LARGE` | 缩小范围 → `ux.md` |
| `TESTRAIL_UNAVAILABLE` | 稍后重试 |
| 阻断 gap | `ux.md §Gaps` |
