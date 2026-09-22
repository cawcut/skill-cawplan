### 7. Resolve product

**仅当「保存意图闸」已触发**后执行本步。Run this after the draft (five fields + display summary) is acceptable and **before** any QA Insights read/write calls. Read-only — no writes. Do **not** call `qa-insights module-tree get` or other `qa-insights` commands in this step（`products list` 仅在本步无 Ticket 选产品分支调用）。

**Resolve order**（命中即停，不重复问、不重复列）：

#### A. Ticket material（step 1 已用 ticket 作素材）

- Read `product_id` from the ticket response.
- Resolve the product **name** for display (from the same response if present, or `cawplan products list --search` with that ID context — **仅**补全展示名，不是让 SQA 选产品).
- **Use it directly** — do not ask SQA to pick the product again; do not list products. Unless `product_id` is missing on the ticket → fall through to **C**.

#### B. Session already has `product_id`

(e.g. relay inbound already carried `product_id`, or SQA explicitly switched product earlier and step 7 was re-run)

- **Use it directly** — do not list products for SQA to pick.
- Product **name**: from session if present; if only `product_id` is known, you may call `cawplan products list --page_size 100` once and match `unique_id` client-side to fill the display name — **禁止** `--search`、**禁止**再列产品让 SQA 选。

#### C. No ticket — list and pick（不猜、不 search、不翻页；纯文字编号列表）

Text / screenshots only; no ticket in step 1; no `product_id` in session.

```bash
cawplan products list --page_size 100
```

- **One call only** — `--page_size 100` 一次拉完，**禁止**翻页、**禁止** `--search`、**禁止**从五字段推断产品名再搜。
- Parse products from the response; map each row's `name` → `unique_id`.
- **产品数通常 > 4** — **不用 AskUserQuestion**；**直接**输出纯文字编号列表（逐字结构，填入实际产品名；**跟随会话语言**二选一，不同时输出）：

```text
要保存到哪个产品？回复序号即可：
1. 【产品 name】
2. 【产品 name】
…
N. 【产品 name】
```

```text
Which product should this be saved to? Just reply with a number:
1. [产品 name]
2. [产品 name]
…
N. [产品 name]
```

**落点**：

- SQA **回复序号**（也认 **产品名** 原文或大小写不敏感匹配）→ 取对应行的 `unique_id` 为 `product_id`，`name` 为 product name → 继续 step 8+。
- **重复 / 没选对**（序号无效、产品名对不上、或 SQA 又说「保存」但未选产品）→ **短提示**（逐字，跟随会话语言）：`还差一步:先选个产品,回序号即可。` / `One more step: please pick a product first — just reply with its number.` — 可重列同一编号列表，**不要**长篇解释或改走 search。
- 列表为空 → 如实报告无可用产品，**stop**（无法继续保存）。
- 返回超过 100 条时 **仍只展示本次 100 条**（不翻页）。若 SQA 称产品不在列表中 → 请提供工单链接或说明需管理员处理；**禁止**改走 `--search` 或口头「再报个产品名」老路。

Keep the resolved `product_id` (and product name) in context for module-tree and archive steps. Requirement archive writes must use this same `product_id` — do not substitute a different product unless SQA explicitly requests a change and step 7 is re-run.

### 8. 推荐挂载位置（仅选择已有 Module）

**触发时机**：

- **仅当**：保存意图闸已触发（step 6）、产品已确定（step 7）、进入本步时，走下方闭环。
- **跳过**：会话已确定 `module_tree_node_id`（如接力入站已带）→ **直接用，不重问** → 带 `module_tree_node_id` 进入 step 11（**不设** `location_confirmed` — step 11 乙式确认闸仍执行）。
- 本步仍在五字段尾巴之后；**不在** step 5b 出现模块树文案（见 step 5b **输出纪律**）。

**读树**（本步及「看看有哪些节点」共用；read only）：

```bash
cawplan qa-insights module-tree get <product_id>
```

On `outcome: SUCCESS`, parse `data.nodes`（可能为 `[]`）。从五字段尝试推荐一个挂载节点（name + `id` + 全路径）→ `{推荐节点全路径}`。Module-tree 由对应 Admin 全局管理；本 skill 只能选择已有节点，禁止创建节点或调用任何创建接口。

**无推荐 / 空树**：

- 无推荐但 `data.nodes` 非空 → **不要**留空、**不要**自由发挥、**不要**弹 ① 选位置框；直接进〔选②〕列出全部已有节点供 SQA 选择。
- `data.nodes` 为 `[]` → 输出下方空树提示，保留草稿与已解析的 `product_id`，然后 **`stop`**；禁止归档、禁止创建兜底。
- 空树提示（逐字；**跟随会话语言**二选一，不同时输出）：
  - `当前没有可选的 Module。请联系对应 Admin 创建后再继续。`
  - `There are no Modules available. Contact the appropriate Admin to create one, then continue.`
- Admin 创建完成后，SQA 说「继续」或同义表达 → **重新执行** `qa-insights module-tree get`；禁止复用先前空列表。

**有推荐节点** → 进 ① 选位置闭环。

**整体流程（闭环）**：

```
① 选位置(框)
     ├─「就保存到这里」→ 用推荐节点 → 挂上 → 设 location_confirmed → step 11 直接写入（跳过 11 乙式确认闸）
     └─「看看有哪些节点」→ 树形缩进列表(文字)→ 选中一个 → 用它挂上 → 设 location_confirmed → step 11 直接写入
```

关键：**§8 的选位置确认即保存确认**——SQA 在此步肯定后，**不得**再在 step 11 重复「将需求保存到…」乙式弹框。若没有合适节点，流程停在本步等待 Admin 创建，不得以任何方式自行创建。

---

#### ① 选位置（AskUserQuestion 框）

**优先 AskUserQuestion**（**两个选项，每项须带 `label` + `description`**；工具若自动追加 Other 行，**勿在 skill 里定义 Other**；**跟随会话语言**整框二选一，不同时输出）：

| 字段 | 中文值 | English value |
|------|-----|-----|
| `header` | 选择位置 | Choose Location |
| `question` | 是否要保存到「{推荐节点全路径}」节点下? | Save under the "{推荐节点全路径}" node? |
| option 1 · `label` | 就保存到这里 | Use this location |
| option 1 · `description` | 用推荐的这个位置 | Go with the recommended location |
| option 2 · `label` | 看看有哪些节点 | Browse nodes |
| option 2 · `description` | 列出模块树再选 | List the module tree and pick |

**落点**（**选位置即确认保存** — Requirement 写入在 step 11 执行，但**不再**二次弹保存确认框）：

- **就保存到这里** → 采用推荐节点，`module_tree_node_id` = 该节点 `id`；设 `location_confirmed = true` → 进入 step 11 Gate / Table B → **直接** POST 或 PATCH（见 `workflow-archive.md` §11 **跳过乙式确认闸**）。
- **看看有哪些节点** → 展示节点树形列表（〔选②〕），SQA 选中一个 → 采用、`module_tree_node_id` 写入上下文；设 `location_confirmed = true` → step 11 **直接**写入。

**AskUserQuestion 不可用时** — 纯文字降级（逐字，填入实际全路径；**跟随会话语言**二选一，不同时输出）：

```text
是否要保存到「{推荐节点全路径}」节点下? 1. 就保存到这里 2. 看看有哪些节点(回序号)
```

```text
Save under the "{推荐节点全路径}" node? 1. Use this location 2. Browse nodes (reply with a number)
```

---

#### 〔选②〕看看有哪些节点（纯文字 · 树形缩进 · 全铺）

- **不使用框**（节点数量不定）。
- 用**缩进体现层级**：顶级顶格，子级逐层缩进；**全量铺开、不折叠**。
- **序号连续、跨层级不重号**；SQA 回序号即选中（**也认节点名**）。
- 引导句（逐字；**跟随会话语言**二选一，不同时输出）：

```text
有哪些节点?告诉我你要哪个(回序号或节点名):
```

```text
Here are the nodes — tell me which one you want (reply with a number or node name):
```

- 列表末尾必须追加短提示（逐字；**跟随会话语言**二选一，不同时输出）：
  - `**如果没有合适的 Module，请联系对应 Admin 创建后再继续。**`
  - `**If none of these Modules fits, contact the appropriate Admin to create one, then continue.**`

- 列表示例形态（序号与缩进按实际树生成；形态对齐方案）：

```text
1. Access
   2. Login
   3. 权限管理
      4. 角色
      5. 访客
6. 项目管理
   7. 复制
   8. 归档
9. 设备
   10. 门禁
   11. 电梯
12. 系统设置
```

- **落点**：选中 → 采用该节点，`module_tree_node_id` 写入上下文；设 `location_confirmed = true` → step 11 **直接**写入。
- SQA 表示没有合适节点、节点不在列表中，或要求新建节点 → 告知当前流程不支持创建 Module，请联系对应 Admin；保留草稿与 `product_id` 后 **`stop`**，不得归档。
- Admin 创建完成后，SQA 说「继续」或同义表达 → 重新读取 module-tree，再展示最新列表。

---

**通用约束**（模块选择专用）：

- **框只用于**「选位置」的两个固定动作。
- **节点列表一律纯文字树形** — 不塞进框。
- **AskUserQuestion 选项一律带 `description`**（短句灰字说明）；纯文字降级措辞与上文一致。
- **全程纯文字降级**：框不渲染时退化为编号问答，措辞与上文一致。
- **禁止创建**：本 skill 不收集新节点名称/父节点，不提供创建确认，不调用创建接口。
- **无节点不归档**：没有有效 `module_tree_node_id` 时不得进入 step 11 Requirement POST。

**If the API fails**: see **Failures** (Rules).
