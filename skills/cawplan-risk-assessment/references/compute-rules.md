# A5 Compute Rules

契约 §2.2、§8。与 `save-rules.md`、`ux.md` 配合；**禁止** workflow 开场与 `save-rules.md` 一并 Read。

---

## §0 上下文解析

| 输入 | 提取 |
|------|------|
| `/product/{product_id}/versions/{major}/{version_id}/overview` | `product_id`、**第二段** `version_id` |
| 用户口述产品/版本名 | `products list --search` → `versions list <product_id>` |
| 可选 `ticket_id` | 仅计算该 Ticket scoped Plan/Run |
| 可选 `plan_mapping_ids` | compute 加 `--plan-mapping-ids id1,id2` |

缺 product 或 version → 追问门户链接或名称；多匹配停步让用户选，禁止猜测。

**与 `cawplan-plan-track` 区别**：plan-track 的 `risk`/`risk_reason` 是排期维度，**不得**当作 A5 结论；但 `versions track` 的 `release_at`、`complete_percent` 可作为只读上下文（§Enrich）。
本 Skill 的 `risk_level` 仅来自规则引擎 compute。

---

## §Intent 意图分流

| 用户意图 | 路径 |
|----------|------|
| 发版风险 / 能不能发版 / 评估风险 | Step 2（按需）→ **compute** → **4b** → 报告 → 可选 save |
| 上次评估 / 已保存结论 / 不重算 | **get** → **4b** → 报告（标注已保存） |
| 保存风险结论 | 无本会话 compute → 先 compute 或 get 确认 → `save-rules.md` |
| 阈值 / 为什么 HIGH | **risk-rules get** + 结合 compute reasons |

同义词：发版风险评估 · release risk · can we release · version risk level · 版本风险等级

---

## §Rules 风险阈值（可选）

```bash
cawplan qa-insights risk-rules get <product_id>
```

展示关键阈值（友好名）：

| API 字段 | 默认 | 含义 |
|----------|------|------|
| `pass_rate_min` | 0.95 | 通过率低于此值 → 可触发 HIGH |
| `p1_open_failures_max` | 0 | P1 未闭环失败超出 → HIGH |
| `new_feature_unexecuted_rate_max` | 0.10 | 新功能未执行率 ≥10% → HIGH |
| `high_plus_open_tickets_max` | 0 | Version 内 High+ 未关闭 Ticket ≥1 → HIGH |

Skill **默认不**调用 `risk-rules set`（留给 QA Lead）。

---

## §Get 已保存评估

```bash
cawplan qa-insights risk-assessment get <product_id> <version_id>
```

- `data === null` → 告知尚无保存记录，询问是否 compute
- 有记录 → 走 **§Enrich（Step 4b）** → 按 `ux.md §Output`「已保存」变体展示；含 `saved_at`、`saved_by.display_name`、`risk_level`、`note`、`ai_summary`、`override_rule_engine`
- 用户随后要求重算 → 仍走 §Compute → §Enrich → 输出

---

## §Compute 重算风险

```bash
cawplan qa-insights testrail execution summary   # ❌ 不是 A5 入口
cawplan qa-insights risk-assessment compute <product_id> <version_id> \
  [--ticket-id <id>] \
  [--plan-mapping-ids <id1,id2>] \
  [--no-refresh-execution]
```

| 项 | 规则 |
|----|------|
| 默认 | **不传** `--no-refresh-execution`（CLI 默认 `refresh_execution: true`） |
| 接受缓存 | 用户明确要求时用 `--no-refresh-execution` |
| Ticket 范围 | `--ticket-id` |
| 编排批次 | `--plan-mapping-ids` 逗号分隔 |

读 `api.data`：`risk_level`、`rule_engine_version`、`computed_at`、`reasons[]`、`summary.execution`、`summary.runs`、`suggested_actions[]`。

### 等级优先级（取最高，SHALL）

| 等级 | 触发（摘要） |
|------|----------------|
| **CRITICAL** | Critical Case Failed/Blocked 未闭环；或 Smoke 未通过 |
| **HIGH** | 通过率低于阈值；P1 未闭环超标；新功能未执行率过高；High+ Ticket 未关闭 |
| **MEDIUM** | 其他 Failed；手工/自动化结论不一致；Flaky 偏高 |
| **LOW** | 以上均不满足 |

### `reasons[].code` 对照（展示用）

| code | 常见含义 |
|------|----------|
| `PASS_RATE_BELOW_MIN` | 通过率低于 `pass_rate_min` |
| `P1_FAILURES_OPEN` | P1 失败未关联已关闭 Ticket |
| `HIGH_PLUS_TICKETS_OPEN` | Version 内 High+ Ticket 未关闭 |
| `CRITICAL_CASE_OPEN` | Critical Case 失败未闭环 |
| `SMOKE_NOT_PASSED` | Smoke Run 未通过 |
| `NEW_FEATURE_UNEXECUTED_RATE_HIGH` | 新功能未执行率过高 |
| `OTHER_FAILURES` | 其他失败项 |
| `AUTO_MANUAL_MISMATCH` | 自动化与手工结论不一致 |
| `FLAKY_RATIO_HIGH` | Flaky 占比偏高 |

`message` 直接展示；`evidence` 中的 `caseIds`/`ticketIds` **不得**原样作为主文唯一信息——须走 §Enrich 补齐可执行字段（见 `ux.md`）。

### `suggested_actions` 排序

`BLOCKING` → `RECOMMENDED` → 其他；同级保持 API 顺序。
展示层可改写为人话 + 建议负责人（`ux.md §Actions`）；**保存 body 仍以 API 原文为准**，不得篡改 `risk_level`。

### Agent 解读（Step 5）

- **SHALL** 写 1–3 句摘要（`ux.md §Output` 顶部「摘要」块）；compute 阶段 `ai_summary=null` 正常
- 摘要第一句 **SHALL** 点明本次等级的**主因维度**（覆盖 / 质量 / Ticket / 时间）
- 若 `reasons` 含 `NEW_FEATURE_UNEXECUTED_RATE_HIGH`，摘要第一句 **SHALL** 强调**新功能执行覆盖率**（`1 - new_feature_unexecuted_rate`），**禁止**以通过率为第一句
- 若同时存在高通过率与低覆盖率，**SHALL** 显式对比两者分母，避免 PM 误判
- **禁止**修改 `risk_level`；**禁止**编造富化/API 中不存在的数据
- 持久化 `ai_summary` 优先交给 BE（save 时不传则由 GenAI 生成）

---

## §Enrich 只读富化（Step 4b）

在 Step 4 compute 或 Step 3 get 成功后、Step 5 输出前执行。所有富化数据须标注「只读上下文，不参与规则计算」。
**禁止**用富化结论覆盖或替代 `risk_level`。

### 触发条件（按 reason code 条件调用，可并行）

| 触发 | 命令 | 用途 |
|------|------|------|
| **始终**（compute 或 get 后输出报告） | `cawplan versions track <product_id> <version_id>` | `release_at`、距今天数、`complete_percent`、`status_counts` |
| `P1_FAILURES_OPEN` 或 `CRITICAL_CASE_OPEN` | `cawplan qa-insights testrail execution failures <product_id> <version_id> --limit 50` | 按 `evidence.caseIds` 过滤，取 case 名、URL、关联 ticket |
| `HIGH_PLUS_TICKETS_OPEN` | `cawplan tickets search --unique_ids <evidence.ticketIds 逗号分隔>` | 取 display_id、标题、status、assignee（**无需** `--time_range`） |

### `execution failures` 策略

1. 从 `reasons[].evidence.caseIds`（或 `case_ids`）收集待查 case ID。
2. 默认一次 Version 级 `failures`（`--limit 50`）；按 case ID 过滤匹配项。
3. 若 Version 级结果未覆盖全部 case ID，且 `summary.runs` 非空：仅对**含失败**的 Run 补调 `--run-id`（参考 A3 `execution.md §Failures`）。
4. 富化表字段见 `ux.md §Enrich`；查不到的 case 保留 ID 并标注「详情未返回」。

### `versions track` 字段

| 字段路径 | 展示 |
|----------|------|
| `detail.data.extra.target_release.release_at` | 目标发布日期（Unix → 可读日期） |
| 计算 | 距今天数：未来为「还剩 N 天」，过去为「已超期 N 天」；无 `release_at` →「未设置」 |
| `detail.data.progress.complete_percent` | 版本完成度 |
| `detail.data.progress.status_counts` | 可选：COMPLETE / 总数推算 |

**禁止**展示 `detail.data.risk` 或 `detail.data.risk_reason` 作为 A5 依据。

### `tickets search` 字段

对每个 `evidence.ticketIds`：`display_id`、标题、`status`、`priority`、`assignees`（display name）。
展示「High+ 未关闭 {open}/{high_plus_total_in_version}」时，`open` 来自 reason evidence count；`high_plus_total_in_version` 若 track/poll 不可得，可仅展示 open 数并注明。

### 阈值来源

- `pass_rate_min`：本会话已 `risk-rules get` 则用返回值，否则默认 `0.95`
- `new_feature_unexecuted_rate_max`：同上，默认 `0.10`
- 用于 runs 附录筛选（`ux.md §RunsAppendix`）及指标表阈值列

---

## §Output 计算结果模板（未保存）

完整模板见 **`ux.md §Output`**。本节仅保留关键约束：

- 主文 **SHALL** 分两层指标：① 测试覆盖（含新功能覆盖率，优先）② 已执行质量（含通过率，次要）
- 所有百分比 **SHALL** 标注分母（见 `ux.md`）
- `summary.runs` **禁止**出现在主文；仅 `ux.md §RunsAppendix` 条件允许时放附录
- 已保存记录（`get`）沿用同一模板，顶部追加 `saved_at` / `saved_by` / `override_rule_engine`

主文隐藏 `product_id`、`version_id`；用户要技术详情时再展开。

**A5 的 `pass_rate`** 来自 `summary.execution.pass_rate`（`passed/executed`）；与 A3「通过质量」不同，勿混用 A3 公式。
**`new_feature_unexecuted_rate`** 分母为版本 Requirement 映射的全部新功能用例，与 `pass_rate` 分母不同。
