### 7. Resolve product

**仅当「保存意图闸」已触发**后执行本步。Run this after the draft (five fields + display summary) is acceptable and **before** any QA Insights API calls (`.../qa/module-tree`, `.../qa/requirements`). Read-only — no writes. Do **not** call `GET/POST .../qa/...` in this step（`products list` 仅在本步无 Ticket 选产品分支调用）。

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
- **产品数通常 > 4** — **不用 AskUserQuestion**；**直接**输出纯文字编号列表（逐字结构，填入实际产品名）：

```text
要保存到哪个产品？回复序号即可：
1. 【产品 name】
2. 【产品 name】
…
N. 【产品 name】
```

**落点**：

- SQA **回复序号**（也认 **产品名** 原文或大小写不敏感匹配）→ 取对应行的 `unique_id` 为 `product_id`，`name` 为 product name → 继续 step 8+。
- **重复 / 没选对**（序号无效、产品名对不上、或 SQA 又说「保存」但未选产品）→ **短提示**（逐字）：`还差一步:先选个产品,回序号即可。` — 可重列同一编号列表，**不要**长篇解释或改走 search。
- 列表为空 → 如实报告无可用产品，**stop**（无法继续保存）。
- 返回超过 100 条时 **仍只展示本次 100 条**（不翻页）。若 SQA 称产品不在列表中 → 请提供工单链接或说明需管理员处理；**禁止**改走 `--search` 或口头「再报个产品名」老路。

Keep the resolved `product_id` (and product name) in context for module-tree and archive steps. All **write** operations (new module node, archive Requirement) must use this same `product_id` — do not substitute a different product unless SQA explicitly requests a change and step 7 is re-run.

### 8. 推荐挂载位置（模块树 · 闭环）

**触发时机**：

- **仅当**：保存意图闸已触发（step 6）、产品已确定（step 7）、进入本步时，走下方闭环。
- **跳过**：会话已确定 `module_tree_node_id`（如接力入站已带）→ **直接用，不重问** → 带 `module_tree_node_id` 进入 step 11。
- 本步仍在五字段尾巴之后；**不在** step 5b 出现模块树文案（见 step 5b **输出纪律**）。

**读树**（本步及「看看有哪些节点」共用；GET only，创建节点前不写库）：

```bash
cawplan api GET /api/v1/public/openapi/product/<product_id>/qa/module-tree
```

Parse `data.nodes`（可能为 `[]`）。从五字段尝试推荐一个挂载节点（name + `id` + 全路径）→ `{推荐节点全路径}`。

**无推荐 / 空树**（系统给不出推荐节点，或 `data.nodes` 为 `[]`）：

- **不要**留空、**不要**自由发挥、**不要**弹 ① 选位置框。
- **直接**进〔选②〕「看看有哪些节点」树形缩进列表（空树时列表为空，仍用同一引导句）；SQA 从中选一个，或说「新建一个节点」→ 进〔选③〕。

**有推荐节点** → 进 ① 选位置闭环。

**整体流程（闭环）**：

```
① 选位置(框)
     ├─「就保存到这里」→ 用推荐节点 → 挂上、继续 step 11 保存（此步只定位置、未写库）
     ├─「看看有哪些节点」→ 树形缩进列表(文字)→ 选中一个 → 用它挂上、继续 step 11
     └─「新建一个节点」→ 问名字+父节点(文字)→ 确认新建(框)
                                                   ├─「对,新建」→ 写库建节点 →〔回到 ①〕拿新建的那条当推荐,再确认一次
                                                   └─「不对」→ 回上一步重问名字+父节点,不写库
```

关键：**新建只负责「把节点建出来」；建完不自动挂载**，而是回到「选位置」逻辑，以刚建的节点为推荐，再走一遍「是否要保存到这里」。

---

#### ① 选位置（AskUserQuestion 框）

**优先 AskUserQuestion**（**三个选项，每项须带 `label` + `description`**；工具若自动追加 Other 行，**勿在 skill 里定义 Other**）：

| 字段 | 值 |
|------|-----|
| `header` | 选择位置 |
| `question` | 是否要保存到「{推荐节点全路径}」节点下? |
| option 1 · `label` | 就保存到这里 |
| option 1 · `description` | 用推荐的这个位置 |
| option 2 · `label` | 看看有哪些节点 |
| option 2 · `description` | 列出模块树再选 |
| option 3 · `label` | 新建一个节点 |
| option 3 · `description` | 建个新的来放 |

**落点**（**此步只定位置、未写库** — 真正保存须经 step 11 确认闸）：

- **就保存到这里** → 采用推荐节点，`module_tree_node_id` = 该节点 `id`，挂上、继续 step 11 保存。
- **看看有哪些节点** → 展示节点树形列表（〔选②〕），SQA 选中一个 → 采用、`module_tree_node_id` 写入上下文、挂上、继续 step 11。
- **新建一个节点** → 进〔选③〕问名字+父节点。

**AskUserQuestion 不可用时** — 纯文字降级（逐字，填入实际全路径）：

```text
是否要保存到「{推荐节点全路径}」节点下? 1. 就保存到这里 2. 看看有哪些节点 3. 新建一个节点(回序号)
```

---

#### 〔选②〕看看有哪些节点（纯文字 · 树形缩进 · 全铺）

- **不使用框**（节点数量不定）。
- 用**缩进体现层级**：顶级顶格，子级逐层缩进；**全量铺开、不折叠**。
- **序号连续、跨层级不重号**；SQA 回序号即选中（**也认节点名**）。
- 引导句（逐字）：

```text
有哪些节点?告诉我你要哪个(回序号或节点名):
```

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

- **落点**：选中 → 采用该节点，`module_tree_node_id` 写入上下文、挂上、继续 step 11 保存（此步只定位置、未写库）。
- SQA 说「新建一个节点」或节点不在列表中 → 进〔选③〕。

---

#### 〔选③〕新建一个节点 · 问名字+父节点（纯文字）

- 引导句（逐字）：`节点名叫什么,挂在哪个父节点下?不确定可先说「看看有哪些节点」。`
- 父节点可以是**顶级**，也可以是**任意现有节点**（层级不限）。
- SQA 不确定父级 → 引导走〔选②〕「看看有哪些节点」浏览后再回来。
- 名字 + 父节点都齐 → 进「确认新建」②。

---

#### ② 确认新建（AskUserQuestion 框 · 写库前确认闸）

**优先 AskUserQuestion**（**两个选项，每项须带 `label` + `description`**）：

| 字段 | 值 |
|------|-----|
| `header` | 确认新建 |
| `question` | 新建节点「{新节点名}」(在「{父节点全路径}」下),对吗?（顶级父节点：`新建节点「{新节点名}」(顶级),对吗?`） |
| option 1 · `label` | 对,新建 |
| option 1 · `description` | 就按上面建 |
| option 2 · `label` | 不对 |
| option 2 · `description` | 改名字或位置 |

**落点**：

- **对,新建** → **写库建节点**（step 9 POST）；建成后 **回到 ① 选位置**，以刚建节点全路径为 `{推荐节点全路径}`，再走一遍「是否要保存到这里」。
- **不对** → 回〔选③〕重问名字+父节点，**不写库**。

**写库约束**：**这是唯一真正写库的一步** — 未经 SQA 明确选「对,新建」，**不许写库、不许自动确认、不许跳过**。

**AskUserQuestion 不可用时** — 纯文字降级（逐字；顶级用 `(顶级)` 替换 `(在「…」下)`）：

```text
新建节点「{新节点名}」(在「{父节点全路径}」下),对吗? 1. 对,新建 2. 不对(回序号)
```

---

#### ③ 新建成功后 → 回到「选位置」再确认

- 写库建成后，**不自动挂载**。
- 以**新建的那条节点全路径**为推荐，**再走一遍 ① 选位置**（`question` / 选项 / 降级与 ① 相同，填入 `{新建节点全路径}`）。
- 选「就保存到这里」→ 采用、`module_tree_node_id` 写入上下文、挂上、继续 step 11 保存（此步只定位置、未写库）。SQA 建完仍能核对，甚至再改或再建。

---

**通用约束**（模块选择专用）：

- **框只用于**「选位置」（2–4 个固定动作）和「确认新建」（是/否）。
- **节点列表一律纯文字树形** — 不塞进框。
- **AskUserQuestion 选项一律带 `description`**（短句灰字说明）；纯文字降级措辞与上文一致。
- **全程纯文字降级**：框不渲染时退化为编号问答，措辞与上文一致。
- **写库前必确认**：仅「确认新建 → 对,新建」写库，且必须 SQA 明确选择。

**If the API fails**: see **Failures** (Rules).

### 9. Create module-tree node（write — §8 ② 确认新建闸之后）

**仅当** §8 〔选③〕名字+父节点已齐，且 SQA 在「确认新建」框选了 **对,新建** 后执行。不得在 step 8 推荐阶段、不得在 SQA 口头说「没有这个节点」时自动 POST。

**Before POST**：须已完成 §8 ②「确认新建」框且 SQA 选 **对,新建**（§8 已闸；本节不再二次读回）。

**POST**：

```bash
cawplan qa-insights module-tree node create <product_id> \
  --parent-id <parent node id> --name "<node name>"
```

- `--parent-id`：现有节点 `id`；**省略**则新建顶级节点。
- Read JSON on stdout; branch on `outcome` (see **Command outcomes**):
  - `SUCCESS` → 取 `api.data.id` 与名称，拼出 `{新建节点全路径}`；**不**此时写入 `module_tree_node_id` 用于归档 — **回到 §8 ③ → ①** 再确认挂载。
  - `FAILURE` → report `error.message`；深度限制错误勿用更深路径重试。
  - `UNKNOWN` → 节点可能已存在；**勿重复执行本命令**（避免重复节点）；请 SQA 在 Test Suites 核对。

Use the `product_id` resolved in step 7.
