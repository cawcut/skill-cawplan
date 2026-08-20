# 导入规则与 BE 缺口（Agent 内部）

用户文案见 [ux.md](ux.md)。

## §数据源

| 规则 | 行为 |
|------|------|
| 有展开用例（`title`+`steps`/`expected`） | `INLINE` |
| 仅测试点 | `REQUIREMENT`（可能 1 TP = 1 Case） |
| `source.type=VERSION` | ❌ 不用 |
| 只跳过不覆盖 | 无强制更新；`SKIP` 不 update |
| refs 幂等 | `cawplan:req_*;cawplan:tp_*;cawplan:case_*` 完整命中才 SKIP |

**错 Suite 重导**：映射按 `product_id`+`case_id`/refs，**不会因换 Suite 自动迁移**；已有映射仍 `SKIP`。

## §Suite

preview / convert **前** `mappings get <product_id>`，记录 `suites[]`、`default_suite_id`、`section_mappings`、`case_template_id`。

| 规则 | 行为 |
|------|------|
| 用户确认 | **框 3**（`ux §SuiteConfirm`）或 `§Intent` Suite 显式命中 |
| **禁止** | 用户未确认时静默使用 `default_suite_id`；框 3 不做推荐标注 |
| 第一层 | 固定 3 项：使用已有 Suite / 新增 Suite / 先不导入 |
| 「已有」分支 | **不列举 `suites[]`**（不管有几个 Suite）；直接自由输入 Suite ID/名称/URL，本地按 `mappings.suites[]` 做名称匹配（见 `ux §SuiteConfirm` 命中数规则），不额外调接口 |
| 新增 Suite | 调用 `qa-insights testrail suite-create <product_id> --name <name>`（契约 §1.3）；名称收集后先二次确认再创建（不可逆、无删除 API）；`duplicate_warning`/`SUITE_CREATE_RATE_LIMITED`/`SUITE_MODE_NOT_SUPPORTED` 的处理见 `ux §SuiteConfirm`/`§Errors` |
| 自由输入选项数 | 已有/新增分支的手动输入步骤均为固定 **2 项**（先不导入 + 返回对方分支），禁止只给 1 项——`AskUserQuestion` 的 `options` 硬性要求 ≥2，只给 1 项会抛 `InputValidationError` 中断对话（历史 bug） |
| 写入 | REQUIREMENT → `--suite-id`；INLINE → `body.suite_id`；convert → `--suite-id`（**须框 3 已确认**） |
| 校验 | `suite_id` ∈ `mappings.suites[]`；否则 `SUITE_NOT_IN_PROJECT` |
| 单 Suite 产品 | 同样走「已有」分支自由输入（不做列表/快捷按钮），但正文追加一句该 Suite 名称+ID 作 FYI，方便用户直接回复确认 |

## §Section

`AUTO_BY_GROUP`（本 Skill 唯一使用的策略，不暴露 `MAP_BY_MODULE`/`FIXED_SECTION`）默认把 Requirement 顶级 Section 建在 Suite 根下。**框 3.5** 让用户决定是否改挂到一个已存在的 Section 下面（不新建顶级、避免 Suite 层级越堆越乱）。

| 规则 | 行为 |
|------|------|
| 触发 | **每次导入都问**（框 3.5，`ux §SectionConfirm`），紧跟在框 3 Suite 之后；或 `§Intent` 显式命中已有 Section |
| **禁止** | 未确认时静默新建顶级 Section 或静默复用上次 `parent_section_id` |
| 复用 | 同会话 `confirmed_parent_section_id` 仍有效（Suite 未变）且用户未要求换 → 免重复弹框，仍需在 `§Preview`/框 4 回显 |
| 依赖 | 选「已有目录」后**不再单独问 ID 还是名称**，一次自由输入同时接受两种格式，Agent 按内容格式自行判断；判断为名称时才调 `sections list <product_id> <suite_id>`（本会话内按 `suite_id` 缓存结果，不重复拉取，除非用户要求刷新） |
| 写入 | REQUIREMENT → `--parent-section-id`；INLINE → body 顶层 `parent_section_id`；convert → `--parent-section-id`（**须框 3.5 已确认**） |
| 校验 | 不在 Skill 侧预校验 ID；交给 `import preview` 返回的 `SECTION_NOT_IN_SUITE`/`SECTION_NOT_FOUND` 兜底 |
| 名称匹配 | 精确匹配优先，无结果退化为包含匹配；命中 **1 条 → 直接采用，不再二次确认**；**2–4 条 → `AskUserQuestion` 逐条列出**（`{name}（父级：{parent_name}）`）；**>4 条 → 不列表**，提示条数并要求换更精确的名称或改用 ID（`AskUserQuestion` 工具本身 `options` 上限为 4，非体验偏好） |
| 非破坏性但非无感 | 换 Section 归属不影响已导入 Case 的去重（不会重复建 Case），但会在新父级下**新建一份同名顶级 Section**——同一 Requirement 可能在 Suite 里出现两处；框 3.5 文案须提示这一点 |

## §Version

全程无感，**不弹窗、不推断、不确认**。仅 `§Intent` 显式命中版本号，或 INLINE 用例自带 `version_name` 时才写入；都没有则不传该字段（不阻断 preview）。写入位置：REQUIREMENT → `--version-name`；INLINE → body 顶层 + 每条 `cases[]`（各自透传，不强求一致）；convert → `--version-name`。未设置时，`ux §Preview`/`§Result` 等模板里 `{version_name}` 一律展示"未指定"。

## §ConfirmState（同会话复用）

Agent 须记住（内部，不对用户默认展示）：

| 字段 | 说明 |
|------|------|
| `confirmed_suite_id` | 框 3 或 Intent 确认后的 Suite ID |
| `confirmed_suite_name` | 对应名称（展示用） |
| `confirmed_parent_section_id` | 框 3.5 或 Intent 确认后的 Section ID；选「新建顶级 Section」时为 `null`（不传该字段） |
| `confirmed_parent_section_name` / `confirmed_parent_section_path` | 对应名称/父级路径（展示用） |
| `confirmed_version_name` | Intent 命中后的版本（无弹窗，见 §Version） |
| `cached_sections_by_suite` | 本会话内 `sections list` 结果缓存，key 为 `suite_id`（内部用，不对用户展示） |

**复用**：同会话重 preview（仅改数据源/修正用例、**未换 Suite/Section 归属**）→ **免框 3/3.5**，仍须在 `§Preview` 表头与框 4 展示已确认值。

**清除重确认**：

- 用户 Intent「换 Suite」或选不同 Suite → 清 `confirmed_suite_*` **及** `confirmed_parent_section_*`（Section 属于特定 Suite，不可跨 Suite 复用）→ 重走框 3 → 框 3.5
- 用户 Intent「换 Section 归属」或选不同 Section/改选「新建顶级」→ 仅清 `confirmed_parent_section_*` → 重走框 3.5（不影响已确认的 Suite）
- 用户提到新版本 → 直接更新 `confirmed_version_name`（无弹窗，不影响 Suite/Section）
- 换 `product_id` → 清全部 ConfirmState（含 `cached_sections_by_suite`）

## §字段

`cases[]` 用 snake_case。INLINE 支持字段：

| 字段 | TestRail | 备注 |
|------|----------|------|
| `title` | `title` | 必填 |
| `steps[]` | `custom_steps_separated` | `{content,expected}` |
| `preconditions` | `custom_preconds` | |
| `version_name` | `custom_case_version` | 有值才写（Version 无感，见 §Version） |
| `importance` | `custom_importance` | Must/Should/Nice 或 1–3 |
| `priority` | `priority_id` | 见 §T1 |
| `automation_*` | `custom_automation__*` | 有值才写 |
| `source_case_key` | refs `cawplan:case_*` | 同 TP 多条时推荐 |
| `tags` | — | 不写 label（BE 未实现） |

**AUTO_BY_GROUP**：`Suite → requirement.summary → group`（无 group → `未分组`）。INLINE 尽量带 `requirement_id`，否则 `MISSING_REQUIREMENT_ID` warning。

**一对多**：同 `test_point_id` 多条 Case；须不同 `source_case_key`（或后端 `content_hash`）。不得以 `req+tp` refs alone 作唯一幂等键。

## §T1

camelCase → snake_case（`testPointId`→`test_point_id` 等）。`tag`→`tags[]`。`steps[]`+`expected[]` 按下标合并。保留 `requirement_id`、`group`。

| T1 priority | TestRail |
|-------------|----------|
| P0 | CRITICAL |
| P1 | HIGH |
| P2 | MEDIUM |
| P3 | LOW |
| P4/P5/Pn(n>3) | LOW |

已是 LOW/MEDIUM/HIGH/CRITICAL 可直接用；无法识别 → 先问用户。

## §body

`source.type` 必填（body 或 `--source-type`）。`--body-file` 禁止省略 `source`。

| type | 必填 | CLI 替代 |
|------|------|----------|
| INLINE | `source`+`cases[]`+`suite_id` | `--source-type INLINE` |
| REQUIREMENT | `source`+`requirement_id`+`suite_id` | `--source-type REQUIREMENT --requirement-id` |

preview 前自检：`source.type` · **已确认 `suite_id`**（框 3）· **已确认 Section 归属**（框 3.5，`parent_section_id` 或不传）· INLINE 有 cases · REQUIREMENT 有 requirement_id（`version_name` 无需确认，有则带上）

**INLINE body 示例**：

```json
{
  "source": { "type": "INLINE" },
  "suite_id": 101,
  "version_name": "4.3.1",
  "cases": [{
    "title": "…", "test_point_id": "tp-1", "requirement_id": "req-1",
    "group": "…", "priority": "HIGH",
    "steps": [{ "content": "…", "expected": "…" }],
    "version_name": "4.3.1", "source_case_key": "tp-1-case-01"
  }]
}
```

## §Convert（A3 interim JSON → INLINE body）

**顺序（MUST）**：`mappings get` → **框 3 Suite** → **框 3.5 Section 归属**（如选「已有 Section」，先 `sections list` 匹配出 ID）→ `node convert_generate_to_import.js ... --suite-id <confirmed> [--parent-section-id <confirmed>] [--version-name <v>]` → preview。`version_name` 无需等待确认，命中 Intent 或用例自带即可直接带上。

禁止在框 3/3.5 确认前传入 `default_suite_id` 或静默 `parent_section_id`。

**为何存在**：A3 的 `cases[]` 只在会话内存；`convert_generate_to_import.js` 固化字段映射，Agent 只落 interim JSON 再跑脚本。

**输入**：与 A3 `csv-template-mapping.md` 同构的 interim JSON（camelCase）。

**映射规则**：（同前，略 — 见脚本与 §T1）

**CLI**：

```bash
node scripts/convert_generate_to_import.js <interim_json_path> \
  --suite-id <confirmed_suite_id> \
  [--parent-section-id <confirmed_parent_section_id>] \
  [--version-name "<confirmed_version>"] [-o <output_path>]
```

`--parent-section-id` 仅在框 3.5 选「导入到已有 Section」时传入；选「新建顶级 Section」时省略该参数（脚本不写 `parent_section_id` 字段，等价于 BE 默认行为）。

**失败恢复（摘除坏用例，2026-08 新增）**：脚本校验红线不变（steps/expected 长度不等等仍整批中断，不猜测、不补齐）。`convert` 失败时，Agent：

1. 读取脚本在 `<out>.errors.json` 写出的结构化明细（`index`/`title`/`reason`/`message`，`STEPS_EXPECTED_LENGTH_MISMATCH` 额外带 `steps_preview`/`expected_preview`，已截断至 100 字符）；
2. **主动向用户建议**摘除这几条、先导入其余用例：「这 N 条用例 {原因摘要} ，要不要先去掉这几条，导入其余 M 条？稍后你确认修正后我再帮你单独补导」；
3. 用户确认后，Agent 按 `errors.json` 里的 `index` 从 interim JSON 的 `cases[]` 中移除对应条目，重新跑 `convert`（不改脚本、不加参数，纯粹是输入变干净了）；
4. 用户若不同意摘除（要去 A3 重新生成这几条），则维持整批中断，走原路径。

**不做**：脚本不提供"自动跳过坏用例"的参数（如 `--skip-invalid`）——摘除必须经用户确认，走 Agent 编辑 interim JSON 这一步，不允许脚本静默部分放行。

## §CLI

```bash
cawplan qa-insights testrail mappings get <product_id>

# 框 3.5 选「已有 Section」+ 按名称查找时用（本会话内按 suite_id 缓存，勿重复调用）
cawplan qa-insights testrail sections list <product_id> <suite_id> [--refresh]

# REQUIREMENT（suite_id / parent_section_id 须已框 3/3.5 确认；version_name 若有则一并带上）
cawplan qa-insights testrail import preview <product_id> \
  --source-type REQUIREMENT --requirement-id <id> --suite-id <n> \
  [--parent-section-id <n>] [--version-name "x.x.x"]

# INLINE（body 含已确认 suite_id / parent_section_id / version_name）
cawplan qa-insights testrail import preview <product_id> --body-file /tmp/body.json

cawplan qa-insights testrail import execute <product_id> --preview-id <id> --confirm
cawplan qa-insights testrail jobs get <product_id> <job_id>
```

Preview 响应：`to_fail>0` 不得 execute；`section_creates` 需在框 4 一并确认；存 `preview_id`。

## §AsyncJob

| 规则 | 行为 |
|------|------|
| 触发 | `execute` 响应含 `job_id` 或 `status ∈ {PENDING, RUNNING}` |
| 默认 | **不** `jobs poll`；`ux §AsyncHandoff` + 框 6 |
| 查进度 | `jobs get` |
| 等到完成 | 用户确认后 `jobs get` 循环，间隔 5s；≥90s → `ux §AsyncTimeout` |
| 完成 | `COMPLETED` → `ux §Result` |
| 禁止 | Job 非终态重复 `execute` |
| 存储 | `product_id` + `job_id` + ConfirmState |

## §BE 缺口（2026-08-20）

| 项 | 状态 |
|----|------|
| `VERSION` 源 | ❌ |
| tags→Label | ❌ |
| `CONTENT_UNCHANGED` 跳过 | ❌ |
| 异步 Job >50 | ✅ get 查 progress |
| Public Open API | ❌ 用 internal `qa-insights testrail` |
| `sections list` + `parent_section_id` 挂靠已有 Section | ✅ 已实现（框 3.5，见 §Section） |
| 新增 Suite（`add_suite` 代理） | ✅ 已实现（框 3「新增」分支，见 §Suite） |
