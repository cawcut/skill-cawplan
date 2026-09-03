# A5 UX — 报告模板与只读富化展示

与 `compute-rules.md` 配合；**禁止** workflow 开场与 `save-rules.md` 一并 Read。
**跟随用户主语言**；禁止同一段中英各写一遍。

---

## §Glossary

| 概念 | 友好名 | 分母 / 说明 |
|------|--------|-------------|
| 新功能执行覆盖率 | `1 - new_feature_unexecuted_rate` | 版本全部新功能用例（Requirement 映射） |
| 新功能未执行率 | `summary.execution.new_feature_unexecuted_rate` | 同上 |
| 已执行用例通过率 | `summary.execution.pass_rate` | **仅已执行**用例（`passed/executed`） |
| 版本完成度 | `versions track` → `complete_percent` | 只读上下文，不参与 A5 规则 |
| 目标发布 | `release_at` | 只读上下文，不参与 A5 规则 |

等级展示：`CRITICAL`→🔴 严重 · `HIGH`→🔴 高 · `MEDIUM`→🟡 中 · `LOW`→🟢 低

---

## §Enrich 富化表字段

### P1 / Critical 未闭环失败表（`reasons` 含 `P1_FAILURES_OPEN` 或 `CRITICAL_CASE_OPEN` 时 **SHALL** 输出）

| 列 | 来源 |
|----|------|
| 用例 | `failures[].case_name` 或 `title`；无则 `Case {case_id}` |
| 优先级 | `failures[].priority` |
| 状态 | FAILED / BLOCKED（来自 `status`） |
| 关联缺陷 | `linked_ticket_url` → 链接(display_id)；无 ticket →「未关联」 |
| 负责人 | 关联 ticket 的 assignee（经 `tickets search` 补查）；无 →「—」 |
| TestRail | `result_url` 或 `case_url` →「打开」链接 |

按优先级 Critical → High → P1 排序；仅展示 `evidence.caseIds` 中的项。

### High+ 未关闭 Ticket 表（`HIGH_PLUS_TICKETS_OPEN` 时 **SHALL** 输出）

表前一行快照（只读上下文）：
`版本完成度 {complete_percent}% · High+ 未关闭 {open_count} 条`

| 列 | 来源 |
|----|------|
| Ticket | `display_id` + 门户链接 |
| 标题 | `title` / `summary` |
| 状态 | `status` 友好名 |
| 优先级 | `priority` |
| 负责人 | `assignees` display name；无 →「未指派」 |

---

## §RunsAppendix 高风险 Run 附录

**主文禁止**展示 `summary.runs`。

仅当以下**任一**成立时，在报告**末尾附录**输出（折叠标题「附录：通过率偏低的 Run」）：

1. `reasons` 含 `PASS_RATE_BELOW_MIN`
2. `summary.runs[]` 中存在 `passRate < pass_rate_min`（默认 0.95，或本会话 `risk-rules get` 值）

```markdown
### 附录：通过率偏低的 Run（仅反映已编排 Run，不代表版本新功能总覆盖）

| Run | 类型 | 通过率 | 说明 |
|-----|------|--------|------|
| {name} | {runType} | {passRate %} | 低于阈值 {pass_rate_min}% |
```

若所有 Run 通过率均 ≥ 阈值，**省略**本附录（即使 `summary.runs` 非空）。

---

## §Actions 建议行动展示

保留 API `suggested_actions` 的 `level` 排序；展示层 **SHALL** 扩展为四列：

| 级别 | 行动 | 建议负责人 | 依据 |
|------|------|------------|------|
| 🚫 BLOCKING | 人话改写（指向上文富化表） | 从关联 ticket assignee 推断；无则「待指派」/「QA Lead」 | `{reason.code}` |
| ⚠️ RECOMMENDED | 人话改写 | 按场景：QA Lead / 模块 owner | `{reason.code}` |

示例（`NEW_FEATURE_UNEXECUTED_RATE_HIGH`）：
> 优先分配资源执行剩余 {unexecuted_rate}% 新功能用例（当前覆盖率仅 {coverage}%）

**保存时** `suggested_actions` 仍以 compute 原文进 body；展示层改写不影响 save JSON。

---

## §Output 计算结果模板（未保存）

```markdown
## 发版风险评估 — {version_name}

**风险等级**：{emoji} {risk_level}
**目标发布**：{release_date 或「未设置」} · {还剩/已超期 N 天}（只读排期信息，不参与规则计算）
规则引擎 v{rule_engine_version} · 计算于 {computed_at}

### 摘要
> {Agent 1–3 句；第一句 = 主因维度；覆盖率触发时不得以通过率为第一句}

### ① 测试覆盖（主风险维度）
| 指标 | 数值 | 分母说明 |
|------|------|----------|
| **新功能执行覆盖率** | **{coverage}%** | 版本全部新功能用例 |
| 新功能未执行率 | {unexecuted_rate}%（阈值 {threshold}%） | 同上 |
| 未执行用例数 | {untested} | 已纳入统计的用例 |

### ② 已执行质量（次要，仅反映「测过的部分」）
| 指标 | 数值 | 分母说明 |
|------|------|----------|
| 已执行用例通过率 | {pass_rate}% | 仅已执行用例 |
| 失败 | {failed} | — |
| P1 未闭环失败 | {p1_open_failures} | — |
| Critical 未闭环 | {critical_failures_open} | — |

> ① 与 ② 分母不同：高通过率不代表覆盖充分。

### 风险原因（{reasons.length} 条）
{按 severity 降序；同 code 合并 evidence 后展示 message，不单列裸 caseIds/ticketIds}

1. **{code}** — {message}
2. ...

### P1 / Critical 未闭环失败（{n}）
{§Enrich 表格；无则省略本节}

### High+ 未关闭 Ticket（{open_count}）
{§Enrich 表格；无则省略本节}

### 建议行动
{§Actions 四列表格}

{§RunsAppendix — 条件允许时追加}

---
*说明：A5 结论来自 QA Insights 规则引擎；排期/完成度为只读上下文。不等同于 A3 执行进度、plan-track 排期风险或 A8 Release Readiness。*

是否保存此评估？可提供备注（note）。保存将写入 Version 并产生 Activity `QA_RISK_ASSESSMENT_SAVED`。
```

### `get` 已保存记录

沿用上表结构；标题改为 `## 发版风险评估（已保存）— {version_name}`；摘要块后追加：

| 项目 | 内容 |
|------|------|
| 保存时间 | {saved_at} |
| 保存人 | {saved_by.display_name} |
| 备注 | {note 或 —} |
| AI 摘要 | {ai_summary 或「保存后由后端生成」} |
| 人工覆盖 | {override_rule_engine 是/否} |

已保存记录若用户要求重算，仍走 compute → 4b → 5。

---

## §Errors 富化失败降级

| 场景 | 处理 |
|------|------|
| `versions track` 失败 | 省略发布日期行；注明「排期信息暂不可用」 |
| `tickets search` 失败 | 回退展示 reason.message；注明 ticket 详情暂不可用 |
| `execution failures` 失败 | 回退 `evidence.caseIds` 列表；注明用例详情暂不可用 |
| 富化不影响 | `risk_level` 与 reasons 仍以 compute/get 为准 |
