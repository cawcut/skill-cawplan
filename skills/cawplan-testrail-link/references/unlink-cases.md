# Workflow C — Unlink Cases（解绑失效/错误的旧映射）

> CLI：`qa-insights testrail link cases unlink preview|execute`
> BE：`POST /api/v1/public/openapi/product/{product_id}/qa/testrail/link/cases/unlink/preview|execute`

只**软删除 CawPlan 的 Case 映射**，使测试点可以重新链接到新用例。**不**修改、不删除 TestRail 上的用例，**不**动 Plan / Run / 缺陷关联。

## §Prerequisites

1. 已有 `product_id`、`requirement_id`。从 Workflow A 接续时直接复用 `ux.md §ConfirmState`（含 `confirmed_suite_id`）。
2. 独立进入（用户直接说「解绑旧映射」）：缺字段 → `ux.md §Prompts` 框 A1；`suite_id` 可选，用户给了才传。
3. 不单独 `mappings get` 选 Suite：解绑的 `--suite-id` 只是过滤条件，不传则处理该需求下全部映射。

## §PreviewCLI

默认只解绑**已失效**的映射：

```bash
cawplan qa-insights testrail link cases unlink preview <product_id> \
  --requirement-id <requirement_id> \
  [--suite-id <confirmed_suite_id>]
```

用户**明确**要求换绑 / 重做时才用：

```bash
# 指定测试点 / Case / 映射（可重复）
cawplan qa-insights testrail link cases unlink preview <product_id> \
  --requirement-id <requirement_id> --scope SELECTED \
  [--test-point-id <id>]… [--case-id <n>]… [--mapping-id <id>]…

# 整个需求全部重做（Agent 不主动提议）
cawplan qa-insights testrail link cases unlink preview <product_id> \
  --requirement-id <requirement_id> --scope ALL_IN_REQUIREMENT
```

| 规则 | 说明 |
|------|------|
| `--scope` 默认 | `STALE_ONLY` |
| 选择项 | `--test-point-id` / `--case-id` / `--mapping-id` **仅**配 `--scope SELECTED`；`SELECTED` 至少给一个，否则 CLI 本地报 `SELECTION_REQUIRED` |
| `ALL_IN_REQUIREMENT` | 仅当用户明确说「整个需求全部重做」；先复述影响范围再预览 |

成功 → 存 `preview_id`（仅内部）；展示 `ux.md §PreviewUnlink`。

## §PreviewFields

| 字段 | Agent 用途 |
|------|------------|
| `summary.to_unlink` | 确认闸门槛；`0` → 不弹确认 |
| `summary.stale` / `alive` / `unknown` | 汇总行；`stale` 对应「旧用例已失效」 |
| `summary.alive_selected` | `>0` → 须用框 A-unlink-confirm-alive |
| `summary.moved` | 存活但已被移到其他目录的数量 |
| `summary.origin_import` / `origin_manual_link` | 来源汇总 |
| `items[].case_state` | `STALE_DELETED` / `STALE_NOT_FOUND` / `ALIVE` / `UNKNOWN`；**只信此字段**判断失效 |
| `items[].action` | `UNLINK`（将解绑）/ `SKIP` |
| `items[].skip_reason` | `CASE_ALIVE` / `TESTRAIL_STATE_UNKNOWN` / `NOT_SELECTED` |
| `items[].origin` | `IMPORT` / `MANUAL_LINK` |
| `items[].case_url` | **必须用 API 值**作为 Case 链接 |
| `warnings[]` | `ux.md §PreviewWarnings` |

`case_state` 为空表示该行未检查（`SELECTED` 范围内或 `NOT_SELECTED` 的行），不得当作失效。

## §State（状态机）

```
PREVIEWED ──确认──▶ EXECUTED ──(从 A 接续)──▶ RELINK_PREVIEWED
    │                   │
    └─ PREVIEW_EXPIRED → 重新 preview（须重新确认）
```

- 任何一步失败**不自动重试写操作**。
- `unlink execute` 之后**必须重新** `link cases preview`，不得用解绑前的 link preview 的 `preview_id` 去 link。
- 换 `product_id` / `requirement_id` → 清全部状态；换 Suite → 须新 preview。

## §ExecuteCLI

```bash
# 仅失效映射（alive_selected = 0）
cawplan qa-insights testrail link cases unlink execute <product_id> \
  --preview-id <preview_id> --confirm

# 含仍存在的用例（alive_selected > 0，且用户在加强版确认框同意）
cawplan qa-insights testrail link cases unlink execute <product_id> \
  --preview-id <preview_id> --confirm --confirm-alive-cases
```

- 无 `--confirm` → CLI 本地 `CONFIRMATION_REQUIRED`。
- `to_unlink=0` → **不调用** execute。
- `--confirm-alive-cases` **只**在用户于框 A-unlink-confirm-alive 明确同意后添加；`alive_selected=0` 时不加。
- 成功 → `ux.md §ResultUnlink`。

## §SelectedUnlink（换绑 / 指定解绑）

仅当用户**明确**提出（例：「把这个测试点的旧用例解绑」「这条 link 错了，换到另一个用例」）：

1. 用 `--scope SELECTED` 加对应选择项预览。
2. `alive_selected>0` → 框 A-unlink-confirm-alive；用户未同意则**停止**，不 execute。
3. `warnings` 含 `IMPORT_ORIGIN_INCLUDED` → 在确认框正文追加提醒：该映射由导入生成，若之后重新导入，请先处理 TestRail 里的旧用例以免重复。
4. 解绑完成后，提示用户重新执行 link（回到 Workflow A）；不自动 link，除非是从 A 接续进来的。

## §Safety（SHALL）

1. 未经用户确认，不得调用 `unlink execute`。
2. 不得自行添加 `--confirm-alive-cases`。
3. `case_state = UNKNOWN` 的项一律不解绑；告知用户 TestRail 暂时无法确认，可稍后重试。
4. 解绑后不得跳过重新 preview 直接 link。
5. 展示时必须说明：解绑只清除 CawPlan 的关联，**不会修改或删除 TestRail 上的任何用例**。
6. 已创建的 Plan / Run 不受解绑影响。解绑完成后固定提示一句：若该需求所属版本的测试计划是用旧映射生成的，必要时请重新编排（`cawplan-testplan-layout`）。
7. 失效判断只信后端 `case_state`，不得由 Agent 推断。

## §Errors

见 `SKILL.md` 错误码表（`SELECTION_REQUIRED` / `PREVIEW_TOO_LARGE` / `ALIVE_CASES_REQUIRE_CONFIRMATION` / `NO_ITEMS_TO_UNLINK` / `PREVIEW_EXPIRED` / `CONFIRMATION_REQUIRED`）与 `ux.md §Errors`。
