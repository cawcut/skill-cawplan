# A4 Execution Rules

契约 §5.2、§6.0.7、§6.2。与 `ux.md` 配合；**禁止**在 workflow 开场与 `ux.md` 一并 Read。

---

## §0 URL 与 Step 0

| 输入 | 提取 |
|------|------|
| `tests/view/{id}` | `test_id`（**不是** `result_id`） |
| `/product/{pid}/versions/{major}/{version_id}/overview/...` | `product_id`=第一段 UUID；**API 用第二段** `version_id` |
| `plans/view` / `runs/view` | 仅缺 version 时 `resolve-url` |

**第一步决策**

| 用户输入 | 第一步 | 禁止 |
|----------|--------|------|
| tests/view + Version URL | `failures --test-id` | 直接 `defects draft` |
| tests/view，无 Version | 追问或 `resolve-url` | test_id 当 result_id |
| A3 同会话已有 failures 行 | `defects draft` | 重复 failures |
| 明确 `result_id` 且非 tests/view 来源 | `defects draft` | — |

**冷启动（唯一 canonical bash）**

```bash
# ❌ defects draft <product_id> <test_id> ...
# ✅ 顺序：
cawplan qa-insights testrail execution failures <product_id> <version_id> --test-id <test_id> --limit 20
cawplan qa-insights testrail defects draft <product_id> <items[0].result_id> \
  --version-id <version_id> --run-id <run_id> --case-id <case_id> --test-id <test_id>
```

`failures`：`--test-id` 必传；首轮不传 `--run-id` / `--include-flaky`。  
`TEST_NOT_IN_VERSION` 等失败 → 补 `run_id` 重试：`failures --test-id --run-id`。  
`resolve-url` 仅缺 version 且无门户链接时；已有 Version URL 勿调用。

**product_id**：门户 URL → 提取；仅 TestRail → `products list`；0/多个 → `ux.md` 缺产品交互。

**会话缓存**：`result_id`、`test_id`、`run_id`、`case_id`、`version_id`、`comment`、`case_title`、`created_on`。

**跳过 Step 0**：A3 行含 `result_id`+`comment` 且 `result_id !== test_id`；或合法非 tests/view 来源 `result_id`。仅贴 tests/view **不算**。

---

## §1 Step 1 draft

**自检（缺一停，回 Step 0）**：`result_id` 来自 Step 0 且 `!== test_id`；有 `run_id`、`case_id`。

```bash
cawplan qa-insights testrail defects draft <product_id> <result_id> \
  --version-id <version_id> --run-id <run_id> --case-id <case_id> --test-id <test_id>
```

**draft 后质检**：`remarks` 含 `See the linked TestRail result for failure details` → Result 定位错误，回 Step 0。  
`recommendation=SKIP_BUG` → 跳过 §Title，进 `ux.md` 决策闸。

---

## §Title 标题精炼（CREATE_NEW）

BE `draft.description` 仅为初稿；**默认不直接创建**。

- ≤80 字；功能 + 失败点；禁止整段 `case_title`、禁止 URL/步骤进标题
- 输入优先：Step 0 `comment`+`case_title`（P0）→ `draft.remarks` 各节 → BE 初稿
- 步骤：提功能对象 → 提实际结果 → 生成 1 个推荐标题 → 写入 body 的 `draft.description`（确认前不提交）
- 优先现象式/偏差式标题；`link-ticket` 不改标题

| BE 初稿 | 推荐 |
|---------|------|
| `主 workspace 成员登录验证 — 实际进入子 workspace` | `成员登录误入子 workspace` |
| `导出报表功能 — 点击导出无响应` | `报表导出点击无响应` |

`comment` 为空或 `result_id===test_id` → 先 Step 0，勿用占位 remarks 精炼。

---

## §Create create-ticket / link-ticket

**须先过** `ux.md` 决策闸与提交闸。

| 命令 | 路径 | Body/Flags | 禁止 |
|------|------|------------|------|
| `defects draft` | `<product_id> <result_id>` | `--version-id` 等 flag | test_id 当 result_id |
| `create-ticket` | `<product_id> <result_id>` | `--body-file` + `--confirm` | 字段 flag、`--result-id` |
| `link-ticket` | `<product_id> <result_id>` | `--ticket-id` + `--confirm` | draft flag |

**body 顶层仅** `draft` + `link_existing_ticket_id`（新建时 null）。以 `defect-draft` 响应为底，覆盖 SQA 确认的 `description`/`remarks`。  
`remarks` 多行 → 必须 `--body-file`。

**流程**：组装 JSON（`/tmp/a4-create-ticket.json`）→ `--dry-run` → 提交闸 → `--confirm`。

**常见报错**：`unknown option '--description'` → 改 body-file；`CONFIRMATION_REQUIRED` → 加 `--confirm`；body 含 `product_id` → 删除。

| 维度 | `defect-draft` | `create-ticket` |
|------|----------------|-----------------|
| 参数 | 字段 flag | 整包 JSON |
| 写 | 无 `--confirm` | 必须 `--confirm` |

**link-ticket**：`--ticket-id <uuid>`；不走 create body。

## 异常码

| code | 动作 |
|------|------|
| `TEST_NOT_FOUND` | 停步 → `ux.md §Errors` |
| `TEST_NOT_IN_VERSION` | 换 version 或 `run_id` 重试 |
| `TEST_RUN_MISMATCH` | 核对 test/run |
| `TESTRAIL_UNAVAILABLE` | 稍后重试 |
| draft 占位 remarks | 回 Step 0 |
