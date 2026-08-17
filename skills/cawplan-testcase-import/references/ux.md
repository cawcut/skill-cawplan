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
| `MISSING_REQUIREMENT_ID` | 缺少需求关联，归档位置可能不完整 |
| T1 `P0–P3+` | 最高/高/中/低 · Pn（勿展示 CRITICAL 等枚举） |

## §Intent

自由文本先匹配，命中则不弹框：按上面导入·import above → INLINE 热接力 · 确认导入·confirm import · 先不·cancel · 重新预览·re-preview · 为什么跳过·why skipped · 放到 4.3.1·version 4.3.1 · 技术详情·technical details · 只有测试点·test points only → REQUIREMENT。

## §Trigger

| 级 | 条件 | 动作 |
|----|------|------|
| P1 | 同会话 `testcase-generate` 后有展开用例（`title`+`steps`/`expected`） | 自动 `INLINE`；**跳过框 0、1** |
| P1b | §Intent 热接力词 + 有用例明细 | 自动 `INLINE`；跳过框 1 |
| P2 | Requirement URL，无展开用例 | `REQUIREMENT`；跳过框 1 |
| P3 | 仅「导入 TestRail」，上下文不全 | 框 0 |
| P4 | 有 `product_id`+`requirement_id`，无 case，无版本 | `REQUIREMENT`+框 2 |

禁止：P1/P1b 弹框 1；有展开用例时不得 `REQUIREMENT`。

## §Prompts

1. 先 1–2 句框上正文（友好名），再 `AskUserQuestion`（`header`+`question`+`label`+`description`）
2. 不可用 → 编号列表降级；勿定义 `Other`
3. 取消 → 尚未导入，预览约 1h 有效
4. preview 成功且 `to_fail===0` → **框 4** 后才能 `execute --confirm`

| 框 | 触发 | option labels（中 / EN） |
|----|------|------------------------|
| 0 入口 | P3 | 粘贴 Requirement 链接 / Paste requirement link · 用上面已生成用例 / Use cases above · 粘贴产品链接 / Paste product link |
| 1 数据源 | 未命中 P1/P1b 且模糊 | 用上面用例（推荐）/ Use cases above (recommended) · 只从测试点生成 / From test points only · 先不导入 / Not now |
| 2 版本 | 未指定或 cases 内冲突 | 使用 {v} / Use {v} · 我来指定 / I'll specify · 先不 / Not now；冲突时各版本各一行 |
| 3 Suite | 无 default 或用户指定 | 默认用例集·{name} / Default suite · 指定其他 / Specify another · 先不 / Not now |
| 4 执行闸 | preview OK | 确认导入 / Confirm import · 先不导入 / Not now |
| 5 失败 | `to_fail>0` | 查看明细 / View details · 修正重预览 / Fix & re-preview · 先不 / Not now |
| 6 异步 | >50 CREATE | 告知后台导入；超时：查状态 / Check status · 稍后重试 / Retry · 先不等 / Stop waiting |

**框 4 框上正文**：已为 **{产品}/{需求}** 生成预览：新建 **{to_create}**，跳过 **{to_skip}**；已存在不覆盖。有 `section_creates` 时追加新建目录数。

## §Preview

不得省略。`action`/`skip_reason`/`warnings` 用 §Glossary。

- **中文用户**：`| # | 用例标题 Title | 处理方式 Action | 归档位置 Section | 说明 Notes |`
- **英文用户**：`| # | Title | Action | Section | Notes |`

Section：`target_section_path` 优先，否则 `parent / child`。表下汇总 to_create/to_skip/to_fail。禁止展示 `preview_id`、裸枚举。

## §Result

```markdown
## TestRail 导入完成 — {产品} / {需求}

| 项目 | 结果 |  （英文用户仅 English 列头）
| 目标版本 | {version} |
| 用例集 | {suite} |
| 新建/跳过/失败 | n/m/k |

### 新建用例 · 测试点 | Case | 链接
### 跳过 · 标题 | 原因
```

## §Errors

不以 error code 为标题；自然语言 + 选项：

| 场景 | 中 / EN 标题 | 选项 |
|------|-------------|------|
| `PRODUCT_TESTRAIL_URL_MISSING` | 产品未配置 TestRail / Not configured | 联系 Lead / 换产品 / 取消 |
| `SUITE_NOT_IN_PROJECT` | 用例集不匹配 / Suite mismatch | 换默认 / 提供 ID / 取消 |
| `PREVIEW_EXPIRED` | 预览已过期 / Preview expired | 重新预览 / 取消 |
| `TESTRAIL_UNAVAILABLE` | TestRail 不可用 / Unavailable | 稍后重试 / 取消 |
| `auth`/403 | 无权限 / No permission | 检查登录 / 联系管理员 / 取消 |
| `validation` | — | Agent 自行修复，不向用户暴露 |
| Job `UNKNOWN` | 结果不确定 / Outcome uncertain | 手动查询 / 取消 |
