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

**Fill rules** (Rules **红线 0** + **枚举完整性** + step 5 **总判据** — replaces any separate "infer / never invent / do not list common" rules):

1. **素材明写** → write into the matching field (no source marker).
2. **行业标配 / UI 强暗示且方向唯一** → write into `constraints` or `normal_expectation` with `（惯例推断）` or `（界面推断）` + **fixed phrasing** (step 3 table below). No specific values **unless** rule 7 applies (material enum with differentiated behavior — keep the enum, not a generic "所选 X").
3. **需具体值才能定稿** → do **not** write into fields; use **需补充** (never sole trigger `素材未提及` / `未写明`).
4. **弱推断 / 范围歧义 / 多种合理实现** → do **not** write into fields; use **待确认** or **需澄清**.
5. **Whole field** has no material and no applicable baseline → that field is `（素材未提及）` only; do **not** split into multiple 存疑 lines.
6. **Never** append inline `（素材未提及）…` after known bullets.
7. **枚举完整性（防信息丢失）** — symmetric to **红线 0** (no fabrication):
   - Material **explicit enums** (platform, aspect ratio, resolution, language, status, type, etc.) → **keep** the list or at least its **classification dimension** in the five fields when **different enum items imply different expected behavior that must be verified separately**.
   - **Testability criterion**: if test design would need **separate cases per item or per class**, the enum **must** be retained — do **not** collapse to "须与所选 X 一致" / "与所选 X 一致" when material named the items.
   - **May still abstract** when every item behaves the same and only the value differs with **no differentiated verification** (e.g. interchangeable labels) → "所选 X" is OK.
   - **Form**: prefer **grouped bullets** over line-by-line dumps — e.g. three aspect-ratio classes with **all** platforms in each class in parentheses, plus a **共 N 个** line when SQA needs to verify completeness; list languages **one per line or one bullet with full names** (no abbreviation). Platform / language names stay in **material wording**.
   - **Field placement**: differentiated enum constraints → usually `constraints`; switching behavior tied to happy path → may also appear in `normal_expectation`. **Do not** push retained enums only into 存疑 — they belong in fields.

**Provenance** (step 2): rewrite UI/state as requirement facts — ✗「截图中密码框为空」→ ✓「密码框为空时…」

**Constraints — no inline gaps**: ✗ `…红色提示；（素材未提及）密码错误次数、账户锁定` → ✓ field: `…红色提示` only; lockout **specific policy** → **需补充**; 「不一致须提示」→ `（惯例推断）` fixed phrasing in field, not 需补充.

**Fixed phrasing for inferred bullets** — use **exact** sentences below (do not synonym-rewrite); extend via walkthrough examples only, no separate checklist file:

| 场景 | 固定措辞 |
|------|----------|
| **跨场景 · 必填拦截** | `（惯例推断）必填项未满足或校验未通过时应拦截提交并给出明确提示` |
| **跨场景 · 删除确认** | `（惯例推断）破坏性或删除操作应经二次确认后方可执行` |
| 注册 · 必填 | `（惯例推断）用户名、邮箱、密码、确认密码为必填项` |
| 注册 · 格式校验 | `（惯例推断）须校验用户名、邮箱、密码格式（具体规则以产品规范为准）` |
| 注册 · 确认密码 | `（惯例推断）确认密码应与密码一致，不一致时应拦截提交并给出明确提示` |
| 注册 · 提交门槛 | `（惯例推断）必填项未填或校验未通过时不应完成注册` |
| 注册 · 成功反馈 | `（惯例推断）注册成功后应有明确成功反馈或进入后续页面（具体页面以产品为准）` |
| 界面 · 按钮禁用 | `（界面推断）必填项未填全时提交按钮呈不可用状态` |

Pick rows that apply; do not paste the whole table. Material facts stay **without** markers.

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

### 5. Attach the open-questions list

After the five fields and display summary, add an **存疑清单**. Classify each item as exactly one of:

- **需补充** — missing **product-specific** concrete values (thresholds, literal copy, landing URL, non-standard rules) that cannot be covered by directional field text. **Forbidden sole triggers**: `素材未提及`, `未写明`, `未提及`.
- **待确认** — **weak** inference / screenshot ambiguity only (step 5 **总判据** — not written in fields). **Forbidden** if the same claim already appears under `（惯例推断）` / `（界面推断）` in the five fields.
- **需澄清** — scope or flow ambiguity (multiple reasonable implementations); state your interpretation for SQA to confirm.

**总判据（写进字段 vs 存疑 — 互斥，禁止两头问）**:

| 条件 | 动作 | 禁止 |
|------|------|------|
| 行业标配 + 方向唯一 + 无产品歧义 | 写字段：`（惯例推断）` + 固定措辞 | 同条再 **待确认** |
| UI/字段强暗示（如 Confirm Password 字段） | 视同上 → 写字段 | 待确认「是否要一致」 |
| 截图弱推断 | **待确认** | 写字段 |
| 产品可能非标 / 需具体值定稿 | **需补充**（具体阈值/文案/URL） | sole trigger「素材未提及」 |
| 范围/流程多种合理实现 | **需澄清** | 写字段猜一种 |

只列 **五字段未承担** 且影响测试设计的关键缺口 — not every unmentioned item.

If there are truly no open questions, say **无存疑项** — do not pad the list.

The list is advisory only: **do not** auto-edit the five fields or archive based on it. SQA decides.

**与 A2 分工**：方向性「有没有标配」由 A1 字段（标记推断）承担；A2 不用「素材未提及」存疑重复同一缺口。

**Example**:

> - **需补充**：用户名/邮箱/密码的具体长度与复杂度阈值（若产品有独标，请补充）。
> - **待确认**：Sign Up 呈灰色是否为必填未填全时的禁用态（仅当未写入 `（界面推断）` 字段时）。
> - **需澄清**：是否包含邮箱验证码或邮箱验证流程。
>
> **反例（禁止）**:
> - **需补充**：密码不一致时的提示文案（应 `（惯例推断）` 写字段）
> - **待确认**：确认密码是否须一致（页面有 Confirm Password → 写字段）
> - **需补充**：「不测范围」素材未提及（字段 `（素材未提及）` 占位即可）

Default: deliver five fields + display summary + open-questions list in one turn. **Do not** ask repeated follow-up questions.

Ask inline **only** when a fundamental gap blocks drafting (e.g. "what is this feature for?").

**Walkthrough — registration (CawCut-style; material vs inferred separated)**:

> **约束与规则**：
> - 用户名、邮箱、密码、确认密码为必填项
> - （惯例推断）须校验用户名、邮箱、密码格式（具体规则以产品规范为准）
> - （惯例推断）确认密码应与密码一致，不一致时应拦截提交并给出明确提示
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
> - **需补充**（可选）：用户名/邮箱/密码的具体格式与长度阈值（若 CawCut 有独标）
>
> **不生成进字段也不进存疑**：「第 3 次失败锁定」「提示应为 xxx」（红线 0 — 具体次数/文案）

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

- **红线 0 — 防臆造 + 推断可追溯可否决（最高优先级，压过推断写字段与存疑补全）**:
  - Five fields may assert **directional** outcomes unless material supplies the value: `应成功` / `应失败` / `应拦截` / `须有明确提示` / `须二次确认` (`明确提示` = feedback type, not a literal sentence).
  - **Forbidden** in fields without material source: specific copy, error codes, lockout counts, timeout seconds, invented thresholds, concrete URLs.
  - **Material facts** → normal bullets, **no** source marker. **惯例推断** → `（惯例推断）` + step 3 fixed phrasing. **界面推断** → `（界面推断）` + fixed phrasing. **Never** mix inferred and material with the same tone.
  - Before writing: would this need a **number / literal message / threshold / error code / URL**? If yes and not in material → **do not** write; use **需补充**. **Prefer fewer invented specifics** — not skipping marked baseline rows.
  - Archived five fields become team assets and feed A2 — SQA must be able to **spot and veto** inferred lines (archive read-back + markers).
  - **Pair with 枚举完整性** (below): 红线 0 = do not **add** values not in material; 枚举完整性 = do not **drop** material enums that drive differentiated verification.
- **枚举完整性 — 防信息丢失（与红线 0 对称，同等优先级）**:
  - When material **explicitly lists** an enum (platforms, ratios, resolutions, languages, states, types, …), **do not** over-abstract into a single "所选 X" / "与所选 X 一致" line if items or classes need **separate test coverage**.
  - **Retain** the full list **or** a **classification** that preserves every verification-relevant distinction (e.g. three aspect-ratio classes with **all** platforms per class in parentheses, plus **共 N 个** for completeness check — not "11 platforms, ratio follows selection").
  - **Criterion**: would A2 need distinct test points per item or per class? → enum must stay in five fields (usually `constraints` / `normal_expectation`), not only in 存疑.
  - **Still abstract** when all items share identical behavior and no per-item/per-class tests are needed.
  - **Not** a license to dump every table cell into five fields — only enums where **different item → different expected behavior → separate verification**. Language names: list **full names** in material wording, no abbreviation.
  - **Does not change**: step 4 summary (may stay short), step 5 字段 vs 存疑互斥, Field comparison / archive dedup.
- **总判据互斥**: step 5 table — same inference **either** in fields (marked) **or** in 存疑, never both. Confirm Password on page → field, not 待确认.
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
