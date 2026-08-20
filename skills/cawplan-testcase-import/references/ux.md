# UX — 字段友好名与用户引导

跟随用户**最近一条消息**主语言；禁止同段中英双语。Agent 自行 `AskUserQuestion`（不写入 `allowed-tools`）。

## §Glossary

`product_id`/`requirement_id` → 产品名/需求摘要。默认隐藏：`preview_id`、`job_id`、UUID、`source_case_key`、`module_tree_node_id`。

| 内部 | 展示 |
|------|------|
| `INLINE` / `REQUIREMENT` | 已展开用例 / 从测试点生成 |
| `CREATE`/`SKIP`/`FAIL` | 新建 / 跳过（已存在）/ 无法导入 |
| `MAPPING_EXISTS`/`REFS_EXISTS` | 已有映射 / 已导入过 |
| `to_create`/`to_skip`/`to_fail` | 将新建 / 将跳过 / 将失败 |
| `section_creates` | 将新建分组目录 |
| `suite_id` | 用例集（Suite） |
| `default_suite_id` | 产品默认用例集（框 3 不做推荐标注，仅 Intent 显式命中「用默认用例集」时使用） |
| `parent_section_id` | 挂靠目录（`{name}（ID {id}）`，与 `suite_id` 一样正常展示，不隐藏） |
| `PARENT_SECTION_ID_IGNORED` | 当前配置不支持挂靠已有目录，已按新建处理 |
| `version_name` | 目标版本（`custom_case_version`） |
| `MISSING_REQUIREMENT_ID` | 缺少需求关联，归档位置可能不完整 |
| T1 `P0–P3+` | 最高/高/中/低 · Pn（勿展示 CRITICAL 等枚举） |

## §Intent

自由文本先匹配，命中则不弹对应框（须在 preview 表头回显确认值）：

按上面导入·import above → INLINE 热接力 · 确认导入·confirm import · 先不·cancel · 重新预览·re-preview · 为什么跳过·why skipped · 技术详情·technical details · 只有测试点·test points only → REQUIREMENT

**Suite 显式指定**（跳过框 3，仍须在 preview/框 4 展示）：

`suite {id}`·用例集 {id}·suite id {n} → 匹配 `suite_id`，须 ∈ `mappings.suites[]` · `导入到 {suite_name}`·import to {name} → 名称唯一匹配 · `用默认用例集`·default suite → `default_suite_id`

**版本显式指定**（Version 无强制确认框，见 §VersionConfirm）：

`放到 {v}`·version {v}·目标版本 {v}·导入到 {v} 版本 → 写入 `version_name`

**Section 归属显式指定**（跳过框 3.5，仍须在 preview/框 4 展示）：

`section id {n}`·目录 id {n}·group_id={n}（从 TestRail 侧边栏 URL 复制）→ 匹配 `parent_section_id`，交由 preview 校验（`SECTION_NOT_IN_SUITE`/`SECTION_NOT_FOUND` 兜底） · `导入到 {section_name} 下`·put under {name}·合并到 {name} 模块 → 按名称匹配（见 `§SectionConfirm` 命中数规则） · `新建顶级`·不用已有目录·create new top-level → 不传 `parent_section_id`

**换目标**（清除复用，重走确认框）：

换 Suite·换用例集·change suite → 清 `confirmed_suite_id` **及** `confirmed_parent_section_id` → 框 3 → 框 3.5 · 换目录·换 Section·改用新建顶级·change section → 仅清 `confirmed_parent_section_id` → 框 3.5 · 换版本·change version → 直接更新 `confirmed_version_name` 为新值（无弹窗）

**异步续接**（须同会话已存 `job_id`）：

查导入状态·导入完成了吗·check import job·check import status → `jobs get` → `§AsyncProgress`；`COMPLETED` → `§Result` · 等到完成·wait for import → 框 6b · 先不等·stop waiting → `§AsyncHandoff` 收束

## §Trigger

| 级 | 条件 | 动作 |
|----|------|------|
| P1 | 同会话 `testcase-generate` 后有展开用例 | 自动 `INLINE`；**跳过框 0、1**；**仍走框 3、框 3.5**（或 Intent/ConfirmState）；版本无感 |
| P1b | §Intent 热接力词 + 有用例明细 | 自动 `INLINE`；跳过框 1 |
| P2 | Requirement URL，无展开用例 | `REQUIREMENT`；跳过框 1 |
| P3 | 仅「导入 TestRail」，上下文不全 | 框 0 |
| P4 | 有 `product_id`+`requirement_id`，无 case | `REQUIREMENT`（框 3、框 3.5 仍须；版本无感） |

禁止：P1/P1b 弹框 1；有展开用例时不得 `REQUIREMENT`。

## §Prompts

1. 先 1–2 句框上正文（友好名），再 `AskUserQuestion`（`header`+`question`+`label`+`description`）
2. 不可用 → 编号列表降级；勿定义 `Other`
3. 取消 → 尚未导入，预览约 1h 有效
4. preview 成功且 `to_fail===0` → **框 4** 后才能 `execute --confirm`
5. **自由输入**（Suite ID / Section ID / Section 名称 / 新 Suite 名等）：正文一句话说明来源（复制 TestRail 目标页面浏览器地址栏 URL 即可，Agent 自动从 `/suites/view/(\d+)` 或 `group_id=(\d+)` 提取数字）；`AskUserQuestion` **固定 2 个占位选项**——「先不导入」+「返回/改用{另一分支}」（具体第二项文案按上下文替换，见 `§SuiteConfirm`/`§SectionConfirm`）——`AskUserQuestion` 工具硬性要求 `options ≥ 2`，**只给 1 个选项会导致 `InputValidationError` 直接中断对话**（历史 bug，勿再犯）；正文明确写「请在下方 Other 输入框中输入」，真实值不建选项

| 框 | 触发 | option labels（中 / EN） |
|----|------|------------------------|
| 0 入口 | P3 | 粘贴 Requirement 链接 / Paste requirement link · 用上面已生成用例 / Use cases above · 粘贴产品链接 / Paste product link |
| 1 数据源 | 未命中 P1/P1b 且模糊 | 用上面用例（推荐）/ Use cases above (recommended) · 只从测试点生成 / From test points only · 先不导入 / Not now |
| 3 Suite | 见 `§SuiteConfirm` | 见 `§SuiteConfirm` |
| 3.5 Section 归属 | 见 `§SectionConfirm`（紧跟框 3 之后） | 见 `§SectionConfirm` |
| 4 执行闸 | preview OK | 确认导入 / Confirm import · 先不导入 / Not now |
| 5 失败 | `to_fail>0` | 查看明细 / View details · 修正重预览 / Fix & re-preview · 先不 / Not now |
| 6 异步交付 | execute 返回 Job | **先不等，稍后查（推荐）** / Don't wait · **等到完成** / Wait until done · **查一次进度** / Check progress once |
| 6b 等到完成 | 框 6 选等到完成 | **继续等** / Keep waiting · **先不等** / Stop waiting |

Version 不再是弹窗（无编号），见 `§VersionConfirm`。

**框 4 框上正文（SHALL 含 Suite；选了已有 Section 时追加归属行；版本未指定时显示"未指定"）**：

> 将导入到用例集 **{suite_name}（ID {suite_id}）** · 目标版本 **{version_name 或"未指定"}** · 新建 **{to_create}** · 跳过 **{to_skip}**；已存在不覆盖。有 `section_creates` 时追加目录数。`to_create>50` → `§AsyncEstimate`。
> 选了「导入到已有 Section」时追加一行：挂靠目录 **{parent_section_name}（ID {parent_section_id}）**。

## §SuiteConfirm

**触发（SHALL）**：首次 preview 前；或用户换 Suite；或 `confirmed_suite_id` 未设置。  
**免弹**：`§Intent` Suite 显式命中；或同会话 `confirmed_suite_id` 仍有效且用户未换 Suite。

**框 3 框上正文**：

> 请选择导入目标 **TestRail 用例集（Suite）**。**选错无法通过重新导入自动迁移**；已映射的 Case 换 Suite 重导仍会跳过。

**第一层**（不对任何 Suite 做推荐标注，不列举 `suites[]`）：**使用已有 Suite 导入** / **新增 Suite 导入** / 先不导入。

- **已有** → **不列表**，直接自由输入——2 个选项「先不导入」/「**返回新增 Suite 导入**」，正文写「请提供 Suite ID、Suite 名称，或直接粘贴 TestRail 用例集页面的完整 URL」；`mappings.suites[]` 恰好只有 **1 个**时，正文追加一句「该产品仅配置了 1 个 Suite：{name}（ID {suite_id}），可直接回复确认，或提供其他 Suite」（信息提示，不建列表选项）（`§Prompts` 自由输入规则）。Agent 按顺序解析用户输入：
  1. 纯数字 → 直接当 `suite_id`；
  2. 匹配 `/suites/view/(\d+)` → 提取数字当 `suite_id`；
  3. 其余 → 当 Suite 名称，在 Step 1 已拿到的 `mappings.suites[]` 里本地匹配（不额外调接口）：精确匹配优先，退化包含匹配；命中 1 条直接采用；2–4 条 `AskUserQuestion` 列出消歧；0 条或 >4 条提示换更精确的名称或改提供 ID。
- **新增** → 走以下步骤，调用 `qa-insights testrail suite-create`：

  1. **收集名称**：自由输入——2 个选项「先不导入」/「**返回选择已有 Suite 导入**」，正文写「请提供新 Suite 的名称（例如 "VN - Hotfix"）」（不问 description，字段可选，留空即可）。
  2. **创建前二次确认**（新建是**立即生效、且无法通过 API 撤销**的写操作，不同于「已有」分支——那边只是引用已存在的 ID，本身零风险）：正文「即将在 TestRail 创建新 Suite「**{name}**」，确认创建吗？」，选项：**确认创建** / **先不创建，改用已有 Suite** / 先不导入。
  3. 确认后调用 `qa-insights testrail suite-create <product_id> --name "<name>"`，按返回结果处理：

  | 情况 | 处理 |
  |------|------|
  | `SUCCESS`，`duplicate_warning=null` | 直接采用：存 `confirmed_suite_id`/`confirmed_suite_name` = 返回的 `suite_id`/`name`；提示「已创建 Suite「{name}」（ID {suite_id}）」；进入框 3.5 |
  | `SUCCESS`，`duplicate_warning` 非空 | 已创建成功，但检测到同名已有 Suite。提示「已新建 Suite「{name}」（ID {suite_id}）；另外发现一个同名的已有 Suite（ID {existing_suite_id}），是否改用它？」，选项：**使用新建的（ID {suite_id}）** / **改用已有的（ID {existing_suite_id}）** / 先不导入。选"改用已有"时 `confirmed_suite_id` 设为 `existing_suite_id`，并提示新建的那个是空 Suite，如不需要可自行去 TestRail 清理（Skill 无删除能力） |
  | `SUITE_CREATE_RATE_LIMITED` | 提示「该产品 10 分钟内新建 Suite 已达上限（5 次），请稍后重试，或改用已有 Suite」，选项：**改用已有 Suite** / 先不导入。退回第一层 |
  | `SUITE_MODE_NOT_SUPPORTED` | 提示「该 TestRail 项目不支持多 Suite 模式，无法新建，请改用已有 Suite（该项目通常只有 1 个默认 Suite）」，选项：**改用已有 Suite** / 先不导入 |
  | 其余（`TESTRAIL_UNAVAILABLE`/`auth`/`validation` 等） | 复用 `§Errors` 通用处理 |

  确认后按原逻辑继续框 3.5（Section 归属），复用现有 `confirmed_suite_id`/`confirmed_suite_name`，不新增 `§ConfirmState` 字段。

两个分支的自由输入互为「返回对方分支」，选错也能来回切换。用户提供的 ID 不预校验，交给 `import preview` 的 `SUITE_NOT_IN_PROJECT` 兜底（`§Errors`）。确认后存 `confirmed_suite_id` + `confirmed_suite_name`。

## §SectionConfirm

**触发（SHALL）**：**每次导入都问**，紧跟在框 3 Suite 确认之后。  
**免弹**：`§Intent` Section 显式命中；或同会话 `confirmed_parent_section_id`（含「新建顶级」这个选择本身）仍有效且 Suite 未变。

**框 3.5 框上正文**：

> 这批用例要新建一个顶级目录保存，还是导入到某个已有目录（Section）下？  
> 导入到已有目录不会影响去重（不会重复建用例），但换目录后**不会移动**之前已经建好的目录——同一需求可能在 Suite 里出现两处，请确认清楚再选。

**第一层 option labels**：

| 场景 | option labels（中 / EN） |
|------|--------------------------|
| 默认 | 新建顶级目录（默认）/ Create new top-level section (default) · 导入到已有目录下 / Import under an existing section · 先不导入 / Not now |

选「导入到已有目录下」→ **不再问 ID 还是名称**，直接自由输入——2 个选项「先不导入」/「**返回选择新建顶级目录**」，正文写「请提供目录 ID、目录名称，或直接粘贴 TestRail 目录页面的 URL（`group_id=` 后的数字即为 ID）」（`§Prompts` 自由输入规则）。Agent 按顺序解析：

1. 纯数字 → 直接当 `parent_section_id`，**不预校验**，交给 preview 的 `SECTION_NOT_IN_SUITE`/`SECTION_NOT_FOUND` 兜底（`§Errors`）；
2. 匹配 `group_id=(\d+)` → 提取数字，同上不预校验；
3. 其余 → 当目录名称关键词，调 `sections list <product_id> <suite_id>`（本会话按 `suite_id` 缓存，不重复拉取，除非用户说「刷新」）→ 先精确匹配（不区分大小写），无结果再退化为包含匹配：

| 命中数 | 处理 |
|--------|------|
| 0 | 提示未找到「{关键词}」，选项：换个名称重试 / 改用 ID / 取消 |
| 1 | **直接采用，不再二次确认**；只在后续框 4/`§Preview` 中回显 |
| 2–4 | `AskUserQuestion` 逐条列出 `{name}（父级：{parent_name}）` 供选择 |
| >4 | **不列表**；提示「找到 {n} 条包含「{关键词}」的目录，请提供更精确的名称，或改用目录 ID」，引导收窄关键词重试或切到 ID 路径（`AskUserQuestion` 的 `options` 上限为 4，非体验偏好可调） |

确认后 Agent 存 `confirmed_parent_section_id` + `confirmed_parent_section_name`（+ `confirmed_parent_section_path` 用于展示）；选「新建顶级目录」时三者均为空，不传 `parent_section_id`。

## §VersionConfirm

**不弹窗**：Version 全程无感，不主动询问、不推断、不确认。仅 `§Intent` 显式命中版本号时写入 `confirmed_version_name`；INLINE 用例自带的 `version_name` 原样透传。都没有 → 不传该字段。所有含 `{version_name}` 的模板（框 4/`§Preview`/`§Result`/`§AsyncHandoff`）未设置时一律显示"未指定"。cases 内多个不同 `version_name` 也不阻断，各自透传，`§Preview` 的 `warnings` 里提示即可。

## §AsyncEstimate

**触发**：preview 后 `to_create > 50`（框 4 追加）。

> 本次将新建 **{to_create}** 条、**{section_n}** 个分组目录；**后台异步**，预计 **{eta_min}–{eta_max} 秒**（约半分钟到一分钟）。

```text
api_calls = to_create + len(section_creates)
eta_min = ceil(api_calls / 170 * 60)
eta_max = ceil(eta_min * 1.3)
```

## §AsyncHandoff

```markdown
## 导入已提交 — {产品} / {需求}

| 项目 | 内容 |
|------|------|
| 用例集 | {suite_name}（ID {suite_id}） |
| 挂靠目录 | {parent_section_name}（ID {parent_section_id}）（仅选了已有目录时显示本行） |
| 目标版本 | {version_name} |
| 状态 | 后台导入中 |
| 规模 | 新建 {to_create} · 跳过 {to_skip} · 目录 {section_n} 个 |
| 预计耗时 | 约 {eta_min}–{eta_max} 秒 |
```

（后续引导句同前：查导入状态 / 导入完成了吗 / 技术详情）

## §AsyncProgress

```markdown
**导入进度** — {processed}/{total}（已新建 {created} · 已跳过 {skipped} · 失败 {failed}）
状态：{status}
```

`COMPLETED` → `§Result` · `FAILED`/`CANCELLED` → `§Errors`

## §AsyncTimeout

> 导入仍在进行（已等待 {elapsed}s）。建议先不等；说「**查导入状态**」即可，**请勿重复确认导入**。

## §Preview

**表头摘要（SHALL，明细表之前）**：

```markdown
| 目标用例集 | {suite_name}（ID {suite_id}） |
| 挂靠目录 | {parent_section_name}（ID {parent_section_id}）（仅选了已有目录时显示本行） |
| 目标版本 | {version_name} |
| 数据源 | {已展开用例 / 从测试点生成} |
```

明细表：`action`/`skip_reason`/`warnings` 用 §Glossary。Section 列用 `target_section_path` 优先（选了已有目录时为三级路径）。表下汇总 to_create/to_skip/to_fail。禁止展示 `preview_id`、裸枚举。

## §Result

```markdown
## TestRail 导入完成 — {产品} / {需求}

| 项目 | 结果 |
| 用例集 | {suite_name}（ID {suite_id}） |
| 挂靠目录 | {parent_section_name}（ID {parent_section_id}）（仅选了已有目录时显示本行） |
| 目标版本 | {version_name} |
| 新建/跳过/失败 | n/m/k |

### 新建用例 · 测试点 | Case | 链接
### 跳过 · 标题 | 原因
```

## §Errors

| 场景 | 中 / EN 标题 | 选项 |
|------|-------------|------|
| `PRODUCT_TESTRAIL_URL_MISSING` | 产品未配置 TestRail | 联系 Lead / 换产品 / 取消 |
| `SUITE_NOT_IN_PROJECT` | 用例集不在当前产品 Project 内 | 重新选用例集(框 3) / 提供有效 ID / 取消 |
| `SECTION_NOT_IN_SUITE` | 所选目录不属于当前用例集 | 重新选择目录(框 3.5) / 提供有效 ID / 取消 |
| `SECTION_NOT_FOUND` | 目录不存在 | 重新选择目录(框 3.5) / 提供有效 ID / 取消 |
| `SUITE_CREATE_RATE_LIMITED` | 新建 Suite 频率超限 | 改用已有 Suite(框 3) / 稍后重试 / 取消 |
| `SUITE_MODE_NOT_SUPPORTED` | 项目不支持多 Suite 模式 | 改用已有 Suite(框 3) / 取消 |
| `PREVIEW_EXPIRED` | 预览已过期 | 重新 preview / 取消 |
| `TESTRAIL_UNAVAILABLE` | TestRail 不可用 | 稍后重试 / 取消 |
| `auth`/403 | 无权限 | 检查登录 / 联系管理员 / 取消 |
| `validation` | — | Agent 自行修复 |
| Job `UNKNOWN` | 结果不确定 | 手动查询 / 取消 |
| Job `FAILED` / `CANCELLED` | 导入任务失败 | 查看错误 / 重新 preview / 取消 |
