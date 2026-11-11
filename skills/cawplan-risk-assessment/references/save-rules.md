# A5 Save Rules & UX

契约 §8.3。与 `compute-rules.md` 配合。capability 参数与示例见 `CAPABILITIES.md`。

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
2. `AskUserQuestion` 或等价交互（用户在请求中已明确要求保存时，可跳过「是否保存」这一问；备注问题只在用户没有给出备注、且等级为 HIGH / CRITICAL 或用户要 override 时问，其他情况不问；无备注时 body 省略 `note`，不传空字符串；override 问题仅当用户要改等级时问；§Save 的提交闸**永不**跳过）：

| 场景 | option labels |
|------|---------------|
| 是否保存 | 保存评估（推荐）/ 先不保存 |
| 备注 | 无备注直接保存 / 添加备注后保存 |
| override（仅当用户要改等级） | 按规则引擎等级保存 / 人工调整等级（须备注） |

**禁止**将 `CRITICAL` 降为 `LOW`/`MEDIUM` 且无 `note`（BE 也会拒绝）。

取消保存 → 友好回执：「评估未写入 Version，可随时说保存风险结论继续。」

---

## §Save 保存写路径（Step 7）

capability `qa.risk_assessment.save`（**write**）：`product_id`、`version_id` + 整个 body。

- body **必须**整体传入：两条路由都可用 `body`；CLI 路由也可用 `body_file`（JSON 文件，推荐用于长 JSON 或拒绝引号参数的环境）。**禁止**字段级参数 / 臆造 flag。
- CLI 路由提交时**必须**带 `confirm`（CLI 的安全开关）；MCP 路由没有 `confirm`，以下面的提交闸代替，闸不可省。
- 本节字段之外不得加键：body 只有 `risk_level`、`reasons`、`note`、`ai_summary`、`override_rule_engine`；`suggested_actions` **不**进 body（仅展示给用户）。
- 每次调用都会**新增一条**保存记录（成为该 Version 最新评估）：同一结论只保存一次；调用失败或结果不明时，先用 capability `qa.risk_assessment.get` 确认是否已写入，再决定是否重试。

### Body 模板

```json
{
  "risk_level": "HIGH",
  "reasons": [
    {"code": "HIGH_PLUS_TICKETS_OPEN", "severity": "HIGH", "message": "2 High+ tickets still open", "evidence": {"ticketIds": ["<ticket_unique_id>"]}}
  ],
  "note": "自动化失败均为已知问题，可发版",
  "override_rule_engine": false
}
```

| 字段 | 规则 |
|------|------|
| `risk_level` | 默认用最近一次 compute 的等级；override 时设 `override_rule_engine: true` 并**必须**有 `note` |
| `reasons` | 默认原样传最近一次 compute 的 `reasons[]`，每项为对象 `{code, severity, message, evidence}`；仅当用户编辑过 reasons 时传编辑后的对象数组 |
| `note` | 用户备注；override 或 CRITICAL 降级场景必填 |
| `ai_summary` | **默认省略**，由 BE GenAI 生成；用户明确要求自定义摘要时才传入 |
| `override_rule_engine` | 仅用户确认人工调整等级时为 `true` |

### 调用序列

**CLI 路由**

1. 把 body 写入临时 JSON 文件：目录取 capability `session.temp_dir` 的返回值。该目录是 CLI 会话共享的固定目录，文件名必须唯一，含 version id 与时间戳（例如 `a5-risk-save-{version_id}-{yyyyMMddHHmmss}.json`），不得复用固定文件名。
2. 预览：capability `qa.risk_assessment.save`（`product_id`、`version_id`、`body_file`、`dry_run`）——只打印 body，不提交；把输出展示给用户。
3. 提交闸（见下）通过后：capability `qa.risk_assessment.save`（`product_id`、`version_id`、同一个 `body_file`、`confirm`）。
4. save 结束后（成功、失败或用户取消）删除该临时文件。

同一次调用里**永远不要**同时传 `dry_run` 和 `confirm`：第一次调用只传 `dry_run`；用户确认后，第二次调用用同一个 body 只传 `confirm`。

**MCP 路由**（无 `dry_run`、无 `confirm`）

1. 预览：把将要发送的完整 body JSON **原样**展示给用户（代替 dry-run 输出）。
2. 提交闸（见下）通过后：capability `qa.risk_assessment.save`（`product_id`、`version_id`、`body` = 刚才展示的同一 JSON，不得再改动）。

### 提交闸（两条路由相同，不可省略）

展示确切 body 后（CLI 路由为 dry-run 输出，MCP 路由为完整 body JSON），用 `AskUserQuestion` 或等价交互询问：

> 以上是将写入 Version 的风险评估内容。确认保存吗？

| option labels |
|---------------|
| 确认保存 / 取消 |

- 选「确认保存」→ 执行上面的提交调用。
- 选「取消」或未明确确认 → 不调用 save，回执「评估未写入 Version，可随时说保存风险结论继续。」（CLI 路由同时删除临时文件）。
- 用户要改 body → 改完重新预览，再过一次本闸。

### 反模式（禁止）

- ❌ CLI 路由无 `confirm`，或同一次调用同时传 `dry_run` 与 `confirm`
- ❌ CLI 路由用固定文件名写临时 body，或 save 后不删除
- ❌ body 中加入 `suggested_actions` 等模板外字段
- ❌ 不整体传 body（`body` / `body_file`），臆造字段级参数
- ❌ 未经用户确认就 save（任一路由；MCP 路由也必须先展示 body 并过提交闸）
- ❌ 结果不明时直接重复 save（会新增重复记录）

---

## §Saved 保存后输出

保存成功后（信封 `code` 为 SUCCESS；CLI 路由读 `api`，MCP 路由读返回本身）：

1. 用 `ux.md §Output` 的「已保存」变体重显完整报告（含 Step 4b 富化内容，若本会话已执行）。
2. 文末追加：

> 已写入 Version · 记录 ID `{id}` · Activity `QA_RISK_ASSESSMENT_SAVED`

若 save 响应 `data` 含 `ai_summary`，替换报告中「AI 摘要」行。

---

## §Handoff 衔接（文末一句，不弹窗）

按 compute 结果**择一**附加（勿堆砌）：

| 条件 | 文案 |
|------|------|
| `CRITICAL`/`HIGH` 且 reasons 含未闭环失败类 | 可继续用 `cawplan-defect-ticket` 登记缺陷并闭环。 |
| `untested` 偏高或 `NEW_FEATURE_UNEXECUTED_RATE_HIGH` 类 reason | 可继续用 `cawplan-test-execution-progress` 查看新功能执行缺口。 |
| 其他 | 如需 Ticket 级测试报告，使用 `cawplan-ticket-report-generate`（**非**本 Skill 的 Release Readiness）。 |

**禁止**：声称本结论 = A8 QA Report 最终发版判定；禁止把 `versions.get` 的 `risk`/`risk_reason` 当作 A5 结论（只读 `release_at`/完成度除外）。

---

## §Errors 异常恢复

| 场景 | 处理 |
|------|------|
| `CONFIRMATION_REQUIRED`（CLI 路由） | 提交调用须带 `confirm`；展示 dry-run body 并重新通过提交闸后，再只带 `confirm` 重试 |
| `get` 返回 null 且用户要保存 | 先 compute |
| `TESTRAIL_UNAVAILABLE` | 说明 compute 可能失败或数据 stale；可不刷新重试（CLI 路由 `no_refresh_execution`；MCP 路由 `refresh_execution`=false）或稍后重算 |
| override 无 note | 要求补充备注或改回规则引擎等级 |
| 校验失败（body 多余键） | 对照 §Save 模板修正 JSON |
| save 失败或结果不明 | 先 capability `qa.risk_assessment.get` 确认是否已写入，再决定是否重试 |
