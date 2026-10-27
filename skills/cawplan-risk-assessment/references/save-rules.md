# A5 Save Rules & UX

契约 §8.3。与 `compute-rules.md` 配合。

---

## §Glossary 展示用字段

| API | 友好名 |
|-----|--------|
| `risk_level` | 风险等级 |
| `rule_engine_version` | 规则引擎版本 |
| `computed_at` | 计算时间 |
| `saved_at` | 保存时间 |
| `saved_by.display_name` | 保存人 |
| `note` | 人工备注 |
| `ai_summary` | AI 摘要 |
| `override_rule_engine` | 已人工覆盖规则引擎 |
| `reasons[].severity` | 严重度 |
| `reasons[].code` | 规则代码 |
| `suggested_actions[].level` | `BLOCKING`→阻塞项 · `RECOMMENDED`→建议项 |

等级展示：`CRITICAL`→严重 · `HIGH`→高 · `MEDIUM`→中 · `LOW`→低

---

## §Prompts 保存决策闸（Step 6）

用户未说「保存」→ 报告后结束，文末仅保留衔接提示（§Handoff），**不**主动弹保存。

用户说保存 / 确认发版结论 / persist：

1. 确认 `risk_level` 与 compute 一致（或用户已明确要 override）
2. `AskUserQuestion` 或等价交互：

| 场景 | option labels |
|------|---------------|
| 是否保存 | 保存评估（推荐）/ 先不保存 |
| 备注 | 无备注直接保存 / 添加备注后保存 |
| override（仅当用户要改等级） | 按规则引擎等级保存 / 人工调整等级（须备注） |

**禁止**将 `CRITICAL` 降为 `LOW`/`MEDIUM` 且无 `note`（BE 也会拒绝）。

取消保存 → 友好回执：「评估未写入 Version，可随时说保存风险结论继续。」

---

## §Save 保存写路径（Step 7）

**必须** `--body-file`（或 `--body`）+ `--confirm`；禁止字段级 flag。

### Body 模板

```json
{
  "risk_level": "HIGH",
  "reasons": [],
  "note": "自动化失败均为已知问题，可发版",
  "override_rule_engine": false
}
```

| 字段 | 规则 |
|------|------|
| `risk_level` | 默认用最近一次 compute 的等级；override 时设 `override_rule_engine: true` 并**必须**有 `note` |
| `reasons` | 传 `[]` 保留 compute 的 reasons（推荐） |
| `note` | 用户备注；override 或 CRITICAL 降级场景必填 |
| `ai_summary` | **默认省略**，由 BE GenAI 生成；用户明确要求自定义摘要时才传入 |
| `override_rule_engine` | 仅用户确认人工调整等级时为 `true` |

### 命令序列

```bash
# 1. 写入临时 JSON
# 2. dry-run
cawplan qa-insights risk-assessment save <product_id> <version_id> \
  --body-file /tmp/a5-risk-save.json \
  --dry-run

# 3. 提交闸通过后
cawplan qa-insights risk-assessment save <product_id> <version_id> \
  --body-file /tmp/a5-risk-save.json \
  --confirm
```

`--dry-run` 与 `--confirm` **不可**同一次调用依赖；先 dry-run 展示 body，再 confirm 提交。

### 反模式（禁止）

```bash
# ❌ 无 --confirm
# ❌ 无 body-file，臆造 CLI flag
# ❌ 未经用户确认就 save
```

---

## §Saved 保存后输出

保存成功后：

1. 用 `ux.md §Output` 的「已保存」变体重显完整报告（含 Step 4b 富化内容，若本会话已执行）。
2. 文末追加：

> 已写入 Version · 记录 ID `{id}` · Activity `QA_RISK_ASSESSMENT_SAVED`

若 save 响应含 `ai_summary`，替换报告中「AI 摘要」行。

---

## §Handoff 衔接（文末一句，不弹窗）

按 compute 结果**择一**附加（勿堆砌）：

| 条件 | 文案 |
|------|------|
| `CRITICAL`/`HIGH` 且 reasons 含未闭环失败类 | 可继续用 `cawplan-defect-ticket` 登记缺陷并闭环。 |
| `untested` 偏高或 `NEW_FEATURE_UNEXECUTED_RATE_HIGH` 类 reason | 可继续用 `cawplan-test-execution-progress` 查看新功能执行缺口。 |
| 其他 | 如需 Ticket 级测试报告，使用 `cawplan-ticket-report-generate`（**非**本 Skill 的 Release Readiness）。 |

**禁止**：声称本结论 = A8 QA Report 最终发版判定；禁止把 `versions track` 的 `risk`/`risk_reason` 当作 A5 结论（只读 `release_at`/完成度除外）。

---

## §Errors 异常恢复

| 场景 | 处理 |
|------|------|
| `CONFIRMATION_REQUIRED` | 提醒须 `--confirm`；展示 dry-run body 后重试 |
| `get` 返回 null 且用户要保存 | 先 compute |
| `TESTRAIL_UNAVAILABLE` | 说明 compute 可能失败或数据 stale；可 `--no-refresh-execution` 重试或稍后重算 |
| override 无 note | 要求补充备注或改回规则引擎等级 |
| 校验失败（body 多余键） | 对照 §Save 模板修正 JSON |
