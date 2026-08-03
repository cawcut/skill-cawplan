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
- **Screenshots** — multimodal images only; **do not OCR**. 分析截图时除文字外也要留意控件状态与页面当前状态（如按钮置灰/禁用、输入框已填、是否正显示错误/成功态），并区分「当前正处于」和「规则上会出现」；写入五字段时用页面/规则表述，勿写来源词（step 2 No provenance），分不清时写入存疑清单。If SQA provides **multiple** screenshots, **include every image** — do not analyze only the first or drop the rest.

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
4. **约束与规则** (`constraints`) — limits, business rules, boundary values **already in material**. No normal flow; do not list missing or "common but unmentioned" items here.
5. **不测范围** (`out_of_scope`, may be empty) — what is explicitly out of scope for this round.

**Fill rules**: fill when possible; infer reasonably when implied; **never invent** to fill gaps. **Whole field empty** → that field is `（素材未提及）` only (valid — e.g. **不测范围** stays in the field, not moved to 存疑清单). **Partial content** → write only confirmed facts in that field; gaps go to **存疑清单** only — never append inline `（素材未提及）…` after known items. **Provenance** (step 2): rewrite UI/state as requirement facts — ✗「截图中密码框为空」→ ✓「密码框为空时…」

**Constraints — no inline gaps**: ✗ `…红色提示；（素材未提及）密码错误次数、账户锁定` → ✓ field: `…红色提示` only; lockout policy → **需补充** on 存疑清单.

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

- **需补充** — not mentioned in material; SQA must provide info.
- **待确认** — AI inferred; SQA should verify.
- **需澄清** — material is vague; AI states its interpretation for SQA to confirm.

只列影响本需求测试设计的关键缺口，不穷举所有素材未提项。

If there are truly no open questions, say **无存疑项** — do not pad the list.

The list is advisory only: **do not** auto-edit the five fields or archive based on it. SQA decides.

**Example**:

> - **需补充**：「不测范围」素材未提及，请补充本次明确不覆盖的场景。
> - **待确认**：「约束与规则」中"仅对道具图生效"为我根据功能名推断，请确认是否准确。
> - **需澄清**：素材提到"主体不被裁切"，但未说明主体如何识别，我理解为居中主体，是否正确？

Default: deliver five fields + display summary + open-questions list in one turn. **Do not** ask repeated follow-up questions.

Ask inline **only** when a fundamental gap blocks drafting (e.g. "what is this feature for?").

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
cawplan api POST /api/v1/public/openapi/product/<product_id>/qa/module-tree --body '{...}'
```

Body fields: see `references/CAWPLAN_OPEN_API.md` §15 — subsection **Create Module Tree Node**.

- `parent_id`: existing node `id`; use `null` for a new root-level node.
- On `SUCCESS`, save `data.id` as `module_tree_node_id` for archive.
- On `FAILURE_INVALID_INPUT` (depth > 5): report the error; do not retry with a deeper path.
- On any other failure: see **Failures** (Rules).

Use the `product_id` resolved in step 7.

### 10. Bind requirement context (hot + cold handoff)

Keep in session context after either:

- **Hot handoff** — a successful **POST** create (step 11 below), or a successful **PATCH** update (step 11).
- **Cold handoff** — loading an existing Requirement from CawPlan for continuation.

**Store**:

- `bound_requirement_id` — from `data.id` (POST/PATCH response) or matched `id` from list GET.
- `five_field_snapshot` — the five saved fields (`function_description`, `entry_trigger`, `normal_expectation`, `constraints`, `out_of_scope`) from that write or list row; **five fields only** (Field comparison) — never include `summary`.
- `summary_snapshot` — the saved `summary` from that write or list row (`null` if server has no value); **separate from** `five_field_snapshot`.
- Also keep `product_id`, product name, `module_tree_node_id`, and module-tree node name when known.

Snapshots = last values written to CawPlan, not unsaved draft.

**Pending write** (when POST/PATCH outcome is unknown):

After SQA confirms a write, if the CLI returns no clear `SUCCESS` or `FAILURE` → set `write_outcome = UNKNOWN` and keep `pending_write` until reconciled or cleared:

- `operation`: `POST` or `PATCH`
- `product_id`, `module_tree_node_id`, `ticket_id` (if any)
- For POST: full intended five fields + `summary`
- For PATCH: `target_requirement_id` + changed keys and values (Field comparison — snapshot diff)
- Do **not** set `bound_requirement_id` or refresh `five_field_snapshot` / `summary_snapshot` on UNKNOWN.

On **clear API failure** (`FAILURE_*` or HTTP error with body): see **Failures** (Rules); `write_outcome` is not UNKNOWN — SQA may retry after read-back without reconcile-first for duplicate fear (same operation retry).

On **SUCCESS**: bind (step 10 Store), clear `pending_write`, set `write_outcome = SUCCESS`. On **unknown outcome**: set `write_outcome = UNKNOWN`, keep `pending_write`, tell SQA the result is unclear — next step **10b** / **Table A — Reconcile** (step 11); do **not** claim success or immediately POST again.

**Field comparison** (authoritative — reconcile dedup + snapshot diff):

- **Normalize**: trim whitespace; treat `out_of_scope` `null`/empty/`（素材未提及）` as equivalent.
- **Strong match** (reconcile / dedup): all **five fields** equal after normalize. **`summary` does not participate in strong match or dedup** — never include `summary` in reconcile probe or binding match.
- **Snapshot diff** (Table B — Archive / PATCH body): compare five fields vs `five_field_snapshot`; compare `summary` only vs `summary_snapshot` (PATCH keys and duplicate-intent summary arm — not for reconcile binding).

**Cold handoff** (SQA provides a requirement `id`, portal link, or asks to continue an existing Requirement):

```bash
cawplan api GET /api/v1/public/openapi/product/<product_id>/qa/requirements --query "module_tree_node_id=<node_id>"
```

Filter client-side by `id` when SQA names a specific requirement. Map the row's five fields into the current draft. Set `bound_requirement_id`, `five_field_snapshot` (five fields per Field comparison), and `summary_snapshot` from that row. If `summary` is `null`, **generate** a display summary for the draft now (step 4); next archive **PATCH** writes `summary`. Clear any `pending_write` / UNKNOWN. Re-show five fields + display summary + open-questions list if SQA wants to edit before the next archive/update.

### 10b. Reconcile (run Table A)

Run when `write_outcome = UNKNOWN`, when SQA asks to archive again after a failed/unclear write, or when about to `POST` while `pending_write` still exists for the same `module_tree_node_id`.

Use the **same GET** as step 10 cold handoff (`module_tree_node_id` from `pending_write` or context). Probe = **five fields** from `pending_write` or current draft — **`summary` not in probe** (Field comparison — strong match).

Follow **Table A — Reconcile** (step 11). While `write_outcome = UNKNOWN`, **never** auto-POST; **never** use Table B「无变化 → 另建」（that row applies only when `write_outcome = SUCCESS`).

### 11. Archive or update Requirement (write — confirm first)

When SQA signals archive/submit intent ("可以了", "存吧", "归档", "提交", etc.), **do not write immediately**.

**Gate** (judge **Table A before Table B**):

- `write_outcome = UNKNOWN` or `pending_write` → step **10b** / **Table A — Reconcile** first; do **not** POST/PATCH until UNKNOWN is cleared or SQA explicitly wants a **new** Requirement (11a full read-back).
- Otherwise → **Table B — Archive**. SQA explicitly wants a **new** Requirement while already bound → **11a** (full POST read-back).

**Table A — Reconcile** (`write_outcome = UNKNOWN` or `pending_write` exists; strong match per **Field comparison**)

| Server compare result | Action |
|-----------------------|--------|
| **Strong match** (one row, five fields) | Bind `id`; refresh snapshots from server; clear `pending_write` and UNKNOWN. Tell SQA: 上次归档可能已成功，已绑定 `id`，**无需再建**. **Do not POST.** |
| **Multiple strong matches** | List `id`s; ask SQA which to bind. Do not auto-POST. |
| **PATCH pending** — server row for `target_requirement_id` already has intended new values | Treat PATCH as likely succeeded; refresh snapshots; clear UNKNOWN. |
| **PATCH pending** — server row still has old values | Read-back → **PATCH retry** (not POST). |
| **No match** | Read-back → **retry same write** (POST or PATCH; **不是另建第二条**). SQA says it is a **different** requirement → Table B → **11a POST**. |

**Table B — Archive** (`write_outcome = SUCCESS`, UNKNOWN cleared; diff per **Field comparison** — snapshot diff)

| Condition | Action |
|-----------|--------|
| No `bound_requirement_id` | **11a POST** create (steps 7–9 if not done). |
| Bound + five fields and `summary` both unchanged vs snapshots | Warn: likely duplicate archive. Ask 是否**另建**? Confirm → **11a POST**. **Skip if you just bound via reconcile (10b)** — tell SQA already bound, no second copy. |
| Bound + five fields unchanged, `summary` changed | **11b PATCH** `summary` only. |
| Bound + five fields changed | **11b PATCH** changed keys vs snapshots (`summary` only if differs from `summary_snapshot`). |
| SQA says it is a different requirement | **11a POST** (full read-back for **new**). |
| **CLEAR_FAILURE** (not UNKNOWN) | Report error; read-back → retry **same** operation (no reconcile required). |

#### 11a. Create (POST)

When Table B routes here (no bound, or SQA confirms另建 / different requirement, or retry POST after Table A no-match).

**Read-back** (new):

> 将把以上五字段与展示摘要【`summary` 文案】归档到【Product：X】的【模块树节点：Y】下的**新** Requirement，review 状态 = 待 review。确认？

**Read-back** (retry after Table A no-match):

> 上次归档结果不明且服务端未发现相同记录，将**重试创建**同一条 Requirement（**不是另建第二条**）。确认？

If open-questions list still has unresolved **需补充** items, add a soft note — remind only; do not block.

Wait for SQA confirmation. **Do not POST** without it.

**After confirmation** — record `pending_write` (operation `POST`, full five fields + `summary`) then call:

```bash
cawplan api POST /api/v1/public/openapi/product/<product_id>/qa/requirements --body '{...}'
```

Body fields: see `references/CAWPLAN_OPEN_API.md` §15 — subsection **Create Requirement**. Body rules: see **Write body rules** below.

**After the call**: update session state per step 10 (**Pending write**). On SUCCESS → **Confirmation**.

#### 11b. Update (PATCH)

When Table B routes here (bound + snapshot diff shows changes).

**PATCH read-back** (must state update, not create):

> 将**更新** Requirement【`bound_requirement_id`】（**不是新建**），变动字段：【列出变动的中文字段名，如「约束与规则」「展示摘要」】。确认？

Wait for SQA confirmation. **Do not PATCH** without it.

**After confirmation** — record `pending_write` (operation `PATCH`, `target_requirement_id`, changed keys per Field comparison) then call:

```bash
cawplan api PATCH /api/v1/public/openapi/product/<product_id>/qa/requirements/<bound_requirement_id> --body '{...}'
```

Changed fields only — see `references/CAWPLAN_OPEN_API.md` §15 — subsection **Update Requirement**. Body rules: see **Write body rules** below.

**After the call**: update session state per step 10. On SUCCESS → **Confirmation**.

## Write body rules

Applies to Requirement **POST** and **PATCH** (not module-tree POST).

- `product_id` is only in the URL — **never** in the body.
- Do **not** send `review_status` or `is_edited`.
- Field names are **snake_case**.
- **POST**: all five fields + non-empty `summary` + `module_tree_node_id`; omit `ticket_id` or set `null` when no ticket was used.
- **PATCH**: send **only** keys that changed (Field comparison — snapshot diff). Do not include unchanged `summary` just because five fields changed.

## Rules

- **Trigger boundary**: this skill is for SQA requirement analysis and QA Insights archiving — not for loading a ticket into a coding session. If the user only pasted a CawPlan issue URL with no analysis intent, stop and use `cawplan-ticket-context` instead. Ticket links are **material** here only when the user also wants five-field analysis or archive.
- **Display summary**: see step 4 (展示摘要 / `summary` role). Snapshots: step 10 Store (`summary_snapshot` separate from `five_field_snapshot`).
- **A1 API scope**: QA Insights module-tree `GET`/`POST`; Requirement `GET` (list), `POST` (create), `PATCH` (update five fields + `summary`) only — no test-point APIs.
- **Failures**: report `code` / `msg` honestly for any `cawplan` or `cawplan api` error; never claim success when the CLI failed or outcome is unknown. Keep the draft (five fields + display summary); do not claim saved or updated.

## Output

**After analysis** (steps 1–6, no archive yet):

- Full five-field draft (section headings, fixed order).
- Display summary (展示摘要) after five fields, before open-questions list.
- Open-questions list (三类 or **无存疑项**).
- After SQA edits: full five-field draft + current display summary again, not a one-line acknowledgment.

**After archive** (step 11): see **Confirmation** below.

## Confirmation

After a successful **create** (`POST`, `code: SUCCESS`) or **update** (`PATCH`, `code: SUCCESS`), report **only fields returned by the API** — do not invent paths:

- Requirement `id` from `data.id` — set `bound_requirement_id` and refresh `five_field_snapshot` and `summary_snapshot` (step 10).
- For **PATCH**, state clearly that the existing Requirement was **updated**, not newly created.
- **`id` / `url`**: use `data.id` for CLI follow-up. Return `data.url` exactly as returned — portal deep link (e.g. `/product/.../qa-insights/test-suites/requirements/{id}`); prepend portal base to open in browser. **Never** construct `url` or call `cawplan api` with `data.url`. Cold-handoff / read-back GET: see `references/CAWPLAN_OPEN_API.md` §15 — subsection **List Requirements (read — cold-handoff and reconcile)**.
- **展示摘要** (`summary`) from `data.summary`, or `-` if API returns `null`.
- Product name and `product_id`.
- Module-tree node name and `module_tree_node_id`.
- `review_status` (expected `PENDING`).
- `ticket_id` if linked, or `-` if none.

**After reconcile (10b / Table A) binds an existing row** — no new write:

- State that the prior write outcome was unclear but the server already has a matching Requirement (five-field strong match per **Field comparison** — `summary` not in match).
- Report bound `id`, product, module-tree node, `summary`, and `review_status` from the list row.
- Clear `pending_write` and UNKNOWN.

After a **clear** failed archive or update (`POST` / `PATCH` with API error body), report:

- The error `code` and `msg`.
- That the draft (five fields + display summary) is unchanged and SQA may revise and retry (or reconcile first if outcome was unknown).

## References

- `references/CAWPLAN_OPEN_API.md` — §15 QA Insights APIs (subsections **Create Module Tree Node**, **Create Requirement**, **Update Requirement**, **List Requirements (read — cold-handoff and reconcile)**); §2 Product APIs and §4 Ticket APIs for product resolution and ticket material.
