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

## §Suite

preview 前 `mappings get <product_id>`，记录 `default_suite_id`、`section_mappings`、`case_template_id`。

- 无 `--suite-id` → `default_suite_id`；空则停（`ux` 框 3）
- `--suite-id` 须属当前 Product 的 TestRail Project
- `SUITE_NOT_IN_PROJECT` → 阻断

## §Version

用户指定版本 → 写入 `version_name`。REQUIREMENT：`--version-name`。INLINE：body 顶层 + 每条 `cases[]` 一致。冲突 → `ux` 框 2，确认前不 preview。

## §字段

`cases[]` 用 snake_case。INLINE 支持字段：

| 字段 | TestRail | 备注 |
|------|----------|------|
| `title` | `title` | 必填 |
| `steps[]` | `custom_steps_separated` | `{content,expected}` |
| `preconditions` | `custom_preconds` | |
| `version_name` | `custom_case_version` | 指定版本时必填 |
| `importance` | `custom_importance` | Must/Should/Nice 或 1–3 |
| `priority` | `priority_id` | 见 §T1 |
| `automation_*` | `custom_automation__*` | 有值才写 |
| `source_case_key` | refs `cawplan:case_*` | 同 TP 多条时推荐 |
| `tags` | — | 不写 label（BE 未实现） |

**AUTO_BY_GROUP**：`Suite → requirement.summary → group`（无 group → `未分组`）。INLINE 尽量带 `requirement_id`，否则 `MISSING_REQUIREMENT_ID` warning。

**一对多**：同 `test_point_id` 多条 Case；须不同 `source_case_key`（或后端 `content_hash`）。不得以 `req+tp` refs  alone 作唯一幂等键。

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
| INLINE | `source`+`cases[]` | `--source-type INLINE` |
| REQUIREMENT | `source`+`requirement_id` | `--source-type REQUIREMENT --requirement-id` |

preview 前自检：`source.type` · INLINE 有 cases · REQUIREMENT 有 requirement_id · suite_id 过门禁 · version_name（若需）

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

## §CLI

```bash
cawplan qa-insights testrail mappings get <product_id>

# REQUIREMENT（推荐 flags）
cawplan qa-insights testrail import preview <product_id> \
  --source-type REQUIREMENT --requirement-id <id> --suite-id <n> --version-name "x.x.x"

# INLINE（推荐 body-file 含 source）
cawplan qa-insights testrail import preview <product_id> --body-file /tmp/body.json
# 或 --source-type INLINE --body-file ...

cawplan qa-insights testrail import execute <product_id> --preview-id <id> --confirm
cawplan qa-insights testrail jobs poll|get <product_id> <job_id>
```

Preview 响应：`to_fail>0` 不得 execute；`section_creates` 需框 4 确认；存 `preview_id`。Section 展示 `target_section_path` 优先。

## §BE 缺口（2026-08-06）

| 项 | 状态 |
|----|------|
| `VERSION` 源 | ❌ |
| tags→Label | ❌ |
| `CONTENT_UNCHANGED` 跳过 | ❌ |
| 异步 Job >50 | ✅ poll |
| Public Open API | ❌ 用 internal `qa-insights testrail` |
