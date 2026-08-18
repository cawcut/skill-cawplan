### 2. Tag sources internally (not in output)

Track source per fact (user text / ticket / screenshot; multiple screenshots by upload order). **Product info is not a fourth material type** — do not tag facts to it; step 1 Product info does not participate in per-fact source tracking. **Five fields must read as finalized requirements**, not evidence notes: state facts directly and **never** name, cite, or allude to which input they came from — regardless of wording or punctuation. If sources contradict, mention the conflict once in the open-questions list only.

**Numeric cross-source check** (before drafting fields): screenshot tooltips, on-screen error copy, and body/ticket text that carry **numbers or thresholds** (duration, size, count, resolution cap, etc.) are all material. **Product overview numbers are not material** — do not cross-check overview figures against screenshot/ticket/body numbers; authoritative numeric scope remains the three material types only. **Cross-check** them — do not adopt one source and ignore another. If values **conflict**, or **match numerically but likely refer to different scopes** (e.g. per-slot tooltip vs cumulative total; current model pair vs full model set), → **存疑** (step 5 — numeric collision + **数值限制型存疑** ①–④). **Do not** default-ignore cross-app / cross-client numbers — if scope is unclear, **需澄清** with judgment clues (e.g. body says SD2.0=15s but another app reports 2s — is that in scope?). Clues may name tooltip / error copy / body in 存疑 only — **not** in five fields.

### 3. Produce the five-field draft

Present exactly these five fields, in this order, as **section headings** (not a table):

1. **功能描述** (`function_description`) — what the feature is and what problem it solves. No triggers or rules.
2. **操作入口 / 触发条件** (`entry_trigger`) — where the user enters and what triggers it. No post-trigger expectations.
3. **正常预期行为** (`normal_expectation`) — what should happen on the happy path. No errors or constraints.
4. **约束与规则** (`constraints`) — validation and business rules: **material facts** (no source marker) or **惯例推断** (`（惯例推断）` prefix + step 3 fixed phrasing, Rules **红线 0** directional only). No happy-path-only content. Do not invent specific thresholds, copy, or URLs; **material enums explicitly listed in material must be retained per 枚举完整性** (Rules).
5. **不测范围** (`out_of_scope`, may be empty) — what is explicitly out of scope for this round.

**维度 / 取值二分**（贯穿以下全部规则）：**验证维度** = 有没有这条规则、这个分支、这个状态、这类枚举；**具体取值** = 阈值、次数、秒数、文案原文、错误码、URL。**总则**管维度取舍，**红线 0** 管取值表达 —— **缺取值不构成删除维度的理由**。

**Product info 边界**：step 1 载入的 Product info **不得**誊进五字段；不得因产品背景新增 `（惯例推断）` / `（界面推断）` 行；产品 description **不构成** step 5 **判据 1** 白名单扩展依据。

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

**回捞清单**（逐类扫素材，不是扫五字段）：**素材** = 用户文字 / 工单 / 截图三类 only（**不含** step 1 Product info）。素材明写的**枚举项**、**状态**、**角色 / 权限身份**、**限制 / 上限**、**异常分支**。任一项在五字段中找不到对应痕迹 → 补回。

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

Product info（`data.description`）**不得**作为扩白名单依据，**不得**因产品背景新增存疑项。

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
