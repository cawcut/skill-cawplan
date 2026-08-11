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
| **跨场景 · 上限拦截** | `（惯例推断）超出长度或数量上限的输入应被拦截并给出明确提示` |
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

### 5. Attach the open-questions list

> **存疑清单不落库**：归档 body 只有五字段 + `summary`（+ `ticket_id`），下游 **A2 / A3 看不到存疑清单**。存在性已确定的维度**不得**只写在这里 —— 见 Rules **总则**。

After the five fields and display summary, add an **存疑清单**. Classify each item as exactly one of:

- **需补充** — 维度已在字段中（方向性），**仅缺**产品特有的具体取值（阈值、文案原文、落地 URL、非标规则）。**仅当该取值缺失会让下游无法设计验证时才列**（如上限数值 —— 边界用例需要它）；纯提示文案**不列**，`须有明确提示` 本身已是完整的方向性断言（红线 0）。**Forbidden sole triggers**: `素材未提及`, `未写明`, `未提及`.
- **待确认** — **维度存在性不确定**（判据 1 第二类）或 **weak** inference / screenshot ambiguity（未写入字段者）。**只问维度本身，不预设产品策略 / 具体答案 / 实现方向**（红线 0）；问法**带判断线索**、不带答案。**Forbidden** if the same claim already appears under `（惯例推断）` / `（界面推断）` in the five fields.
  - ✓ `待确认：邮箱在系统中不存在时的提示方式（是否区分「邮箱未注册」与「邮件已发送」，依产品策略）` —— 问到维度即止。
  - ✗ `待确认：应统一提示以防邮箱枚举` —— 替产品预设了安全策略，素材未提。
- **需澄清** — scope or flow ambiguity (multiple reasonable implementations); state your interpretation for SQA to confirm.

**判据 1 — 维度存在性（先判存在性，再判取值）**:

先问：**该维度在同类产品中是否近乎必然存在？**

- **第一类 · 必然（封闭白名单 —— 仅以下九项可据此写进字段）**：
  1. 必填校验（存在必填输入项或表单提交时）
  2. 格式校验（存在有格式约束的字段时）
  3. 确认 / 重复输入的一致性（存在二次输入或确认类字段时，如 Confirm Password）
  4. 长度或数量上限（存在自由输入或可累加数量时；纯枚举选择器不适用）
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

If there are truly no open questions, say **无存疑项** — do not pad the list.

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

Default: deliver five fields + display summary + open-questions list in one turn. **Do not** ask repeated follow-up questions.

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

### 6. Revise from SQA feedback

When SQA requests changes in natural language (e.g. "约束改成只限会员" or "摘要改成会员专属道具图"), apply **all** requested edits in one pass, then **re-show the complete five fields and the current display summary** — not just "done".

Apply **display-summary regeneration rules** (step 4): if only the summary was edited, keep five fields and update summary; if five fields substantively changed, regenerate summary only when the old summary is no longer accurate.

Re-run steps 3–5 after each revision round until SQA is satisfied or moves on to product / module-tree / archive (steps 7+ below).

### 7. Resolve product

Run this after the draft (five fields + display summary) is acceptable and **before** any QA Insights API calls (`.../qa/module-tree`, `.../qa/requirements`). Read-only — no writes. Do **not** call `GET/POST .../qa/...` in this step.

**When ticket material was used** (step 1 already called `tickets search`):

- Read `product_id` from the ticket response.
- Resolve the product **name** for display (from the same response if present, or `cawplan products list --search` with that ID context).
- **Use it directly** — do not ask SQA to pick the product again unless `product_id` is missing.

**When no ticket** (text / screenshots only):

```bash
cawplan products list --search "<product name SQA provides>"
```

- **One match** → use its `unique_id` as `product_id`.
- **Multiple matches** → list `name` + `unique_id` and ask SQA to choose.
- **No match** → ask SQA for a different product name or a ticket link.

Keep the resolved `product_id` (and product name) in context for module-tree and archive steps. All **write** operations (new module node, archive Requirement) must use this same `product_id` — do not substitute a different product unless SQA explicitly requests a change and step 7 is re-run.

### 8. Recommend module-tree node (read-only)

After product is resolved (step 7) and the draft is accepted, fetch the module tree and help SQA pick a node. **GET only** — do **not** `POST` to create nodes in this step (that is step 9).

```bash
cawplan api GET /api/v1/public/openapi/product/<product_id>/qa/module-tree
```

1. Parse `data.nodes` (may be `[]` on a new product).
2. From the five fields, **recommend** one existing node (name + `id`) where this Requirement should live.
3. Ask SQA: "建议挂到【父路径 / 节点名】下，对吗？" SQA may confirm, pick another node by name, or say the node does not exist.
4. If SQA names a node, search the tree by `name` (case-insensitive) and confirm the match.
5. Keep the chosen `module_tree_node_id` in context for archive.

**If no suitable node exists**:

- Tell SQA the node is missing and that **creating it requires a separate confirmation** (step 9).
- **Do not** call `POST .../qa/module-tree` yet.

**If the API fails**: see **Failures** (Rules).

### 9. Create module-tree node (write — confirm first)

Run only when SQA agrees the node is **missing** and wants to create it (after step 8). This **writes** to the database.

**Before POST**, read back once:

> 模块树里没有「【节点名】」，将在【父节点名 / 根节点】下新建，确认？

Wait for SQA confirmation. **Do not POST** without it.

**After confirmation**:

```bash
cawplan qa-insights module-tree node create <product_id> \
  --parent-id <parent node id> --name "<node name>"
```

- `--parent-id`: existing node `id`; **omit** for a new root-level node.
- Read the JSON on stdout and branch on `outcome` (see **Command outcomes**):
  - `SUCCESS` → save `api.data.id` as `module_tree_node_id` for archive.
  - `FAILURE` → report `error.message`; on a depth-limit error do not retry with a deeper path.
  - `UNKNOWN` → the node may or may not exist; **do not re-run the command** (that risks a duplicate node). Ask SQA to check Test Suites.

Use the `product_id` resolved in step 7.

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

When SQA signals archive/submit intent ("可以了", "存吧", "归档", "提交", etc.), **do not write immediately**.

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

If open-questions list still has unresolved **需补充** (product-specific concrete values) or unverified **（惯例推断）** / **（界面推断）** bullets SQA may want to fix first, add a soft note — remind only; do not block.

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

## Output

**After analysis** (steps 1–6, no archive yet):

- Full five-field draft (section headings, fixed order).
- Display summary (展示摘要) after five fields, before open-questions list.
- Open-questions list (三类 or **无存疑项**).
- After SQA edits: full five-field draft + current display summary again, not a one-line acknowledgment.

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
