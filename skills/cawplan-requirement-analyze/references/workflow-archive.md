### 10. Bind requirement context (hot + cold handoff)

Keep in session context after either:

- **Hot handoff** — a successful **POST** create (step 11 below), or a successful **PATCH** update (step 11).
- **Cold handoff** — loading an existing Requirement from CawPlan for continuation.

**Store**:

- `bound_requirement_id` — from `api.data.id` (create/update response; on the MCP route the response `data.id`), `reconcile.matched_requirement_ids[0]` (10b; on the MCP route the single matched row's `id`), or the matched `id` from a cold-handoff GET.
- `summary_snapshot` — the saved `summary` from that write or list row (`null` if server has no value).
- `ticket_id_snapshot` — the saved `ticket_id` from that write or list row (`null` if none); **separate from** `summary_snapshot`. Store the ticket **display_id** (e.g. `CAWP-04606`), not the unique id.
- `knowledge_document` — `{dataset_id, id}` of the bound Requirement's Markdown document, taken from that Requirement's own data: `requirement_data` (cold handoff), or the `knowledge_document` in the create response (`api.data`; MCP route: `data`), or a capability `qa.requirements.get` call when it is first needed. Its `status` may be `uploading` / `indexing` — never a gate. **Never** from a write response's `data.document.id` (not the path id), never by searching documents by name. Re-binding to another Requirement discards the old value.
- Also keep `product_id`, product name, `module_tree_node_id`, and module-tree node name when known.

The five fields are **not** stored as a snapshot: after a successful create the five-field draft is frozen and is never a baseline for later edits — requirement content changes go through the Markdown (**11b-MD**).

Snapshots = last values written to CawPlan, not unsaved draft.

**Pending write** (when POST/PATCH outcome is unknown):

After SQA confirms a write, if the call returns no clear `SUCCESS` or `FAILURE` (CLI route: `outcome: UNKNOWN` or no parseable result; MCP route: the call itself failed — timeout, dropped connection, no `{code}` envelope — so it is unclear whether the write landed) → set `write_outcome = UNKNOWN` and keep `pending_write` until reconciled or cleared:

- `operation`: `POST` or `PATCH`
- `product_id`, `module_tree_node_id`, `ticket_id` (if any)
- For POST: full intended five fields + `summary`
- For PATCH: `target_requirement_id` + changed keys and values (Field comparison — snapshot diff; `summary` / `ticket_id` only)
- Do **not** set `bound_requirement_id` or refresh `summary_snapshot` / `ticket_id_snapshot` on UNKNOWN.

`pending_write` is for POST and for the `summary` / `ticket_id` PATCH only. A **Markdown write-back (11b-MD) does not use it** — it carries its own pre-write comparison and read-back verification, and it is idempotent.

On **clear API failure** (`FAILURE_*` or HTTP error with body; MCP route: an envelope whose `code` is not `SUCCESS`): see **Failures** (Rules); `write_outcome` is not UNKNOWN — SQA may retry after read-back without reconcile-first for duplicate fear (same operation retry).

On **SUCCESS**: bind (step 10 Store), clear `pending_write`, set `write_outcome = SUCCESS`, clear `location_confirmed`. On **unknown outcome**: set `write_outcome = UNKNOWN`, keep `pending_write`, tell SQA the result is unclear — next step **10b** / **Table A — Reconcile** (step 11); do **not** claim success or immediately POST again.

**Field comparison** — on the **CLI route** the capabilities own this. `qa.requirements.reconcile` decides what matches; `qa.requirements.update` decides which keys changed. Do not compare fields by hand or hand-compute a PATCH body.

Your part is to feed them the right inputs. For a **POST** probe, the probe comes from the current five-field draft. For a bound Requirement, `qa.requirements.update` is used for `summary` / `ticket_id` **only**: `desired` contains just those keys (the five-field keys are always omitted — omitted = unchanged), and **`snapshot` is `summary_snapshot` + `ticket_id_snapshot` verbatim** (step 10 **Store**). Put the intended `ticket_id` (display_id, or `null` to unlink) in `desired` when the link should change; omit `ticket_id` from `desired` only when you are not touching the link this round (leave-as-is).

On the **MCP route** there is no reconcile and the update does not diff for you, so the comparison is done by hand with exactly the same inputs and the same rule (trim, then byte-exact): the changed keys are the `summary` / `ticket_id` keys whose desired value differs from `summary_snapshot` / `ticket_id_snapshot`; the five-field keys are never sent. See 11b-PATCH (MCP route) and 10b (MCP route).

**Fixed phrasing** (first-time five-field draft only): use the step 3 table sentences for inferred bullets — **no synonym rewrites**. Reworded bullets read as changed text and stop matching an earlier archive.

**Cold handoff** (SQA provides a requirement `id`, display ID, Test Suite Link, or asks to continue an existing Requirement):

Resolve the reference in this order:

1. Valid `product_id` + `requirement_id` take priority. Use them directly; do not call the display-ID resolver.
2. Parse an old Portal URL from the string only; never request the page:

   `/product/{product_id}/qa-insights/test-suites/requirements/{requirement_id}`

3. A bare display ID must strictly match `^REQ-\d+$`; a Browse URL must contain:

   `/browse/product/{product_key}/qa/requirement/{display_id}`

   For either form call capability `qa.requirements.resolve` (`display_id`):

   - **CLI route**: pass the display ID or the full Browse URL as `display_id` (quote a full URL in the shell). The CLI validates/extracts `display_id` locally, calls the by-display-id endpoint, and parses the real UUIDs from API `data.url`.
   - **MCP route**: the tool takes the display ID only. Take `display_id` out of the Browse URL yourself and check it against `^REQ-\d+$` **before** calling; if it does not match, handle it as the `FAILURE / validation` row below without calling.

   The Browse URL's `product_key` (for example `CP`) is not `product_id`; never infer a UUID from it.

All Portal/Browse URLs are string inputs only. Never fetch the page or send raw HTTP / API requests for it.

Acquire one common `requirement_data` object:

- When `product_id` + `requirement_id` are known directly or from an old Portal URL, call capability `qa.requirements.get` (`product_id`, `requirement_id`).
- On success (CLI route `outcome: SUCCESS`; MCP route `code == "SUCCESS"`), set `requirement_data = data` (single `QARequirement` object; no list filter).
- When `qa.requirements.resolve` succeeds: on the CLI route require both `meta.product_id` and `meta.requirement_id`, then bind those IDs; on the MCP route (no `meta`) take them from `data.product_id` and `data.id`. Set `requirement_data = data` directly. **Do not call `qa.requirements.get` in the same cold-handoff request.** Resolver `data` is the same full Requirement structure.

For either source, `requirement_data` must be an object containing `id` and `product_id`. Treat missing binding IDs, unusable data, or (CLI route) conflicting `data.id` / `data.product_id` versus resolver metadata as an abnormal API response; stop without replacing an existing binding or snapshots.

Display-ID resolver outcomes (MCP route: a non-`SUCCESS` `code` meaning the Requirement was not found → `not_found` row; any other non-`SUCCESS` `code`, or a call with no clear response → "Other" row):

| Result | Action |
|--------|--------|
| `FAILURE / validation` | Explain that the display ID must be `REQ-` followed by digits; do not make another Requirement request. |
| `FAILURE / not_found` | Report that the Requirement does not exist; stop. |
| Other `FAILURE` or `UNKNOWN` | Report the error honestly; stop without guessing IDs or falling back to `qa.requirements.get`. |
| `SUCCESS` with invalid IDs/data | Report an abnormal response; stop. |

Only after successful validation may a new explicit target replace the current binding, draft, and snapshots. A failed rebind leaves the previous session context intact.

When only `module_tree_node_id` is available and you must filter by `id`: capability `qa.requirements.list` (`product_id`, `module_tree_node_id`).

On success (CLI route `outcome: SUCCESS`; MCP route `code == "SUCCESS"`), `data` is the requirement array (MCP route: if `data` is a paged object, use its item list and page through it) — filter client-side by `id` when SQA names a specific requirement, then use the matched row as `requirement_data`.

Bind only — **do not** map the five fields into a draft, do not generate a summary, and do not re-show five fields / summary / open-questions. Set `bound_requirement_id`, `summary_snapshot`, `ticket_id_snapshot`, and `knowledge_document` from `requirement_data`; also keep `product_id` and `module_tree_node_id`. Clear any `pending_write` / UNKNOWN and any previous five-field draft. Then tell SQA only that the Requirement is bound (`已绑定 REQ-xxx` / `Bound to REQ-xxx`, using `display_id` when present) and ask what to change. The Markdown is read on demand (11b-MD), not pre-loaded.

### 10b. Reconcile (run Table A)

Run when `write_outcome = UNKNOWN`, when SQA asks to archive again after a failed/unclear write, or when about to `POST` while `pending_write` still exists for the same `module_tree_node_id`.

**CLI route** — capability `qa.requirements.reconcile` (CLI only):

- Probe and intended-patch files go in the directory from capability `session.temp_dir` with a unique name (for example `req-probe-<display_id or noticket>-<unix seconds>.json`); delete them after reconcile returns.
- **POST pending**: `product_id`, `module_tree_node_id`, `probe_file` (a file holding the five-field JSON).
- **PATCH pending** (summary / ticket_id only) — add the target and what that PATCH meant to write: `product_id`, `module_tree_node_id`, `probe_file` (a file containing `{}`), `target_requirement_id` = `bound_requirement_id`, `intended_patch_file` (a file holding the `patch_body` the last update returned).

POST probe = the **five fields** from `pending_write` or the current draft (the command ignores `summary`). PATCH pending: the PATCH branch only compares the keys in `intended_patch_file`, so the probe content is unused — pass a file containing `{}` (`probe_file` accepts a file only, and `module_tree_node_id` is required). `module_tree_node_id` comes from `pending_write` or context.

This capability is **read-only** — it never writes. It reports what it found via `reconcile.decision`; act on it per **Table A** (step 11).

**MCP route** — there is no reconcile capability. Before any retry, look the record up yourself (read-only) and derive the same `reconcile.decision` value, then act on it per **Table A**:

- **POST pending**: capability `qa.requirements.list` (`product_id`, `module_tree_node_id` from `pending_write` or context; page through all results). A row is a strong match when **all five fields** equal the probe (the five fields in `pending_write` or the current draft) after trimming, byte-exact — `null` counts as empty, and an `out_of_scope` of `（素材未提及）` / `(素材未提及)` / `(Not mentioned in material)` counts as empty; inference markers are kept; `summary` is ignored. Exactly one → `strong_match_single` (its `id` = the matched id); several → `strong_match_multiple` (list every matching `id`); none → `no_match`.
- **PATCH pending**: capability `qa.requirements.get` (`product_id`, `requirement_id` = `target_requirement_id`). Target not found → `no_match`. Every key you meant to change (the changed keys recorded in `pending_write`) already equals its intended value (same trim rule; `ticket_id` empty = `null`) → `patch_already_applied`; otherwise → `patch_still_old` (the retry then goes through the 11b-PATCH MCP pre-check, which stops and asks if the server value differs from the snapshot).
- If the look-up itself fails, keep `write_outcome = UNKNOWN` and `pending_write`, tell SQA the result is still unclear, and stop. **Never re-create blindly.**

While `write_outcome = UNKNOWN`, **never** re-run the write command (on either route); **never** use Table B「无变化 → 另建」（that row applies only when `write_outcome = SUCCESS`).

### 11. Archive or update Requirement (write — confirm first)

When SQA signals archive/submit intent ("可以了", "存吧", "归档", "提交", "保存到 CawPlan", "存到 CawPlan", "保存需求", etc.), **do not write immediately**.

**乙式确认闸（何时弹 / 何时跳过）**：

| 条件 | step 11 行为 |
|------|----------------|
| `location_confirmed = true`（§8 刚完成选位置：「就保存到这里」或〔选②〕选中节点） | **跳过**下方 11a/11b 乙式 AskUserQuestion 与「将需求保存/更新到…」路径复述；**直接**记录 `pending_write` 后 POST/PATCH |
| §8 **被跳过**（接力入站已带 `module_tree_node_id`、冷交接更新且未重选位置） | **保留** 11a/11b 乙式确认闸（此路径无 §8 确认，须在此确认一次） |
| Table B「另建」、reconcile 后 `no_match` 重试等**非 §8 落点** | 见各子节；`no_match` 重试若 `location_confirmed` 仍为 true → **跳过**乙式，仅输出一行状态后直写 |

**Gate** (judge **Table A before Table B**):

- `write_outcome = UNKNOWN` or `pending_write` → step **10b** / **Table A — Reconcile** first; do **not** POST/PATCH until UNKNOWN is cleared or SQA explicitly wants a **new** Requirement (11a full read-back).
- Otherwise → **Table B — Archive**. SQA explicitly wants a **new** Requirement while already bound → **11a** (full POST read-back).

**Table A — Reconcile** (`write_outcome = UNKNOWN` or `pending_write` exists) — run step 10b (CLI route: capability `qa.requirements.reconcile`; MCP route: the 10b look-up), then act on `reconcile.decision`:

| `reconcile.decision` | Action |
|----------------------|--------|
| `strong_match_single` | Bind `reconcile.matched_requirement_ids[0]`; refresh snapshots from `api`/server; clear `pending_write` and UNKNOWN; **set `just_reconciled = true`**. Tell SQA（逐字，**跟随会话语言**二选一，下接 **Confirmation** §6 成功回执）：`这条上次其实已经保存成功了(当时没返回确认)。已绑定到那一条,没有重复创建。` / `This was actually already saved last time (the confirmation just didn't come back). It's now bound to that entry — no duplicate was created.` **Do not create.** |
| `strong_match_multiple` | **List every id in `reconcile.matched_requirement_ids`; ask SQA which to bind.** Do not pick one yourself; do not create. |
| `patch_already_applied` | Treat PATCH as likely succeeded; refresh snapshots; clear UNKNOWN; **set `just_reconciled = true`**. |
| `patch_still_old` | Read-back → **PATCH retry** via capability `qa.requirements.update` (not create). |
| `no_match` | Read-back → **retry the same write** (capability `qa.requirements.create` with the same body, or capability `qa.requirements.update`; **不是另建第二条**). SQA says it is a **different** requirement → Table B → **11a**. |

**Table B — Archive** (`write_outcome = SUCCESS`, UNKNOWN cleared; diff per **Field comparison** — snapshot diff)

| Condition | Action |
|-----------|--------|
| No `bound_requirement_id` | **11a POST** create (steps 7–8 if not done). |
| Bound + SQA wants to change the requirement content (Markdown) | **11b-MD**. Not driven by a `qa.requirements.update` diff. |
| Bound + `summary` and/or `ticket_id` changed vs snapshots | **11b-PATCH** (command emits only changed keys). Same request also changing Markdown → 11b-MD first, then 11b-PATCH, as two calls. |
| Bound + `summary` and `ticket_id` unchanged vs snapshots, and no Markdown change (`qa.requirements.update` returns **`NOOP`**; MCP route: your 11b-PATCH comparison finds no changed key, and nothing is sent) | Warn: likely duplicate archive. Ask 是否**另建**? Confirm → **11a POST**. **Skip if you just bound via reconcile (10b)** — tell SQA already bound, no second copy.<br><br>Two branches, decided by `just_reconciled`: **(a) `just_reconciled = false`** → warn and **ask**; only after SQA confirms do you go to 11a. `NOOP` states a fact; it is **not** permission to create. **(b) `just_reconciled = true`** → **skip the warning and the question entirely**; tell SQA already bound, no second copy. Asking here would invite a duplicate moments after telling SQA 无需再建. |
| SQA says it is a different requirement (**另建**) | **11a POST** only if the session still holds the five-field draft **and** no Markdown write-back has happened since binding. Otherwise say 需要提供素材重新分析 / the material must be provided again, and restart from step 1 — a stale draft must not create a requirement that disagrees with the current Markdown. |
| **CLEAR_FAILURE** (not UNKNOWN) | Report error; read-back → retry **same** operation (no reconcile required). |

#### 11a. Create (POST)

When Table B routes here (no bound, or SQA confirms另建 / different requirement, or retry POST after Table A no-match).

**保存确认（新建 POST）** — **仅当 `location_confirmed` 不为 true** 时执行乙式确认。§8 已确认挂载位置时 **禁止**再输出「将需求保存到…」或弹「确认保存这条需求?」框。

**乙式确认**（`location_confirmed` 为 false / 未设时）— AskUserQuestion 无「框上正文」字段 — **先**纯文字输出路径行，**再**弹框；**勿**把路径塞进 `question`。

框上方正文（逐字，填入 `{模块树节点全路径}`；**跟随会话语言**二选一，不同时输出）：

> 将需求保存到「{模块树节点全路径}」下。
> This requirement will be saved under "{模块树节点全路径}."

**优先 AskUserQuestion**（**两个选项，每项须带 `label` + `description`**；工具若自动追加 Other 行，**勿在 skill 里定义 Other**；**跟随会话语言**整框二选一，不同时输出）：

| 字段 | 中文值 | English value |
|------|-----|-----|
| `header` | 确认保存 | Confirm Save |
| `question` | 确认保存这条需求? | Confirm saving this requirement? |
| option 1 · `label` | 确认保存 | Confirm save |
| option 1 · `description` | 存到 CawPlan | Save it to CawPlan |
| option 2 · `label` | 先不保存 | Not yet |
| option 2 · `description` | 先留着草稿 | Keep it as a draft for now |

**AskUserQuestion 不可用时** — 纯文字降级（逐字；**跟随会话语言**二选一，不同时输出）：

```text
将需求保存到「{模块树节点全路径}」下。 确认保存这条需求? 1. 确认保存 2. 先不保存(回序号)
```

```text
This requirement will be saved under "{模块树节点全路径}." Confirm saving this requirement? 1. Confirm save 2. Not yet (reply with a number)
```

**落点**（仅乙式路径）：

- **确认保存**（或同义肯定）→ 记录 `pending_write` 后 POST（见下方）。
- **先不保存** → 逐字回执，**不 POST**（**跟随会话语言**二选一，不同时输出）：
  > 好的,先不保存。需求草稿还在,你可以继续改;想好了说一声「保存到 CawPlan」。
  > Okay, not saving for now. The requirement draft is still here — keep editing, and just say "save to CawPlan" when you're ready.

**跳过乙式确认闸**（`location_confirmed = true`）— §8 选位置已肯定：

- **禁止**输出「将需求保存到…」、**禁止**弹确认框、**禁止**等待第二轮肯定。
- **直接**记录 `pending_write` 后 POST（见下方 **After confirmation**）。

**重试保存**（Table A `no_match` 后重试 POST）：

- `location_confirmed = true` → **仅**一行状态（逐字，**跟随会话语言**二选一）：`上次保存没确认成功,查过没有重复,现在重存一次。` / `The last save wasn't confirmed successful — I checked and there's no duplicate, so I'm retrying the save now.` 然后**直接** POST；**勿**再接乙式框或路径复述。
- `location_confirmed` 未设 → 乙式路径，框上方两行正文（**跟随会话语言**二选一，不同时输出）：
  > 上次保存没确认成功,查过没有重复,现在重存一次。将需求保存到「{模块树节点全路径}」下。
  > The last save wasn't confirmed successful — I checked and there's no duplicate, so I'm retrying the save now. This requirement will be saved under "{模块树节点全路径}."
  再接 AskUserQuestion / 降级 / **先不保存** 落点。

Wait for SQA confirmation **only on the 乙式 path**. On the skip path, **do not wait** — POST immediately after Gate/Table routing.

**After confirmation or skip** — record `pending_write` (operation `POST`, full five fields + `summary`) then call:

capability `qa.requirements.create` (`product_id`, and the body below):

- **CLI route**: pass the body as `body_file` (long JSON is error-prone to inline). Write the file in the directory printed by capability `session.temp_dir`. That directory is fixed and shared by CLI sessions, so give the file a unique name that contains the display ID and a Unix-seconds timestamp — the ticket display ID when a ticket was used, otherwise `noticket` (e.g. `<that path>/req-create-CAWP-12345-1762750000.json`) — and delete the file after the call returns, whatever the outcome (`pending_write` keeps the content in context). The CLI injects `is_ai_generated: true` at the **request body top level** and trims the fields — do not put `is_ai_generated` in the file.
- **MCP route**: pass the same object inline as `body`. Nothing injects or normalizes for you, so build it the way the CLI would: trim every field; send an `out_of_scope` of `（素材未提及）` / `(素材未提及)` / `(Not mentioned in material)` as `""`; keep `summary` non-empty; add `is_ai_generated: true` at the body top level; never include `product_id`, `review_status` or `is_edited` (see **Write body rules**).

Body: `module_tree_node_id` + the five fields + non-empty `summary` (+ `ticket_id` when a ticket was used). Argument shapes: `references/CAPABILITIES.md` (`qa.requirements.create`); field rules: **Write body rules** below.

The capability POSTs directly — it does **not** look for duplicates first. Preventing duplicates is this skill's job (step 11 Gate + Table B + 10b reconcile), not the capability's.

**After the call**: branch on the result (see **Command outcomes**) and update session state per step 10 (**Pending write**). On `SUCCESS` → **Confirmation**.

**本步完成标准**（POST / PATCH / 11b-MD 通用）：`SUCCESS` 后按顺序执行：
1. Read `output-confirmation.md`；CLI 路由调用 capability `config.env` 拼接链接，MCP 路由不取 Host（按 §6「MCP 路由」变体）。
2. 在**正式回复正文**输出 §6 成功回执（需求 `REQ-xxxxx`、Knowledge Doc Link、Test Suite Link；链接取数位置与缺失处理见 §6「字段位置」；MCP 路由给需求编号、不给链接并说明链接不可用）。

回执写在思考里不算输出；最终回复本身必须包含回执，不得用 recap / wrap-up 或「上面的回执」代替。

#### 11b. Update a bound Requirement (11b-MD / 11b-PATCH)

When Table B routes here (bound; SQA changes the requirement content, or `summary` / `ticket_id` differ from their snapshots). Two paths (not the CLI / MCP routes), never mixed in one call:

- **11b-MD** — requirement **content** (the Markdown document). Defined below, after the shared confirmation.
- **11b-PATCH** — `summary` / `ticket_id` only (capability `qa.requirements.update`). The five-field keys are never sent again after binding.

**更新确认**（两条路由共用）— **仅当 `location_confirmed` 不为 true** 时执行乙式确认。§8 刚完成选位置时 **禁止**再弹「确认更新这条需求?」。11b-MD 的确认框**上方**放 diff 结果（CLI 路由 `diff -u`；MCP 路由按 11b-MD 的手工 diff）；`location_confirmed` 在已绑定后总是 false，所以 11b-MD 总会确认一次。

**乙式确认**（`location_confirmed` 为 false / 未设时）— 先路径正文，再弹框。若更新场景无节点上下文 / 位置不变，**可省**框上方路径行。

框上方正文（逐字，填入 `{模块树节点全路径}`；**跟随会话语言**二选一，不同时输出）：

> 将需求更新到「{模块树节点全路径}」下。
> This requirement will be updated under "{模块树节点全路径}."

**优先 AskUserQuestion**（**两个选项，每项须带 `label` + `description`**；**跟随会话语言**整框二选一，不同时输出）：

| 字段 | 中文值 | English value |
|------|-----|-----|
| `header` | 确认更新 | Confirm Update |
| `question` | 确认更新这条需求? | Confirm updating this requirement? |
| option 1 · `label` | 确认更新 | Confirm update |
| option 1 · `description` | 更新到 CawPlan | Update it in CawPlan |
| option 2 · `label` | 先不更新 | Not yet |
| option 2 · `description` | 先留着草稿 | Keep it as a draft for now |

**AskUserQuestion 不可用时** — 纯文字降级（逐字；**跟随会话语言**二选一，不同时输出）：

```text
将需求更新到「{模块树节点全路径}」下。 确认更新这条需求? 1. 确认更新 2. 先不更新(回序号)
```

```text
This requirement will be updated under "{模块树节点全路径}." Confirm updating this requirement? 1. Confirm update 2. Not yet (reply with a number)
```

**落点**（仅乙式路径）：

- **确认更新**（或同义肯定）→ 11b-MD：进入其第 5 步（写前比对）；11b-PATCH：记录 `pending_write` 后 PATCH（见下方）。
- **先不更新** → 逐字回执，**不 PATCH、不写文档**（11b-MD 的 `new.md` 保留，不写入）（**跟随会话语言**二选一，不同时输出）：
  > 好的,先不更新。需求草稿还在,你可以继续改;想好了说一声「保存到 CawPlan」。
  > Okay, not updating for now. The requirement draft is still here — keep editing, and just say "save to CawPlan" when you're ready.

**跳过乙式确认闸**（`location_confirmed = true`，仅 11b-PATCH 可能出现）— 直接记录 `pending_write` 后 PATCH。

Wait for SQA confirmation **only on the 乙式 path**. On the skip path, **do not wait** — PATCH immediately after Gate/Table routing.

##### 11b-MD. Edit the requirement Markdown (full-text overwrite)

The server stores the requirement content as one free-form Markdown document, and a write **replaces the whole document**. So: read the real text → change **only** what SQA asked → show the diff → confirm → write → verify. On the CLI route, never retype the whole document in the conversation — read and write through **files**. On the MCP route there are no files (see below).

**Target — exactly one document**: the bound Requirement's own `knowledge_document` (`dataset_id` + `id`, step 10 **Store**). If it is not stored yet (e.g. right after a create), call capability `qa.requirements.get` (`product_id`, `requirement_id` = `bound_requirement_id`) first and take it from that response. Never search documents by name; never use the `data.document.id` of a write response; never send raw HTTP / API requests.

Below, `<ds>` = `knowledge_document.dataset_id` and `<doc>` = `knowledge_document.id`. Every read is capability `knowledge.documents.get` (`dataset_id` = `<ds>`, `document_id` = `<doc>`); every write is capability `knowledge.documents.update` (`dataset_id` = `<ds>`, `document_id` = `<doc>`, plus the content). Both are named per step below; the routes differ only in where the text lives:

**CLI route — working copies are files.** Shell variables do **not** survive between Bash calls. Create the temp directory once, **write its absolute path down**, and spell that absolute path in every later call (below `$D` stands for it). Keep it until the session ends — `orig.md` is the rollback source.

- Make `$D`: call capability `session.temp_dir`, then `mkdir -p "<that path>/req-md-<display_id>-<unix seconds>"`; that directory is `$D`.
- Every read passes `refresh`, `no_interactive` and `output` = the target file (`$D/orig.md`, `$D/pre.md` or `$D/verify.md`). `refresh` is mandatory on every read (the CLI caches document content for 12 h and a write does not clear it). `no_interactive` only keeps a real terminal from opening a menu.
- Every write passes `text_file` = `$D/new.md` (or `$D/orig.md` for rollback) — use `text_file` only, never `file`, and never a document name.
- Local steps use plain shell tools: `cp "$D/orig.md" "$D/new.md"`, edit `new.md` only, `diff -u "$D/orig.md" "$D/new.md"`, `cmp` for every comparison.
- Spell `dataset_id` / `document_id` out in full in every call (or keep them in two separate variables). Never pack several CLI options into one variable and expand it: zsh does not word-split, so the CLI fails with a missing-option error and nothing runs.

**MCP route — working copies stay in the conversation.** There is no temp directory and no `output` / `refresh` / `no_interactive`: each `knowledge.documents.get` returns the full current content in the response `data`. Keep `orig` (the first read, verbatim — it is the rollback source for the rest of the session), build `new` from it, and send the complete `new` text as the `text` argument of `knowledge.documents.update` — this is the one place the whole document is sent inline, so copy `orig` unchanged except for the confirmed edit. "Compare" below means an exact character-for-character comparison of the full texts; "diff" means the changed lines in unified-diff form (`-` old line / `+` new line, with the nearest heading as context), produced from `orig` and `new`.

1. **Read** into `orig` (CLI: `orig.md`). Check, in order:
   - `knowledge_document` missing or empty → output the **统一提示** (`output-confirmation.md`「需求文档更新」) and stop; do not write.
   - The read failed: `code` is not `SUCCESS`, or no content came back (a wrong `document_id` returns `code: "SUCCESS"` with `data.status: "not_found"` and no content — that is this case). CLI route: stdout is not the `{code, data:{output_path, length}}` form; the file was **not** written — never use an older file in its place. → output the 统一提示 plus the response `msg`; stop.
   - The content is empty or whitespace only (CLI: `length` is 0, or `grep -q '[^[:space:]]' "$D/orig.md"` finds nothing) → say the requirement document is empty and stop; do **not** re-analyse the requirement and write it back.
   - Otherwise treat it as the requirement Markdown. Read it by meaning — do not assume any fixed headings or sections. Then copy it to `new` (CLI: `cp` to `new.md`).
2. **Edit** `new` only, with **local replacements**: change the original sentence to the new one; put added content in the semantically closest section. **Before replacing, confirm the original sentence occurs exactly once in `orig`** (zero or several matches → do not edit; ask SQA which one). Forbidden: rewriting the whole document, reordering sections, changing headings, translating, normalising wording, adding inference markers. Unsure which section something belongs in → ask SQA, do not guess.
3. **Show.** The diff (CLI: `diff -u` output) is "what changes". No difference → tell SQA nothing changes and **do not write**. `new` empty, or much shorter than `orig` without SQA asking to delete → stop and confirm with SQA; do not write.
4. **Confirm** with the shared 乙式确认闸 above (diff above the box).
5. **Pre-write comparison.** Read again into `pre` (CLI: `pre.md`) and compare it with `orig` (CLI: `cmp`).
   - Identical → continue.
   - Different → **do not write**. Tell SQA the document was changed by someone else while confirming; go back to step 1 on the new content and redo the same edit there. The old `new` is void — never merge it with the new content and write.
   - The read fails → 统一提示 and stop.
   This only narrows the race to the instant between compare and write; it is **not** a lock, and that residual window is accepted.
6. **Write** `new` with capability `knowledge.documents.update` (CLI: `text_file` = `$D/new.md`; MCP: `text` = the full `new`; never a name). Success = `code == "SUCCESS"`; failure = `{code, data:null, msg}` (CLI also exits 1) — report the `msg` truthfully.
7. **Verify by read-back** — after **every** write attempt (success, failure, or no response): read into `verify` (CLI: `verify.md`) and compare it with `new`.
   - Identical → the write landed → success receipt (`output-confirmation.md`「需求文档更新」).
   - Write failed with `DIFY_ERROR` / `Document is not available` → the previous write is still being processed (large documents take longer): **wait ~5 s and retry the same `new`, up to 3 times** before reading back; this wait is not the "retry once" below.
   - Different, or the write errored → retry **once** with the **same** `new` (no pre-write comparison before the retry), then read back again. Still different → failure receipt with the temp directory path (MCP route: the「保留在本会话中」variant). A full overwrite is idempotent, so the retry is safe; no `pending_write` / reconcile is involved.
8. **Rollback** ("撤销刚才的修改"): first compare a fresh read (`pre`) with the **last written `new`**; different → stop and tell SQA someone changed it since. Identical → write `orig` back with capability `knowledge.documents.update` (CLI: `text_file` = `$D/orig.md`; MCP: `text` = the full `orig`), then read-back verify as in step 7.
9. **Success = `outcome: SUCCESS`** for the cross-skill relay: nothing extra to do — a relay only starts from an unsaved draft (a create), so it is never triggered from this route.

Same request also changes `summary` / `ticket_id` → finish 11b-MD (including verification) first, then run 11b-PATCH as a separate call.

##### 11b-PATCH. Update `summary` / `ticket_id`

**After confirmation or skip** — record `pending_write` (operation `PATCH`, `target_requirement_id`) then call:

capability `qa.requirements.update` (`product_id`, `requirement_id` = `bound_requirement_id`):

**CLI route** — pass `desired` = the desired state of `summary` and/or `ticket_id` (no five-field keys) and `snapshot` = `summary_snapshot` + `ticket_id_snapshot` verbatim.

Pass **complete** states, not a hand-computed diff — the capability works out which keys changed and PATCHes only those. (`desired_file` / `snapshot_file` accept the same content from files when the JSON is long.) Include `ticket_id` in both objects when comparing or changing the ticket link (display_id, or `null` to clear). The CLI adds `is_ai_generated: true` to every non-empty PATCH body — do not put it in `desired` / `snapshot`.

**`snapshot` must be the values last written to CawPlan** — i.e. `summary_snapshot` + `ticket_id_snapshot` from step 10, verbatim. Not a value you made up for the edit (that yields `NOOP` and silently drops it), and not a fresh `GET` taken to "compare" (that re-sends someone else's concurrent edit as if it were yours). Neither mistake raises an error.

Record returned `patch_body` keys internally (session / retry); **do not** print a changed-field list to SQA.

**MCP route** — the tool sends whatever you give it, so do the CLI's work by hand, in this order:

1. Work out the changed keys: for `summary` (and `ticket_id` when you are touching the link), compare the desired value with `summary_snapshot` / `ticket_id_snapshot` — the values last written to CawPlan, never a made-up or freshly read value — after trimming (`ticket_id`: empty = `null`). No changed key → this is `NOOP`: send nothing and go to **Table B** row 2.
2. Read the Requirement: capability `qa.requirements.get` (`product_id`, `requirement_id` = `bound_requirement_id`). If the server value of **any key you are changing** differs from its snapshot (after the same trim), someone else changed it: **stop**, show SQA the server value next to the snapshot, and ask how to proceed; do not write.
3. Call `qa.requirements.update` with `desired` = **only the changed keys** (trimmed values) plus `is_ai_generated: true`. Never send unchanged keys, five-field keys, `product_id`, `review_status` or `is_edited`.

Record the keys you sent as the patch body internally (session / retry, 10b); **do not** print a changed-field list to SQA.

**After the call**: branch on the result (see **Command outcomes**) and update session state per step 10. On `SUCCESS` → **Confirmation**.

## Command outcomes

**CLI route** — every `qa.*` capability prints one JSON object (writes: `{outcome, command, meta, api, post_body|patch_body}`, the Open API envelope in `api`; reads: `{outcome, command, meta, data}`). **Branch on the `outcome` field — not on the exit code**: `FAILURE` and `UNKNOWN` share exit code 1, and they call for opposite responses.

**MCP route** — every call returns the plain `{code, msg, data}` envelope (the `api.data` of this skill is the response `data`). Map it onto the same table: `code == "SUCCESS"` → `SUCCESS`; any other `code` → `FAILURE` (report `msg`); the call itself failed with no envelope (timeout, dropped connection) → treat as `UNKNOWN` (the write may have landed); an update you did not send because nothing changed → `NOOP`; a 10b look-up that bound an existing row → `RECONCILED`.

| `outcome` | Meaning | Action |
|-----------|---------|--------|
| `SUCCESS` | The write landed | Bind / refresh snapshots (step 10 **Store**); clear `pending_write`; → **Confirmation** |
| `NOOP` | **Nothing was sent** — the update had no changed keys | → **Table B** row 2 (both branches — see that row) |
| `RECONCILED` | **Nothing was written** — reconcile found the earlier write had already landed | → **Table A** (`strong_match_single` / `patch_already_applied`) |
| `FAILURE` | Definitively failed; nothing was written | Report the error message honestly (CLI: `error.message`; MCP: `msg`). Fix and **retry the same operation** — no reconcile needed |
| `UNKNOWN` | **The result is genuinely unknown** — the write may or may not have landed | Set `write_outcome = UNKNOWN`; keep `pending_write`; **never re-run the write**; → step **10b** reconcile (MCP route: the 10b look-up). Never report this as success |

`knowledge.documents.*` capabilities (used by 11b-MD) have **no `outcome` envelope** on either route: success is `code == "SUCCESS"`; a failure is `{code, data: null, msg}` (CLI: printed on stdout, exit 1). Judge them by `code` **and** by the read-back comparison in 11b-MD, never by exit code alone.

`error.type` (CLI route) refines a `FAILURE`: `validation` (bad body — fix it), `not_found` (target gone), `auth` / `feature_disabled` (permissions), `api` (server-side business error). On the MCP route read the same distinction from `code` / `msg`.

**Session flag `just_reconciled`** — set to `true` when Table A binds via `strong_match_single` or `patch_already_applied`. **Cleared after the next `qa.requirements.create` / `qa.requirements.update` call, regardless of what that call returns (`NOOP`, `SUCCESS`, `FAILURE`, or `UNKNOWN`)** — on the MCP route also when an update is resolved as `NOOP` without being sent. It exists solely to pick the branch in **Table B** row 2.

## Write body rules

Field names are **snake_case**. A `create` body carries `module_tree_node_id`, the five fields, a non-empty `summary`, and `ticket_id` only when a ticket was used. An update `desired` / `snapshot` pair may also carry `ticket_id` (display_id, or `null` to unlink); it is compared like `summary` — **not** part of reconcile strong match.

**`is_ai_generated`**: Skill 归档的写请求统一带 `is_ai_generated: true`（boolean）。`qa.requirements.create` → 请求体**顶层**；`qa.requirements.update` → 非空 PATCH body **顶层**；`qa.testpoints.archive` → `test_points` **每个元素内**。与 `is_edited` 正交。CLI 路由由 CLI 注入：Skill/agent **不要**在 `body_file` / `desired` / `snapshot` 里手写该字段。MCP 路由没有注入：按 11a / 11b-PATCH 的 MCP 说明自己放进 `body` / `desired`。

On the CLI route the capability rejects a body containing `product_id`, `review_status`, or `is_edited` and sends nothing — so a `FAILURE` / `validation` here means the body you built was wrong, not that the server refused. On the MCP route nothing checks this for you: never send those keys. (These keys do appear in `GET` responses; that is expected — the restriction is on what you send.)
