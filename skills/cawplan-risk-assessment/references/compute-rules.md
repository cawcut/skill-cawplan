# A5 Compute Rules

契约 §2.2、§8。与 `save-rules.md`、`ux.md` 配合；按步骤需要时 Read，**禁止**开场一次性 Read 全部 references。
每个 capability 的 CLI / MCP 参数与示例见 `CAPABILITIES.md`。

**返回读取**：`qa.*` capability 在 CLI 路由返回 `{outcome, command, meta, api}`，从 `api` 读 Open API 信封 `{code, msg, data}`（`outcome` 为 SUCCESS / FAILURE）；带 `dry_run` 的 save 不调用服务端，只返回 `{outcome, command, meta, post_body}`，读 `post_body`、没有 `api`；MCP 路由直接返回 `{code, msg, data}`。下文「`data`」均指该信封的 `data`（CLI 路由即 `api.data`）。`versions.get`、`tickets.search` 两条路由都直接返回 `{code, msg, data}`。

---

## §0 上下文解析

| 输入 | 提取 |
|------|------|
| `/product/{product_id}/versions/{major}/{version_id}/overview` | `product_id`、**第二段** `version_id` |
| 用户口述产品/版本名 | capability `products.list`（`search`）→ capability `versions.list`（`product_id`） |
| 可选 `ticket_id` | 仅计算该 Ticket scoped Plan/Run |
| 可选 `plan_mapping_ids` | compute 传 `plan_mapping_ids`（CLI 路由逗号分隔；MCP 路由为字符串数组） |
| 「当前版本」/ 未指定版本 | 已确认产品在 capability `products.list` 返回中的 `inprogress_version_id` / `inprogress_version_name` |

**当前版本规则**：用户说「当前版本」或未给版本时，用已确认产品的 `inprogress_version_id` 作为 `version_id`，并在回答中写明所用版本名（`inprogress_version_name`）。若该产品的 `in_progress_versions` 含多个版本，列出其余版本名，告诉用户可切换。产品无 `inprogress_version_id` → 追问版本（可用 capability `versions.list` 列出候选）。

缺 product 或 version（且不适用当前版本规则）→ 追问门户链接或名称；多匹配停步让用户选，禁止猜测。

**与 `cawplan-plan-track` 区别**：plan-track 的 `risk`/`risk_reason` 是排期维度，**不得**当作 A5 结论；但 capability `versions.get` 返回的 `release_at`、`complete_percent` 可作为只读上下文（§Enrich）。
本 Skill 的 `risk_level` 仅来自规则引擎 compute。

---

## §Intent 意图分流

| 用户意图 | 路径 |
|----------|------|
| 发版风险 / 能不能发版 / 评估风险 | Step 2（按需）→ **compute** → **4b** → 报告 → 可选 save |
| 上次评估 / 已保存结论 / 不重算 | **get** → **4b** → 报告（标注已保存） |
| 保存风险结论 | 无本会话 compute → 先 compute 或 get 确认 → `save-rules.md` |
| 阈值 / 为什么 HIGH | capability `qa.risk_rules.get` + 结合 compute reasons |

同义词：发版风险评估 · release risk · can we release · version risk level · 版本风险等级

---

## §Rules 风险阈值（可选）

capability `qa.risk_rules.get`（`product_id`）。阈值从 `data` 读（CLI 路由 `api.data`，MCP 路由 `data`）。

展示关键阈值（友好名）：

| API 字段 | 默认 | 含义 |
|----------|------|------|
| `pass_rate_min` | 0.95 | 通过率低于此值 → 可触发 HIGH |
| `p1_open_failures_max` | 0 | P1 未闭环失败超出 → HIGH |
| `new_feature_unexecuted_rate_max` | 0.10 | 新功能未执行率 ≥10% → HIGH |
| `high_plus_open_tickets_max` | 0 | Version 内 High+ 未关闭 Ticket ≥1 → HIGH |

Skill **默认不**修改风险规则阈值（写阈值留给 QA Lead，本 Skill 不做该写操作）。

---

## §Get 已保存评估

capability `qa.risk_assessment.get`（`product_id`、`version_id`）。只读已保存结果，不重算。

- `data === null`（CLI 路由 `api.data`，MCP 路由 `data`）→ 告知尚无保存记录，询问是否 compute
- 有记录 → 走 **§Enrich（Step 4b）** → 按 `ux.md §Output`「已保存」变体展示；含 `saved_at`、`saved_by.display_name`、`risk_level`、`note`、`ai_summary`、`override_rule_engine`
- 用户随后要求重算 → 仍走 §Compute → §Enrich → 输出

---

## §Compute 重算风险

capability `qa.testrail.execution.summary` ❌ 不是 A5 入口。A5 入口是：

capability `qa.risk_assessment.compute`（`product_id`、`version_id`；可选 `ticket_id`、`plan_mapping_ids`；刷新见下表）。只计算，**不保存**。

| 项 | 规则 |
|----|------|
| 默认（刷新 TestRail 执行数据） | 两条路由都要刷新：CLI 路由默认即刷新（**不传** `no_refresh_execution`；也可显式传 `refresh_execution`）；MCP 路由**必须**显式传 `refresh_execution`=true（不传则不刷新） |
| 接受缓存 | 仅用户明确要求时：CLI 路由传 `no_refresh_execution`；MCP 路由传 `refresh_execution`=false |
| Ticket 范围 | `ticket_id` |
| 编排批次 | `plan_mapping_ids`（CLI 路由逗号分隔；MCP 路由字符串数组） |

读 `data`（CLI 路由 `api.data`，MCP 路由 `data`）：`risk_level`、`rule_engine_version`、`computed_at`、`reasons[]`、`summary.execution`、`summary.runs`、`suggested_actions[]`。`summary.runs` 须空安全读取：缺失、`null` 或 `[]` 均视为「无执行数据」。

### 无执行数据（`summary.runs` 缺失或为空）

规则引擎此时仍会报 `pass_rate`=1、`untested`=0，这**不是**真实结果：

- **禁止**把覆盖率 / 通过率展示为 100%（① ② 指标表的数值列改为「无执行数据」）。
- 明确告知用户：该版本没有 TestRail 执行数据。
- 结论（摘要与解读）只基于 Ticket 侧 reasons（如 `HIGH_PLUS_TICKETS_OPEN`）；`risk_level` 仍原样展示 compute 结果，不改。
- 不输出 `ux.md §RunsAppendix`；不调用 capability `qa.testrail.execution.failures` 按 run 补查。

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
展示层可改写为人话 + 建议负责人（`ux.md §Actions`），只用于展示给用户；save body 不含 `suggested_actions`（字段见 `save-rules.md §Save`）。不得篡改 `risk_level`。

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

| 触发 | capability | 用途 |
|------|------|------|
| **始终**（compute 或 get 后输出报告） | capability `versions.get`（`product_id`、`version_id`） | 各发布渠道 `release_at`、距今天数、`complete_percent`、`status_counts` |
| `P1_FAILURES_OPEN` 或 `CRITICAL_CASE_OPEN` | capability `qa.testrail.execution.failures`（`product_id`、`version_id`、`limit`=50） | 按 `evidence.caseIds` 过滤，取 case 名、URL、关联 ticket |
| `HIGH_PLUS_TICKETS_OPEN` | capability `tickets.search`（`unique_ids` = `evidence.ticketIds`；CLI 路由逗号分隔，MCP 路由字符串数组） | 取 display_id、标题（`description`）、status、assignee（**无需** `time_range`） |

### `qa.testrail.execution.failures` 策略

1. 从 `reasons[].evidence.caseIds`（或 `case_ids`）收集待查 case ID。
2. 默认一次 Version 级 `qa.testrail.execution.failures`（`limit`=50）；按 case ID 过滤匹配项（列表在 `data` 中：CLI 路由 `api.data`，MCP 路由 `data`）。
3. 若 Version 级结果未覆盖全部 case ID，且 `summary.runs` 非空：仅对**含失败**的 Run 补调并传 `run_id`（参考 A3 `execution.md §Failures`）。
4. 富化表字段见 `ux.md §Enrich`；查不到的 case 保留 ID 并标注「详情未返回」。

### `versions.get` 字段

本 Skill 只需版本详情；不需要发布历史或子 Ticket 统计，**不**调用 `versions.releases` / `tickets.stats`。

`data.extra.target_release` 是**数组**，每个发布渠道一项：`[{channel_id, channel_name, release_at}]`（不是对象）。

| 字段路径 | 展示 |
|----------|------|
| `data.extra.target_release[].channel_name` + `release_at` | 每个渠道一行目标发布日期（Unix → 可读日期）；只需一个日期时取最早的未来 `release_at` |
| 计算 | 距今天数：未来为「还剩 N 天」（N ≤ 3 时另标「临近」），过去为「已超期 N 天」；版本未发布而 `release_at` 已过去 → 标注「已超期」；数组缺失、为空或无 `release_at` →「未设置」 |
| `data.progress.complete_percent` | 版本完成度 |
| `data.progress.status_counts` | 可选：COMPLETE / 总数推算 |

**禁止**展示 `data.risk` 或 `data.risk_reason` 作为 A5 依据。

### `tickets.search` 字段

对每个 `evidence.ticketIds`：`display_id`、标题（字段为 `description`，不是 `title`/`summary`）、`status`、`priority`、`assignees`（display name）。
展示「High+ 未关闭 {open}/{high_plus_total_in_version}」时，`open` 来自 reason evidence count；`high_plus_total_in_version` 若 `versions.get`/poll 不可得，可仅展示 open 数并注明。

### 阈值来源

- `pass_rate_min`：本会话已调用 `qa.risk_rules.get` 则用返回值，否则默认 `0.95`
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
