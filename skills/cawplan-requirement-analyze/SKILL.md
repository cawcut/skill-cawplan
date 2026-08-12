---
version: 0.2.6
name: cawplan-requirement-analyze
description: |
  Analyze SQA requirement inputs into five structured fields plus a display summary, and archive a Requirement to CawPlan QA Insights.
  Use when: the user explicitly asks to analyze requirements, structure requirement fields, produce a five-field draft with display summary and open-questions list, recommend a QA module-tree node, archive a Requirement, or update an existing Requirement in QA Insights — including when they provide a ticket link or ID together with requirement-analysis intent (e.g. "需求分析", "analyze this ticket", screenshots + ticket).
  Do not auto-select when the message is only a bare CawPlan issue URL with no requirement-analysis wording; prefer `cawplan-ticket-context` for coding-session ticket loading.
  NOT for: loading a ticket into the coding session only, writing or editing code, uploading AI daily reports, creating tickets, or generating test points.
argument-hint: "[requirement text, ticket URL/ID (optional), screenshots (optional)]"
allowed-tools: Bash
---

# CawPlan Requirement Analyze

## Bootstrap

```bash
cawplan skill check
```

## Workflow

### 1. Collect requirement material

**入口路由前置检查（先判此项，再收素材）** — SQA 的意图是**延续 / 修改一条已归档的 Requirement**（给出 requirement `id`、portal 链接，或说「接着上次那条改」）？

- **是** → 走 step 10 **Cold handoff** 载入服务端五字段作为草稿基线，**不要从头重分析**。理由：归档比对（`reconcile` strong match 与 `requirements update` 的 snapshot diff）是 **trim 后逐字节精确比对**，从头重分析必然产生措辞漂移，会让 reconcile 误判 `no_match`（重复建单风险）或 PATCH 误报变更键。
- **否**（新需求分析）→ 继续本步收集素材。

**零素材早停（新增）** — 判定本条消息是否带有**任一**素材：用户文字、工单（URL / display ID / unique ID）、截图。

- **全无** → **只**输出下方引导文案，然后 **`stop`**；**禁止**进入 step 2–5（否则会产出全「（素材未提及）」废稿）。
- **有任一** → 继续下方 `Accept any mix of`，不弹窗。

**输出纪律（零素材分支）** — 内部脚手架，**不**呈现给 SQA：

- **只**输出引导文案块本身——**禁止**在其前或其后加任何说明、过渡句或复述判定过程。
- **禁止**出现类似：「根据入口路由检查…」「当前会话没有素材…」「按照流程规则，我需要先请求素材…」「零素材早停」等字样。
- 不要解释你在检查什么、为什么停下；SQA 只看到引导文案，与下方示例一致。

引导文案（**仅此块**逐字输出给用户，保留编号列表格式）：

> 想分析需求？给我下面任一样就能开始：
> 1. 需求文字描述
> 2. 工单链接 / 工单号
> 3. 相关截图 / 设计稿（可多张）
>
> 三样都给最省事。我会先整理成完整需求给你过目。

（结尾不提归档/保存。纯文字，不用 AskUserQuestion。）

**边界**：只贴工单链接 = 有素材，按下方 ticket 解析；裸 issue URL 且无分析意图 → 仍走 Rules **Trigger boundary**（`cawplan-ticket-context`），不走零素材分支。

Accept any mix of:

- **User text** — use as-is.
- **CawPlan ticket** — URL, `PREFIX-123` display ID, or unique ID. Extract display IDs from URLs like `/issue/CAWP-04606` before searching.
- **Screenshots** — multimodal images only; **do not OCR**. 分析截图时除文字外也要留意控件状态与页面当前状态（如按钮置灰/禁用、输入框已填、是否正显示错误/成功态），并区分「当前正处于」和「规则上会出现」；写入五字段时用页面/规则表述，勿写来源词（step 2 No provenance）。**强推断**（UI 强暗示、可与惯例一并写入字段）→ 用 **`（界面推断）`** 写入字段（step 3 固定措辞）；**弱推断**（单帧难区分态与规则）→ **待确认** 存疑，不写进字段。If SQA provides **multiple** screenshots, **include every image** — do not analyze only the first or drop the rest.

Do not process ticket image attachments in A1.

**Ticket lookup** (only when a ticket is provided as material):

```bash
# Single display ID
cawplan tickets search --display_ids CAWP-04606
# Multiple display IDs — comma-separated, no spaces
cawplan tickets search --display_ids CAWP-13477,CAW-04560
```

From each ticket, use **only** `description` and `remarks` (no separate title — rely on these two). Strip HTML tags from `remarks` before analysis. Do **not** use `progress_comment`, comments, or attachments.

### 2. Tag sources internally (not in output)

Track source per fact (user text / ticket / screenshot; multiple screenshots by upload order). **Five fields must read as finalized requirements**, not evidence notes: state facts directly and **never** name, cite, or allude to which input they came from — regardless of wording or punctuation. If sources contradict, mention the conflict once in the open-questions list only.

**Numeric cross-source check** (before drafting fields): screenshot tooltips, on-screen error copy, and body/ticket text that carry **numbers or thresholds** (duration, size, count, resolution cap, etc.) are all material. **Cross-check** them — do not adopt one source and ignore another. If values **conflict**, or **match numerically but likely refer to different scopes** (e.g. per-slot tooltip vs cumulative total; current model pair vs full model set), → **存疑** (step 5 — numeric collision + **数值限制型存疑** ①–④). **Do not** default-ignore cross-app / cross-client numbers — if scope is unclear, **需澄清** with judgment clues (e.g. body says SD2.0=15s but another app reports 2s — is that in scope?). Clues may name tooltip / error copy / body in 存疑 only — **not** in five fields.

### 3. Produce the five-field draft

Present exactly these five fields, in this order, as **section headings** (not a table):

1. **功能描述** (`function_description`) — what the feature is and what problem it solves. No triggers or rules.
2. **操作入口 / 触发条件** (`entry_trigger`) — where the user enters and what triggers it. No post-trigger expectations.
3. **正常预期行为** (`normal_expectation`) — what should happen on the happy path. No errors or constraints.
4. **约束与规则** (`constraints`) — validation and business rules: **material facts** (no source marker) or **惯例推断** (`（惯例推断）` prefix + step 3 fixed phrasing, Rules **红线 0** directional only). No happy-path-only content. Do not invent specific thresholds, copy, or URLs; **material enums explicitly listed in material must be retained per 枚举完整性** (Rules).
5. **不测范围** (`out_of_scope`, may be empty) — what is explicitly out of scope for this round.

**维度 / 取值二分**（贯穿以下全部规则）：**验证维度** = 有没有这条规则、这个分支、这个状态、这类枚举；**具体取值** = 阈值、次数、秒数、文案原文、错误码、URL。**总则**管维度取舍，**红线 0** 管取值表达 —— **缺取值不构成删除维度的理由**。

**Fill rules** (Rules **总则** + **红线 0** + **枚举完整性** + step 5 **判据 1** / **总判据** — replaces any separate "infer / never invent / do not list common" rules):

1. **素材明写** → write into the matching field (no source marker).
2. **行业标配 / UI 强暗示且方向唯一** → write into `constraints` or `normal_expectation` with `（惯例推断）` or `（界面推断）` + **fixed phrasing** (step 3 table below). 「行业标配」的范围**以 step 5 判据 1 白名单为准**，不在会话里临时判定。No specific values **unless** rule 7 applies (material enum with differentiated behavior — keep the enum, not a generic "所选 X").
3. **维度已定、仅缺具体值** → 维度**写进字段**（方向性表述）+ 具体值另列 **需补充**；**禁止**因缺值整条不写（总则）。Never sole trigger `素材未提及` / `未写明`.
4. **维度存在性不确定 / 弱推断 / 范围歧义 / 多种合理实现** → do **not** write into fields; use **待确认** or **需澄清**（存在性判据见 step 5 **判据 1** 第二类）.
5. **Whole field** has no material and no applicable baseline → that field is `（素材未提及）` only; do **not** split into multiple 存疑 lines.
6. **Never** append inline `（素材未提及）…` after known bullets.
7. **枚举完整性（防信息丢失）** — symmetric to **红线 0** (no fabrication):
   - Material **explicit enums** (platform, aspect ratio, resolution, language, status, type, etc.) → **keep** the list or at least its **classification dimension** in the five fields when **different enum items imply different expected behavior that must be verified separately**.
   - **Testability criterion**: if test design would need **separate cases per item or per class**, the enum **must** be retained — do **not** collapse to "须与所选 X 一致" / "与所选 X 一致" when material named the items.
   - **May still abstract** when every item behaves the same and only the value differs with **no differentiated verification** (e.g. interchangeable labels) → "所选 X" is OK.
   - **Form**: prefer **grouped bullets** over line-by-line dumps — e.g. three aspect-ratio classes with **all** platforms in each class in parentheses, plus a **共 N 个** line when SQA needs to verify completeness; list languages **one per line or one bullet with full names** (no abbreviation). Platform / language names stay in **material wording**.
   - **Field placement**: differentiated enum constraints → usually `constraints`; switching behavior tied to happy path → may also appear in `normal_expectation`. **Do not** push retained enums only into 存疑 — they belong in fields.

**Provenance** (step 2): rewrite UI/state as requirement facts — ✗「截图中密码框为空」→ ✓「密码框为空时…」

**Constraints — no inline gaps**: ✗ `…红色提示；（素材未提及）密码错误次数、账户锁定` → ✓ field: `…红色提示` only; 账户锁定属**判据 1 第二类**（存在性依赖产品）→ **待确认**，不进字段、也不用 `需补充` 问具体政策（`需补充` 以「维度已在字段中」为前提）; 「不一致须提示」→ `（惯例推断）` fixed phrasing in field, not 需补充.

**Fixed phrasing for inferred bullets** — use **exact** sentences below (do not synonym-rewrite); extend via walkthrough examples only, no separate checklist file:

| 场景 | 固定措辞 |
|------|----------|
| **跨场景 · 必填拦截** | `（惯例推断）必填项未满足或校验未通过时应拦截提交并给出明确提示` |
| **跨场景 · 删除确认** | `（惯例推断）破坏性或删除操作应经二次确认后方可执行` |
| **跨场景 · 上限拦截** | `（惯例推断）超出长度或数量上限的输入应被拦截并给出明确提示`（**仅**用户可键入的自由输入或可增删的计数项 —— 文件自带属性见 step 5 判据 1 ④） |
| **跨场景 · 格式校验** | `（惯例推断）有格式约束的字段应校验格式，不符时应拦截并给出明确提示（具体规则以产品规范为准）` |
| **跨场景 · 一致性校验** | `（惯例推断）需二次确认的输入应与原输入一致，不一致时应拦截提交并给出明确提示` |
| **跨场景 · 失败反馈** | `（惯例推断）操作失败时应有明确失败反馈` |
| **跨场景 · 成功反馈** | `（惯例推断）操作成功后应有明确成功反馈或进入后续页面（具体页面以产品为准）` |
| **跨场景 · 空态展示** | `（惯例推断）列表或结果为空时应有明确空态展示` |
| **跨场景 · 网络异常** | `（惯例推断）网络异常或超时时应有明确失败反馈，且不应停留在无反馈的中间态` |
| 注册 · 必填 | `（惯例推断）用户名、邮箱、密码、确认密码为必填项` |
| 注册 · 格式校验 | `（惯例推断）须校验用户名、邮箱、密码格式（具体规则以产品规范为准）` |
| 注册 · 确认密码 | `（惯例推断）确认密码应与密码一致，不一致时应拦截提交并给出明确提示` |
| 注册 · 提交门槛 | `（惯例推断）必填项未填或校验未通过时不应完成注册` |
| 注册 · 成功反馈 | `（惯例推断）注册成功后应有明确成功反馈或进入后续页面（具体页面以产品为准）` |
| 界面 · 按钮禁用 | `（界面推断）必填项未填全时提交按钮呈不可用状态` |

Pick rows that apply; do not paste the whole table. Material facts stay **without** markers.

**为什么表内必须照抄原句**（勿误读为「内容准入门槛」）：原因是**执行侧的归档去重** —— `reconcile` strong match 与 `requirements update` 的 snapshot diff 都是 **trim 后逐字节精确比对**，同义改写会让同一条需求在服务端对不上，导致误判 `no_match`（重复建单）或误报变更键。它约束的是**措辞**，从不构成「无措辞可写就别写」的理由（判据 1 白名单九项均已有跨场景措辞）。

**表外句式模板（仅限 `（界面推断）`）**：截图能强暗示的 UI 状态远多于表内那一行，表内无对应行时按此模板自拟：

`（界面推断）<页面/控件状态>时<控件或页面>应<呈不可用状态 / 呈错误态 / 显示提示 / 保持禁用>`

- **仅 `（界面推断）` 可用表外句式**。`（惯例推断）` **一律**取表内行 —— 白名单九项都有措辞，不存在缺口；给非白名单维度自拟惯例措辞进字段 = 绕过判据 1 的封闭白名单，**禁止**。
- 表外句式**不放松判据 1**：UI 强暗示仍须方向唯一（总判据表第 2 行）；弱推断走 `待确认`。
- **同一会话内**同一维度复用**首次**措辞，不要每轮改写。跨会话稳定由 step 1 入口路由的冷交接保证（重分析必然漂移）。

**Display** (`normal_expectation`, `constraints`): **one** point → single line after the heading; **two or more** → `- ` bullets, one point per line — not one long paragraph or semicolon chains.

**Example format** (match this style):

> **功能描述**：道具图生成功能，将用户上传的原图裁剪并输出为固定 1:1 比例的道具图。
>
> **操作入口 / 触发条件**：用户在「道具图」页面上传原图并点击「生成」后触发。
>
> **正常预期行为**：无论原图为何种比例，生成结果均为 1:1 的道具图，且主体内容不被异常裁切。
>
> **约束与规则**：
> - 仅对「道具图」类型生效
> - 输出比例固定 1:1，不受原图比例影响
>
> **不测范围**：（素材未提及）

### 4. Present the display summary

Immediately **after** the five fields and **before** the open-questions list, present **展示摘要** (API field `summary`):

- **Purpose**: one-line label for QA Insights list/cards — **display only**. **Not** one of the five fields. **Not** input for test-point generation (A2).
- **Length**: aim for ≤15 **Chinese characters**; **do not** auto-truncate. If over limit, rewrite shorter or add one line **建议精简** for SQA to shorten.
- **Always generate**: produce a non-empty summary on every analysis. Archive **POST** always includes `summary`; A1 side treats summary as **required** (API allows null, but A1 does not send empty).
- **Regeneration**: regenerate only when five fields **substantively** change and the current summary is no longer accurate, or when SQA explicitly edits the summary (e.g. "摘要改成…"). **Do not** mechanically rewrite the summary every revision round — that causes spurious `summary` in PATCH changed-key lists.

**Example** (follows the five-field example above):

> **展示摘要**：道具图固定 1:1 裁剪输出

If over 15 characters and not yet shortened:

> **展示摘要**：道具图上传后裁剪为固定比例输出  
> （建议精简）

### 4b. 漏测自检（内部执行，不呈现）

五字段与展示摘要成稿后、**向 SQA 呈现之前**跑一轮回捞，只做一件事：**素材里出现过的东西，五字段里有没有留下可验证的痕迹。**

**回捞清单**（逐类扫素材，不是扫五字段）：素材明写的**枚举项**、**状态**、**角色 / 权限身份**、**限制 / 上限**、**异常分支**。任一项在五字段中找不到对应痕迹 → 补回。

**两条硬约束**：

1. **只回捞素材明写的名词性事实。** 能用**素材原意**直述的 → 补进字段，**无来源标记、也无推断标记**（它就是素材事实）。
2. **需要任何推断的，不从本步产出。** 例如素材只提到某状态、没写该状态的处理规则 —— 补「该状态应有对应处理」**已经是推断**，必须退回 step 3 的正常推断路径：先过 **判据 1**，再带 `（惯例推断）` / `（界面推断）` 标记。**本步不得产出无标记的推断行。**

> **勿平移 A2 的措辞**：A2 §6 自审说的 "no source marking" 只针对**来源**标记，因为 A2 的测试点标题**没有推断标记体系**；A1 有，且推断标记是红线 0「SQA 可一眼否决」机制的命根子。两者不可混同。

**输出纪律**：内部脚手架 —— **不**告诉 SQA 做过自检、**不**逐项打钩、**不**标记哪行是回捞补的、**不**先给初稿再给修订版（SQA 只看一版）。

**范围**：每次**首次出稿**跑一轮。step 6 的 SQA 修订轮**不重跑**，除非 SQA 明确要求重新分析。

**数值与上限补充自检**（与回捞并列，仍不呈现）：

3. **判据 1 ④ 误套**：若 `constraints` 含文件时长 / 大小 / 分辨率 / 码率等**文件自带属性**上限，字段中**不得**出现 ④「超出长度或数量上限的**输入**…」惯例推断行 —— 素材写了 → 无标记事实；素材没写 → 退回 step 3，不套 ④。
4. **数值限制型存疑**：`constraints` 触发 step 5 **数值限制型存疑** 时，存疑清单**不得**为「无存疑项」—— ①–④ 逐项扫描，未写死者必须列出。
5. **多来源数值对撞**：素材中截图 tooltip / 报错文案 / 正文均出现过数值时，是否已在存疑中处理不一致或口径差异？漏了 → 补存疑（step 2 **Numeric cross-source check**）。

### 5. Attach the open-questions list

> **存疑清单不落库**：归档 body 只有五字段 + `summary`（+ `ticket_id`），下游 **A2 / A3 看不到存疑清单**。存在性已确定的维度**不得**只写在这里 —— 见 Rules **总则**。

After the five fields and display summary, add an **存疑清单**. Classify each item as exactly one of:

- **需补充** — 维度已在字段中（方向性），**仅缺**产品特有的具体取值（阈值、文案原文、落地 URL、非标规则）。**仅当该取值缺失会让下游无法设计验证时才列**（如上限数值 —— 边界用例需要它）；纯提示文案**不列**，`须有明确提示` 本身已是完整的方向性断言（红线 0）。**Forbidden sole triggers**: `素材未提及`, `未写明`, `未提及`.
- **待确认** — **维度存在性不确定**（判据 1 第二类）或 **weak** inference / screenshot ambiguity（未写入字段者）。**只问维度本身，不预设产品策略 / 具体答案 / 实现方向**（红线 0）；问法**带判断线索**、不带答案。**Forbidden** if the same claim already appears under `（惯例推断）` / `（界面推断）` in the five fields.
  - ✓ `待确认：邮箱在系统中不存在时的提示方式（是否区分「邮箱未注册」与「邮件已发送」，依产品策略）` —— 问到维度即止。
  - ✗ `待确认：应统一提示以防邮箱枚举` —— 替产品预设了安全策略，素材未提。
- **需澄清** — scope or flow ambiguity (multiple reasonable implementations); state your interpretation for SQA to confirm. Also: **numeric interpretation** ambiguities from step 5 **数值限制型存疑** ①–④ (boundary inclusivity, rounding, counting scope, limit-value source).

**数值限制型存疑（强制逐项 — 存疑侧规则，不产生新 `（惯例推断）` 字段行）**:

When **`constraints`** contains **restrictive** measurable limits — e.g. 最大 / 上限 / 不超过 / 至少 / 限制 / 超限 / 不得超过 — involving duration, count, size, length, resolution cap, quantity cap, etc.:

**Trigger scope**: **`constraints` only** — **do not** trigger from `out_of_scope`, `normal_expectation` result descriptions (e.g. 「导出时长与所选挡位一致」), or **enum inventories without a cap** (e.g. 「支持 480P/720P/1080P/4K」with no 「不得超过」 semantics).

**Mandatory scan** — for each of ①–④ below, if material has **not** nailed that item, add **需澄清** or **需补充** (mapping below). **Skip items already explicit in material.** If **all four** are explicit → 无存疑项 is allowed. If **any** item is open → **forbidden** to output **无存疑项**. This checklist overrides the general 「只列关键缺口」relaxation for numeric-limit requirements.

| # | Question (only when not explicit in material) | Typical class |
|---|-----------------------------------------------|---------------|
| ① | 边界含不含等于（≤ 还是 &lt;，恰好等于限制值是否放行） | **需澄清** |
| ② | 取整 / 精度口径（如 14.9s / 15.0s / 15.4s；毫秒还是取整到秒）。**连续量**（时长、大小、比例）优先；**纯整数计数**仅在素材暗示小数/四舍五入时才列 | **需澄清** |
| ③ | 单位与统计口径（单文件上限 vs 同类型累计总时长；是否并存、是否都校验） | **需澄清** |
| ④ | 限制值来源（固定清单 vs 按当前模型 / 节点 / 客户端动态下发） | **需澄清**（多种合理解读）；字段已有方向仅缺完整清单 → **需补充** |

After step 2 **Numeric cross-source check** finds collision or scope mismatch → use this section to expand ①–④; do not duplicate the same gap twice.

**Examples**:
- ✓ **需澄清**：tooltip 写「Max Duration 15s」而正文写 SD2.0 累计 15s —— 15s 是单槽上限、同类型累计上限，还是两者并存且都校验？
- ✓ **需澄清**：正文 SD2.0=15s、SD2.5=30s，另一 app 报错「Video exceeds 2 seconds」—— 2s 是否同属本需求校验口径？限制值是否按模型 / 节点动态下发、SD2.0/2.5 是否为全集？
- ✗ **需澄清**：时长限制怎么算？（无线索，违反「问法带判断线索」）

**多来源数值对撞（存疑归类）**: complements step 2 — when tooltip / error copy / body numbers **conflict** or **likely differ in scope**, → 存疑 (clues allowed in 存疑 only). Then expand per ①–④ above. Cross-app numbers: **do not** silently adopt or ignore.

**判据 1 — 维度存在性（先判存在性，再判取值）**:

先问：**该维度在同类产品中是否近乎必然存在？**

- **第一类 · 必然（封闭白名单 —— 仅以下九项可据此写进字段）**：
  1. 必填校验（存在必填输入项或表单提交时）
  2. 格式校验（存在有格式约束的字段时）
  3. 确认 / 重复输入的一致性（存在二次输入或确认类字段时，如 Confirm Password）
  4. 长度或数量上限（存在**自由输入**或可累加数量时；纯枚举选择器不适用）
     - **自由输入** = user-typable text or numbers in a field.
     - **可累加数量** = user add/remove countable items (e.g. attachment slots, line items).
     - **Not ④**: file-intrinsic attributes — duration, file size, resolution, bitrate, etc. User action may be upload/replace only; the limit is on the **file**, not on typed input.
     - **File-attribute limits**: material states the limit → write as **material fact** (no marker) in `constraints`; material omits the limit → **需补充** only — **never** apply ④ fixed phrasing.
     - ✗ **反例**：上传视频**文件时长**超限 → 套 ④「超出长度或数量上限的**输入**…」（文件属性 ≠ 用户输入；用户仅上传/替换，不键入时长）
     - ✓ **正例**：注册页用户名/密码**键入**长度上限 → ④ 门槛满足 → `（惯例推断）` + 需补充具体数值
     - ✓ **正例**：最多 5 个附件槽位（用户可增删**计数项**）→ ④ 门槛满足（计数项，非单文件属性）
  5. 破坏性或删除操作的二次确认（存在删除或不可逆操作时）
  6. 提交失败须有明确反馈（存在提交或远程操作时）
  7. 操作成功须有明确反馈（存在提交或远程操作时）
  8. 空态展示（存在列表或查询结果时）
  9. 网络异常 / 超时的失败反馈（存在**明显网络依赖**时：远程提交、上传 / 下载、发信、导出等；纯本地 UI 交互不适用）
- **形态门槛 ≠ 论证必然性**：**九项全部带括号门槛**，门槛只用来判断**本功能是否触及该项**；门槛一旦满足，该项即为第一类，**无需再论证其必然性**，收口反问不适用于门槛判断。门槛不满足 → 该项不适用，**静默跳过**（不进字段、也不进存疑）。**不要**为无门槛的项目现场自拟门槛 —— 九项的门槛都写在括号里，照读即可。
- **素材部分承担某项时仍补方向**：素材只覆盖了该项的部分环节（如只写了「提交后返回登录页」、未写另一环节的反馈）→ 未覆盖环节**仍取固定措辞补方向**；**不因**「素材提到过这个维度」就整项跳过（总则：该写的不能漏）。
- **第二类 · 形态依赖具体产品选择（不进字段 → `待确认` / `需澄清`）**：账户锁定、图形 / 短信验证码、审批流、自动保存、双因子验证、软删除回收站、**幂等 / 重复提交**、**越权 / 角色权限**、**多端 / 环境差异**，**以及任何不在第一类白名单内的维度**。
  - **幂等为何是第二类**（勿改回第一类）：要不要测幂等**强依赖「该操作是否有副作用」**，需要一步论证 → 撞收口反问。硬判第一类会对「重复触发无副作用」的操作也写出防重规则，制造噪声。
  - **与第 9 项的分界**：`网络异常 / 超时的失败反馈` 是第一类（有网络请求就必须有失败反馈，无需论证）；`多端 / 环境差异`（多客户端、旧版本、分辨率、弱网覆盖范围）是第二类（依赖产品是否有多端形态）。**同属一个测试轴但结论不同，勿合并。**
  - **第二类的 `待确认` 必须用「带判断线索的问法」**：给出让 SQA 一眼能判的那个依据，但**不给答案**（与红线 0 的存疑禁臆造并行不冲突 —— 禁的是替产品定策略，不是禁止把判断依据说清楚）。
    - ✓ 幂等：`重复提交 / 重复触发是否会产生副作用（如重复发信、重复扣减）？若会，是否需要防重`
    - ✓ 越权：`是否存在多角色或私有数据，需要验证越界访问`
    - ✓ 多端：`是否需覆盖多端 / 多客户端或弱网环境`
    - ✗ `是否需要幂等？`（无线索，SQA 无从下手）　✗ `应做防重以避免重复发信`（预设答案，违反红线 0）
- **收口反问**：**若你需要现场论证某维度「为什么必然存在」，它就不属第一类。** 第一类的「必然」只来自**它在白名单里**，不来自任何现推的理由。
- **默认拒绝**：判不准 → 按第二类处理。新增第一类维度须**改本 skill 的白名单**，不在会话里临时决定。
- **措辞可用性**：白名单九项**全部**有跨场景措辞，一一对应 step 3 固定措辞表 —— ① 必填拦截 ② 格式校验 ③ 一致性校验 ④ 上限拦截 ⑤ 删除确认 ⑥ 失败反馈 ⑦ 成功反馈 ⑧ 空态展示 ⑨ 网络异常。**注册专属行只是同义特化**：注册场景优先取注册行，非注册场景取跨场景行。**不得**因「本功能不是注册」就认为该项无措辞可写而滑去 `待确认`。

判为第一类后，再按 **维度 / 取值二分**（step 3）处理取值：素材有 → 直接写（无标记）；素材没有 → 字段只写方向，取值另列 **需补充**。

截图弱推断（单帧无法区分「当前正处于」与「规则上会出现」）→ 存在性不确定 → **待确认**（step 1）。

**总判据（写进字段 vs 存疑 —— 分工，不是互斥）**:

**同一维度**在字段中只出现一次；**取值缺口**可另在存疑列一条，两处内容**不得重复**（字段写方向，存疑只问值）。此分工与 A2（`cawplan-testpoint-generate`）自查清单 `review-checklist.md` 的 A#6「方向测试点 + 具体值存疑**并存**」一致 —— 勿改回互斥。

| 条件 | 动作 | 禁止 |
|------|------|------|
| 判据 1 第一类 + 方向唯一 + 无产品歧义 | 写字段：`（惯例推断）` + 固定措辞 | 同条再 **待确认** |
| UI/字段强暗示（如 Confirm Password 字段） | 视同上 → 写字段 | 待确认「是否要一致」 |
| 截图弱推断 | **待确认** | 写字段 |
| **维度已定、仅缺具体值** | **字段写方向 + 需补充只问取值** | 整条不写；sole trigger「素材未提及」 |
| **维度存在性依赖产品选择**（判据 1 第二类） | **待确认** | 写字段硬断言其存在 |
| 范围/流程多种合理实现 | **需澄清** | 写字段猜一种 |

只列 **五字段未承担** 且影响测试设计的关键缺口 — not every unmentioned item。「未承担」按**内容**判：维度已写进字段但**具体取值**仍缺，该取值即属未承担，可列 `需补充`（不与字段重复，见总判据）。

If there are truly no open questions, say **无存疑项** — do not pad the list. **Exception**: when step 5 **数值限制型存疑** triggered and any of ①–④ remains open → **无存疑项** is forbidden (see mandatory scan above).

The list is advisory only: **do not** auto-edit the five fields or archive based on it. SQA decides.

**与 A2 分工**：方向性「有没有标配」由 A1 字段（标记推断）承担；A2 不用「素材未提及」存疑重复同一缺口。

**Example**:

> - **需补充**：用户名/邮箱/密码的具体长度与复杂度阈值（若产品有独标，请补充）。
> - **待确认**：Sign Up 呈灰色是否为必填未填全时的禁用态（仅当未写入 `（界面推断）` 字段时）。
> - **需澄清**：是否包含邮箱验证码或邮箱验证流程。
>
> **反例（禁止）**:
> - **需补充**：密码不一致时的提示文案（方向已由 `（惯例推断）` 固定措辞写进字段；纯文案不列存疑）
> - **需补充**：是否存在长度上限（**维度**应写进字段，需补充只问**具体数值**）
> - **待确认**：确认密码是否须一致（页面有 Confirm Password → 写字段）
> - **需补充**：「不测范围」素材未提及（字段 `（素材未提及）` 占位即可）

Default: deliver five fields + display summary + open-questions list + step 5b tail in one turn. **Do not** ask repeated follow-up questions.

Ask inline **only** when a fundamental gap blocks drafting (e.g. "what is this feature for?").

**Walkthrough — registration (CawCut-style; material vs inferred separated)**:

> **约束与规则**：
> - 用户名、邮箱、密码、确认密码为必填项
> - （惯例推断）须校验用户名、邮箱、密码格式（具体规则以产品规范为准）
> - （惯例推断）确认密码应与密码一致，不一致时应拦截提交并给出明确提示
> - （惯例推断）超出长度或数量上限的输入应被拦截并给出明确提示
> - （惯例推断）网络异常或超时时应有明确失败反馈，且不应停留在无反馈的中间态
> - （界面推断）必填项未填全时 Sign Up 按钮呈不可用状态
>
> **正常预期行为**：
> - 校验通过后点击 Sign Up 完成账号创建
> - （惯例推断）注册成功后应有明确成功反馈或进入后续页面（具体页面以产品为准）
>
> **不测范围**：（素材未提及）
>
> **存疑**：
> - **需澄清**：是否包含邮箱验证码或邮箱验证流程？
> - **需补充**：用户名/邮箱/密码的具体长度上限数值（边界用例需要；若 CawCut 有独标请补充）
> - **待确认**：是否存在账户锁定策略（判据 1 第二类 —— 形态依赖产品选择，未写入字段）
>
> **三分示例对照**：长度上限 = 白名单第一类 → **维度进字段 + 数值进需补充**；账户锁定 = 第二类 → **只进待确认、不进字段**；「第 3 次失败锁定」「提示应为 xxx」= 具体取值 → **两处都不出现**（红线 0）。
>
> **形态门槛示例**：注册有远程提交 → 第 9 项（网络异常）门槛满足 → 进字段；注册页无列表 → 第 8 项（空态）门槛不满足 → **静默跳过**，既不进字段也不进存疑。

**Walkthrough — video export config (enum retention; material lists must not collapse)**:

> **约束与规则**：
> - 共支持 11 个发布平台：TikTok、YouTube Shorts、Instagram Reel、Instagram Story、Facebook、Pinterest、Snapchat、YouTube、X、Instagram Post、LinkedIn
> - 画面比例按平台分为三类，切换平台时输出比例应随之变化，须分别覆盖三类比例验证：
>   - 9:16（TikTok、YouTube Shorts、Instagram Reel、Instagram Story、Facebook、Pinterest、Snapchat）
>   - 16:9（YouTube、X）
>   - 1:1（Instagram Post、LinkedIn）
> - 支持分辨率四档：480P、720P、1080P、4K
> - 支持语言九种：英语、西班牙语、法语、德语、意大利语、葡萄牙语、日语、韩语、中文
>
> **正常预期行为**：
> - 用户选择发布平台后，预览/导出画面比例应与该平台所属比例类一致
> - 用户切换平台时，画面比例应随平台所属类别更新（9:16 / 16:9 / 1:1）
>
> **不测范围**：（素材未提及）
>
> **存疑**：（按素材实际情况；若无缺口则 **无存疑项**）
>
> **反例（禁止 — 信息降级）**:
> - ✗ `输出比例须与所选平台一致`（丢失三类比例及平台映射，A2 无法生成分类验证点）
> - ✗ `分辨率须与所选分辨率一致`（丢失 480P/720P/1080P/4K 四档）
> - ✗ `文案/字幕/配音须与所选语言一致`（丢失九种语言清单，A2 无法规划多语言验证）

**Walkthrough — omni to video material duration (numeric limits; no ④ misuse; cross-source collision)**:

> **约束与规则**：
> - Omni to Video 生成前须校验素材时长：Audio 与 Video **分类型**分别累计总时长，不得超过当前所选模型的限制值（素材写明：SD2.0=15s，SD2.5=30s）
> - 超限时须拦截并给出明确提示
>
> **正常预期行为**：
> - 各类型素材累计总时长在限制内时，可正常进入生成流程
>
> **不测范围**：（素材未提及）
>
> **存疑**：
> - **需澄清**：上传槽 tooltip「Max Duration 15s」与正文「SD2.0 累计 15s」—— 15s 是单槽上限、同类型累计上限，还是两者并存且都校验？
> - **需澄清**：正文 SD2.0=15s、SD2.5=30s，另一 app 报错「Video exceeds 2 seconds」—— 2s 是否同属本需求校验口径？限制值是否按模型 / 节点动态下发、SD2.0/2.5 是否为全集？
> - **需澄清**：累计 15s 时，恰好 15.0s（或 14.9s / 15.4s）是否放行？按秒还是毫秒、如何取整？
>
> **反例（禁止）**:
> - ✗ `（惯例推断）超出长度或数量上限的输入应被拦截并给出明确提示`（文件时长是文件属性，非用户键入；④ 门槛不满足 —— 超限规则已由素材事实承担）
> - ✗ **无存疑项**（存在 tooltip / 跨 app 数值与正文口径未闭合，且 ①–④ 有未写死项）
> - ✗ 只采 tooltip 15s、忽略正文累计 15/30 或另一 app 的 2s 报错（违反 step 2 **Numeric cross-source check**）

### 5b. 五字段呈现尾巴（轻量引导）

After the open-questions list (step 5), append **exactly one** lightweight closing line — **first draft** (steps 3–5) and **every revision re-show** (step 6) use the **same** line.

引导文案（**仅此一句**，逐字输出给用户；纯文字，不用 AskUserQuestion）：

> 以上是整理好的需求，你看看内容对不对。没问题就说一声「保存到 CawPlan」。

**输出纪律**：

- **禁止**在同一轮追加：产品名、`product_id`、模块树节点名、`module_tree_node_id`、「建议挂到…」「确认挂载」「确认归档/保存」等保存流程细节。
- Step 6 修订轮：**重出**完整五字段 + 展示摘要 + 存疑清单 + **同一尾巴**；禁止只回「已改」。
- 与 step 4b 一致：不告知做过漏测自检。

### 6. Revise from SQA feedback

When SQA requests changes in natural language (e.g. "约束改成只限会员" or "摘要改成会员专属道具图"), apply **all** requested edits in one pass, then **re-show the complete five fields and the current display summary** — not just "done".

Apply **display-summary regeneration rules** (step 4): if only the summary was edited, keep five fields and update summary; if five fields substantively changed, regenerate summary only when the old summary is no longer accurate.

Re-run steps 3–5 + step 5b tail after each revision round until SQA is satisfied with the **field content** — **do not** enter steps 7+ until save intent is triggered（见 **保存意图闸** below）。

**保存意图闸** — enter steps 7+ **only** when one of these holds:

| Path | Condition |
|------|-----------|
| **口头** | SQA says 「保存到 CawPlan」or synonymous 「存到 CawPlan」「保存需求」 |
| **识别兼容**（recognize, not prompt SQA to say） | `可以了`、`存吧`、`提交`、`归档` |
| **接力入站** | Session has `resume_intent` (`testpoint` \| `testcase`) — Rules **跨 skill 接力**; **not** an A1 verbal trigger |

**Do not** list `马上保存` as an A1 verbal trigger — that is A2/A3 框2 option label; it routes via `resume_intent` relay, not standalone A1 speech.

Until save intent is triggered: **do not** call `products list`, **do not** `GET .../module-tree`, **do not** recommend a mount node.

Display layer: five-field tail and guidance use 「保存到 CawPlan」; recognition layer may accept legacy phrases.

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
     ├─「可以,放这里就行」→ 用推荐节点 → 挂上、继续归档保存
     ├─「看看有哪些节点」→ 树形缩进列表(文字)→ 选中一个 → 用它挂上、继续归档
     └─「新建一个节点」→ 问名字+父节点(文字)→ 确认新建(框)
                                                   ├─「对,新建」→ 写库建节点 →〔回到 ①〕拿新建的那条当推荐,再确认一次
                                                   └─「不对」→ 回上一步重问名字+父节点,不写库
```

关键：**新建只负责「把节点建出来」；建完不自动挂载**，而是回到「选位置」逻辑，以刚建的节点为推荐，再走一遍「放不放这里」。

---

#### ① 选位置（AskUserQuestion 框）

**优先 AskUserQuestion**（**三个选项，仅 `label`，无 `description`**；工具若自动追加 Other 行，**勿在 skill 里定义 Other**）：

| 字段 | 值 |
|------|-----|
| `header` | 选择位置 |
| `question` | 建议放到「{推荐节点全路径}」下,可以吗? |
| option 1 · `label` | 可以,放这里就行 |
| option 2 · `label` | 看看有哪些节点 |
| option 3 · `label` | 新建一个节点 |

**落点**：

- **可以,放这里就行** → 采用推荐节点，`module_tree_node_id` = 该节点 `id`，挂上、继续 step 11 归档保存。
- **看看有哪些节点** → 展示节点树形列表（〔选②〕），SQA 选中一个 → 采用、`module_tree_node_id` 写入上下文、挂上、继续 step 11。
- **新建一个节点** → 进〔选③〕问名字+父节点。

**AskUserQuestion 不可用时** — 纯文字降级（逐字，填入实际全路径）：

```text
建议放到「{推荐节点全路径}」下,可以吗? 1. 可以,放这里就行 2. 看看有哪些节点 3. 新建一个节点(回序号)
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

- **落点**：选中 → 采用该节点，`module_tree_node_id` 写入上下文、挂上、继续 step 11 归档保存。
- SQA 说「新建一个节点」或节点不在列表中 → 进〔选③〕。

---

#### 〔选③〕新建一个节点 · 问名字+父节点（纯文字）

- 引导句（逐字）：`节点名叫什么,挂在哪个父节点下?不确定可先说「看看有哪些节点」。`
- 父节点可以是**顶级**，也可以是**任意现有节点**（层级不限）。
- SQA 不确定父级 → 引导走〔选②〕「看看有哪些节点」浏览后再回来。
- 名字 + 父节点都齐 → 进「确认新建」②。

---

#### ② 确认新建（AskUserQuestion 框 · 写库前确认闸）

**优先 AskUserQuestion**（**两个选项，仅 `label`，无 `description`**）：

| 字段 | 值 |
|------|-----|
| `header` | 确认新建 |
| `question` | 新建后位置是「{父节点全路径} → {新节点名}」,对吗? |
| option 1 · `label` | 对,新建 |
| option 2 · `label` | 不对 |

展示**完整路径**，末端即为要新建的那节；**建议视觉上标出是新增节点**（呈现层用路径箭头与末端名体现，勿改 question 字面）。

**落点**：

- **对,新建** → **写库建节点**（step 9 POST）；建成后 **回到 ① 选位置**，以刚建节点全路径为 `{推荐节点全路径}`，再走一遍「放不放这里」。
- **不对** → 回〔选③〕重问名字+父节点，**不写库**。

**写库约束**：**这是唯一真正写库的一步** — 未经 SQA 明确选「对,新建」，**不许写库、不许自动确认、不许跳过**。

**AskUserQuestion 不可用时** — 纯文字降级（逐字）：

```text
新建后位置是「{全路径}」,对吗? 1. 对,新建 2. 不对(回序号)
```

（`{全路径}` = `{父节点全路径} → {新节点名}`）

---

#### ③ 新建成功后 → 回到「选位置」再确认

- 写库建成后，**不自动挂载**。
- 以**新建的那条节点全路径**为推荐，**再走一遍 ① 选位置**：
  - `question`：`建议放到「{新建节点全路径}」下,可以吗?`
  - 选项同 ①（`可以,放这里就行` / `看看有哪些节点` / `新建一个节点`）。
- 选「可以,放这里就行」→ 采用、`module_tree_node_id` 写入上下文、挂上、继续 step 11 归档保存。SQA 建完仍能核对，甚至再改或再建。

---

**通用约束**（模块选择专用）：

- **框只用于**「选位置」（2–4 个固定动作）和「确认新建」（是/否）。
- **节点列表一律纯文字树形** — 不塞进框。
- **选项不带说明**，靠 `label` + `question` 表意。
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

### 10. Bind requirement context (hot + cold handoff)

Keep in session context after either:

- **Hot handoff** — a successful **POST** create (step 11 below), or a successful **PATCH** update (step 11).
- **Cold handoff** — loading an existing Requirement from CawPlan for continuation.

**Store**:

- `bound_requirement_id` — from `api.data.id` (create/update response), `reconcile.matched_requirement_ids[0]` (10b), or the matched `id` from a cold-handoff GET.
- `five_field_snapshot` — the five saved fields (`function_description`, `entry_trigger`, `normal_expectation`, `constraints`, `out_of_scope`) from that write or list row; **five fields only** (Field comparison) — never include `summary`.
- `summary_snapshot` — the saved `summary` from that write or list row (`null` if server has no value); **separate from** `five_field_snapshot`.
- `ticket_id_snapshot` — the saved `ticket_id` from that write or list row (`null` if none); **separate from** `five_field_snapshot` and `summary_snapshot`. Store the ticket **display_id** (e.g. `CAWP-04606`), not the unique id.
- Also keep `product_id`, product name, `module_tree_node_id`, and module-tree node name when known.

Snapshots = last values written to CawPlan, not unsaved draft.

**Pending write** (when POST/PATCH outcome is unknown):

After SQA confirms a write, if the CLI returns no clear `SUCCESS` or `FAILURE` → set `write_outcome = UNKNOWN` and keep `pending_write` until reconciled or cleared:

- `operation`: `POST` or `PATCH`
- `product_id`, `module_tree_node_id`, `ticket_id` (if any)
- For POST: full intended five fields + `summary`
- For PATCH: `target_requirement_id` + changed keys and values (Field comparison — snapshot diff)
- Do **not** set `bound_requirement_id` or refresh `five_field_snapshot` / `summary_snapshot` / `ticket_id_snapshot` on UNKNOWN.

On **clear API failure** (`FAILURE_*` or HTTP error with body): see **Failures** (Rules); `write_outcome` is not UNKNOWN — SQA may retry after read-back without reconcile-first for duplicate fear (same operation retry).

On **SUCCESS**: bind (step 10 Store), clear `pending_write`, set `write_outcome = SUCCESS`. On **unknown outcome**: set `write_outcome = UNKNOWN`, keep `pending_write`, tell SQA the result is unclear — next step **10b** / **Table A — Reconcile** (step 11); do **not** claim success or immediately POST again.

**Field comparison** — the `qa-insights` commands own this. `requirements reconcile` decides what matches; `requirements update` decides which keys changed. Do not compare fields by hand or hand-compute a PATCH body.

Your part is to feed them the right inputs: the probe / `--desired` come from the current draft, and **`--snapshot` is `five_field_snapshot` + `summary_snapshot` + `ticket_id_snapshot` verbatim** (step 10 **Store**). Put the intended `ticket_id` (display_id, or `null` to unlink) in `--desired` when the link should change; omit `ticket_id` from `--desired` only when you are not touching the link this round (leave-as-is).

**Fixed phrasing**: use the step 3 table sentences for inferred bullets — **no synonym rewrites**. Reworded bullets read as changed text and stop matching an earlier archive.

**Cold handoff** (SQA provides a requirement `id`, portal link, or asks to continue an existing Requirement):

```bash
cawplan api GET /api/v1/public/openapi/product/<product_id>/qa/requirements --query "module_tree_node_id=<node_id>"
```

Filter client-side by `id` when SQA names a specific requirement. Map the row's five fields into the current draft. Set `bound_requirement_id`, `five_field_snapshot` (five fields per Field comparison), `summary_snapshot`, and `ticket_id_snapshot` from that row. If `summary` is `null`, **generate** a display summary for the draft now (step 4); next archive **PATCH** writes `summary`. Clear any `pending_write` / UNKNOWN. Re-show five fields + display summary + open-questions list if SQA wants to edit before the next archive/update.

### 10b. Reconcile (run Table A)

Run when `write_outcome = UNKNOWN`, when SQA asks to archive again after a failed/unclear write, or when about to `POST` while `pending_write` still exists for the same `module_tree_node_id`.

```bash
# POST pending
cawplan qa-insights requirements reconcile <product_id> \
  --module-tree-node-id <node_id> --probe-file <五字段 JSON>

# PATCH pending — add the target and what that PATCH meant to write
cawplan qa-insights requirements reconcile <product_id> \
  --module-tree-node-id <node_id> --probe-file <五字段 JSON> \
  --target-requirement-id <bound_requirement_id> \
  --intended-patch-file <上次 update 返回的 patch_body>
```

Probe = the **five fields** from `pending_write` or the current draft (the command ignores `summary`). `module_tree_node_id` comes from `pending_write` or context.

This command is **read-only** — it never writes. It reports what it found via `reconcile.decision`; act on it per **Table A** (step 11).

While `write_outcome = UNKNOWN`, **never** re-run the write command; **never** use Table B「无变化 → 另建」（that row applies only when `write_outcome = SUCCESS`).

### 11. Archive or update Requirement (write — confirm first)

When SQA signals archive/submit intent ("可以了", "存吧", "归档", "提交", "保存到 CawPlan", "存到 CawPlan", "保存需求", etc.), **do not write immediately**.

**Gate** (judge **Table A before Table B**):

- `write_outcome = UNKNOWN` or `pending_write` → step **10b** / **Table A — Reconcile** first; do **not** POST/PATCH until UNKNOWN is cleared or SQA explicitly wants a **new** Requirement (11a full read-back).
- Otherwise → **Table B — Archive**. SQA explicitly wants a **new** Requirement while already bound → **11a** (full POST read-back).

**Table A — Reconcile** (`write_outcome = UNKNOWN` or `pending_write` exists) — run `requirements reconcile` (step 10b), then act on `reconcile.decision`:

| `reconcile.decision` | Action |
|----------------------|--------|
| `strong_match_single` | Bind `reconcile.matched_requirement_ids[0]`; refresh snapshots from `api`/server; clear `pending_write` and UNKNOWN; **set `just_reconciled = true`**. Tell SQA: 上次归档可能已成功，已绑定 `id`，**无需再建**. **Do not create.** |
| `strong_match_multiple` | **List every id in `reconcile.matched_requirement_ids`; ask SQA which to bind.** Do not pick one yourself; do not create. |
| `patch_already_applied` | Treat PATCH as likely succeeded; refresh snapshots; clear UNKNOWN; **set `just_reconciled = true`**. |
| `patch_still_old` | Read-back → **PATCH retry** via `requirements update` (not create). |
| `no_match` | Read-back → **retry the same write** (`requirements create` with the same body, or `requirements update`; **不是另建第二条**). SQA says it is a **different** requirement → Table B → **11a**. |

**Table B — Archive** (`write_outcome = SUCCESS`, UNKNOWN cleared; diff per **Field comparison** — snapshot diff)

| Condition | Action |
|-----------|--------|
| No `bound_requirement_id` | **11a POST** create (steps 7–9 if not done). |
| Bound + five fields, `summary`, and `ticket_id` all unchanged vs snapshots (`requirements update` returns **`NOOP`**) | Warn: likely duplicate archive. Ask 是否**另建**? Confirm → **11a POST**. **Skip if you just bound via reconcile (10b)** — tell SQA already bound, no second copy.<br><br>Two branches, decided by `just_reconciled`: **(a) `just_reconciled = false`** → warn and **ask**; only after SQA confirms do you go to 11a. `NOOP` states a fact; it is **not** permission to create. **(b) `just_reconciled = true`** → **skip the warning and the question entirely**; tell SQA already bound, no second copy. Asking here would invite a duplicate moments after telling SQA 无需再建. |
| Bound + five fields unchanged, `summary` and/or `ticket_id` changed | **11b PATCH** metadata only (`summary`, `ticket_id`, or both — command emits only changed keys). |
| Bound + five fields changed | **11b PATCH** changed keys vs snapshots (`summary` / `ticket_id` only if they differ from their snapshots). |
| SQA says it is a different requirement | **11a POST** (full read-back for **new**). |
| **CLEAR_FAILURE** (not UNKNOWN) | Report error; read-back → retry **same** operation (no reconcile required). |

#### 11a. Create (POST)

When Table B routes here (no bound, or SQA confirms另建 / different requirement, or retry POST after Table A no-match).

**Read-back** (new):

> 将把以上五字段与展示摘要【`summary` 文案】归档到【Product：X】的【模块树节点：Y】下的**新** Requirement，review 状态 = 待 review。约束/正常预期中含 **（惯例推断）** / **（界面推断）** 项，请核对；不符请先改五字段再确认。确认？

**Read-back** (retry after Table A no-match):

> 上次归档结果不明且服务端未发现相同记录，将**重试创建**同一条 Requirement（**不是另建第二条**）。约束/正常预期中含 **（惯例推断）** / **（界面推断）** 项，请核对。确认？

If open-questions list still has unresolved **需补充** (product-specific concrete values), **需澄清** from **数值限制型存疑** ①–④ (boundary / precision / counting scope / limit-value source), or unverified **（惯例推断）** / **（界面推断）** bullets SQA may want to fix first, add a soft note — e.g. 「存疑清单中仍有未闭合的数值口径项，归档后 A2 可能缺边界/统计口径用例；可先修订五字段或确认后再归档」— remind only; do not block.

Wait for SQA confirmation. **Do not POST** without it.

**After confirmation** — record `pending_write` (operation `POST`, full five fields + `summary`) then call:

```bash
cawplan qa-insights requirements create <product_id> --body-file <path>
```

Body: `module_tree_node_id` + the five fields + non-empty `summary` (+ `ticket_id` when a ticket was used). Write it to a temp file — long JSON is error-prone to inline. See 仓库根 `references/CAWPLAN_OPEN_API.md` §15 — subsection **Create Requirement**.

The command POSTs directly — it does **not** look for duplicates first. Preventing duplicates is this skill's job (step 11 Gate + Table B + 10b reconcile), not the command's.

**After the call**: branch on `outcome` (see **Command outcomes**) and update session state per step 10 (**Pending write**). On `SUCCESS` → **Confirmation**.

#### 11b. Update (PATCH)

When Table B routes here (bound + snapshot diff shows changes).

**PATCH read-back** (must state update, not create):

> 将**更新** Requirement【`bound_requirement_id`】（**不是新建**），变动字段：【列出变动的中文字段名，如「约束与规则」「展示摘要」】。约束/正常预期中含 **（惯例推断）** / **（界面推断）** 项，请核对。确认？

Same soft note as **11a** when unresolved **需补充** / **数值限制型存疑** 需澄清 / unverified inferred bullets remain — remind only; do not block.

Wait for SQA confirmation. **Do not PATCH** without it.

**After confirmation** — record `pending_write` (operation `PATCH`, `target_requirement_id`) then call:

```bash
cawplan qa-insights requirements update <product_id> <bound_requirement_id> \
  --desired '<五字段 + summary + ticket_id 的期望状态 JSON>' \
  --snapshot '<five_field_snapshot + summary_snapshot + ticket_id_snapshot 原样 JSON>'
```

Pass **complete** states, not a hand-computed diff — the command works out which keys changed and PATCHes only those. (`--desired-file` / `--snapshot-file` accept the same content from files when the JSON is long.) Include `ticket_id` in both objects when comparing or changing the ticket link (display_id, or `null` to clear); reconcile strong match still uses **five fields only**.

**`--snapshot` must be the values last written to CawPlan** — i.e. `five_field_snapshot` + `summary_snapshot` + `ticket_id_snapshot` from step 10, verbatim. Not the current draft (that yields `NOOP` and silently drops the edit), and not a fresh `GET` (that re-sends someone else's concurrent edit as if it were yours). Neither mistake raises an error.

Echo the returned `patch_body` keys back to SQA as the changed-field list.

**After the call**: branch on `outcome` (see **Command outcomes**) and update session state per step 10. On `SUCCESS` → **Confirmation**.

## Command outcomes

Every `cawplan qa-insights` command prints one JSON object. **Branch on the `outcome` field — not on the exit code**: `FAILURE` and `UNKNOWN` share exit code 1, and they call for opposite responses.

| `outcome` | Meaning | Action |
|-----------|---------|--------|
| `SUCCESS` | The write landed | Bind / refresh snapshots (step 10 **Store**); clear `pending_write`; → **Confirmation** |
| `NOOP` | **Nothing was sent** — the update had no changed keys | → **Table B** row 2 (both branches — see that row) |
| `RECONCILED` | **Nothing was written** — reconcile found the earlier write had already landed | → **Table A** (`strong_match_single` / `patch_already_applied`) |
| `FAILURE` | Definitively failed; nothing was written | Report `error.message` honestly. Fix and **retry the same operation** — no reconcile needed |
| `UNKNOWN` | **The result is genuinely unknown** — the write may or may not have landed | Set `write_outcome = UNKNOWN`; keep `pending_write`; **never re-run the write**; → step **10b** reconcile. Never report this as success |

`error.type` refines a `FAILURE`: `validation` (bad body — fix it), `not_found` (target gone), `auth` / `feature_disabled` (permissions), `api` (server-side business error).

**Session flag `just_reconciled`** — set to `true` when Table A binds via `strong_match_single` or `patch_already_applied`. **Cleared after the next `requirements create` / `requirements update` call, regardless of what that call returns (`NOOP`, `SUCCESS`, `FAILURE`, or `UNKNOWN`).** It exists solely to pick the branch in **Table B** row 2.

## Write body rules

Field names are **snake_case**. A `create` body carries `module_tree_node_id`, the five fields, a non-empty `summary`, and `ticket_id` only when a ticket was used. A `update` `--desired` / `--snapshot` pair may also carry `ticket_id` (display_id, or `null` to unlink); it is compared like `summary` — **not** part of reconcile strong match.

The command rejects a body containing `product_id`, `review_status`, or `is_edited` and sends nothing — so a `FAILURE` / `validation` here means the body you built was wrong, not that the server refused. (These keys do appear in `GET` responses; that is expected — the restriction is on what you send.)

## Rules

- **总则 — 防漏测（本 skill 最高准则，优先于红线 0）**:
  - 五字段是下游的**根资产**：A2 生成测试点时**只读五字段**；A3 写用例时具体值**只能**来自测试点标题或五字段。**存疑清单不落库**，下游看不到。
  - 本准则管**维度取舍的两个方向**（判据见 step 5 **判据 1**）：
    - **禁止该写的漏写** — 存在性已确定的验证维度，不得因缺具体取值被整条删除，也不得只存在于存疑清单。
    - **约束存在性不确定的别硬写** — 存在性依赖具体产品选择的维度不进字段，走 `待确认` / `需澄清`。
  - **上一条的边界（两方向的分界）**：「不得只存在于存疑清单」**只适用于存在性已确定**的维度。存在性本身不确定的维度**允许**只进存疑 —— 这是 A1 的能力边界，且 SQA 当场即可拍板。宁可漏一条 `待确认`，也不可把不存在的规则写成团队资产。
  - 与 **红线 0** 的分工：本准则管**维度写不写**，红线 0 管**取值怎么写**。两者作用在不同轴上，不冲突。
  - 裁决顺序：**总则 > 红线 0 > 输出简洁**。
- **红线 0 — 防臆造 + 推断可追溯可否决（表达约束；优先级次于总则 — 防漏测）**:
  - Five fields may assert **directional** outcomes unless material supplies the value: `应成功` / `应失败` / `应拦截` / `须有明确提示` / `须二次确认` (`明确提示` = feedback type, not a literal sentence).
  - **Forbidden** in fields without material source: specific copy, error codes, lockout counts, timeout seconds, invented thresholds, concrete URLs.
  - **Material facts** → normal bullets, **no** source marker. **惯例推断** → `（惯例推断）` + step 3 fixed phrasing. **界面推断** → `（界面推断）` + fixed phrasing. **Never** mix inferred and material with the same tone.
  - Before writing: would this need a **number / literal message / threshold / error code / URL**? If yes and not in material → **写方向、不写该具体值**，具体值另列 **需补充**；**维度本身不因此删除**（总则）。**Prefer fewer invented specifics** — not skipping marked baseline rows.
  - **存疑清单同样受禁臆造约束**（不止五字段）：`待确认` / `需澄清` 只陈述**待定的维度或问题本身**，**不得**替产品预设具体策略、具体文案或某一实现方向。问法要**带判断线索**（给出让 SQA 一眼能判的依据），但**不给答案** —— 两者不冲突：禁的是替产品定策略，不是禁止把判断依据说清楚。
  - Archived five fields become team assets and feed A2 — SQA must be able to **spot and veto** inferred lines (archive read-back + markers).
  - **Pair with 枚举完整性** (below): 红线 0 = do not **add** values not in material; 枚举完整性 = do not **drop** material enums that drive differentiated verification.
- **枚举完整性 — 防信息丢失（总则 — 防漏测 的具体化）**:
  - When material **explicitly lists** an enum (platforms, ratios, resolutions, languages, states, types, …), **do not** over-abstract into a single "所选 X" / "与所选 X 一致" line if items or classes need **separate test coverage**.
  - **Retain** the full list **or** a **classification** that preserves every verification-relevant distinction (e.g. three aspect-ratio classes with **all** platforms per class in parentheses, plus **共 N 个** for completeness check — not "11 platforms, ratio follows selection").
  - **Criterion**: would A2 need distinct test points per item or per class? → enum must stay in five fields (usually `constraints` / `normal_expectation`), not only in 存疑.
  - **Still abstract** when all items share identical behavior and no per-item/per-class tests are needed.
  - **Not** a license to dump every table cell into five fields — only enums where **different item → different expected behavior → separate verification**. Language names: list **full names** in material wording, no abbreviation.
  - **Does not change**: step 4 summary (may stay short), step 5 字段 vs 存疑分工, Field comparison / archive dedup.
- **总判据分工（不是互斥）**: step 5 table — **同一维度**只在字段出现一次（带标记），不得再以 `待确认` 重复问同一维度；但**取值缺口**可另列 `需补充`（字段写方向、存疑只问值）。Confirm Password on page → field, not 待确认.
- **A2 boundary**: A1 owns directional rules in five fields; A2 generates test points — do not duplicate baseline gaps as A1-style `需补充：素材未提及`.
- **Trigger boundary**: this skill is for SQA requirement analysis and QA Insights archiving — not for loading a ticket into a coding session. If the user only pasted a CawPlan issue URL with no analysis intent, stop and use `cawplan-ticket-context` instead. Ticket links are **material** here only when the user also wants five-field analysis or archive.
- **Display summary**: see step 4 (展示摘要 / `summary` role). Snapshots: step 10 Store (`summary_snapshot` separate from `five_field_snapshot`).
- **A1 API scope**: writes go through `cawplan qa-insights` (module-tree node create; requirement create / update / reconcile). Reads still use `cawplan api GET` (module tree, requirement list). **No test-point APIs.**
- **Failures**: report `error.message` (and `api.code` / `api.msg` when present) honestly for any command failure; **never claim success when `outcome` is `FAILURE` or `UNKNOWN`**. Keep the draft (five fields + display summary); do not claim saved or updated.
- **五字段尾巴**：出稿与修订重出均只用 step 5b 固定轻量尾巴；产品 / 模块树 / 保存确认仅在保存意图触发后（step 7+）出现。用户可见引导用「保存到 CawPlan」。Step 7 **C** 分支列产品供选 ≠ A2/A3 链接解析缺 `product_id` 时的「do not scan product lists」——后者禁止猜产品；本 skill 保存流程内无 Ticket 时 **必须** 拉列表让 SQA 选。
- **跨 skill 接力（入站 / 出站）**:
  - **入站**（来自「生成测试点」或「生成用例」框，且会话已有五字段草稿）：**跳过 step 1–6**，直接从 step 7（Resolve product）/ 归档闸 step 11 继续；**不得**从头重分析（措辞漂移会破坏 reconcile / snapshot diff）。入站（`resume_intent`）本身即保存意图；**不在入站前**向 SQA 重复五字段尾巴里的保存引导。
  - **入站挂载节点**：若接力已带 `module_tree_node_id`，按方案「已确定挂载节点直接用,不重问」— 跳过 §8 选位置闭环，直接进入 step 11（归档闸照旧）。
  - **入站冷启动**（无五字段草稿）：从 step 1 正常收素材。
  - **出站**：归档或更新 `outcome: SUCCESS` 后，若会话存在 `resume_intent`（`testpoint` | `testcase`），回写 `product_id` + `requirement_id`（= `bound_requirement_id`），**读取并清除** `resume_intent`，回到发起方 skill 从其 **§2 refresh** 续跑；不停在本 skill 等下一条指令。
  - 各归档/更新**确认闸照旧**——接力不绕过确认。

## Output

**After analysis** (steps 1–6, no archive yet):

- Full five-field draft (section headings, fixed order).
- Display summary (展示摘要) after five fields, before open-questions list.
- Open-questions list (三类 or **无存疑项**).
- **固定尾巴**（五字段 + 展示摘要 + 存疑之后，仅此一句，逐字）：
  > 以上是整理好的需求，你看看内容对不对。没问题就说一声「保存到 CawPlan」。
- **禁止**在同一轮追加产品、模块树、节点 id、保存确认问句。
- After SQA edits: full five-field draft + current display summary + open-questions list + **同一尾巴** again, not a one-line acknowledgment.

**After archive** (step 11): see **Confirmation** below.

## Confirmation

After a create or update returns `outcome: SUCCESS`, report **only fields present in `api.data`** — do not invent paths:

- Requirement `id` from `api.data.id` — set `bound_requirement_id` and refresh `five_field_snapshot`, `summary_snapshot`, and `ticket_id_snapshot` (step 10).
- For an **update**, state clearly that the existing Requirement was **updated**, not newly created.
- **`url`**: return `api.data.url` exactly as returned — portal deep link (e.g. `/product/.../qa-insights/test-suites/requirements/{id}`); prepend portal base to open in browser. **Never** construct `url` or pass it to `cawplan api`.
- **展示摘要** (`summary`) from `api.data.summary`, or `-` when it is `null`.
- Product name and `product_id`.
- Module-tree node name and `module_tree_node_id`.
- `review_status` (expected `PENDING`).
- `ticket_id` if linked, or `-` if none.

**After reconcile (10b / Table A) binds an existing row** — no new write:

- State that the prior write outcome was unclear but the server already has a matching Requirement (`requirements reconcile` returned `strong_match_single`).
- Report bound `id`, product, module-tree node, `summary`, and `review_status` from the list row.
- Clear `pending_write` and UNKNOWN.

After a **clear** failed archive or update (`POST` / `PATCH` with API error body), report:

- The error `code` and `msg`.
- That the draft (five fields + display summary) is unchanged and SQA may revise and retry (or reconcile first if outcome was unknown).

## References

- `references/CAWPLAN_OPEN_API.md` — §15 QA Insights APIs (subsections **Create Module Tree Node**, **Create Requirement**, **Update Requirement**, **List Requirements (read — cold-handoff and reconcile)**); §2 Product APIs and §4 Ticket APIs for product resolution and ticket material.
