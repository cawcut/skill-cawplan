# QA Insights 写命令 — Phase 1a 分步执行计划

> **真源**：[`QA_INSIGHTS_WRITE_COMMANDS_IMPLEMENTATION_PLAN.md`](QA_INSIGHTS_WRITE_COMMANDS_IMPLEMENTATION_PLAN.md)（rev.4，已批准）
> **范围**：**Phase 1a** — 仅 CLI；**不改** skill、plugin、根 `VERSION`；**不删** `cawplan api` 逃生舱。
> **Phase 1a 之于 rev.4**：删掉 skill **从不调用** 的 opt-in 路径（`--reconcile-first` / `--force-new` / `DUPLICATE_BLOCKED`、exit code 分层、条数中间态细分）；**correctness-critical 判据与 6 个被 skill 调用的子命令一条未动**（详见文末「Phase 1a 削减说明」）。
> **测试 product**：`019fb1ff-d547-741f-bfa2-405386d04d5b`（写库联调专用）
> **CI**：只跑单测 + `validate-skills`；写库冒烟 **不进 CI**（OQ#7）

每步格式：**(a) 做什么** · **(b) 文件/命令** · **(c) 如何验证**

**单测 parity 约定**：凡含单测的步骤，`(c)` 要求 `describe`/`test` 名称嵌入方案 §5 判据 ID 或 §8 Parity `P*`（如 `P3`、`A1-FC-5`），便于从绿色日志逐条对覆盖。

**outcome / exit code 约定（Phase 1a）**：JSON `outcome` enum 为 **`SUCCESS` / `RECONCILED` / `NOOP` / `FAILURE` / `UNKNOWN`** 五个（相对 rev.4 去掉 `DUPLICATE_BLOCKED`）——**skill 消费的就是这个字段**。exit code 收成 **0 / 1**：`SUCCESS`/`NOOP`/`RECONCILED` → **0**；`FAILURE`/`UNKNOWN`/`validation` → **1**。**skill 以 JSON `outcome` 为准，exit code 仅粗分「成功 / 需关注」**。

---

## 步骤 0 — 执行前基线

**(a)** 确认仓库干净可读、CLI 现有测试绿，作为 Phase 1a 起点快照。

**(b)** 命令（仓库根目录）：

```bash
cd cli && npm install && npm run build && npm test
cd .. && bash scripts/validate-skills.sh
```

**(c)** `npm test` 全部通过；`validate-skills.sh` 末尾 `All skill validations passed.`；记录当前 `cli/package.json` `version`（应为 `0.0.24`）。

**实测基线（2026-08-06）**：`npm run build` 无 TS 错误；`npm test` → **17 test files / 187 tests passed**（与方案 §1.4 记录一致）；`validate-skills.sh` → `All skill validations passed.`；`cli/package.json` version = **`0.0.24`**；根 `VERSION` = `0.2.6`；分支 `zzl-qa-skill`。

【状态：完成】

---

## 步骤 1 — 只读探路：真实 Requirement 数据形态（逃生舱 GET）

**(a)** 在**任何** `lib/qa-insights` 实现之前，用逃生舱纯只读 GET 一条**已归档** Requirement，确认鉴权通、路径通，并核对真实响应形态：`data` 是单对象还是数组、五字段与 `summary`/`url` 的字段名与嵌套结构是否与方案 §3.3.1 / §5 假设一致。若有差异，记入执行笔记，步骤 3–5（normalize / strong-match / snapshot-diff）须按实测结构实现。

**(b)** 命令（需 `cawplan auth`；**只读、不写**；**仅测试 product**）：

```bash
# 将 <真实 requirement_id> 换为测试产品上已存在的一条（可从 QA Insights 门户或此前 A1 归档记录获取）
cawplan api GET /api/v1/public/openapi/product/019fb1ff-d547-741f-bfa2-405386d04d5b/qa/requirements/<真实 requirement_id>
```

可选对照（仍只读）：`cawplan api GET .../qa/requirements?module_tree_node_id=<node_id>` 观察 list 行结构与单条 GET 是否一致。

**(c)** 终端可见 `code: SUCCESS` 与完整 JSON；书面记录：`data` 类型、五字段键名、`summary`/`url`/`module_tree_node_id` 等实际路径。与方案假设一致方可进入步骤 2；不一致则先更新执行笔记中的「字段映射表」，再实现 lib。

### 字段映射表（2026-08-06 实测 · proto 环境）

探针对象：`product 019fb1ff-…` / `requirement 019fcfa0-da13-78db-b552-323598ce1c38`（单条 GET）；对照 list GET `module_tree_node_id=019fcf73-7fd1-7b6a-8745-97c2ffaded05`（返回 2 行）。两条均 `code: SUCCESS`。

| 项 | 实测 | 与方案假设 |
|----|------|-----------|
| 单条 GET `data` | **单对象**（dict） | ✅ 一致 |
| list GET `data` | **数组**（list，非分页信封） | ✅ 一致 |
| list 行结构 vs 单条 GET | **20 个 key 完全相同** | ✅ 一致 |
| 五字段位置 | **`data` 顶层扁平**，`snake_case`，无嵌套 | ✅ 一致 |
| `summary` | 与五字段**平级独立**（本条 `"视频导出参数配置"`） | ✅ 一致 |

**五字段键名（lib 直接取顶层，无需路径拼接）**：`function_description`、`entry_trigger`、`normal_expectation`、`constraints`、`out_of_scope`

**其余键**：`id`、`module_tree_node_id`、`url`（portal 深链路径，非 API 路由）、`ticket_id`、`created_at`/`updated_at`/`created_by`、`last_reviewed_at`。

**只读回显字段（读有、写 body 禁发 —— 读写不对称，勿混淆）**：`product_id`、`review_status`（本条 `PENDING`）、`reviewer_group`、`reviewers`、`reviewer_reviews`、`review_history`。`body-builders` 硬拒的是**写 body** 中的 `{product_id, review_status, is_edited}`，与响应含这些键不矛盾。

**实测补充（影响步骤 3 单测取例）**：本条 `out_of_scope` 为**有实质内容的长文本**，非 `（素材未提及）`/空/`null` 三态之一 —— 真实库中 `out_of_scope` 常态有值。步骤 3 单测须将「有内容正常比对」作为**主用例**，三态等价作为**边界用例**，不可只测三态。

**旁证（设计正确性）**：同一节点下 2 行 `summary` 分别为「视频导出参数配置」与「视频生成参数配置」—— 高度相似但非同一条，印证 `requirements reconcile` 采用**五字段强匹配而非 summary 匹配**（A1 Field comparison）是必要的。

【需用户确认后再继续】

【状态：完成】（待用户确认字段形态后方可进入步骤 2）

---

## 步骤 2 — 创建 `lib/qa-insights` 目录与类型真源

**(a)** 新建 `cli/src/lib/qa-insights/types.ts`：定义 `QAInsightsWriteEnvelope`、`outcome` 联合类型（**五值**：`SUCCESS` / `RECONCILED` / `NOOP` / `FAILURE` / `UNKNOWN`）、`reconcile.decision` 常量、`RequirementFiveFields`、`RequirementSnapshot`、`TestPointDraft` 等（对齐方案 §3.3.1，**按本文顶部 Phase 1a outcome 约定去掉 `DUPLICATE_BLOCKED`**；字段名须与步骤 1 实测一致）。

**(b)** 新建文件：`cli/src/lib/qa-insights/types.ts`（仅此文件，不含实现逻辑）。

**(c)** `cd cli && npm run build` 无 TS 错误；类型可被其他模块 `import`；`outcome` 联合类型**不含** `DUPLICATE_BLOCKED`。

**实测**：`npm run build` 无 TS 错误；`outcome` 五值联合，`grep DUPLICATE_BLOCKED cli/src` 仅命中一处**说明其被移除的注释**，无类型成员。

【状态：完成】

---

## 步骤 3 — 实现 `normalize.ts` + 单测

**(a)** 实现字段 trim、`out_of_scope` 三态等价（`null`/空/`（素材未提及）`）、五字段提取（不含 `summary`）；解析逻辑对齐步骤 1 实测结构。

**(b)** 新建：`cli/src/lib/qa-insights/normalize.ts`、`cli/tests/qa-insights-normalize.unit.test.ts`。

**(c)** `cd cli && npm test -- qa-insights-normalize` 全绿；测试名须含 **`A1-FC-1`**、**`A1-FC-2`**（及方案 §7.1 其余用例）。跑完后在输出中可逐条对上 **P3**（normalize 为强匹配前置）。

**实测**：`qa-insights-normalize` **28 passed**。按步骤 1 实测补充：`out_of_scope` **有内容**为主用例（含真实库长文本），三态等价为边界用例。

【状态：完成】

---

## 步骤 4 — 实现 `strong-match.ts` + 单测

> **保留不动**：strong-match 仍由 `requirements reconcile`（步骤 17）使用 —— Phase 1a 删的只是 `create` 端那个 skill 不调用的 opt-in 包装。

**(a)** 实现五字段强匹配：normalize 后逐字段相等；**summary 不参与**；保留 `（惯例推断）`/`（界面推断）` 标记。

**(b)** 新建：`cli/src/lib/qa-insights/strong-match.ts`、`cli/tests/qa-insights-strong-match.unit.test.ts`。

**(c)** `npm test -- qa-insights-strong-match` 全绿；测试名须含 **`A1-FC-3`**、**`A1-FC-5`**、**`P3`**（含「summary 不同仍匹配」）。

**实测**：`qa-insights-strong-match` **27 passed**。P3 用步骤 1 真实数据取例（同节点两行 summary「视频导出参数配置」/「视频生成参数配置」近似但非同条），验证 summary 不参与匹配。

【状态：完成】

---

## 步骤 5 — 实现 `snapshot-diff.ts` + 单测

**(a)** 实现 `computePatchBody(desired, snapshot)`：仅输出变动键；`out_of_scope` 等价不算变；空 diff 返回 `{}`。

**(b)** 新建：`cli/src/lib/qa-insights/snapshot-diff.ts`、`cli/tests/qa-insights-snapshot-diff.unit.test.ts`。

**(c)** `npm test -- qa-insights-snapshot-diff` 全绿；测试名须含 **`A1-FC-6`**、**`A1-WB-4`**、**`P4`**（仅 summary 变 / 五字段+summary 均变 / 无变空 diff）。

**实测**：`qa-insights-snapshot-diff` **28 passed**。另覆盖「desired 中缺席的键 = 保持不变，绝不清空」——防 PATCH 误清字段。

【状态：完成】

---

## 步骤 6 — 实现 `body-builders.ts` + 单测

**(a)** 实现 Requirement POST body 校验/组装、PATCH body 禁发检查、testpoint batch 四键校验与禁发键硬失败；`reviewer_user_ids`/`reviewer_group` **透传**；禁发 `{product_id, review_status, is_edited}` **硬失败**。

**(b)** 新建：`cli/src/lib/qa-insights/body-builders.ts`、`cli/tests/qa-insights-body-builders.unit.test.ts`。

**(c)** `npm test -- qa-insights-body-builders` 全绿；测试名须含 **`A1-WB-1`**、**`A1-WB-2`**、**`A1-WB-3`**、**`A2-§9-body`**、**`P6`**、**`P10`**。

**实测**：`qa-insights-body-builders` **45 passed**。含读写不对称用例：把步骤 1 那种 GET 回来的行直接当写 body → 因含 `product_id`/`review_status` 被硬拒。

【状态：完成】

---

## 步骤 7 — 实现 `api-codes.ts` + 单测

**(a)** 实现信封解析：`parseApiEnvelope(payload)`、`isApiSuccess(code)`、`isFailureInvalidInput` 等；处理 HTTP 200 + `FAILURE_*`。

**(b)** 新建：`cli/src/lib/qa-insights/api-codes.ts`、`cli/tests/qa-insights-api-codes.unit.test.ts`。

**(c)** `npm test -- qa-insights-api-codes` 全绿；测试名须含 **`A1-MT-1`** / **`P11`** 相关（`SUCCESS`、`FAILURE_INVALID_INPUT` mock payload）。

**实测**：`qa-insights-api-codes` **26 passed**。SUCCESS 形态取自步骤 1 真实响应 `{code:SUCCESS,data,msg:"success"}`。

【状态：完成】

---

## 步骤 8 — API 形态探针：OQ-A / OQ-B / OQ-C（须在 `errors.ts` 之前）

> **依赖开放项 OQ-A、OQ-B、OQ-C**（方案 §12）
>
> ⚠️ **本步含真实写请求（PATCH / batch POST）** —— 虽然目标 id 不存在、预期被服务端拒绝，但请求本身走的是**写路径**。因此 **Phase 1 的「首次真写确认关卡」前移至本步**（不再只在末尾冒烟步）。

**(a)** 在实现 `errors.ts` **之前**，用逃生舱实测 not-found 与 feature 关闭的信号形态，供错误分类照**实测**编写（勿先假设再回头补）：

| 探针 | 目的 | 依赖 |
|------|------|------|
| **OQ-A** | 不存在 `requirement_id` 的 **PATCH** → HTTP 404 还是 200+`FAILURE_*`？ | OQ-A |
| **OQ-B** | 不存在 `requirement_id` 的 **batch POST** → 同上 | OQ-B |
| **OQ-C** | `qa_reports` **未开**产品的 GET/写请求 → HTTP 403 还是 200+信封？ | OQ-C |

**探针 id 写死为全零 UUID**：`00000000-0000-0000-0000-000000000000`。**严禁**改成任何可能真实存在的 id —— 手滑替换成真实 id 会造成**真实写入**（PATCH 覆盖字段 / batch 追加测试点），且 API 无 DELETE requirement 可回滚。

**OQ-C 分支**：测试 product `019fb1ff-...` 的 `qa_reports` **大概率已开**。若能拿到 **qa_reports 关闭**的产品 id → 对该产品打一条**只读 GET** 一并探针；**否则** → 在步骤 9 将 `feature_disabled` 按方案 §6 **假设**实现，并显式标注 **「未证实，待 flag-off 产品补验」**，**不得**当作已核实通过。

**(b)** 命令（需 `cawplan auth`；**仅测试 product**，OQ-C 另用 flag-off 产品若可得）：

```bash
# OQ-A：不存在 id 的 PATCH —— id 固定全零，勿改
cawplan api PATCH /api/v1/public/openapi/product/019fb1ff-d547-741f-bfa2-405386d04d5b/qa/requirements/00000000-0000-0000-0000-000000000000 --body '{}'

# OQ-B：不存在 id 的 batch POST —— id 固定全零，勿改
cawplan api POST /api/v1/public/openapi/product/019fb1ff-d547-741f-bfa2-405386d04d5b/qa/requirements/00000000-0000-0000-0000-000000000000/testpoints/batch --body '{"test_points":[]}'

# OQ-C（可选）：qa_reports 关闭的产品 —— 只读 GET
# cawplan api GET /api/v1/public/openapi/product/<flag-off-product_id>/qa/module-tree
```

**(c)** 书面记录每条探针的 HTTP status、body 信封 `code`/`msg`；写入执行笔记「OQ-A/B/C 实测表」。步骤 9 `errors.ts` **必须**按此表实现 404/信封/`feature_disabled` 分支；OQ-C 未探到时在代码注释与单测中标注 **未证实**。确认两条写探针用的都是全零 UUID。

### OQ-A/B/C 实测表（2026-08-06 · proto · 全零 UUID）

> ⚠️ **实测推翻方案假设**：写接口的 not-found **不是 HTTP 404**，而是 **HTTP 200 + 信封 `FAILURE_INVALID_INPUT` + `msg: "requirement not found"`**。§15「Get Requirement Notes: `404` → Requirement missing」**只适用于读**（单条 GET）；写接口（PATCH / batch POST）走信封。`errors.ts` **不得**依赖 HTTP 404 判定写路径的 not-found。

| 探针 | 请求 | 实测结果 | 结论 |
|------|------|----------|------|
| **OQ-A** | `PATCH .../qa/requirements/0000…0000 --body '{}'` | **HTTP 200** + `code: FAILURE_INVALID_INPUT`、`msg: "requirement not found"`、`data` 为含 null 字段的占位对象 | 写 not-found = **200 + 信封**，非 404 |
| **OQ-B**（第 1 次） | 同上 batch POST，`{"test_points":[]}` | HTTP 200 + `FAILURE_INVALID_INPUT`、`msg: "test_points are required"` | **body 校验先于 requirement 查找**；空数组探不到 not-found |
| **OQ-B**（第 2 次，带 1 条合法测试点） | batch POST，1 条合法四键测试点 | **HTTP 200** + `FAILURE_INVALID_INPUT`、`msg: "requirement not found"`、`data: {}` | 与 OQ-A **同形态** |
| **OQ-C** | `GET .../product/019fb201-…/qa/module-tree`（用户提供的「qa_reports 未开」产品） | **HTTP 200 + `code: SUCCESS`**，正常返回 7 个节点 | **未复现 feature-disabled**：该产品 QA Insights 读路径可用，`qa_reports` 未开**不影响** QA Insights |
| **OQ-C 旁证**（首轮 403，权限修复前） | `PATCH .../product/019fb1ff-…/qa/requirements/0000…0000` | **HTTP 403** + `code: INSUFFICIENT_PERMISSIONS`、`data.required: "qa_insights.edit"`、`data.resource_type: "product"` | 403 形态**已实测**：code 为 `INSUFFICIENT_PERMISSIONS`，**非** `FAILURE_*` 前缀 |

**关键实现要点（步骤 9 必须遵循）**：

1. **写路径 not-found**：`FAILURE_INVALID_INPUT` + `msg` 含 `not found` → 映射 `FAILURE` / `not_found`（**不是** `validation`）。仅凭 `code` 无法区分 not-found 与真正的入参非法（**同一个 code**），须结合 `msg`。
2. **`FAILURE_INVALID_INPUT` 一码多义**：depth>5、缺 `test_points`、requirement not found **共用**此 code —— 分类须看 `msg`，且分不出时**保守归 `validation`**。
3. **403 形态**：`code: INSUFFICIENT_PERMISSIONS`（独立命名空间，非 `FAILURE_*`），由 `cawplanRequest` 抛 `ApiError(403)`。
4. **`data` 非空不代表成功**：OQ-A 的失败响应 `data` 是含 null 字段的对象 —— **必须先判 `code`**，不可因 `data` 有内容就认为成功。

**未探到项**：`feature_disabled` 真实形态。用户确认「就是 403」，且 403 形态已由权限旁证实测；但**「功能未开」与「无产品权限」是否同码**未验证 → 步骤 9 按 403/`INSUFFICIENT_PERMISSIONS` 实现，`feature_disabled` 与 `auth` 归同一 403 分支处理，注释标注该细分**未证实**。

### 补充探针：depth>5（用户批准「选项 A」后执行 · 2026-08-06）

**目标**：在 `019fb201-…` 的 level-5 节点 `V4`（`019fb339-664e-7ef5-b1ef-43bc5a41cf25`）下建子节点，实测 depth>5 报错形态。

**结果：未测到 —— 被权限层拦截，未产生写入。**

```
POST .../product/019fb201-…/qa/module-tree  {"parent_id":"019fb339-664e-…","name":"…"}
→ HTTP 403 · code: INSUFFICIENT_PERMISSIONS
  msg: "user has 'qa_insights.edit' but lacks access to product '019fb201-…'"
```

**三方对照（同一账号、同一时刻）确立了权限模型**：

| 产品 | 读（GET） | 写（POST/PATCH） |
|------|-----------|------------------|
| `019fb1ff-…`（测试 product） | ✅ SUCCESS | ✅ 通（到达业务层，返回 `FAILURE_INVALID_INPUT / requirement not found`） |
| `019fb201-…`（用户提供） | ✅ SUCCESS | ❌ **403 INSUFFICIENT_PERMISSIONS** |

**结论（对步骤 9 的实际价值）**：

1. **权限是 per-product 且读写分离** —— 「有 `qa_insights.edit` 角色」≠「对该产品可写」。403 的 `data.required` / `data.resource_type` 明确指出是**产品级资源访问**问题，不是角色缺失。
2. **403 形态第二次独立复现**（不同产品、不同 HTTP 方法 POST vs PATCH），`code: INSUFFICIENT_PERMISSIONS` 稳定 → 步骤 9 的 403 分支可**照实测实现**，不再是单点观测。
3. **depth>5 仍未实测** → 该分支按 §15 文档形态（`FAILURE_INVALID_INPUT` + `msg: "module tree depth exceeds limit (5)"`）以 mock 实现，代码注释标注 **`// depth>5: 形态取自 §15 文档，未实测`**。因其归 `validation` 分支、与 not-found 的 `msg` 判别互不干扰，风险可控。
4. **写库联调（步骤 24）只能在 `019fb1ff-…` 上进行** —— 与计划写死的测试 product 一致，无需调整。

【需用户确认后再继续】（**本轮首次发出写请求**，由用户确认再执行本步）

【状态：完成】（OQ-A/B 已实测；OQ-C 未复现 feature-disabled，见实测表）

---

## 步骤 9 — 实现 `errors.ts` + 单测

**(a)** 实现两层错误映射：`mapCawplanRequestError(err, { method, isWrite })` → `{ outcome, error }`；**按步骤 8 实测表**处理 404 vs 信封 `FAILURE_*`；写 POST/PATCH 5xx → `UNKNOWN`（OQ#1）；GET 5xx → `UNKNOWN`；401/403；fetch 网络错误 → `UNKNOWN`。

**OQ-C**：`feature_disabled` / 403 分支若步骤 8 未拿到 flag-off 产品 → 按方案 §6 假设实现，文件头或分支处注释 **`// OQ-C: 未证实，待 flag-off 产品补验`**，单测用 mock，**不得**标为已核实。

**(b)** 新建：`cli/src/lib/qa-insights/errors.ts`、`cli/tests/qa-insights-errors.unit.test.ts`。

**(c)** `npm test -- qa-insights-errors` 全绿；测试名须对齐 **OQ#1**、**§6**、**`P9`**（写 POST 5xx→UNKNOWN、GET 5xx、401、403/404 或信封失败）；OQ-C 未实测分支须在测试名或注释中标 **`OQ-C-unverified`**。

**实测**：`qa-insights-errors` **35 passed**；全量 **23 files / 376 tests passed**，无回归。

**按步骤 8 实测表实现（与原计划假设不同处）**：
1. **写路径 not-found 不走 HTTP 404** —— 按 `FAILURE_INVALID_INPUT` + `msg` 含 `not found`/`不存在` 判定 → `FAILURE`/`not_found`。HTTP 404 分支保留但**仅供读路径**。
2. **`FAILURE_INVALID_INPUT` 一码多义** —— msg 敏感分类；无法确认为 not-found 时**保守归 `validation`**。单测以 OQ-A/OQ-B **原样 payload** 为 fixture，形态漂移即红灯。
3. **失败响应 `data` 可能非空** —— 单测显式断言 OQ-A 的 `data` 非空但仍判 FAILURE（防「有 data 即成功」误判）。
4. **403** —— `code: INSUFFICIENT_PERMISSIONS` 实测两次（PATCH/019fb1ff 授权前、POST/019fb201）；ACL 缺失 → `auth`，msg 含 feature 字样 → `feature_disabled`（该细分标注 `OQ-C-unverified`）。
5. **depth>5** —— 代码注释标注取自 §15 文档、**未实测**（探针被产品权限拦截）。

【状态：完成】

---

## 步骤 10 — 实现 `reconcile-requirement.ts` + 单测

**(a)** 实现 Table A 五行纯函数：`strong_match_single` / `strong_match_multiple` / `patch_already_applied`（**仅变动键**，rev.4 §3.3.5）/ `patch_still_old` / `no_match`；多匹配返回全 `id` 列表，**不**自动绑定（无 `--bind-id`）。

**(b)** 新建：`cli/src/lib/qa-insights/reconcile-requirement.ts`、`cli/tests/qa-insights-reconcile-requirement.unit.test.ts`。

**(c)** `npm test -- qa-insights-reconcile-requirement` 全绿；测试名须含 **`A1-TA-1`**～**`A1-TA-5`**、**`P5`**、**`P13`**；`patch_already_applied` 仅比变动键；`strong_match_single` 时 `matched_requirement_ids.length === 1`。

【状态：未开始】

---

## 步骤 11 — 实现 `reconcile-testpoints.ts` + 单测

**(a)** 实现条数核对（对齐 rev.4 §3.3.7，**Phase 1a 将中间态收成一个桶**）：

- `count_after === count_before + batch_size` → **`RECONCILED`**
- `count_after === count_before` → **`FAILURE`** + `decision: retry_same_batch`
- **其他一切**（`count_after` 既非 `count_before` 也非 `count_before + batch_size`）→ **`FAILURE`** + `decision: **count_unexpected**` + 提示人工查库
- 缺 `count_before` → validation 拒绝（**不**自行 GET 猜基线）

以上非 `RECONCILED` 分支 **一律不自动 POST**。

**(b)** 新建：`cli/src/lib/qa-insights/reconcile-testpoints.ts`、`cli/tests/qa-insights-reconcile-testpoints.unit.test.ts`。

**(c)** `npm test -- qa-insights-reconcile-testpoints` 全绿；测试名须含 **`A2-§9.4`**、**`P8`**、**`P9`**；覆盖四类：`old + batch` → `RECONCILED`、`old` 不变 → `retry_same_batch`、**`count_unexpected`（合并原 partial / high 两例为一组断言，偏低与偏高各一条输入即可）**、缺 `count_before` → validation。

【状态：未开始】

---

## 步骤 12 — 实现信封输出与 exit code 工具

**(a)** 新建 `cli/src/lib/qa-insights/envelope.ts`：`printEnvelope(envelope)` → stdout JSON；`exitCodeForOutcome(outcome)` **两档**映射：`SUCCESS`/`NOOP`/`RECONCILED` → **0**；`FAILURE`/`UNKNOWN` → **1**（含 `validation` 类 `FAILURE`）。在函数注释中写明：**skill 以 JSON `outcome` 为准，exit code 仅粗分成功/需关注**。

**(b)** 新建：`cli/src/lib/qa-insights/envelope.ts`；`cli/tests/qa-insights-envelope.unit.test.ts`。

**(c)** `npm test -- qa-insights-envelope` 全绿；测试名标注各 `outcome` 的 exit code（**SUCCESS/RECONCILED/NOOP→0**、**FAILURE/UNKNOWN→1**）；`printEnvelope` 输出可 `JSON.parse` 且含 `outcome`/`command`/`meta`；断言五值 enum 全覆盖且**无** `DUPLICATE_BLOCKED`、**无** exit 2/3。

【状态：未开始】

---

## 步骤 13 — 注册 `qa-insights` 命令骨架

**(a)** 新建 `cli/src/commands/qa-insights.ts`：`registerQAInsightsCommand(program)`，挂空壳子命令组 `qa-insights`（`module-tree`、`requirements`、`testpoints` 嵌套），暂只实现 `--help`。

**(b)** 修改：`cli/src/index.ts`（`import` + `registerQAInsightsCommand(program)`）。

**(c)** `cd cli && npm run build && node dist/index.js qa-insights --help` 能列出子命令树；**现有** `npm test` 仍全绿。

【状态：未开始】

---

## 步骤 14 — 子命令：`module-tree node create`

**(a)** 实现 `cawplan qa-insights module-tree node create <product_id> --parent-id --name [--dry-run]`：组 body、调 `cawplanRequest` POST、映射 `FAILURE_INVALID_INPUT`、输出信封。

**(b)** 修改：`cli/src/commands/qa-insights.ts`（`module-tree` → `node create` action）。

**(c)** 单测/mock：`--dry-run` 输出 `post_body` 且无 HTTP；测试名含 **`A1-MT-1`**、**`P11`**；`qa-insights module-tree node create --help` 显示参数。

【状态：未开始】

---

## 步骤 15 — 子命令：`requirements create`（直白 POST，无 opt-in 去重）

**(a)** 实现**唯一**路径：`--body-file`/`--body` 解析 → body-builders 校验 → **直接 POST**（无 GET、无 POST 前强匹配）；`--dry-run`；成功/失败/UNKNOWN 信封。**Phase 1a 不实现** `--reconcile-first` / `--force-new` / `DUPLICATE_BLOCKED` —— 重复防护由 skill 侧 Table B + `requirements reconcile`（步骤 17）承担，A1 step 11 Gate 首次归档本就 **POST 前不 GET**。

**(b)** 修改：`cli/src/commands/qa-insights.ts`（`requirements create`）。

命令签名（Phase 1a 最终形态）：

```bash
cawplan qa-insights requirements create <product_id> \
  [--body-file <path> | --body '<json>'] [--dry-run]
```

**(c)** 单测 mock：路径**不**调用 GET requirements；测试名含 **`A1-TB-1`**、**`A1-PW-2`**、**`P1`**；禁发字段 → validation 不发 POST；`--help` **不含** `--reconcile-first` / `--force-new`。

【状态：未开始】

---

## 步骤 16 — 子命令：`requirements update`

**(a)** 实现 `--desired-file` + `--snapshot-file` → snapshot-diff → PATCH 仅变动键；空 diff → `NOOP`；`--dry-run`；禁发字段硬失败。

**(b)** 修改：`cli/src/commands/qa-insights.ts`（`requirements update`）。

**(c)** 单测：测试名含 **`A1-WB-4`**、**`A1-TB-3`**、**`P4`**；仅 summary 变时 `patch_body` 仅 `{summary}`；无变 `outcome: NOOP` 且不 PATCH。

【状态：未开始】

---

## 步骤 17 — 子命令：`requirements reconcile`

**(a)** 实现只读 Table A：GET list by `module_tree_node_id` + probe 强匹配；PATCH pending 分支；`matched_requirement_ids` 单条时长度 1；**无** `--bind-id`（多匹配列全 id，交 SQA 选）。

**(b)** 修改：`cli/src/commands/qa-insights.ts`（`requirements reconcile`）；复用 `reconcile-requirement.ts`（步骤 10）与 `strong-match.ts`（步骤 4）。

**(c)** 单测：测试名含 **`A1-TA-1`**～**`A1-TA-5`**、**`P2`**、**`P5`**、**`P13`**；决策码与 §3.3.5 表一致；强匹配命中 → `RECONCILED`（**不**产生 `DUPLICATE_BLOCKED`）。

【状态：未开始】

---

## 步骤 18 — 子命令：`testpoints archive`

**(a)** 实现 POST batch：四键校验、**不 GET**、成功判定 `code===SUCCESS` 且返回长度一致；写失败 5xx/transport → `UNKNOWN`（同次不 GET）。

**(b)** 修改：`cli/src/commands/qa-insights.ts`（`testpoints archive`）。

**(c)** 单测：测试名含 **`A2-§9.5`**、**`A2-§8.5`**、**`P7`**、**`P9`**、**`P10`**；正常路径无 GET testpoints；长度不等 → `FAILURE`。

【状态：未开始】

---

## 步骤 19 — 子命令：`testpoints reconcile`

**(a)** 实现 GET 一次 + 条数核对；`--count-before` 必填；`count_unexpected` → **FAILURE、不 POST**（Phase 1a 合并桶，见步骤 11）；`retry_same_batch`；**永不** POST。

**(b)** 修改：`cli/src/commands/qa-insights.ts`（`testpoints reconcile`）；复用 `reconcile-testpoints.ts`（步骤 11）。

**(c)** 单测：测试名含 **`A2-§9.4`**、**`P8`**、**`P9`**；缺 `--count-before`、`old + batch`、`old` 不变、`count_unexpected`（偏低/偏高各一条）全覆盖。

【状态：未开始】

---

## 步骤 20 — CLI 全量单测与构建

**(a)** 跑通全部新增与回归单测；修复 lint/TS 问题；汇总 parity 覆盖。

**(b)** 命令：

```bash
cd cli && npm run build && npm test
```

**(c)** 全部 test files 绿；`qa-insights-*.unit.test.ts` 输出中 **§8 的 P1–P13** 可逐一对上（含命令层 mock 单测；**`P2` 由 `requirements reconcile` 单独承担** —— reconcile-first 语境已随 Phase 1a 削减移除）；`dist/index.js` 含 `qa-insights` 六子命令。

【状态：未开始】

---

## 步骤 21 — bump `cli/package.json` 版本

**(a)** 将 `cli/package.json` `version` 从 `0.0.24` bump 至 `0.0.25`（或下一 patch）；**不**动根 `VERSION` / skill / plugin。

**(b)** 修改：`cli/package.json`（仅 `version` 字段）。

**(c)** `cd cli && npm run build` 后 `node dist/index.js --version` 显示新版本；根 `VERSION` 仍为 `0.2.6`。

【状态：未开始】

---

## 步骤 22 — 仓库 skill 校验回归

**(a)** 确认 Phase 1a **未改** skill 前提下校验仍绿。

**(b)** 命令（仓库根）：

```bash
bash scripts/validate-skills.sh
```

**(c)** 输出 `All skill validations passed.`；`git status` 无 skill / plugin 意外修改。

【状态：未开始】

---

## 步骤 23 — 编写人工冒烟脚本（不进 CI）

**(a)** 新建 `cli/scripts/qa-insights-write-smoke.sh`：按方案 §7.2 表顺序调用六子命令；硬编码测试 `product_id`；每步检查 JSON `outcome`；**不**接入 `.github/workflows`。

**脏数据可辨认（必做）**：脚本对**所有创建的 requirement** 在文本字段（如 `summary` / `function_description`）加**时间戳前缀** `[SMOKE-<YYYYMMDDTHHMM>] `，模块树节点名同理。前缀由脚本运行时生成（如 `date -u +%Y%m%dT%H%M`）。

**(b)** 新建：`cli/scripts/qa-insights-write-smoke.sh`（可 `chmod +x`）。

**(c)** `bash -n cli/scripts/qa-insights-write-smoke.sh` 通过；脚本注释标明需 `cawplan auth`、仅测试 product；**并注明**：「本脚本会在测试 product 上**累积**冒烟数据（§7.2 步骤 3 刻意验证『默认不去重』会真建重复条目），**Open API 无 DELETE requirement 接口**，需**定期人工清理**；带 `[SMOKE-` 前缀便于识别与 grep。」

【状态：未开始】

---

## 步骤 24 — 本地真写库冒烟（**必做**）

> Phase 1a **唯一**完整端到端写库验证（步骤 14–19 以 mock/dry-run 为主；步骤 8 仅为不存在 id 的错误形态探针）。**未跑通不得进入步骤 25 验收。**

**(a)** 在测试 product `019fb1ff-d547-741f-bfa2-405386d04d5b` 上跑通方案 §7.2 全流程。**Phase 1a 调整**：原 §7.2 步骤 5「`create --reconcile-first` 同五字段 → `DUPLICATE_BLOCKED`」**已删除**（该 flag 不再实现）；原步骤 5b 多匹配验证由 **`requirements reconcile`** 承担（同五字段重复 create 后自然形成多行，若环境允许）。

**(b)** 命令：

```bash
cawplan auth status   # 须已登录
bash cli/scripts/qa-insights-write-smoke.sh
```

**(c)** 关键断言（对照 **P1–P13**）：create 无 POST 前 GET（**P1**）；`requirements reconcile` → `RECONCILED`，多匹配列全 id（**P2**、**P13**）；update 仅变动键（**P4**）；archive 无 GET、信封长度（**P7**）；testpoints reconcile 条数（**P8**）；禁发字段无 HTTP（**P6**）；`--dry-run` 无写（脚本末步）。全程 **仅测试 product**。

**脏数据备注**：本步会在测试 product 留下带 `[SMOKE-` 前缀的 requirement（含 §7.2 步骤 3 刻意产生的重复条目）；**API 无删除接口，需定期人工清理**。

【状态：未开始】（首次写请求确认关卡已前移至步骤 8）

---

## 步骤 25 — Phase 1a 验收对照（方案 §13）

> **硬前置**：步骤 24 真写库冒烟已跑通；否则 **不得**标 Phase 1a 完成。

**(a)** 逐条勾选方案 §13 验收标准与 §8 Parity P1–P13；确认 **未改** skill、逃生舱仍可用。**Phase 1a 例外说明**：§13 中涉及 `--reconcile-first` / `DUPLICATE_BLOCKED` / exit code 分层 / `count_mismatch_*` 细分的勾项，按本文顶部约定标注 **「Phase 1a 已削减 — 不适用」**，不算未完成项。

**(b)** 对照文档：`QA_INSIGHTS_WRITE_COMMANDS_IMPLEMENTATION_PLAN.md` §13、§8.2；步骤 1 字段实测表、步骤 8 OQ-A/B/C 实测表一并归档。

**(c)** 在 PR 描述或本文件后续修订中记录勾选结果；未勾项（除上述「不适用」外）或未跑步骤 24 → Phase 1a **未完成**。

【状态：未开始】

---

## 依赖关系简图

```text
0 基线
 → 1 只读探路 GET（【用户确认】）— 须在一切 lib 之前
 → 2 types（依步骤 1 实测字段；outcome 五值）
 → 3–7 lib + 单测（normalize / strong-match / snapshot-diff / body-builders / api-codes；含 parity 测试名）
 → 8 OQ-A/B/C 探针（含真实写请求 →【用户确认】；须在 errors 之前；全零 UUID）
 → 9 errors（依步骤 8 实测；OQ-C 未证须标注）
 → 10–11 reconcile-requirement / reconcile-testpoints（条数中间态合并为 count_unexpected）
 → 12 envelope（exit code 两档 0/1）
 → 13 注册骨架
 → 14–19 子命令（14 独立；15 create 直白 POST；16 update；17 reconcile 依赖 4+10；18–19 依赖 11）
 → 20 全量单测 + parity 汇总（P1–P13）
 → 21–22 版本 bump + validate-skills
 → 23 冒烟脚本（[SMOKE-<ts>] 前缀）
 → 24 真写库冒烟【必做】
 → 25 验收（硬依赖 24）
```

---

## 明确不做（Phase 1a 禁止项）

- 不修改 `skills/cawplan-requirement-analyze/SKILL.md`、`skills/cawplan-testpoint-generate/SKILL.md`
- 不修改根 `VERSION`、`.claude-plugin/`、`.cursor-plugin/`、`.codex-plugin/`
- 不实现读命令薄包装（`module-tree get`、`requirements list/get`、`testpoints list`）；步骤 1 只读探路 **仅**用逃生舱 `cawplan api GET`
- **不实现** `requirements create` 的 `--reconcile-first` / `--force-new`，**不产生** `DUPLICATE_BLOCKED` outcome，**不做** exit code 分层（仅 0/1），**不细分** `count_mismatch_partial` / `count_mismatch_high`（合并为 `count_unexpected`）
- 不把写库联调接入 CI / GitHub Actions secret（步骤 24 仅本地人工）
- 步骤 8 探针 **不得**使用全零 UUID 以外的 requirement id

---

## Phase 1a 削减说明（相对 rev.4）

本轮从 rev.4 执行计划中删除的，**全部是 skill 从不调用的路径**；rev.4 §2.1 的 correctness-critical 判据与被 skill 调用的 **6 个子命令一条未动**。

| 删除项 | 理由 |
|--------|------|
| `requirements create --reconcile-first` / `--force-new`（原步骤 16 整步） | rev.4 §3.2 自述「skill 正常流程**不用**」；A1 step 11 Gate 首次归档本就 POST 前不 GET。重复防护仍由 skill Table B + `requirements reconcile` 承担 |
| `DUPLICATE_BLOCKED` outcome 及其 exit code 2 | 仅由 `--reconcile-first` 产生，随之移除；`requirements reconcile` 命中仍返回 `RECONCILED` |
| exit code 分层（0/1/2/3） | 收成 0/1；skill 消费的是 JSON `outcome`，分层无实际消费者 |
| `count_mismatch_partial` / `count_mismatch_high` | rev.4 自述「A2 真源未写，防御性扩展」「理论上不应出现」（batch 全成全败）；合并为单一 `count_unexpected`，处置动作完全相同（FAILURE + 人工查库 + 绝不自动 POST） |

**一条未动（保留全部 correctness-critical 判据）**：`normalize`（`out_of_scope` 三态等价）、`strong-match`（五字段、summary 不参与）、`snapshot-diff`（PATCH 仅变动键）、`body-builders`（禁发三字段硬失败、batch 四键）、两套 reconcile 策略分离（A1 五字段强匹配 / A2 条数核对）、写后 5xx → `UNKNOWN`、**永不自动第二次 POST**、多强匹配无 `--bind-id`。

**被 skill 调用的 6 个子命令全部保留**：`module-tree node create`、`requirements create`、`requirements update`、`requirements reconcile`、`testpoints archive`、`testpoints reconcile`。

---

## 当前进度

**已完成**：
- 步骤 0（执行前基线）—— 构建无错、17 files / 187 tests 全绿、skill 校验通过、CLI 版本 `0.0.24`。
- 步骤 1（只读探路 GET）—— 两条只读 GET 均 `code: SUCCESS`；字段形态与方案假设**完全一致**（详见步骤 1「字段映射表」）。**无写操作。**

- 步骤 2–7（types + normalize / strong-match / snapshot-diff / body-builders / api-codes）—— 六个纯离线模块 + 五个单测文件全绿。**全程无后端调用。**
- 步骤 8（OQ-A/B/C 写探针）—— 已实测，**结果推翻方案假设**：写路径 not-found 为 **HTTP 200 + `FAILURE_INVALID_INPUT`**，非 HTTP 404（详见步骤 8「OQ-A/B/C 实测表」）。全零 UUID，**未产生任何数据**。

**测试计数**：基线 17 files / 187 tests → 现 **22 files / 341 tests passed**（新增 154：normalize 28、strong-match 27、snapshot-diff 28、body-builders 45、api-codes 26）。`npm run build` 无 TS 错误；无回归。

- 步骤 9（`errors.ts`）—— 按步骤 8 实测表实现两层错误映射，35 passed。

**测试计数**：**23 files / 376 tests passed**（基线 187 + 新增 189）。

**下一步**：步骤 10–12（reconcile-requirement / reconcile-testpoints / envelope）—— 纯离线，可连续执行。再下一停点为**步骤 24 真写冒烟**（步骤 13–23 为命令层 + mock 单测，不碰真实后端）。

**已确认事项**（用户 2026-08-06 回复）：
1. 步骤 1 字段映射表无误，准予进入 lib 实现；
2. 后续写操作（步骤 8 探针、步骤 24 真写冒烟）落在 **proto** 环境。
