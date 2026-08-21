# A4 UX — 字段友好名与用户引导

Agent 自行 `AskUserQuestion`（不写入 `allowed-tools`）。**跟随用户主语言**生成文案；禁止同一段中英各写一遍。

---

## §Glossary 字段与枚举

展示用友好名；`product_id`/`version_id` → 产品名/版本名；`result_id` **默认隐藏**。

**上下文**：`test_id` 测试执行 ID · `case_title` 用例名称 · `comment` 失败备注 · `created_on` 失败时间 · `status` 执行状态 · `result_url` TestRail 测试链接

**草稿**：`draft.description` 缺陷标题 · `draft.remarks` 缺陷详情 · `draft.type` 工单类型 · `draft.priority` 优先级 · `draft.parent_id` 父工单 · `failure_category` 失败分类 · `recommendation` 系统建议 · `similar_tickets` 相似缺陷 · `parent_suggestion` 父单建议

**枚举（展示时翻译）**

- `status`：FAILED→失败 · BLOCKED→阻塞
- `recommendation`：CREATE_NEW→新建缺陷单 · LINK_EXISTING→关联已有 · SKIP_BUG→暂不建产品缺陷
- `failure_category`：PRODUCT_BUG→产品缺陷 · ENVIRONMENT→环境 · TEST_DATA→测试数据 · SCRIPT_ISSUE→脚本问题 · UNKNOWN→待分类
- `type`：BUGFIX→缺陷修复 · FEATURE→功能单

**TestRail 链接**：优先 API `result_url`；fallback `https://unifihome.testrail.io/index.php?/tests/view/{test_id}`

**意图同义词**（自由文本先匹配，再弹框）：登记缺陷/转缺陷/建bug/file defect · 确认创建/提交/confirm create · 关联/link · 跳过/不建单/skip · 改标题/change title · 取消/先不/cancel

---

## §Prompts 交互元模板（SHALL）

1. 框上正文 1–2 句（友好字段名）
2. `AskUserQuestion`：`header` + `question` + 每选项 `label`（+ 可选 `description`）
3. 不可用 → `{上下文} {question} 1.{opt1} 2.{opt2}…`
4. 勿定义 `Other`；选「先不/取消」→ 友好回执且不写操作

**双闸**：决策闸（Step 2）后才 `--dry-run`；提交闸后才 `--confirm`。

**取消回执**（按用户语言）：尚未登记缺陷，预览仍在；可说「确认创建」或「关联已有单」继续。

### 场景选项清单

| 场景 | option labels |
|------|---------------|
| 缺版本 | 粘贴版本门户链接 / 提供版本名称 / 粘贴 Plan·Run 链接 |
| 缺产品 | 各候选产品名各一行 |
| 多 Result (`total>1`) | 最新一条(推荐) / 第n条·{时间} / 我自己说明 |
| 无 Result | 换 Test 链接 / 从 A3 进度选 / 结束 |
| 已关联 | 查看就够了 / 仍要新建 / 改关联到其他单 |
| 决策 CREATE_NEW | 按推荐标题新建（唯一父单候选时内嵌「挂到 {parent_suggestion.display_id}」） / 修改标题后新建 / 关联已有 / 暂不登记 |
| 决策 LINK_EXISTING | 关联推荐相似单 / 选其他相似单 / 仍要新建 / 暂不登记 |
| 决策 SKIP_BUG | 了解不建单 / 仍要强制新建 |
| 标题 | 推荐标题 / 系统初稿 / 自己输入（≤80字） |
| 相似单 | 各 display_id + 标题截断 / 都不是新建 |
| 父单（多候选或需更换时） | 挂推荐功能单 / 顶层缺陷单 / 指定其他父单 |
| 提交创建 | 确认创建 / 先不创建 |
| 提交关联 | 确认关联 / 先不关联 |

### Step 2 预览（决策闸前展示）

表格：用例 · TestRail 测试 `[test_id](url)` · 失败时间 · 执行状态 · 失败备注 · 系统建议 · 失败分类  
标题对比：系统初稿 vs 推荐标题 + 精炼理由一行  
缺陷详情：`remarks` 渲染；有则附相似缺陷表、父单建议一句。**禁止**预览主文展示 `result_id`/UUID。

### 决策落点

**父单免弹规则**：`parent_suggestion` 仅一个候选且无 `similar_tickets` 冲突、无 `ambiguous`/`low_confidence` 标记时，父单信息内嵌进决策闸选项文案（见「决策 CREATE_NEW」行），不单独起一轮 `AskUserQuestion`；仅当存在多个候选，或用户主动要求「指定其他父单」时，才走「父单」子交互。

| 选择 | 动作 |
|------|------|
| 按推荐新建 | 唯一父单候选 → 直接 Step 4；多候选/需指定其他父单 → 父单确认 → Step 4 |
| 改标题新建 | 标题子交互 → 父单 → Step 4 |
| 关联已有 | 相似单子交互 → Step 5 |
| 暂不/了解 | 取消回执，结束 |
| 强制新建 | 记录覆盖 → Step 4 |

### Step 4/5 提交闸

`--dry-run` 成功后：摘要表（标题、类型、优先级、版本、父单）+ 确认创建/关联 vs 先不。

---

## §Errors 异常恢复

自然语言说明（不以 error code 为标题）+ 编号选项：

| 场景 | 选项 |
|------|------|
| 测试不在版本 | 换版本 / 提供 Run ID 重试 / 取消 |
| 找不到 Test | 换链接 / 取消 |
| Test·Run 不匹配 | 核对重试 / 取消 |
| 失败信息未拉取 | 重新查询 / 取消 |
| TestRail 不可用 | 稍后重试 / 取消 |
