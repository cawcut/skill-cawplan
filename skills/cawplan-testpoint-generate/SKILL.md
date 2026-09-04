---
version: 0.2.8
name: cawplan-testpoint-generate
description: |
  Generate test-point coverage outlines from an archived CawPlan Requirement (five fields), with an open-questions list, and batch-archive test points after SQA confirmation.
  Use when: an archived Requirement needs test points or a coverage outline; cold handoff (Requirement link or id); hot handoff after A1 archive ("generate test points for this requirement"); incremental test-point supplements on an existing Requirement.
  NOT for: structuring or archiving Requirements (use `cawplan-requirement-analyze`); expanding test points into step-by-step cases or Excel (A3); viewing or editing archived test points or review in Test Suites (use the web UI); unarchived five-field drafts only (archive via A1 first).
argument-hint: "[Requirement link or requirement_id, or 'continue the requirement just archived']"
allowed-tools: Bash
---

# CawPlan TestPoint Generate

**跟随用户主语言**生成文案；禁止同一段中英各写一遍。

## Bootstrap

```bash
cawplan skill check
```

## Workflow

**归档后用例热交接（优先于 §1）** — 本条为「马上生成测试用例」（或同义，见 `cawplan-testcase-generate` P2），且会话已有有效 binding（`product_id` + `requirement_id`）？

- **是** → 读 `cawplan-testcase-generate` skill，按 P2 热交接续跑（**stop** 本 skill 后续步骤）。
- **否** → 继续下方 §1。

### 1. Resolve target Requirement (entry priority)

On each **generate test points** request, resolve the target in this order (**fall through** until one row matches):

| Step | Condition | Action |
|------|-----------|--------|
| **P1** | This message has an explicit reference (Requirement link / `requirement_id` / switch to another Requirement) | **Cold handoff** — rebind; ignore prior session binding |
| **P2** | Hot-handoff phrasing matches **and** session has **valid binding** (`product_id` + `requirement_id` both present) | **Hot handoff** — use current session binding |
| **P3** | Session has a requirement **draft** (five-field draft from analysis) but **no** valid `requirement_id` (not saved yet) | → **框2「需求还没保存」** below. **Do not** call APIs or show a test-point table |
| **兜底** | None of the above (no link, no valid binding, no draft) | → **框1「锁定 Requirement」** below |

**P2 话术（同义，须先满足有效 binding 才走热交接）**：`马上生成测试点` / `生成测试点` / `补测试点` / `按上面那条` / `按上面那条生成测试点` / `接着刚才那条` 等。

**有效 binding** = `product_id` and `requirement_id` both present in session. Phrasing alone without binding → **fall through** to P3 or 兜底.

#### 框1 · 锁定 Requirement（入口 / 兜底）

**触发**：上表 **兜底**（无 Requirement 链接 / 无有效 binding / 无草稿）。P1 或有效 P2 → **不弹**。

**禁止**在选项中出现「用刚归档那条」（属有效 P2 热交接，自动走）。

**优先 AskUserQuestion**（**两个选项，每项须带 `label` + `description`**；工具会自动追加 Other 自由输入行，**标题/占位不可自定义**——**不要**在 skill 里定义或手写 Other / 自由输入行；**跟随会话语言**整框二选一，不同时输出）：

| 字段 | 中文值 | English value |
|------|-----|-----|
| `header` | 锁定 Requirement | Lock Requirement |
| `question` | 生成测试点前，先确定是哪条 Requirement？ | Before generating test points, let's confirm which Requirement this is |
| option 1 · `label` | 已有 Requirement 链接 | I have a Requirement link |
| option 1 · `description` | 把链接发我 | Send me the link |
| option 2 · `label` | 没有 Requirement | No Requirement yet |
| option 2 · `description` | 马上生成并保存到 CawPlan | Generate and save to CawPlan now |

**AskUserQuestion 不可用时** — 纯文字降级（逐字；**跟随会话语言**二选一，不同时输出）：

```text
锁定 Requirement
生成测试点前，先确定是哪条 Requirement？
1. 已有 Requirement 链接 —— 选这个，把 Requirement 链接发我
2. 没有 Requirement —— 马上生成并保存到 CawPlan
请回复序号，或直接粘贴 Requirement 链接、或直接说你想怎么做。
```

```text
Lock Requirement
Before generating test points, let's confirm which Requirement this is
1. I have a Requirement link — pick this, then send me the link
2. No Requirement yet — generate and save to CawPlan now
Reply with a number, paste the Requirement link directly, or just tell me what you'd like to do.
```

**落点**：

- 选「已有 Requirement 链接」→ **请对方发 Requirement 链接**（一句即可）；拿到 Requirement 链接后（下条消息，或工具自动 Other 框里直接粘贴）→ 按下方 **Portal URL** 规则解析（只解析、不 fetch）；仅 `requirement_id` 缺 `product_id` → 用大白话追问补 `product_id` 或完整 Requirement 链接。无法解析为 Requirement 链接 → 复述两项，请重选或补 Requirement 链接。
- 选「没有 Requirement」→ 读 `cawplan-requirement-analyze` skill，按 **跨 skill 接力**：会话写 `resume_intent = testpoint`；有草稿则跳过分析直达归档闸，无草稿则从收素材开始。

#### 框2 · 需求还没保存

**触发**：上表 **P3**（有需求草稿、无 `requirement_id`）。有效热交接 / 已给 Requirement 链接 → **不弹**。

**优先 AskUserQuestion**（**两个选项，每项须带 `label` + `description`**；Other 行由工具自动追加，**勿定义**；**跟随会话语言**整框二选一，不同时输出）：

| 字段 | 中文值 | English value |
|------|-----|-----|
| `header` | 需求还没保存 | Requirement Not Saved Yet |
| `question` | 这份需求还没保存到 CawPlan，先保存再来生成测试点 | This requirement hasn't been saved to CawPlan yet — save it first, then generate test points |
| option 1 · `label` | 马上保存 | Save now |
| option 1 · `description` | 存好再接着生成测试点 | Save it, then continue to generate test points |
| option 2 · `label` | 先不保存 | Not yet |
| option 2 · `description` | 先停一下，我再看看这份需求 | Pause for now, I'll review this requirement again |

**AskUserQuestion 不可用时** — 纯文字降级（逐字；**跟随会话语言**二选一，不同时输出）：

```text
需求还没保存
这份需求还没保存到 CawPlan，先保存再来生成测试点
1. 马上保存 —— 存好再接着生成测试点
2. 先不保存 —— 先停一下，我再看看这份需求
请回复序号，或直接说你想怎么做。
```

```text
Requirement Not Saved Yet
This requirement hasn't been saved to CawPlan yet — save it first, then generate test points
1. Save now — save it, then continue to generate test points
2. Not yet — pause for now, I'll review this requirement again
Reply with a number, or just tell me what you'd like to do.
```

**落点**：

- 「马上保存」→ 读 `cawplan-requirement-analyze` skill，会话写 `resume_intent = testpoint`，走保存/归档流程（**确认闸照旧**）；`SUCCESS` 后回到本 skill **§2 refresh** 续跑。
- 「先不保存」→ **stop**；保留草稿，不生成测试点。
- 若 SQA 用工具自动 Other 或自由回复 → 按内容判断（换目标 / 补充说明）；无法理解则复述两项选项。

**Portal URL** (parse only — never fetch):

`/product/{product_id}/qa-insights/test-suites/requirements/{requirement_id}`

- Extract `product_id` + `requirement_id` from the string only.
- **Forbidden**: `cawplan api GET {url}`, HTTP fetch, or any request to the portal path.

**Only `requirement_id`, missing `product_id`**: ask for `product_id` or a full Requirement link. **Do not** guess the product or scan product lists.

**Rebind** replaces the whole context (`product_id`, `requirement_id`, five fields, test-point stubs). One active Requirement at a time. Same `requirement_id` as current binding = refresh same row, not rebind. Contradictory messages (new URL + "还是刚才那条") → ask; do not guess.

### 跨 skill 接力

- **出站**（框1「没有 Requirement」、框2「马上保存」）：接力前写入 `resume_intent = testpoint`。
- **入站回归**：需求分析归档 `SUCCESS` 后，发起方从 **§2 refresh** 继续。
- **A1 §6 引导入站**：需求分析 §6 成功回执后 SQA 说「马上生成测试点」→ 有效 binding 下 P2 热交接，直跑 §2 refresh（无需再贴需求）。
- **出站回归（`resume_intent = testcase`）**：测试点归档 `SUCCESS`（或 §10 `count_matched` 确认已落库）后，若会话存在 `resume_intent = testcase`，**读取并清除** `resume_intent`，读 `cawplan-testcase-generate` skill 从其 **§2 refresh** 续跑；**不追加** §9.5 用例引导；不停在本 skill 等下一条指令。
- **归档后用例引导**：§9.5 成功回执末尾可选追加一句（见 §9.5 末尾引导）；用户回「马上生成测试用例」→ 读 `cawplan-testcase-generate` skill（P2 热交接）；不接茬则不重复提示。
- **框1「已有 Requirement 链接」解析成功** → 按 P1 冷交接继续，**不弹**框2。

### 2. Refresh before generate (always)

Before generating or supplementing test points (cold or hot), pull live data:

```bash
cawplan api GET /api/v1/public/openapi/product/<product_id>/qa/requirements/<requirement_id>
```

Use `data` directly for the five fields + `url` (single `QARequirement` object; no list filter).

```bash
cawplan api GET /api/v1/public/openapi/product/<product_id>/qa/requirements/<requirement_id>/testpoints
```

**Record `data.test_points.length` as `count_before`** (session state ③). This is the baseline `testpoints reconcile` needs if an archive comes back `UNKNOWN` — the command **refuses to derive it**, because a second GET could pick up rows someone else added in between and silently corrupt the comparison. Re-record it on every refresh; a stale baseline is worse than none.

| Result | Action |
|--------|--------|
| Requirement found (`code: SUCCESS`) | Use **latest** five fields silently; do not diff against chat cache |
| Requirement missing (`404` or explicit not-found) | Report "这条 Requirement 已不存在" / "This Requirement no longer exists"（**跟随会话语言**二选一）; do not generate from stale context |

Use five fields for generation only. Do not track `module_tree_node_id`, `review_status`, or `ticket_id` for A2 logic.

### 3. Incremental gate (§9.3)

Check in this order (**library-empty check first — do not evaluate intent wording before this**):

1. **`testpoints` is empty** → **generate directly**. **Do not** ask, regardless of how vague the phrasing is (e.g. "生成测试点" alone). This is the most common case (first-time generation) and must never fall into step 2.
2. **`testpoints` is non-empty** and intent is vague ("生成测试点" only, no indication of supplement vs. review) → stop and ask:
   - Supplement a few more on top of existing?
   - Show what's already archived first?
3. **`testpoints` is non-empty** and intent is clear ("再补两条并发的" / "看看已有的") → proceed directly.

### 4. Read coverage dimensions (required)

Before enumerating axes, **read the file** (do not rely on memory or hardcoded axes in this skill):

`references/coverage-dimensions.md` (in this skill's directory)

### 5. Generate test points (no write)

**Axis traversal (fixed order — A/B 与 C/D 三态纪律不同，见下)**:

**六槎位记录**（对象／操作／关系／约束／变化／不变量）: 对象（涉及哪些实体）／操作（本次改动的动作是什么）／关系（是否有量与量、状态与状态之间的比较或关联）／约束（限制、上限、权限等条件）／变化（相对旧版本改了什么）／不变量（需求要求保持不变/不受影响的部分）。六项逐一过一遍：本次需求命中哪几项就记一行（`因素：xxx`），命中不到的直接跳过，不强填、不编造。这一行记录留在内部工作稿，不作为正式字段呈现给 SQA。

**Model Self-check**：记完六槎位后，回头把五字段（尤其 `function_description` 与 `out_of_scope`/约束）完整重读一遍：原文里提到的、命中六槎位范畴的表述，是否都已经有对应记录？漏记的补一行。只做一轮，不循环。

**行为分区展开（P1）**：对上面记录的**每一条**因素，继续问一句——**这个因素上有哪些值 / 状态 / 条件 / 来源 / 适用层级，是需要分别覆盖的？**逐个记为一个分区（`因素：xxx → 分区：a / b / c`）。分区的作用是**划出覆盖空间**，不决定生成几条测试点。**分区之间行为是否相同，不在这一步判断**——行为相同的分区**照样各记一个**，它们会在下游按 verification goal 合并进同一条标题（**granularity rules** §2），但**分区本身不得在这一步被合并掉**。一条因素若确实只有一个分区，记一个，不强凑。**只展开一层，不对分区递归展开。**留在内部工作稿，与六槎位记录同级，不作为正式字段呈现给 SQA。仍受**红线 0**：分区只描述方向性差异，不据此编造具体数值、阈值、文案、错误码。

After reading `references/coverage-dimensions.md`, walk **variation axes** in **A → B → C → D** group order (within each group, top-to-bottom as listed). Do not jump randomly between groups.

For each axis, judge三态: **覆盖** / **不适用（具名跳过）** / **拿不准（进存疑清单）**. Path types (`正向` / `异常` / `逆向` / `边界`) **label only** — not axes for cross-multiply.

判断某轴是否适用时，依据**功能本身的形态**（是否有写入、是否多角色、是否改动存量、是否关键链路等），而不是依据需求原文是否出现该轴对应的关键词。需求未提及但功能形态符合适用条件的，仍按现有三态处理（A/B 明确不适用具名跳过、拿不准存疑；C/D 默认存疑兜底）。

**行为分区补充展开（P2）**：判某轴**适用**时，同时读该轴在 `coverage-dimensions.md` 的**「生成时的展开追问」列**，命中的方向**并入 P1 的分区清单**（**不逐项打钩、不做覆盖矩阵**，命中不到的静默跳过）。**P2 只往 P1 清单里补，不另起一份、不改写 P1 的骨架。**

- **A/B 组变化轴**（`输入类型` / `交互反馈` / `状态迁移` / `角色权限` / `来源入口`）：维持原三态 — 判「不适用」前，先反问一句「这是这个功能形态本身不涉及，还是我没想清楚它可能怎么涉及」；确认属前者 → **具名跳过**（写出一句 `〔X 轴〕判不适用（原因：…）`，与六槎位记录同级，**不进存疑清单、不呈现给 SQA**）；反问后仍不确定，或发现其实说不清「为什么不涉及」→ 不再允许跳过，转**拿不准 → 存疑清单**。
- **C/D 组技术轴**（`幂等` / `并发` / `一致性` / `存量兼容` / `环境兼容` / `性能` / `安全审计` / `可观测`）：**默认存疑兜底** — 仅当五字段能**正面证明**该轴不适用（对照 `coverage-dimensions.md` §二.1 形态门槛表）→ **静默跳过**；否则即便倾向判「不适用」，也须在存疑清单留一行：`〔X 轴〕判为本次不测（原因：…）/ 是否需覆盖，请确认`（仍受红线 0：方向性表述，不编造具体次数/文案/阈值/错误码，不因此生成测点）。多根 C/D 轴指向同一缺口时，按 step 6 结构型存疑合并规则并成一行。

上述记录、核对与判断，仍受**红线 0** 约束——六槎位只记录方向性因素，不据此编造具体数值、文案、阈值、错误码或实现方式；这些因素最终能否落地成测试点，仍由现状 closure 与红线 0 决定。

**Generate → prune → dedup → closure checks**:

1. 从 **P1/P2 展开的因素及其分区**中**归纳出** **representative** verification goals（**不是**分区之间做叉乘/笛卡尔积——分区是用来逐个确认有没有被覆盖到的，不是用来相乘的）。五字段仍是分区的来源，但不再是生成的直接入口。Count is **coverage-driven** — no fixed min/max. When cross-multiplying enum/boundary values, follow **granularity rules** §2 (one row per verification goal, all values in title). When the five fields omit a case but `coverage-dimensions.md` judges a **基本盘** path type applicable (`正向` / `异常` / `边界` per section 3) and the title needs only **directional** assertions (**红线 0** below), add a representative row during cross-multiply (e.g. credential login → wrong credentials `异常`) — do not wait for closure to flag zero coverage. 前者管分区来源，后者管基本盘四轴零覆盖兜底，**互不替代**：基本盘兜底仍在五字段之外独立生效，不因生成入口换成分区而失效。
2. **分区归属检查（Partition Accountability）**：P1/P2 展开出的**每一条分区**，在上一步归纳完 verification goals 后，必须能归入以下三类之一，**不允许"既不在标题、也不在存疑"地静默消失**：
   - **①已体现**：分区对应的方向已被某条 draft row 的标题覆盖（含合并进其他分区、由 granularity §2 收敛的情况）；
   - **②转存疑**：分区方向明确，但因红线 0（需编造具体数值/文案/阈值/错误码）或存在"多种合理实现方式"而无法直接生成 → 转一条存疑；
   - **③归纳不出可执行断言，仍不得丢弃**：分区本身一时构不成"操作 + 预期方向"的完整验证目标（如状态类分区缺少明确触发条件）→ 同样转存疑，格式沿用存疑清单纪律：`〔来自因素 X 的分区 Y〕未能归纳出测试点，是否需要补充/确认`。
   - 逐条过一遍 P1/P2 清单即可，**不是覆盖矩阵、不逐项打钩汇报给 SQA**（内部检查，与六槎位/P1 同级，不作为正式字段呈现）。**默认动作从"归纳不出就放弃"改为"归纳不出就转存疑"**。
   - 本条**不改变** A/B/C/D 轴「笃定不适用」的静默判断——那是"轴不适用"，与本条要堵的"分区被识别却消失"是两回事；已判定不适用的轴不会产生分区，无需本条介入。
3. Prune axes contradicted by `out_of_scope`.
4. **Batch-internal dedup** (verification goal — §2.2): merge per **granularity rules** §2；被合并行携带的**分区信息并入保留行的标题**，不随合并丢弃（granularity §2 Merge ≠ omit partitions）; run on **all draft rows without `id`**, after generate/supplement, **before** closure checks and §6 self-critique. **Never** compare drafts to archived rows by semantics (cross-batch = id only, §10).
5. **Coverage closure** (scoped — **not** a per-axis status report for the full checklist). All generated titles obey **红线 0** first:
   - **(a) 基本盘四轴** — `正向` / `输入类型` / `边界` / `异常`: judged **适用** and **no draft row covers it** (standalone row **or** verification goal already covered per step 4):
     1. **对照 `coverage-dimensions.md` 第三节适用判断 + 展开追问** — if a **标配方向** (no implementation ambiguity), title needs only directional assertions (红线 0) → **generate 1 representative row**; do not 存疑 solely because the requirement did not spell out the case.
     2. **Multiple reasonable implementations** (e.g. menu hidden vs click error) → **存疑**; do not generate guessing which.
     3. Assertion **requires specific numbers / copy / thresholds / error codes** not in the five fields → **do not generate** that part (红线 0); 存疑 or generate only the directional segment.
   - **(b) 需求明写的技术轴** — rules / constraints / limits in the five fields that map to a variation axis (e.g. "立即刷新" → `一致性`; "不可重复提交 / 只扣一次" → `幂等`; "仅某类型可用" → `角色权限`). Same (a) logic when **zero coverage**: unambiguous directional row → generate 1; implementation ambiguity or invented specifics → 存疑. **(a)(b) = axis-level, zero coverage only.**
   - **(c) 同轴关键取值收口（取值级，仅已适用轴）** — run after (a)(b); prevents treating "one value on this axis" as "axis closed":
     - **Purpose**: for each **already applicable** variation axis, check whether **stretch / non-baseline key values** on that same axis are missing — not whether the axis was touched at all.
     - **「已适用」** (must meet **at least one**; do not infer applicability after the fact):
       1. This batch already has a draft row whose primary tag is that axis; or
       2. Generation judged the axis **覆盖** or **拿不准** (A/B 轴的拿不准；**C/D 轴「判为本次不测」类存疑不算已适用**); or
       3. (a)/(b) already maps a rule to that axis (including 基本盘四轴 judged applicable).
     - **基本盘标配首条取值不归 (c)** — first baseline on `异常` / `边界` (wrong credentials, empty required field, boundary card from five fields) is handled in step 1 / (a); **do not** 存疑 those as "B/C 未覆盖".
     - **Check**: for each applicable axis, compare draft coverage against that axis's **展开追问（取值提示）** column in `coverage-dimensions.md`. If a **明显常见** **stretch** key value **directly relevant to this requirement's shape** is not covered (no standalone row **and** verification goal not already covered per step 4) → one 存疑 line: `〔X 轴已测 A，B/C 未覆盖〕` + suggest补测试点或请确认. 已展开为分区的并入标题；需编造具体值的进存疑。
     - **明显常见**: anchor on 展开追问 only — no ad-hoc enumeration. Must be **directly relevant** to this requirement's inputs / constraints / states / technical shape. E.g. requirement mentions popup blocking and a row covers it → weak-net / disconnect / timeout on the same axis may enter 存疑; if the requirement does not involve multi-client, do **not** auto-raise old-app / resolution sub-items just because another value on the axis was tested.
     - **Bounds**: applies only to axes already judged applicable — **A/B 笃定不适用 axes stay silent**; **C/D 八轴未正面证明不适用者已在遍历阶段进存疑，不得用 (c) 再拖入**。Do not use (c) to drag in C/D axes on features where they were only scope-confirmed as out-of-test. Value-level, **not** a per-value checkbox matrix. **Stretch** missing values：**已在 P1/P2 展开为分区的**，按 granularity §2 合并进已有标题；**确需编造具体值才能断言的**，才进存疑。Merge with structural 存疑 (step 6) when the same gap would appear twice.
     - **Example** (illustration only — not limited to `环境兼容`): `环境兼容` row covers popup blocking but not disconnect / timeout → 存疑 to补 or confirm scope.
   - **All other axes**:
     - **A/B 组**：笃定不适用仍具名跳过（判断前须先写原因，不进存疑）；既未明写、又未按形态判适用 → 不陈述、不生成、不为轴或取值遗漏进存疑。
     - **C/D 八轴**：已在轴遍历时按 §二.1 处理（正面证明不适用 → 静默；否则默认存疑兜底）。closure 此处不为 C/D 轴重复开缺口。
6. **Structural 存疑 self-check** (结构型 only — **no** lexical keyword triggers):
   - When the five fields state a **rule or type difference** but not its **failure / exception / boundary behavior** (e.g. "AD Video/Story 不提供入口" — menu hidden vs click error?), add 存疑 for SQA to confirm.
   - **Forbidden** as sole triggers: vague wording like `正常` / `正确` / `合理` / `若干` — **触发须结构型，不因措辞模糊而存疑**.
7. **Soft self-check**: too many → case-level detail, **per-value row splits** (fix per granularity rules), or wrong axes? too few → missed applicable axes or obvious key values within (a)(b)(c)?
8. **Truly thin** five fields (nothing to cross-multiply) → stop and ask SQA to enrich; **thin but testable** → generate + put gaps in 存疑清单.

**红线 0 — 防臆造（最高优先级，压过一切「直接生成」与 closure 补行）**:

- Test-point titles may assert only **directional** outcomes unless the five fields already supply the value: `应成功` / `应失败` / `应拦截` / `应有明确提示` (`明确提示` = feedback type, not a literal sentence).
- **Forbidden** in titles without five-field source: specific copy, error codes, lockout counts, timeout seconds, invented thresholds.
- Before writing: would this assertion need a **number / literal message / threshold / error code**? If yes and not in the five fields → **do not generate** that part; 存疑 instead. **Prefer fewer rows over invented specifics.**
- Five-field numbers (e.g. 125-char limit, Free plan 50 cap) are **not** fabrication — use them.
- **「宁可少生成」** means fewer invented details — **not** skipping directional rows **or dropping behaviorally distinct partitions** when `coverage-dimensions.md` section 3 applies.

**存疑清单纪律** (§5 — applies to step 2 partition accountability, step 5 closure, and §7 presentation):

- Format: 〔指向哪〕+〔为什么疑〕+〔建议动作〕.
- **Forbidden sole triggers**: `素材未提及` / `需补充` (A1 requirement-gap phrasing — A2 covers gaps with test-point rows or scope/ambiguity 存疑, not A1 copy).
- **Unsure unique vs ambiguous** (implementation style, stretch scope) → lean **存疑**; do not skip B-class confirmation to seem helpful. **Unsure whether `异常` baseline applies** (e.g. wrong credentials on credential login) → follow checklist section 3 + step 1 / (a), not 存疑.
- **方向唯一、只是「要不要测」未定**（功能形态上适用某轴/某分区，但五字段既未确认也未排除，且不涉及「往哪个方向写」的歧义）→ **生成 1 条方向性代表行**（红线 0 约束不变，不含任何具体值/文案/阈值/错误码），标题末尾加 `（范围待确认）`；**不转存疑**。**与「多种合理实现方式」严格区分**：后者是「往哪个方向写都可能猜错」（如菜单隐藏 vs 点击报错，两种实现都合理）→ 仍然存疑；前者是「方向没有歧义，只是没人拍板测不测」（如功能形态判该测某个角色权限差异，但五字段没提也没排除）→ 转生成。判断不清归为「多种实现方式」时优先存疑，不得为了少写存疑而滥用本条。
- When unsure whether to generate a **directional** baseline row vs 存疑 → **红线 0** first: if specifics would be invented, stop that part; if only directional, generate.

**Title rules & granularity (§4.1 — outline layer, not executable cases)**:

Test points are **coverage outlines (验证目标)**. Executable scripts (precondition + steps + per-value expected data) belong in **A3**.

**责任边界**：A2 负责**发现测试空间**并按 verification goal 收敛成行，**且在标题中保留该 goal 下的关键分区**；A3 负责把 **A2 已表达的**空间展开成前置条件/数据/步骤/Expected，**不承担重新发现 A2 未表达测试空间的责任**。

**Granularity rules**:

1. **One row = one verification goal (测什么)** — no operation steps, no per-value row explosion at A2. Steps and data-driven per-value cases → A3.
2. **Merge decision** (same verification goal only — also governs §5 step 4 batch-internal dedup):
   - **Merge** when: **same operation** + **same expectation direction** + **no extra precondition** (e.g. plan/permission) — **one row**, **list all values in the title** (e.g. `各挡位 5s/10s/15s`). **Do not** split into one row per value.
   - Same **what we verify** with different data states, **data values only**, or wording → one row.
   - (①) Same goal, different precondition data → one row.
   - (②) "混合时/同时存在/共存" wrapper when core assertion matches an existing row → merge.
   - (③) **Same operation, only test data values differ** (e.g. Duration 5s/10s/15s) → **one row listing all values** in the title; drop per-value duplicate rows.
   - **Do not merge** when: operation differs, expectation direction differs, or a value triggers **extra precondition** (e.g. `4K` needs paid plan vs normal resolution) → **separate rows** or 存疑.
   - **Merge ≠ omit partitions** — 合并多个分区到一行时，该行标题必须**显式提及被合并的分区**（取值、状态、位置、条件、来源、适用范围等，**形态由分区本身决定，不限于枚举取值**），不得只写最抽象的那一层表述。默认值尤其不可省略（aligns with review-checklist A#2, closure (c)）。这份**分区清单**是 **A3 的展开依据**——**A3 只负责把 A2 已表达的测试空间展开成可执行用例，不承担重新发现 A2 未表达测试空间的责任。**
   - **列分区 ≠ 写步骤**：✅ `删除展示顺序中的首张 / 中间 / 末张图片后，其余有效连接的相对展示顺序应保持正确`；❌ 展开成操作序列（→ A3）；❌ 拆成一个分区一行（违反「一行一个验证目标」）。
3. **Overline test** (pull back to goal layer):
   - If a draft has full **executable-case** structure (precondition + step sequence + per-value expected data) → **overline** — drop steps, keep **what** is verified; merge same-goal value splits per rule 2.
   - **Listing all values in one row ≠ listing operation steps per value.** ✅ `选择各 Duration 挡位（5s/10s/15s，含默认）后，导出视频时长应与所选挡位一致` — value inventory in one verification-goal sentence. ❌ `选 5s → 导出 → 验 5s；选 10s → 导出 → 验 10s…` — that packs multiple case scripts into one row; still overline. Splitting into three one-value rows is also wrong — merge values, not steps.

**Relationships (do not conflict)**:

- **Batch-internal dedup (step 4)**: apply granularity §2; different goals (e.g. `正常保存` vs `越权拦截`) → separate rows.
- **Enum completeness** (review-checklist A#2): merge requires **full value / partition list in the title**（分区形态不限于枚举值，见 granularity §2）, not fewer rows with missing values.

**Title shape**:

- Structure: precondition + behavior under test (+ implied expectation). **Obey 红线 0** (above).
- One verification goal per row; outline layer, not step-by-step cases.

Good: `Free plan 已有 50 个 workflow 时再 Duplicate 应提示超过上限且无法复制`

Bad: `测试复制功能` / `打开项目页 → 点更多 → 点 Duplicate` (steps → A3)

Bad (too fine — split): `选择 5s 挡位后视频时长应为 5s` + `选择 10s…` + `选择 15s…` (same goal → one row per rule 2)

Bad (overline — steps packed): `打开视频配置 → 分别选择 5s/10s/15s 导出并逐档检查时长` (executable script → A3)

**Priority rules (每条测试点必填)**:

每条生成的测试点（含 §6 自查补的行）**都要**带一个 `priority`，取值 `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` 之一，**不留空、不设"待定"态**。按路径类型（第三节 `正向`/`异常`/`边界`）+ 是否核心链路 / 资金权限风险判断，拿不准时按下表兜底档：

| 判断依据 | priority |
|---|---|
| 覆盖 `正向` / 基本主路径，或涉及资金/权限/数据丢失风险的点 | `HIGH`（默认档，拿不准时落这里） |
| 覆盖核心链路的 `异常` / `边界` | `MEDIUM` |
| 覆盖非核心、辅助性、UI 细节类的点 | `LOW` |

- **AI 自动推断不产出 `CRITICAL`**——该枚举值保留供 SQA 事后手动指定，生成/自查阶段不主动打这个档。
- 存疑清单条目不是测试点，不需要 `priority`。
- SQA 可像改标题/标签一样，在 §8 修订阶段口头指定或调整某条的 `priority`（含改成 `CRITICAL`）；不新增独立弹框。
- **拼写必须逐字符精确匹配** `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` 这四个字符串之一，不得有多字/少字/变形（如 `MEDIUUM`）；生成后按 §6 自查逐条核对。

### 6. Post-generation self-critique (internal — before first present)

**Skip** when §5 step 8 triggered (**truly thin** five fields — no draft to review). Otherwise, after §5 produces an **internal draft** (test-point rows + 存疑) and **before** any output to SQA:

1. **Read the checklist file** (same as §4 — do not rely on memory):

   `references/review-checklist.md` (in this skill's directory)

2. **Switch perspective** to 「资深测试评审」. Walk **A 层** items **in list order**, **one round only** — no multi-round loop. For each A-layer item, read **only the bold check line**; parenthetical maintainer notes are **not** required reading. **B 层** is capability-boundary awareness only — do **not** read B-layer items line by line.

3. **Compare draft against each A-layer item**. On a hit:
   - **Direction-clear universal baseline** (title needs only directional assertions per **红线 0**) → **add test-point row(s)**; merge into the formal list indistinguishably from §5 rows — **no source marking**; **re-group and re-number** as needed.
   - **Specific value / implementation unclear**, or a **B 层** theme → **add 存疑** (at most one line per B-layer theme); do **not** invent coverage or pretend covered.
   - All supplements obey **红线 0**, no coverage matrix, **不编造具体值**. **A 层模式项**笃定不适用 → silent；**C/D 八轴**按 §5 存疑兜底，自审不得用「笃定不适用」把 C/D 轴静默掉。Self-critique补 rows must obey **granularity rules** §2 and **Priority rules** — every added row needs a `priority`, same as §5 rows.

4. **开放式反查（清单之外，独立一步，仍一轮不循环）**：步骤 2-3 的清单核对完成后，**丢开清单**，把五字段原文和当前草稿表**并排重读一遍**，切到「拿这份表去找茬的评审」立场，只问自己一句：**"如果这份测试点表被拿去让人挑漏洞，最可能被挑出来的是哪个方向？"**——只问这一句、想到即记，**不追加第二轮、不为了凑数而想**。命中的方向按步骤 3 同样规则分流（方向明确→补行；具体值/实现不明→存疑）；命中不到就此停止，不勉强找。**本步骤仍受红线 0**，不改变「一轮不循环」的纪律——它是清单核对之外的**第二个输入源**，不是清单的第二轮。

5. **Hard rules** (non-negotiable):
   - **Internal only, one version to SQA**: 生成初稿 → 自审补漏 → **only then** §7 present. **Forbidden**: show draft first, then a revised version; SQA sees **one** table set.
   - **Same turn, same context**: self-critique immediately follows §5 in **this** conversation — do **not** re-invoke as a separate pass re-feeding requirement + draft.
   - **No report, no checkmarks, no source tags**: do **not** tell SQA which checklist lines were applied; do **not** output per-line ☑/❌; do **not** mark which rows came from self-critique. Checklist is scaffolding, not an output artifact.
   - **Self-critique补 rows** are AI-generated → **`is_edited: false`** at archive (§9); not SQA edits.

6. **Scope**: run **once** before **first present of that round** on every generate/supplement that produced a draft. **Incremental**: self-critique **only this round's M new drafts** (no `id`), not re-audit archived N rows. **Do not** re-run after §8 SQA revision rounds unless SQA explicitly asks to regenerate.

**Division of labor**: `coverage-dimensions.md` = generate-time axes (§4–§5). `review-checklist.md` = post-generate retrospective for gaps generation mechanics miss. Do **not** duplicate axis closure (a)(b)(c) here. §5 step 7 soft self-check (quantity/axes) stays in §5; this step is the fixed漏点 pattern pass.

### 7. Present to SQA

**输出纪律**：呈现时**只给「哪条需求 + 表」**（首批加「草稿」、增量按状态列区分）；**禁止**复述内部过程——不得出现「轴遍历 / 自查 / 覆盖维度清单 / 已按…完成 / 五字段已读取 / 核对完毕」等字样。第一句直接进正题。

**开场**（`〔需求名〕` = `summary` → truncate `function_description` → `requirement_id`，与保存确认等处显示名规则一致）：

- **首批**（库为空，逐字；**跟随会话语言**二选一，不同时输出）：
  > 需求「〔需求名〕」的测试点草稿如下（这条之前还没有测试点）：
  > Draft test points for requirement "〔需求名〕" (no existing test points yet):

- **增量**（库里已有，逐字；**跟随会话语言**二选一，不同时输出）：
  > 需求「〔需求名〕」的测试点如下（已有的标「已存」、本轮新增标「新增」）：
  > Test points for requirement "〔需求名〕" (existing ones marked "Saved," new ones this round marked "New"):

紧接下方分节表；**不要**在开场前另加覆盖面叙述或其它过程说明。

1. **测试点清单 — 按 `group` 分节呈现（硬性要求，每次必做）**

   **禁止**把全部测试点挤进一张无分节的连续表。即使 `group` 字段已在各行有值，也**不得**只靠 `N.M` 序号暗示分组——**必须先打出组标题行，再跟该组的小表**。

   **分节规则**（仅排序与分表呈现；**不改** `group` 取值或分组逻辑）：

   - 按各行已有 `group` 字段归并；空 `group` → 组名显示为 `未分组`，且**永远排在最后一节**。
   - 节序号 N = 第 N 组（从 1 起）；组内行序号 N.M（M 从 1 递增）。

   **每一节固定两块输出**（节与节之间空一行）：

   ```text
   **N. {组名}**

   | 序号 | 标题 | 标签 | 优先级 |
   |------|------|------|--------|
   | N.1 | … | … | … |
   | N.2 | … | … | … |
   ```

   - **组标题格式（硬性）**：单独一行，形如 `**1. 分享创建**`、`**2. 权限与访问控制**`。`{组名}` = 该节 `group` 字段原文（空则用 `未分组`）。**每一组都必须有标题行**——单组时也输出 `**1. …**`，不得省略。
   - **每节一张小表**：表内只放该 `group` 的行；**禁止**跨组合并成一张大表。
   - **每次呈现都要分节**：首次生成、SQA 修订后重展、增量合并展示——规则相同，组标题不可漏。
   - **组内顺序不变**：加 `优先级` 列**不改**组内行序，不按 priority 重排。

   **列定义**：

   - **First batch** (library empty): `序号 | 标题 | 标签 | 优先级` — no status column; no row bolding.
   - **Incremental** (library has archived rows): `序号 | 标题 | 标签 | 优先级 | 状态` — see rules below.
   - **已存行（无 `priority` 字段的老数据）**：`优先级` 列显示 `—`，不臆造、不补算。

2. **存疑清单** after **all** group sections (§5): 〔指向哪〕+〔为什么疑〕+〔建议动作〕; no coverage checkbox matrix. If none: say so explicitly.

3. **尾巴**（草稿表 + 存疑清单之后，逐字；首次呈现与 §8 修订后重展均输出；**不做弹框**；**跟随会话语言**二选一，不同时输出）：
   > 要改就直接说（增删，或改标题/标签/分组）；没问题就说一声「保存到 CawPlan」。
   > Just tell me if you want changes (add/remove, or edit title/tags/group); if it looks good, say "save to CawPlan."

**Do not state draft totals** before save (no `共 N 条草稿`, no N in save prompts). SQA reviews the tables; **the only count SQA sees is in the post-POST success receipt** (§9.5).

**Incremental merged display** (only when library already has test points — N archived + M new drafts):

Per §7 step 1: **one section per `group`** (group title line + small table). Within each group, merge archived + new into **one** table; **continuous numbering** (archived first in API order, new drafts appended). 存疑清单覆盖 **full** N+M set（**不要**另加覆盖面叙述）。Archive only drafts without `id`; edit/delete archived rows → Test Suites UI.

**Distinguish 新增 vs 已存** (two means — status column is required; bold is optional):

1. **Status column** (primary, plain text): `已存` (has `id`, read-only) or `新增` (this round's draft, no `id`). This column alone must make the distinction clear even if other formatting fails.
2. **Bold entire rows** (enhancement): status `新增` → bold all five cells (`**…**`); `已存` rows not bold. May write `🆕 新增` in the status column.

**No count summary after tables** — do **not** write `本轮新增 M 条` / `其余 K 条为已存` / `共 N 条` (agents cannot reliably count rows; see Rules Index · Draft totals). Optional **non-numeric** footer after all group sections（**跟随会话语言**二选一，不同时输出）: `已存的标「已存」（只读，改/删请去 Test Suites 后台）；「新增」为本轮新测试点，确认后只保存新增的。` / `Items marked "Saved" are read-only here (edit/delete via the Test Suites console); items marked "New" are this round's new test points — only the new ones will be saved once confirmed.`

**Rendering discipline**:

- **Group title lines are a hard requirement** — same priority as the incremental status column. Never skip them to save space or because `group` is already on each row internally.
- Bold and emoji in tables are **enhancements only** — some clients may not render `**` or emoji inside tables. **Status column text** (incremental) and **group title lines** must carry meaning without relying on table-only formatting.
- Never rely on bold/emoji alone to tell 新增 from 已存.

### 8. Revise from SQA feedback

Natural language: add / delete drafts / edit title, tags, group / adopt 存疑 items. Ambiguous edits → ask.

**Adopting 存疑 → new test-point rows** counts as a revision round (same as add): re-show full table, recompute 序号.

After **any** revision round → **re-show the full 分节清单** (every group title + per-group table, §7 step 1) with recomputed numbers; refresh 存疑 as needed; **re-output §7 尾巴**. Prompt: review by title content, not old numbers only (§4.4).

**SQA insists on keeping two similar rows** → keep both; do not re-run §2.2 merge on those rows.

**Never auto-save.** "看着不错" ≠ save → ask e.g. `要现在保存，还是再调调？` / `Save now, or keep adjusting?`（**跟随会话语言**二选一） — **no draft count** in this prompt.

**原稿** = first table shown to SQA this working set (**after §6 self-critique** — §5 internal draft does not count). Self-critique补 rows are part of 原稿. Track which draft rows SQA touched for `is_edited` (§9).

### 9. Archive (write — explicit confirm only)

Proceed only when SQA clearly says 保存 / 存 / 入库 / `保存到 CawPlan`.

**Save confirm** (§9.4) before POST — **AskUserQuestion**; **no draft count**. AskUserQuestion 无「框上正文」字段 → **先输出一行路径正文，再弹框**（勿把路径塞进 question）。

`〔需求名〕` = `summary` → truncate `function_description` → `requirement_id`.

#### 首批保存

框上方正文（逐字，填入 `〔需求名〕`；**跟随会话语言**二选一，不同时输出）：

> 将测试点保存到需求「〔需求名〕」下。
> These test points will be saved under requirement "〔需求名〕."

**优先 AskUserQuestion**（**两个选项，每项须带 `label` + `description`**；工具若自动追加 Other 行，**勿在 skill 里定义 Other**；**跟随会话语言**整框二选一，不同时输出）：

| 字段 | 中文值 | English value |
|------|-----|-----|
| `header` | 确认保存 | Confirm Save |
| `question` | 确认保存这批测试点? | Confirm saving this batch of test points? |
| option 1 · `label` | 确认保存 | Confirm save |
| option 1 · `description` | 存到 CawPlan | Save it to CawPlan |
| option 2 · `label` | 先不保存 | Not yet |
| option 2 · `description` | 先留着草稿 | Keep it as a draft for now |

**AskUserQuestion 不可用时** — 纯文字降级（逐字；**跟随会话语言**二选一，不同时输出）：

```text
将测试点保存到需求「〔需求名〕」下。 确认保存这批测试点? 1. 确认保存 2. 先不保存(回序号)
```

```text
These test points will be saved under requirement "〔需求名〕." Confirm saving this batch of test points? 1. Confirm save 2. Not yet (reply with a number)
```

#### 增量保存（库里已有，仅存本轮新增）

框上方正文（逐字，填入 `〔需求名〕`；**跟随会话语言**二选一，不同时输出）：

> 将本轮新测试点保存到需求「〔需求名〕」下（已存的不动）。
> This round's new test points will be saved under requirement "〔需求名〕" (existing ones are untouched).

**优先 AskUserQuestion**（**两个选项，每项须带 `label` + `description`**；工具若自动追加 Other 行，**勿在 skill 里定义 Other**；**跟随会话语言**整框二选一，不同时输出）：

| 字段 | 中文值 | English value |
|------|-----|-----|
| `header` | 确认保存 | Confirm Save |
| `question` | 确认保存本轮新测试点? | Confirm saving this round's new test points? |
| option 1 · `label` | 确认保存 | Confirm save |
| option 1 · `description` | 存到 CawPlan | Save it to CawPlan |
| option 2 · `label` | 先不保存 | Not yet |
| option 2 · `description` | 先留着草稿 | Keep it as a draft for now |

**AskUserQuestion 不可用时** — 纯文字降级（逐字；**跟随会话语言**二选一，不同时输出）：

```text
将本轮新测试点保存到需求「〔需求名〕」下（已存的不动）。 确认保存本轮新测试点? 1. 确认保存 2. 先不保存(回序号)
```

```text
This round's new test points will be saved under requirement "〔需求名〕" (existing ones are untouched). Confirm saving this round's new test points? 1. Confirm save 2. Not yet (reply with a number)
```

**「先不保存」回执**（纯文字，逐字；**跟随会话语言**二选一，不同时输出）：
> 好的，先不保存。测试点草稿还在，你可以继续改；想好了说一声「保存到 CawPlan」。
> Okay, not saving for now. The test point draft is still here — keep editing, and just say "save to CawPlan" when you're ready.

**Before POST**: build `test_points` from the last full table in display order — **one body entry per draft row without `id`**, same order as shown. Do not skip or duplicate rows.

POST **only drafts without `id`**, in display order:

```bash
cawplan qa-insights testpoints archive <product_id> <requirement_id> \
  --body-file <path>   # {"test_points":[{"title":"...","tags":["边界"],"group":"...","priority":"HIGH","is_edited":false}]}
```

**Never pipe this command through `head`/`tail`/other output-truncating filters** (e.g. `... | head -30`) — the full stdout JSON receipt is the only source for the `outcome` branch below and for the archived-count downstream (`Test points added` in QA daily reports). A truncated receipt can't be parsed and silently counts as zero, even when the batch actually landed.

Body per item (skill/agent): **only** `title`, `tags`, `group`, `priority`, `is_edited`. `priority` is required, one of `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` (§5 **Priority rules**) — the command hard-rejects a missing or invalid value. The Skill/agent must not submit `category_code` manually. The CLI injects `is_ai_generated: true` and `category_code` on **each** item before POST — do not put either field in `--body-file`. `category_code` is calculated once, only when the test point is created; later Skill-side changes to `tags` do not trigger recalculation, and the stored `category_code` remains unchanged. The command rejects the batch and sends nothing if an item carries anything else (an `id` here usually means an already-archived row is being re-posted).

**`is_edited`**: `false` if untouched since 原稿 (includes rows added in §6 self-critique — AI-generated, no source tag); `true` if SQA edited or added (including adopting 存疑). Incremental batch: only for **new** M drafts vs their 原稿; archived N rows excluded. The command passes this through verbatim — **it never infers the value**, so getting it right is this skill's job.

Branch on `outcome`:

| `outcome` | Action |
|-----------|--------|
| `SUCCESS` | The command already verified the envelope and that the returned count equals what was sent. Store `api.data.test_points[].id` as session stubs (§10); **do not** list them to SQA → **success receipt (§9.5)** |
| `FAILURE` | Report `error.message` honestly (§9.6). `validation` = the body was built wrong; fix and resend. Do **not** fake success, do **not** blind-retry |
| `UNKNOWN` | The batch may or may not have landed. **Never re-archive on a guess** → §10 |

**Success receipt (§9.5)** — **only place SQA sees a count**. **Two lines** when `url` is present; otherwise line 1 only. Use **`N` = `body.test_points.length`** (or response `test_points.length` on SUCCESS). `〔需求名〕` = `summary` → truncate `function_description` → `requirement_id`.

- **Line 1**（逐字；**跟随会话语言**二选一）：`已保存 N 条测试点到需求「〔需求名〕」下。` / `Saved N test points under requirement "〔需求名〕."`
- **Line 2**（仅当 refresh 返回非空 `url`；**单独一行**，不接到 line 1 句末；逐字；**跟随会话语言**二选一）：`Requirement 链接:{url}` / `Requirement link: {url}`

**If `url` is missing or null** — output line 1 only; say nothing about links — never construct portal URLs, never note that `url` was unavailable.

**Forbidden in success receipt**: per-row tables; title lists; `id` lists; re-generated or summarized titles; any line about missing `url` (e.g. "未返回 url"/"无法附 Requirement 链接"); **apology or post-hoc recount explanations** (e.g. "之前误算成 13 条").

**§9.5 末尾引导（可选追加）** — 满足**全部**条件时，在成功回执**最后**另起一行逐字追加（不弹框、不追问、**仅本轮一次**；**跟随会话语言**二选一，不同时输出）：

> 想继续生成测试用例？说「马上生成测试用例」，我会在当前会话直接生成。
> Want to generate test cases next? Say "generate test cases now" and I'll do it right in this session.

**追加条件**（须同时满足）：

- 本轮测试点归档结果为 `SUCCESS`（含 §10 `count_matched` 确认已落库后下接 §9.5 式回执）
- 会话**无** `resume_intent`（非跨 skill 入站接力后的自动出站回归）
- 非「先不保存」回执路径
- 非保存失败 / UNKNOWN / `pending_write` 未定态

**不追加**：保存失败、结果未定、`先不保存`；出站 `resume_intent = testcase` 自动回流 `cawplan-testcase-generate`（已自动续跑，无需再引导）。SQA 未接茬、去做别的 → **顺其自然，不重复提示**。

**用户接茬**：SQA 说「马上生成测试用例」→ 以会话 `product_id` + `requirement_id` 读 `cawplan-testcase-generate` skill，当前会话 P2 热交接直跑 §2 refresh，**无需**再贴需求或测试点。

On failure → report `error.message` (and `api.code` / `api.msg` when present) honestly (§9.6). Do not fake success or blind-retry.

### 10. UNKNOWN write outcome (§9.4)

Archive returned `outcome: UNKNOWN` → set `write_outcome = UNKNOWN`, then run:

```bash
cawplan qa-insights testpoints reconcile <product_id> <requirement_id> \
  --count-before <§2 刷新时记录的基线> --batch-size <本批条数>
```

`--count-before` is the baseline recorded at the §2 refresh, **before** the archive. The command will not guess it. Read-only — it never writes.

Same rule as §9: **never pipe this command through `head`/`tail`/other output-truncating filters** — the full stdout JSON receipt is what the `reconcile.decision` branch below reads.

| `reconcile.decision` | Action |
|----------------------|--------|
| `count_matched` | The batch already landed. Tell SQA it is saved; clear UNKNOWN; merge stubs on the next refresh. **Do not archive again.** → 下接 **§9.5** 成功回执（含末尾引导，条件同 §9.5） |
| `retry_same_batch` | Nothing landed. Read-back, then archive the **same** batch — not a regenerated one. |
| `count_unexpected` | The count is neither unchanged nor `+batch`. Someone may have appended concurrently, or the data is inconsistent. **Stop and ask SQA to check Test Suites**; archive nothing. |

**Never** re-archive a batch on ambiguity.

### 11. Archived row edits

SQA wants to change/delete a row **with `id`** → direct them to Test Suites UI. A2 only appends; no PATCH/DELETE.

## Session state (in-conversation only)

**① Binding**: `product_id`, `requirement_id`, five-field snapshot, `url`.

**② Work set**: 原稿 snapshot; touched-row marks; current drafts; archived stubs from last refresh.

**③ Write**: `pending_write` after save confirm; `write_outcome` SUCCESS / failure / UNKNOWN.

Refresh binding + stubs before each generate. Rebind clears all. After successful archive, merge new `id`s into stubs; new supplement round gets a **new** 原稿 for the M drafts.

## Walkthrough example (workflow Duplicate — requirement `019fb63e-d5ad-7cb7-8b5f-761ceeb50c0a`)

**五字段（节选）**：workflow 项目 Duplicate；入口为项目卡片更多菜单；正常预期为生成副本、列表可见、新窗口打开；约束含仅 workflow 类型、他人分享不可复制、命名 `Copy of xxx`、125 字符上限、素材一并复制、Free plan 50 个上限等。

**判轴（节选）**：`输入类型`/`交互反馈`（Duplicate 有 UI 提交过程）/`角色权限`（他人分享只读）/`边界`（50 上限、125 字符）→ **覆盖**；`幂等`（Duplicate 有写入）→ **覆盖**；`一致性`（副本列表可见）→ 正向测点 1.1 已体现。**C/D 其余轴**：`并发`（50 上限计数）、`存量兼容`（改动既有 workflow 能力）、`环境兼容`（Web 客户端）等五字段未正面排除 → **进存疑**（合并一行，非静默）；`性能`/`可观测`/`安全审计` 同理，除非 §二.1 形态门槛可正面证明不适用。

**批内去重示例**：已有「Free plan 达 50 个 workflow 时 Duplicate 应提示超限」→ 不再单独生成「第 51 次点击 Duplicate 仍提示超限」（同验证目标，仅状态不同）。

**样例测试点（草稿）**：

**1. 复制与命名**

| 序号 | 标题 | 标签 | 优先级 |
|------|------|------|--------|
| 1.1 | 本人拥有的 workflow 项目点击 Duplicate 后应在列表出现名为「Copy of 原项目名」的副本 | `正向` | `HIGH` |
| 1.2 | Free plan 账号已有 50 个 workflow 时再 Duplicate 应提示超过最大限制且无法复制 | `边界` | `MEDIUM` |
| 1.3 | 连续快速点击 Duplicate 应仅创建一份副本 | `幂等` | `HIGH` |
| 1.4 | Duplicate 进行中应有进行中态，且完成前入口不可重复触发 | `交互反馈` | `LOW` |

**存疑（两条，不同缺口不合并）**：

1. 约束未明确 AD Video / Story 类型是否隐藏 Duplicate 入口——建议在需求 `out_of_scope` 标明，或确认 UI 层入口不可见即可。
2. 〔并发/存量兼容/环境兼容〕Duplicate 涉及创建写入、plan 上限计数与 Web 客户端，判为本次不测（原因：五字段未写明并发/存量/弱网范围）/ 是否需覆盖，请确认。

## Walkthrough example (login — baseline vs 红线 0)

**五字段（节选）**：账号 + 密码登录；入口为登录页；正常预期为登录成功并进入首页；约束未写账户锁定策略。

**生成（草稿）**：

**1. 登录校验**

| 序号 | 标题 | 标签 | 优先级 |
|------|------|------|--------|
| 1.1 | 正确账号和密码登录应成功并进入预期页面 | `正向` | `HIGH` |
| 1.2 | 错误账号或密码登录应失败并给出明确提示 | `异常` | `MEDIUM` |

**存疑（可选一条）**：连续登录失败是否触发账户锁定 — 五字段未写策略，请确认是否在本次范围内。

**不生成**：「第 3 次失败锁定账户」「提示应为『用户名或密码错误』」等需具体次数/文案的测点（红线 0）。

## Walkthrough example (video config — granularity / Duration merge)

**五字段（节选）**：导出前可在视频配置面板设置 Duration 挡位 5s / 10s / 15s（默认 15s）与 Resolution；正常预期为导出视频时长与所选 Duration 一致；约束未写 4K 是否需要付费套餐。

**颗粒度**：Duration 三挡 → 一条列全值、不拆三条、不塞步骤 — 见 §5 **Granularity rules** 与 Good/Bad 示例。若五字段写明「4K 仅付费套餐可用」→ `4K` 与普通分辨率是**不同前置/预期** → 单独成条或进存疑（granularity §2 · do not merge）。

**样例测试点（草稿，节选）**：

**1. 导出与时长**

| 序号 | 标题 | 标签 | 优先级 |
|------|------|------|--------|
| 1.1 | 选择各 Duration 挡位（5s/10s/15s，含默认 15s）后，导出视频时长应与所选挡位一致 | `正向` | `HIGH` |

## Rules Index

Authoritative rules live in **Workflow**; this section is navigation only. On conflict: **红线 0** > closure 补行 > 不编造优先.

| Rule | Authority |
|------|-----------|
| **红线 0** — 防臆造 | §5 **红线 0** + step 5 closure |
| **Granularity** — outline vs A3 | §5 **Title rules & granularity** |
| **Priority** — 每条测试点必填 CRITICAL/HIGH/MEDIUM/LOW | §5 **Priority rules** |
| **存疑清单** — format & discipline | §5 **存疑清单纪律**; presentation → §7 step 3 |
| **Coverage closure** (a)(b)(c) | §5 step 5 |
| **Self-critique** | §6 |
| **Presentation** — 分节、状态列 | §7 |
| **Draft totals** — SQA 只看保存后条数 | §7 · §9.5 · §9 save confirm（禁草稿/保存前计数） |
| **Archive / confirm / receipt** | §9; UNKNOWN → §10 (`testpoints reconcile`, needs `count_before` from §2) |
| **Cross-batch dedup** | §10 (`id` stubs); batch-internal → §5 step 4 + granularity §2 |
| **API** | Writes → `cawplan qa-insights` (§9 archive, §10 reconcile); reads → `cawplan api GET` (§2); `references/CAWPLAN_OPEN_API.md` §15 |
| **Trigger boundary** | §1 决策树 P3 → 框2；兜底 → 框1；ticket URL without test-point intent → not this skill |
| **Failures** | §9 On failure; keep drafts |

## Output & Confirmation

- **Generate / revise (no archive)** → §6 then §7
- **Save confirm + POST** → §9; UNKNOWN reconcile → §10

## References

- `references/CAWPLAN_OPEN_API.md`
- `references/coverage-dimensions.md`
- `references/review-checklist.md`
