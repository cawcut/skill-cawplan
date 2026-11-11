### 7. Resolve product

**仅当「保存意图闸」已触发**后执行本步。Run this after the draft (five fields + display summary) is acceptable and **before** any QA Insights read/write calls. Read-only — no writes. Do **not** call capability `qa.module_tree.get` or any other `qa.*` capability in this step（本步只调用 capability `products.list`）。

**`products.list` 调用约定**（本步所有分支通用）：

- MCP 路由一律传 `view` = `compact`（产品全量返回体积过大，不带 compact 会撑爆工具结果）；CLI 路由没有 `view`，不传。
- `search` 只匹配产品的 **name 与 description**，**不匹配 ID**。已知 `product_id` 要补全展示名时，**禁止**拿 ID 去 `search`：按下方「分页」逐页拉取，在本地用每行 `unique_id` 匹配，命中即停。
- **分页**：`page_size` = 50，`page_num` 从 1 开始；响应里的 `total` 决定是否还有下一页（`page_num × 50 < total` 即还有）。**不要**一次拉 100 条或更多。

**Resolve order**（命中即停，不重复问、不重复列）：

#### A. Ticket material（step 1 已用 ticket 作素材）

- Read `product_id` from the ticket response.
- Product **name** for display：优先取同一工单响应里的产品名；没有时按上方「分页」拉 capability `products.list`，本地按 `unique_id` 匹配补全展示名（**仅**补全展示名，不是让 SQA 选产品）。翻完仍未匹配 → 展示名用 `product_id` 原值，继续。
- **Use it directly** — do not ask SQA to pick the product again; do not list products. Unless `product_id` is missing on the ticket → fall through to **C**.
- 若 SQA 在会话中明确点名了**另一个**产品（与工单产品不同）→ 问一次用哪个（两个产品名并列，回序号），再按所选继续；不要静默替换。

#### B. Session already has `product_id`

(e.g. relay inbound already carried `product_id`, or SQA explicitly switched product earlier and step 7 was re-run)

- **Use it directly** — do not list products for SQA to pick.
- Product **name**: from session if present; if only `product_id` is known, 按上方「分页」拉 capability `products.list`，本地按 `unique_id` 匹配补全展示名 — **禁止**拿 ID 传 `search`、**禁止**再列产品让 SQA 选。

#### C. SQA 点名了产品（无 Ticket、会话无 `product_id`）

SQA 在会话任一消息里说了产品名（如「保存到 UniFi Access」「Access 产品」）。

- 调用 capability `products.list`：`search` = 产品名里**一个有区分度的词**（如 `UniFi Access` → `Access`；不要用 `UniFi` 这类多数产品共有的词），`page_size` = 50，MCP 路由加 `view` = `compact`；结果超过一页时按 `total` 继续翻页取全。
- 本地匹配（先 trim，大小写不敏感）：
  - **全名精确匹配**：某行 `name` 与 SQA 给的名字完全相同；
  - 或 **唯一简称**：SQA 给的是简称 / 名字的一部分（如 `Access`），且只有**一行** `name` 包含它。
- **恰好一行命中** → 取该行 `unique_id` 为 `product_id`、`name` 为 product name → 继续 step 8+，不再让 SQA 选。
- **多行命中**（含**同名产品**）→ 纯文字编号列表让 SQA 选，每行带产品线以便区分（产品线取该行的产品线名称字段；只有 `product_line_id` 时就展示它）：

```text
找到多个叫「{SQA 给的名字}」的产品，回序号选一个：
1. 【产品 name】（产品线：【产品线】）
2. 【产品 name】（产品线：【产品线】）
```

```text
Several products match "{SQA 给的名字}" — reply with a number:
1. [产品 name] (product line: [产品线])
2. [产品 name] (product line: [产品线])
```

- **无命中** → 一句说明没找到该产品（逐字结构，跟随会话语言）：`没找到叫「{名字}」的产品。` / `No product named "{名字}" was found.`，然后转 **D** 分页列表让 SQA 选（SQA 也可以再给一个产品名重新搜）。

#### D. No ticket, no named product — list and pick（纯文字编号列表，分页）

Text / screenshots only; no ticket in step 1; no `product_id` in session; SQA 没有点名产品。

capability `products.list`（`page_size` = 50，`page_num` = 1；MCP 路由加 `view` = `compact`；不传 `search`，**禁止**从五字段推断产品名再搜）。

- Parse products from the response; map each row's `name` → `unique_id`。
- **产品数通常 > 4** — **不用 AskUserQuestion**；**直接**输出纯文字编号列表（逐字结构，填入实际产品名；**跟随会话语言**二选一，不同时输出）。序号**跨页连续**（第 2 页从 51 开始），这样回序号不会有歧义：

```text
要保存到哪个产品？回复序号即可，也可以直接输入产品名搜索：
1. 【产品 name】
2. 【产品 name】
…
N. 【产品 name】
```

```text
Which product should this be saved to? Reply with a number, or type a product name to search:
1. [产品 name]
2. [产品 name]
…
N. [产品 name]
```

- 还有下一页（`page_num × 50 < total`）→ 列表末尾追加一行（逐字，跟随会话语言）：`共 {total} 个产品，已显示 {起}–{止}。回「下一页」看更多。` / `{total} products in total, showing {起}–{止}. Reply "next page" for more.`；SQA 回「下一页」/ `next page` → `page_num` + 1 再拉一页，按同样格式接着编号展示。

**落点**：

- SQA **回复序号**（已展示过的任一页均可）→ 取对应行的 `unique_id` 为 `product_id`，`name` 为 product name → 继续 step 8+。
- SQA **输入产品名**：先在已展示的行里按 **C** 的规则本地匹配；唯一命中即采用；否则按 **C** 用 `search` 搜索并按 **C** 的落点处理。
- **重复 / 没选对**（序号无效、或 SQA 又说「保存」但未选产品）→ **短提示**（逐字，跟随会话语言）：`还差一步:先选个产品,回序号或产品名即可。` / `One more step: please pick a product first — reply with its number or name.` — 可重列当前页编号列表，**不要**长篇解释。
- 列表为空（`total` = 0）→ 如实报告无可用产品，**stop**（无法继续保存）。
- 翻完所有页 SQA 仍说产品不在列表中 → 请提供工单链接或说明需管理员处理（可能无该产品权限）。

Keep the resolved `product_id` (and product name) in context for module-tree and archive steps. Requirement archive writes must use this same `product_id` — do not substitute a different product unless SQA explicitly requests a change and step 7 is re-run.

### 8. 推荐挂载位置（仅选择已有 Module）

**触发时机**：

- **仅当**：保存意图闸已触发（step 6）、产品已确定（step 7）、进入本步时，走下方闭环。
- **跳过**：会话已确定 `module_tree_node_id`（如接力入站已带）→ **直接用，不重问** → 带 `module_tree_node_id` 进入 step 11（**不设** `location_confirmed` — step 11 乙式确认闸仍执行）。
- 本步仍在五字段尾巴之后；**不在** step 5b 出现模块树文案（见 step 5b **输出纪律**）。

**读树**（本步及「看看有哪些节点」共用；read only）：

capability `qa.module_tree.get` (`product_id`)（不传 MCP-only 的 `expand`）。

成功时（CLI 路由 `outcome: SUCCESS`；MCP 路由 `code == "SUCCESS"`）parse `data.nodes`（可能为 `[]`）。按下方顺序确定一个推荐挂载节点（name + `id` + 全路径）→ `{推荐节点全路径}`。Module-tree 由对应 Admin 全局管理；本 skill 只能选择已有节点，禁止创建节点或调用任何创建接口。

**推荐顺序**：

1. **SQA 点名的模块优先** — SQA 在会话任一消息里点名了模块 / 套件（如「保存到 Login 模块」「放在 Login 下面」「Access / Login」；「归档到 QA Insights」「存到测试套件」这类只说明归档目的地的说法不是点名节点，按内容推荐）→ 先去掉点名里的泛称词（`模块` / `节点` / `套件` / `module` / `node` / `suite`）并 trim，再与树中节点匹配（大小写不敏感）：
   - 节点 `name` 完全相同；或
   - 与节点**全路径**完全相同（全路径 = 从顶级到该节点的各级 `name` 用 ` / ` 连接，如 `Access / Login`）。
   - **恰好一个节点命中** → 它就是 `{推荐节点全路径}`，进 ① 选位置闭环（即使该节点 `is_completed` 为 true 也照用 — 这是 SQA 自己点的）。
   - **多个命中或无命中** → 回落到第 2 条正常推荐，并在 ① 框（第 2 条也无推荐时为〔选②〕列表）上方用一句话说明（逐字结构，跟随会话语言二选一）：`没找到名为「{点名}」的节点，改为按需求内容推荐：` / `No node named "{点名}" was found, so here is a recommendation based on the requirement:`；多个命中时改用 `有多个名为「{点名}」的节点，改为按需求内容推荐：` / `Several nodes are named "{点名}", so here is a recommendation based on the requirement:`。
2. **按五字段推荐** — 从五字段内容推荐一个最贴合的节点。
   - `is_completed` 为 true 的节点**仍可被选择**（〔选②〕照常列出、SQA 选中照常采用），但**不要优先推荐**：有合适的未完成节点时推荐未完成节点；只有已完成节点合适时才推荐它。

**无推荐 / 空树**：

- 无推荐但 `data.nodes` 非空 → **不要**留空、**不要**自由发挥、**不要**弹 ① 选位置框；直接进〔选②〕列出全部已有节点供 SQA 选择。
- `data.nodes` 为 `[]` → 输出下方空树提示，保留草稿与已解析的 `product_id`，然后 **`stop`**；禁止归档、禁止创建兜底。
- 空树提示（逐字；**跟随会话语言**二选一，不同时输出）：
  - `当前没有可选的 Module。请联系对应 Admin 创建后再继续。`
  - `There are no Modules available. Contact the appropriate Admin to create one, then continue.`
- Admin 创建完成后，SQA 说「继续」或同义表达 → **重新调用** capability `qa.module_tree.get`；禁止复用先前空列表。

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
| `header` | 选择模块 | Choose Module |
| `question` | 保存到「{推荐节点全路径}」节点？选择后会立即写入 CawPlan | Save under the "{推荐节点全路径}" node? Choosing it saves to CawPlan right away |
| option 1 · `label` | 就保存到这里 | Use this module |
| option 1 · `description` | 立即保存到这个模块 | Save to this module now |
| option 2 · `label` | 看看有哪些节点 | Browse nodes |
| option 2 · `description` | 列出模块树再选 | List the module tree and pick |

本框就是**保存确认**（CLI / MCP 两条路由相同）：问句必须带「选择后会立即写入 CawPlan」，让 SQA 知道选完就会写，不会再有第二次确认。

**落点**（**选位置即确认保存** — Requirement 写入在 step 11 执行，但**不再**二次弹保存确认框）：

- **就保存到这里** → 采用推荐节点，`module_tree_node_id` = 该节点 `id`；设 `location_confirmed = true` → 进入 step 11 Gate / Table B → **直接** POST 或 PATCH（见 `workflow-archive.md` §11 **跳过乙式确认闸**）。
- **看看有哪些节点** → 展示节点树形列表（〔选②〕），SQA 选中一个 → 采用、`module_tree_node_id` 写入上下文；设 `location_confirmed = true` → step 11 **直接**写入。

**AskUserQuestion 不可用时** — 纯文字降级（逐字，填入实际全路径；**跟随会话语言**二选一，不同时输出）：

```text
保存到「{推荐节点全路径}」节点？选择后会立即写入 CawPlan。 1. 就保存到这里 2. 看看有哪些节点(回序号)
```

```text
Save under the "{推荐节点全路径}" node? Choosing it saves to CawPlan right away. 1. Use this module 2. Browse nodes (reply with a number)
```

---

#### 〔选②〕看看有哪些节点（纯文字 · 树形缩进 · 全铺）

- **不使用框**（节点数量不定）。
- 用**缩进体现层级**：顶级顶格，子级逐层缩进；**全量铺开、不折叠**。
- **序号连续、跨层级不重号**；SQA 回序号即选中（**也认节点名**）。
- 引导句（逐字；**跟随会话语言**二选一，不同时输出）：

```text
有哪些节点?告诉我你要哪个(回序号或节点名),选中后会立即写入 CawPlan:
```

```text
Here are the nodes — tell me which one you want (reply with a number or node name); your choice saves to CawPlan right away:
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
