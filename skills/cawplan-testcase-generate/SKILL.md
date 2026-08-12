---
version: 0.2.6
name: cawplan-testcase-generate
description: |
  Expand archived test points into executable test cases: Markdown title-state preview first, expand steps on demand, export team CSV when SQA actively requests after review (read-only — does not write to CawPlan).
  Use when: generating test cases (preview first), expanding executable steps in Markdown preview, exporting CSV when SQA asks to export, or hot handoff after A2 ("按上面的生成用例", "generate test cases from above", or similar); cold handoff via Requirement portal link or requirement_id.
  NOT for: test-point coverage outlines (use `cawplan-testpoint-generate`); requirement analysis or archiving (use `cawplan-requirement-analyze`); viewing or editing archived test points in Test Suites (web UI); unarchived five-field drafts only (archive via A1 first).
argument-hint: "[Requirement portal link or requirement_id, '生成测试用例', '按上面的生成用例' / 'generate test cases from above']"
allowed-tools: Bash
---

# CawPlan TestCase Generate

## Bootstrap

```bash
cawplan skill check
```

## 红线 0 — 防臆造（最高优先级，压过一切展开与导出）

- 用例 Title / Preconditions / Step / Expected 里的**具体值**（次数、阈值、错误码、提示文案）**只能来自测试点或五字段**。
- 源里没有 → 方向占位或 **(甲) 诚实带尾巴**（如「应提示密码长度不符(具体文案以实现为准)」），**绝不落成硬值**。
- 四法只建议取哪一类值、铺哪几步；细则见 `references/test-design-methods.md`，但红线 0 不可外包给 reference。

## Workflow

### 1. Resolve target Requirement (entry priority)

On each **generate test cases** request, resolve the target in this order (**fall through**):

| Step | Condition | Action |
|------|-----------|--------|
| **P1** | Explicit reference (portal URL / `requirement_id` / switch) | **Cold handoff** — rebind |
| **P2** | Hot-handoff phrasing matches **and** **valid binding** (`product_id` + `requirement_id` both present) | **Hot handoff** — use session binding |
| **P3** | Requirement **draft** in session but **no** valid `requirement_id` (not saved) | → **框3「需求还没保存」** below |
| **兜底** | No link, no valid binding, no draft | → **框1「锁定 Requirement」** below |

**P2 话术（同义，须有效 binding）**：`按上面的生成用例` / `generate test cases from above` / `expand the test points above` / `接着生成用例` / `把上面的展开成用例` / `生成测试用例` / `展开用例` 等（与 SPEC hot handoff 同意图）。

**有效 binding** = `product_id` + `requirement_id` both present. Phrasing without binding → fall through to P3 or 兜底.

**未归档拦截（P3 + 原 unarchived branch 合并）** — 会话有需求草稿和/或测试点草稿/表，但 **无** valid `requirement_id` → **框3「需求还没保存」**（见下）。**Do not** fall through to §2 GET（would return empty and mislead SQA toward generating test points first). Unarchived fast-path is **not** supported in this release.

#### 框1 · 锁定 Requirement（入口 / 兜底）

**触发**：上表 **兜底**；或用户说 `生成用例` / `生成测试用例` / `展开用例` 等且消息与上下文中**无** Requirement 链接、无有效 binding、无草稿（object-unclear）。有效 P1/P2、已保存 Requirement → **不弹**。

**禁止**选项「用上面出好的」（属有效 P2）。

**优先 AskUserQuestion**（**仅两个点选项**；工具会自动追加 Other 自由输入行，**标题/占位不可自定义**——**不要**在 skill 里定义或手写 Other / 自由输入行）：

| 字段 | 值 |
|------|-----|
| `header` | 锁定 Requirement |
| `question` | 生成用例前，先确定是哪条 Requirement？ |
| option 1 · `label` | 已有 Requirement 链接 |
| option 1 · `description` | 选这个，把链接发我 |
| option 2 · `label` | 没有 Requirement |
| option 2 · `description` | 马上生成并保存到 CawPlan |

**AskUserQuestion 不可用时** — 纯文字降级（逐字）：

```text
锁定 Requirement
生成用例前，先确定是哪条 Requirement？
1. 已有 Requirement 链接 —— 选这个，把链接发我
2. 没有 Requirement —— 马上生成并保存到 CawPlan
请回复序号，或直接粘贴链接、或直接说你想怎么做。
```

**落点**：

- 选「已有 Requirement 链接」→ **请对方发链接**；拿到后（下条消息或工具自动 Other 框粘贴）→ Portal 解析（见下）；无法解析 → 复述两项 / 请重选。
- 选「没有 Requirement」→ 会话写 `resume_intent = testcase`，读 `cawplan-requirement-analyze` skill 接力。

#### 框3 · 需求还没保存

**触发**：上表 **P3**；或原 unarchived branch 条件（测试点草稿/表 + 无 `requirement_id`）。

**优先 AskUserQuestion**（**仅两个点选项**；Other 行由工具自动追加，**勿定义**）：

| 字段 | 值 |
|------|-----|
| `header` | 需求还没保存 |
| `question` | 这份需求还没保存到 CawPlan，先保存再来展开用例 |
| option 1 · `label` | 马上保存 |
| option 1 · `description` | 存好再接着展开用例 |
| option 2 · `label` | 先不保存 |
| option 2 · `description` | 先停一下，我再看看这份需求 |

**AskUserQuestion 不可用时** — 纯文字降级（逐字）：

```text
需求还没保存
这份需求还没保存到 CawPlan，先保存再来展开用例
1. 马上保存 —— 存好再接着展开用例
2. 先不保存 —— 先停一下，我再看看这份需求
请回复序号，或直接说你想怎么做。
```

**落点**：「马上保存」→ 会话写 `resume_intent = testcase`，读 `cawplan-requirement-analyze` skill 走保存/归档（**确认闸照旧**），`SUCCESS` 后回 **§2 refresh**；「先不保存」→ **stop**；若 SQA 用工具自动 Other 或自由回复 → 复述 / 按说明处理。

**Trigger routing** (when intent is ambiguous):

| User wants | Route to |
|------------|----------|
| 测试点大纲 / 覆盖面 / 「生成测试点」 | **A2** `cawplan-testpoint-generate` |
| 分析需求 / 五字段 / 归档 Requirement | **A1** `cawplan-requirement-analyze` |
| 生成测试用例（先出标题态预览）/ 可执行步骤 / 导出 CSV 用例 / 按上面的生成用例 | **A3** (this skill) |

**Anti-confusion**:

- **Object unclear** — user says `生成用例` / `生成测试用例` / `展开用例` (or equivalent) with **no** Requirement in message or context, no valid binding, no draft → **框1** above (not a bare text ask). Missing `product_id` after link parse → ask in plain language; **do not** scan product lists.
- **Draft already exists** + vague "生成用例" again → stop and ask: **重新生成** or **在现有基础上调整/展开?** (prevent overwriting SQA-edited draft).
- A3 **never** invents new coverage surfaces — gaps go to 存疑清单, suggest back to **A2**.

**Portal URL** (parse only — never fetch):

`/product/{product_id}/qa-insights/test-suites/requirements/{requirement_id}`

- Extract `product_id` + `requirement_id` from the string only.
- **Forbidden**: `cawplan api GET {url}`, HTTP fetch, or any request to the portal path.

**Only `requirement_id`, missing `product_id`**: ask for `product_id` or a full portal link.

**Rebind** replaces whole context. One active Requirement at a time.

### 跨 skill 接力

- **出站**（框1「没有 Requirement」、框3「马上保存」、§3 框2「马上生成测试点」）：接力前写入 `resume_intent = testcase`。
- **入站回归**：需求分析归档或测试点流程完成后，按 `resume_intent` 回到本 skill **§2 refresh** 续展开。
- **框2「马上生成测试点」**：读 `cawplan-testpoint-generate` skill；该流程**只生成并呈现测试点、不自动归档**；SQA 确认归档后才回 §2 refresh。若只说「看着不错」未归档，回来仍 `test_points.length === 0`、会再弹框2 — **预期行为**。
- **框1「已有 Requirement 链接」解析成功** → 按 P1 冷交接继续，**不弹**框3。

### 2. Refresh before expand (always)

Before expanding (cold **or** hot), pull live data — **library is source of truth**:

```bash
cawplan qa-insights requirements get <product_id> <requirement_id>
```

On `outcome: SUCCESS`, use envelope `data` for five fields + `module_tree_node_id` + metadata (`url`, etc.).

```bash
cawplan qa-insights testpoints list <product_id> <requirement_id>
```

On `outcome: SUCCESS`, use `data.test_points[]` in `sort_order`. Map each row: `id` → `TestPointId`, `title` → `TestPointTitle`, `tags[]` → Tag (`/` join if multiple), `group` → Group.

| Result | Action |
|--------|--------|
| Requirement found (`outcome: SUCCESS`) | Use latest five fields silently |
| Requirement missing (`error.type: not_found`, often `status: 404`) | Report honestly; do not expand from stale chat |
| Read fails (`outcome: FAILURE` or `UNKNOWN`) | Report error; **no fake success, no blind retry, no guessing** |

**Five-field drift**: if refresh shows five fields (especially `constraints`) changed since test points were written → one light 存疑 line before expand; do not expand silently.

### 3. Hard stop (after refresh, before expand)

| Condition | Action |
|-----------|--------|
| `test_points.length === 0` (after §2 refresh) | → **框2「还没有测试点」** below. Do not invent cases. |

#### 框2 · 还没有测试点

**触发**：§2 refresh 后 `test_points.length === 0`；与 §1 未归档路径（框3）**互斥**。

**优先 AskUserQuestion**（**仅两个点选项**；Other 行由工具自动追加，**勿定义**）：

| 字段 | 值 |
|------|-----|
| `header` | 还没有测试点 |
| `question` | 这条 Requirement 还没有测试点 |
| option 1 · `label` | 马上生成测试点 |
| option 1 · `description` | 生成好再接着展开用例 |
| option 2 · `label` | 先看看需求内容 |
| option 2 · `description` | 读一遍再决定 |

**AskUserQuestion 不可用时** — 纯文字降级（逐字）：

```text
还没有测试点
这条 Requirement 还没有测试点
1. 马上生成测试点 —— 生成好再接着展开用例
2. 先看看需求内容 —— 读一遍再决定
请回复序号，或直接说你想怎么做。
```

**落点**：

- 「马上生成测试点」→ 会话写 `resume_intent = testcase`，读 `cawplan-testpoint-generate` skill；**该流程只生成并呈现测试点、不自动归档**；SQA 确认归档后，按 `resume_intent` 回 **§2 refresh** 续展开。若只说「看着不错」未归档，回来仍无测试点、会再弹框2 — **预期行为**。
- 「先看看需求内容」→ **展示 §2 已拉取的五字段**，读完再决定。
- 若 SQA 用工具自动 Other 或自由回复 → 复述 / 按说明处理。

### 4. Read references (on demand — do not inline into SKILL)

| When | Read (in this skill's directory) |
|------|----------------------------------|
| Before expanding each test point | `references/test-design-methods.md` — EP/BVA/ST/EG toolbox |
| Before writing Title / Preconditions / Step / Expected; when inferring Priority (P0–P3) | `references/testcase-writing-spec.md` — field rules, split/merge, priority 升降, **步骤粒度（跨页必拆）** |
| Before export | `references/csv-template-mapping.md` — 12 columns, cross-row, escape, **草稿态混排 / 半展开留空** |
| Column layout truth source | `assets/testcase-template.csv` |

### 5. Expand test cases

**Preview carrier (workbench)**:

> 预览一律为对话内结构化 Markdown（表格 / 缩进步骤块 + 行首文字标签），不使用 artifact / 交互组件、不落盘 HTML。真相源是会话内存 `cases[]`。SQA 内容改动通过对话口述，Claude 更新 `cases[]` 后**只重打受影响部分**：改标题 → 重打受影响 Group 块的标题表；改某条步骤 → 只重打该 Group 块内那条展开块，不动其余。默认输出形态 = **首轮按 Group 分块标题表，后续局部展开块**，不每轮重打全部。

**Expansion boundary (first rule)**:

- Four methods expand **only on archived test points** — do not invent coverage.
- Missing surface with no parent test point → **存疑 only**: "此面无测试点覆盖，回去补一条测试点后刷新重展开." **No orphan cases.**
- Every case under the **archived main path** must have non-empty `testPointId` + parent test point — in `cases[]`, preview, and export (see §8).
- SQA **verbally adds** a new case → same rule: must attach non-empty `testPointId` + parent test point; if none → 存疑 back to **A2**, **not** into `cases[]` / preview / export.

**One test point → N cases**: split when **expected response differs**; merge when same response, different data only — see `references/testcase-writing-spec.md`. Do not skip values listed in A2 titles.

**Three-tier output rhythm** (content axis — Markdown preview only; **no CSV on this axis**):

| Tier | Markdown 预览呈现 | Trigger |
|------|------------------|---------|
| **Title only** | 按 **Group 无条件分块**的多张小表（见下「预览呈现格式」）；块内列：`#` / `用例标题` / `优先级` / `父测试点`（**无「分组」列**） | 默认首轮 — "生成测试用例" |
| **Partial** | 仅 SQA 点名那几条，打 step/expected 并排块；块标题与父测试点列遵「预览呈现格式」 | "展开第 X 条" / "先展开这 1–3 条" |
| **Full** | 全部条目打展开块（**仅 SQA 主动说「全部展开」时**）；块标题与父测试点列遵「预览呈现格式」 | "全部展开" |

**本批展开分流（Partial / Full 共用 — 看本批条数，不看池子总量）**:

- **适用**：SQA 本次请求属于 **Partial** 或 **Full** 展开（已有点名或「全部展开」意图）。
- **本批条数 `batchCount`**：这一次要打出 step/expected 块的 case 数。
  - Partial：SQA 点名的条数（如「展开前 25 条」→ 25；「展开第 1、3、5 条」→ 3）。
  - Full：当前 `cases[]` 中**本回合尚未展开**的条数（`steps` / `expected` 仍为空或视为未展开）。
  - 与 `cases[]` 总条数、已展开条数无关 — 只数本批。
- **`batchCount ≤ 10`**：照旧直接展开 Markdown 预览块，**不问、不停**。
- **`batchCount > 10`** 且 SQA **未**在请求里已表态 → **先不铺步骤**，只给三选一（载体分流，非确认闸；禁「确认 / confirm / 是否继续」）：

  > 本次要展开 N 条，在对话里会很长。你想：(a) 全部铺开（不管长短）；(b) 导出 CSV，去表格里看（按当前内容导出，未展开的按草稿态）；(c) 先不展开 — 你可以重新说一个更小的范围（比如「先展开 5 条」）。

  | 选择 | 动作 |
  |------|------|
  | **(a)** | 按本批范围全量打 Markdown 展开块 → §9 partial/full hint（复用 §9「SQA 明确要全量预览时允许」） |
  | **(b)** | 不铺对话展开块 → 走 §8 导出流程（本选择视为 SQA 主动要导出；**不会**为本批自动展开步骤，按当前内容导出，未展开的按草稿态）→ §9 export receipt |
  | **(c)** | 停下，不展开、不导出；等 SQA 重新发起更小范围 |

- **免分流（已表态则不问）**：请求里已明确决断要全铺时，**直接当 (a)**，例如「我知道很长，就是要全铺」「别问，全展开」「不管多长全部展开」— 仍遵守 §9 全量预览例外，不先抛三选一。
- **边界**：这不是给展开加确认闸；≤10 条、或已表态的 >10 条，展开仍无摩擦。三选一**仅**在「本批 > 10 且未表态」时出现。

- Default first pass: **title-state Markdown tables grouped by Group** (not CSV). **父测试点**列是拆分账核心：同一父测试点连出 N 行 = 逐项拆对；只出 1 行 = 可能错合；空 = 孤儿。
- **Preview table columns ≠ CSV 12 columns** — preview is for human review; export column layout follows `assets/testcase-template.csv`. 预览层的 `同上` 是显示缩写；`cases[].testPointTitle` 与导出 JSON 始终保留全称（见下「预览呈现格式」）。
- **预览一律按 Group 分块**（Title / Partial / Full 均适用；**即使仅 1 个 Group 也必须分块**，禁止单组平铺）：每个 Group 一块，块首为 `### {Group名}`；块内表列固定为 `#` / `用例标题` / `优先级` / `父测试点`。**禁止**在块内再加「分组」列（分组已由块标题表达）。分块仅影响 Markdown 布局，**不**决定 SQA 点名展开哪些条。
- **父测试点列「同上」**（**仅** Markdown 预览显示层；`cases[].testPointTitle` 与 §8 导出**永远全称**，见下条）：
  1. **块首行强制全称**：每个 `### {Group名}` 块内表格的**第一行**，父测试点列**必须写全称**，**禁止** `同上`（块内无上一条用例可比）。
  2. **「同上」触发条件（须同时满足）**：
     - 本行**不是**该块表格首行；
     - 本行 `cases[].testPointTitle` 与**本块内紧邻上一行**的 `testPointTitle` **逐字完全相同**（比的是父测试点列字符串本身，**不是**用例标题、**不是**主题相似、**不是**全局 `#` 序号）。
  3. **块边界归零**：每个新 Group 块开始时，**不得**延续上一块的「同上」链；跨块**禁止** `同上` 或「同第 N 条」。
  4. **禁止写法**：预览中不得出现「同第 N 条」；连续多行 `同上` 仅表示**同一父测试点**在本块内拆出多条用例。
- **与 CSV 导出无关（重要）**：上述分块与 `同上` **仅**作用于对话内 Markdown 预览。§8 导出时 interim JSON / CSV **每行**仍填完整 `testPointTitle` 与 `group`（12 列照常），**绝不**出现 `同上` 或省略。`cases[]` 内存真相源始终完整；预览只是渲染层缩写。

#### 预览呈现格式（Markdown only — 不影响 §8 导出）

| 档位 | 布局 |
|------|------|
| **Title only** | 按 Group 无条件分块；每块一张 4 列表（无「分组」列）；父测试点遵块内「同上」 |
| **Partial / Full** | 展开块挂在对应 Group 块下；块首仍打 `### {Group名}`；每条展开块用 `####` 标题行，保留 `#` / 标题 / 优先级 / 父测试点（父测试点仍遵块内「同上」），再接 Preconditions / Step / Expected |

- Partial expand: **SQA names every case** — do not proactively suggest which rows to expand. 本批点名条数用于上文 `batchCount`（见「本批展开分流」）。
- Detail three columns (**Preconditions / Step / Expected**) are **always generated together** per case (all or none).
- When expanding steps, follow `references/testcase-writing-spec.md` **「步骤粒度」**节: **after an action, if there is an observable page jump or state change → separate step**; do not merge cross-page / cross-state actions into one sentence. Same-page setup with no intermediate observable result may merge (不为拆而拆). Granularity SQA tuned on some rows → on Full expand, apply the same rules to the rest.

**Preview self-check** (when generating/updating preview):

- **块首行写了 `同上`（硬修，非提示）**：逻辑上必错、无误报空间。渲染前若发现某 Group 块表格首行父测试点列为 `同上`（或「同第 N 条」）→ **不得**留 `⚠` 也不交付该预览；**当场**用该行 `cases[].testPointTitle` **全称**写回父测试点列，再输出预览。**do not block** expand 的其余项仍适用。
- 父测试点列为 `同上`，但本行 `cases[].testPointTitle` ≠ 本块内紧邻上一行 `cases[].testPointTitle`（逐字）→ inline `⚠同上引用错误`（软提示，不阻断）
- Step contains verification verbs (验证/检查/确认) → inline `⚠疑似预期混入步骤`
- `step` line count ≠ `expected` line count → inline `⚠步骤/预期不配对`
- Expected contains source-doubtful concrete values → inline `⚠具体值待核` (红线 0 backstop)

**SQA edits in preview** — row-prefix labels: `【已调整】` / `【新增】` / `【存疑】`; deleted rows → "已移除" subsection at preview end (trace, not silent drop). **存疑清单正文** (separate from row labels) still uses A2 format: 〔指向哪〕+〔为什么疑〕+〔建议动作〕. Say "无" if none.

**Priority**: infer P0–P3 per `references/testcase-writing-spec.md` (升降规则); script maps to Critical/High/Medium/Low on export.

### 6. Self-review (internal — do not show SQA a checklist)

Run **twice**: (1) before **title-state preview**; (2) before **export**.

1. Per `references/testcase-writing-spec.md` — would merging reduce duplicate verification goals?
2. Every case has non-empty `testPointId` (archived path); orphans **do not enter** `cases[]`, preview, or export → 存疑 back to A2.

### 7. Confirm before writing files

| Action | Confirm? | Notes |
|--------|----------|-------|
| Title-state / expand preview (Markdown) | **No** | Does not write files |
| **Export CSV** (SQA initiates) | **No** upfront confirm | SQA asked; receipt states draft vs final (see §9) |
| **Regenerate entire set** | **Yes** | Clears `cases[]`, discards all `【已调整】` / `【新增】` / "已移除" traces, rebuilds from GET test points — wipes SQA manual edits |
| Delete / retitle / SQA-directed tweak | **No** | Update `cases[]` + re-render affected preview; **§8 only when SQA says export** |

### 8. Export via script (mandatory — no AI-written CSV)

AI produces an **export-time snapshot** of current `cases[]` as interim JSON; `export_to_csv.js` lays out cells only — **no improvisation, no inline CSV text, no ad-hoc export code**.

**When to export**:

- Triggered **only when SQA actively asks** (e.g. 「导出 CSV」). May export at **any content state** (title-only / partial mix / full). Assemble interim JSON from current `cases[]`. Non–full-expand = **draft export**: unexpanded rows keep `steps` / `expected` as `[]`; mixed rows legal (see `references/csv-template-mapping.md` 「草稿态导出」). Export does **not** lock work state; may export multiple times (timestamp filenames do not overwrite). Describe draft status honestly in §9 receipt — do not rename files or add columns.
- Before export: **filter out** entries with `status: 'removed'` — preview-only trace; **do not** put `status` or removed rows into interim JSON.
- Before export: if any remaining row has `steps.length !== expected.length` → **refuse export**, point SQA to fix in preview (e.g. "第 3 条步骤与预期数量不一致,先修齐再导") — **do not** call §8 and dump script stderr.

**Interim JSON contract** (`{ requirementTitle, cases: [...] }`):

| Field | Notes |
|-------|-------|
| `requirementTitle` | For filename (`<title>_<timestamp>.csv`) |
| `title` | Case title |
| `priority` | P0–P3 (or English — script maps) |
| `tag`, `group`, `testPointTitle` | Inherit from parent test point; **`testPointTitle` 必须全称，禁止 `同上` 或省略** |
| `testPointId`, `requirementId` | From GET — **required under archived main path** |
| `moduleTreeNodeId` | From GET five fields; empty + 存疑 if missing |
| `preconditions` | string or string[]; title-only tier → omit or empty |
| `steps[]`, `expected[]` | **Equal length**; title-only → both `[]` |

**Script hard gates** (archived main path): empty `testPointId` / `requirementId` / `title` → fail; `steps.length !== expected.length` → fail.

```bash
# Ephemeral path — timestamp avoids $$ cross-invocation collisions; run all three lines in one shell
TMP_JSON="/tmp/a3_export_$(date +%Y%m%d_%H%M%S)_$RANDOM.json"

cat > "$TMP_JSON" <<'EOF'
{ "requirementTitle": "...", "cases": [ ... ] }
EOF

node scripts/export_to_csv.js "$TMP_JSON" -o testcases   # zero npm deps; run from this skill directory

rm -f "$TMP_JSON"
```

- Default output dir: `testcases/` under cwd; override with `-o <dir>` when SQA specifies.
- On script failure after a valid export attempt → report stderr honestly; fix JSON upstream, retry.
- **Forbidden**: writing CSV by hand in chat or generating one-off Python/JS export snippets.
- **To SQA**: do not say "脚本" — say "按当前内容导出".

### 9. Present (preview + export receipt)

**Preview state** (after title table / partial expand / full expand when SQA asked):

- Markdown 预览的**分块、列结构、父测试点「同上」**遵 §5「预览呈现格式」；与 §8 CSV 落盘无关。
- Output the corresponding **Markdown preview** + **one of the three SQA hints below** + 存疑清单 (if any).
- **Forbidden**: agent **proactively** pasting a full expand table for all cases (context blow-up). **Exception** — full Markdown preview is allowed when:
  1. SQA explicitly says **「全部展开」** (or equivalent), **or**
  2. SQA chose **(a) 全部铺开** from §5「本批展开分流」, **or**
  3. SQA **免分流已表态**（§5：如「我知道很长，就是要全铺」）— still preview, not CSV.
  Title tables and partial expand blocks are always allowed as Markdown preview.

**Three SQA hints** (after preview; no word "脚本"):

- **After title-state preview:**
  > 以上为标题态预览(未导出)。可继续调标题 / 增删;需要看步骤粒度就说「展开第 X 条」;审阅满意后说「导出 CSV」,即按当前内容导出。

- **After partial expand:**
  > 已展开这 N 条供你看步骤粒度,其余未展开。可继续展开别的,或说「全部展开」;随时可说「导出 CSV」(当前为混排,会按草稿态导出)。

- **Export receipt** (after §8 only — thin summary, **no case body**):
  1. Requirement display name + file path (from stdout `已导出: ...`)
  2. Group-level counts (e.g. "3 组 / 12 条")
  3. 存疑清单 (if any, same list as preview state)
  4. Status line:
     > 已导出:<路径>。本次 N 条,其中 M 条含步骤、其余标题态。**非全展开时:此为草稿态、非最终交付。**

CSV is an **export snapshot**; Markdown preview is the **in-conversation work state**.

## Session state (in-conversation only)

- **Binding**: `product_id`, `requirement_id`, latest five fields, `module_tree_node_id`, test-point rows from GET.
- **Draft**: in-memory `cases[]` is the working set. SQA adjusts in chat → update `cases[]` + **re-render affected Markdown preview** (default: group-blocked title tables on first pass, **local expand blocks afterward** — not full re-render every turn). Deleted entries: `status: 'removed'` on the row (preview "已移除" only). **Export is a separate, SQA-initiated commit** — not re-export on every tweak; may export multiple times; work state unchanged after export. Partial expand may add one line index e.g. "已展开: #1,#3". Prior expanded content lives in `cases[]`; a Partial turn only renders rows SQA named this turn.
- **No disk state**: no `.memory`, no cross-session cache. Interim JSON exists in `/tmp/` only at export instant, then deleted. Markdown preview is chat output, not disk state.

**Out of scope (v1)**: offline CSV edit round-trip (路 B); no `is_edited`; A3 never POST/PATCH CawPlan.

## Walkthrough (Markdown 预览 → 按需展开 → SQA 触发导出)

**Setup**: Requirement archived; A2 has test point `1.1` "错误账号或密码登录应失败并给出明确提示" (`异常`, group `登录校验`). After §2 refresh, expand to cases.

**Step A — "生成测试用例"** → §6 self-review → **title-state Markdown tables by Group** + §9 title-state hint. **Do not run §8.**

Title-state preview (illustrative — even a single Group uses one block):

### 登录校验

| # | 用例标题 | 优先级 | 父测试点 |
|---|---------|--------|---------|
| 1 | 错误账号或密码点击 Sign In 应失败并给出明确提示 | P1 | 错误账号或密码登录应失败并给出明确提示 |

**多 Group 时父测试点「同上」**（块边界归零 + 块首行全称 — illustrative）：

### 素材时长基础校验

| # | 用例标题 | 优先级 | 父测试点 |
|---|---------|--------|---------|
| 3 | 上传超可用时长的 Video 应被拦截并提示 | P1 | 上传超过当前可用时长的 Audio 或 Video 素材应被拦截并提示(文案以实现为准) |

### 类型与节点独立性

| # | 用例标题 | 优先级 | 父测试点 |
|---|---------|--------|---------|
| 4 | 节点 A 上传 Audio 后仅重算该类型可用时长 | P1 | 同一节点内 Audio 与 Video 时长限制应独立计算,互不影响 |
| 5 | 节点 A 上传 Video 后仅重算该类型可用时长 | P1 | 同上 |

- #4 是新块**首行** → 父测试点**必须全称**（禁止 `同上`，即使 #3 在上一块末行）。
- #5 与 #4 的 `testPointTitle` **逐字相同** → 父测试点列可写 `同上`。
- 跨块**禁止**让 #4 写 `同上` 指向 #3（那是跨组误用）。

`cases[]` in memory (illustrative — **not** an export file):

```json
{
  "requirementTitle": "账号密码登录",
  "cases": [
    {
      "title": "错误账号或密码点击 Sign In 应失败并给出明确提示",
      "priority": "P1",
      "tag": "异常",
      "group": "登录校验",
      "testPointTitle": "错误账号或密码登录应失败并给出明确提示",
      "testPointId": "019fd7aa-0000-0000-0000-000000000002",
      "requirementId": "019fd634-8ffd-7d62-b46e-32f8132b4520",
      "moduleTreeNodeId": "019fd633-47c8-7be0-a7c5-1ea1179c7195",
      "steps": [],
      "expected": []
    }
  ]
}
```

**Step B — SQA: "展开第 1 条"** → output that row's Markdown expand block under `### 登录校验`, using `####` for the expand header (**no confirm, no file**). Two granularity examples:

1. **同页可合（不为拆而拆）**: 输入与点击同属铺垫、验证点只在登录结果 — merge to one step / one expected (see `references/testcase-writing-spec.md` 「步骤内拆分判据」).

```json
{
  "preconditions": "1. 当前处于未登录状态",
  "steps": ["在登录页输入错误账号或密码并点击 Sign In 按钮"],
  "expected": ["登录失败，停留登录页并提示账号或密码错误(具体文案以实现为准)"]
}
```

2. **跨页必拆**: follow `references/testcase-writing-spec.md` **「步骤粒度」**节 Config → Idea → Storyboard table example — **do not duplicate**; cite that table when explaining cross-page splits.

**Step C — SQA: "导出 CSV"** → §8 (filter `status: 'removed'`, pairing check) → §9 export receipt.

Export column layout: `assets/testcase-template.csv`.

## Output & Confirmation

- **Title-state first pass** → §6 → §5 title Markdown preview → §9 hint (**no §8**)
- **Partial / full expand** → §5：若本批 `batchCount > 10` 且未表态 → 三选一分流；**(a)** / ≤10 / 免分流 → expand Markdown preview → §9 hint；**(b)** → §8 → §9 receipt；**(c)** → 停下（**no confirm gate on expand itself; triage is routing only**）
- **Export CSV (SQA initiates)** → §8 (filter removed, refuse mispaired) → §9 receipt (any content state)
- **Regenerate entire set** → §7 confirm → §6 → §5 preview
- **Failures** → §2 honest error; keep in-memory draft if safe

## References

- `references/CAWPLAN_OPEN_API.md` — Requirement / TestPoints field shapes (§15); CLI reads via `cawplan qa-insights requirements get` / `testpoints list`
- `references/test-design-methods.md`
- `references/testcase-writing-spec.md`
- `references/csv-template-mapping.md`
