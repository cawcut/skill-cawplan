### 10. Bind requirement context (hot + cold handoff)

Keep in session context after either:

- **Hot handoff** — a successful **POST** create (step 11 below), or a successful **PATCH** update (step 11).
- **Cold handoff** — loading an existing Requirement from CawPlan for continuation.

**Store**:

- `bound_requirement_id` — from `api.data.id` (create/update response), `reconcile.matched_requirement_ids[0]` (10b), or the matched `id` from a cold-handoff GET.
- `summary_snapshot` — the saved `summary` from that write or list row (`null` if server has no value).
- `ticket_id_snapshot` — the saved `ticket_id` from that write or list row (`null` if none); **separate from** `summary_snapshot`. Store the ticket **display_id** (e.g. `CAWP-04606`), not the unique id.
- `knowledge_document` — `{dataset_id, id}` of the bound Requirement's Markdown document, taken from that Requirement's own data: `requirement_data` (cold handoff), or the `knowledge_document` in the create response (`api.data`), or a `requirements get` when it is first needed. Its `status` may be `uploading` / `indexing` — never a gate. **Never** from a write response's `data.document.id` (not the path id), never by searching documents by name. Re-binding to another Requirement discards the old value.
- Also keep `product_id`, product name, `module_tree_node_id`, and module-tree node name when known.

The five fields are **not** stored as a snapshot: after a successful create the five-field draft is frozen and is never a baseline for later edits — requirement content changes go through the Markdown (**11b-MD**).

Snapshots = last values written to CawPlan, not unsaved draft.

**Pending write** (when POST/PATCH outcome is unknown):

After SQA confirms a write, if the CLI returns no clear `SUCCESS` or `FAILURE` → set `write_outcome = UNKNOWN` and keep `pending_write` until reconciled or cleared:

- `operation`: `POST` or `PATCH`
- `product_id`, `module_tree_node_id`, `ticket_id` (if any)
- For POST: full intended five fields + `summary`
- For PATCH: `target_requirement_id` + changed keys and values (Field comparison — snapshot diff; `summary` / `ticket_id` only)
- Do **not** set `bound_requirement_id` or refresh `summary_snapshot` / `ticket_id_snapshot` on UNKNOWN.

`pending_write` is for POST and for the `summary` / `ticket_id` PATCH only. A **Markdown write-back (11b-MD) does not use it** — it carries its own pre-write comparison and read-back verification, and it is idempotent.

On **clear API failure** (`FAILURE_*` or HTTP error with body): see **Failures** (Rules); `write_outcome` is not UNKNOWN — SQA may retry after read-back without reconcile-first for duplicate fear (same operation retry).

On **SUCCESS**: bind (step 10 Store), clear `pending_write`, set `write_outcome = SUCCESS`, clear `location_confirmed`. On **unknown outcome**: set `write_outcome = UNKNOWN`, keep `pending_write`, tell SQA the result is unclear — next step **10b** / **Table A — Reconcile** (step 11); do **not** claim success or immediately POST again.

**Field comparison** — the `qa-insights` commands own this. `requirements reconcile` decides what matches; `requirements update` decides which keys changed. Do not compare fields by hand or hand-compute a PATCH body.

Your part is to feed them the right inputs. For a **POST** probe, the probe comes from the current five-field draft. For a bound Requirement, `requirements update` is used for `summary` / `ticket_id` **only**: `--desired` contains just those keys (the five-field keys are always omitted — omitted = unchanged), and **`--snapshot` is `summary_snapshot` + `ticket_id_snapshot` verbatim** (step 10 **Store**). Put the intended `ticket_id` (display_id, or `null` to unlink) in `--desired` when the link should change; omit `ticket_id` from `--desired` only when you are not touching the link this round (leave-as-is).

**Fixed phrasing** (first-time five-field draft only): use the step 3 table sentences for inferred bullets — **no synonym rewrites**. Reworded bullets read as changed text and stop matching an earlier archive.

**Cold handoff** (SQA provides a requirement `id`, display ID, Test Suite Link, or asks to continue an existing Requirement):

Resolve the reference in this order:

1. Valid `product_id` + `requirement_id` take priority. Use them directly; do not call the display-ID resolver.
2. Parse an old Portal URL from the string only; never request the page:

   `/product/{product_id}/qa-insights/test-suites/requirements/{requirement_id}`

3. A bare display ID must strictly match `^REQ-\d+$`; a Browse URL must contain:

   `/browse/product/{product_key}/qa/requirement/{display_id}`

   For either form call (quote a full URL in the shell):

   ```bash
   cawplan qa-insights requirements resolve '<display_id_or_browse_url>'
   ```

   The command validates/extracts `display_id` locally, calls the by-display-id endpoint, and parses the real UUIDs from API `data.url`. The Browse URL's `product_key` (for example `CP`) is not `product_id`; never infer a UUID from it.

All Portal/Browse URLs are string inputs only. Never fetch the page with `cawplan api` or HTTP.

Acquire one common `requirement_data` object:

- When `product_id` + `requirement_id` are known directly or from an old Portal URL, call:

```bash
cawplan qa-insights requirements get <product_id> <requirement_id>
```

- On `outcome: SUCCESS`, set `requirement_data = data` (single `QARequirement` object; no list filter).
- When `requirements resolve` succeeds, require both `meta.product_id` and `meta.requirement_id`, then bind those IDs and set `requirement_data = data` directly. **Do not call `requirements get` in the same cold-handoff request.** Resolver `data` is the same full Requirement structure.

For either source, `requirement_data` must be an object containing `id` and `product_id`. Treat missing binding IDs, unusable data, or conflicting `data.id` / `data.product_id` versus resolver metadata as an abnormal API response; stop without replacing an existing binding or snapshots.

Display-ID resolver outcomes:

| Result | Action |
|--------|--------|
| `FAILURE / validation` | Explain that the display ID must be `REQ-` followed by digits; do not make another Requirement request. |
| `FAILURE / not_found` | Report that the Requirement does not exist; stop. |
| Other `FAILURE` or `UNKNOWN` | Report the error honestly; stop without guessing IDs or falling back to `requirements get`. |
| `SUCCESS` with invalid IDs/data | Report an abnormal response; stop. |

Only after successful validation may a new explicit target replace the current binding, draft, and snapshots. A failed rebind leaves the previous session context intact.

When only `module_tree_node_id` is available and you must filter by `id`:

```bash
cawplan qa-insights requirements list <product_id> --module-tree-node-id <node_id>
```

On `outcome: SUCCESS`, `data` is the requirement array — filter client-side by `id` when SQA names a specific requirement, then use the matched row as `requirement_data`.

Bind only — **do not** map the five fields into a draft, do not generate a summary, and do not re-show five fields / summary / open-questions. Set `bound_requirement_id`, `summary_snapshot`, `ticket_id_snapshot`, and `knowledge_document` from `requirement_data`; also keep `product_id` and `module_tree_node_id`. Clear any `pending_write` / UNKNOWN and any previous five-field draft. Then tell SQA only that the Requirement is bound (`已绑定 REQ-xxx` / `Bound to REQ-xxx`, using `display_id` when present) and ask what to change. The Markdown is read on demand (11b-MD), not pre-loaded.

### 10b. Reconcile (run Table A)

Run when `write_outcome = UNKNOWN`, when SQA asks to archive again after a failed/unclear write, or when about to `POST` while `pending_write` still exists for the same `module_tree_node_id`.

```bash
# POST pending
cawplan qa-insights requirements reconcile <product_id> \
  --module-tree-node-id <node_id> --probe-file <五字段 JSON>

# PATCH pending (summary / ticket_id only) — add the target and what that PATCH meant to write
cawplan qa-insights requirements reconcile <product_id> \
  --module-tree-node-id <node_id> --probe-file <内容为 {} 的文件> \
  --target-requirement-id <bound_requirement_id> \
  --intended-patch-file <上次 update 返回的 patch_body>
```

POST probe = the **five fields** from `pending_write` or the current draft (the command ignores `summary`). PATCH pending: the PATCH branch only compares the keys in `--intended-patch-file`, so the probe content is unused — pass a file containing `{}` (`--probe-file` accepts a file only, and `--module-tree-node-id` is required). `module_tree_node_id` comes from `pending_write` or context.

This command is **read-only** — it never writes. It reports what it found via `reconcile.decision`; act on it per **Table A** (step 11).

While `write_outcome = UNKNOWN`, **never** re-run the write command; **never** use Table B「无变化 → 另建」（that row applies only when `write_outcome = SUCCESS`).

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

**Table A — Reconcile** (`write_outcome = UNKNOWN` or `pending_write` exists) — run `requirements reconcile` (step 10b), then act on `reconcile.decision`:

| `reconcile.decision` | Action |
|----------------------|--------|
| `strong_match_single` | Bind `reconcile.matched_requirement_ids[0]`; refresh snapshots from `api`/server; clear `pending_write` and UNKNOWN; **set `just_reconciled = true`**. Tell SQA（逐字，**跟随会话语言**二选一，下接 **Confirmation** §6 成功回执）：`这条上次其实已经保存成功了(当时没返回确认)。已绑定到那一条,没有重复创建。` / `This was actually already saved last time (the confirmation just didn't come back). It's now bound to that entry — no duplicate was created.` **Do not create.** |
| `strong_match_multiple` | **List every id in `reconcile.matched_requirement_ids`; ask SQA which to bind.** Do not pick one yourself; do not create. |
| `patch_already_applied` | Treat PATCH as likely succeeded; refresh snapshots; clear UNKNOWN; **set `just_reconciled = true`**. |
| `patch_still_old` | Read-back → **PATCH retry** via `requirements update` (not create). |
| `no_match` | Read-back → **retry the same write** (`requirements create` with the same body, or `requirements update`; **不是另建第二条**). SQA says it is a **different** requirement → Table B → **11a**. |

**Table B — Archive** (`write_outcome = SUCCESS`, UNKNOWN cleared; diff per **Field comparison** — snapshot diff)

| Condition | Action |
|-----------|--------|
| No `bound_requirement_id` | **11a POST** create (steps 7–8 if not done). |
| Bound + SQA wants to change the requirement content (Markdown) | **11b-MD**. Not driven by a `requirements update` diff. |
| Bound + `summary` and/or `ticket_id` changed vs snapshots | **11b-PATCH** (command emits only changed keys). Same request also changing Markdown → 11b-MD first, then 11b-PATCH, as two calls. |
| Bound + `summary` and `ticket_id` unchanged vs snapshots, and no Markdown change (`requirements update` returns **`NOOP`**) | Warn: likely duplicate archive. Ask 是否**另建**? Confirm → **11a POST**. **Skip if you just bound via reconcile (10b)** — tell SQA already bound, no second copy.<br><br>Two branches, decided by `just_reconciled`: **(a) `just_reconciled = false`** → warn and **ask**; only after SQA confirms do you go to 11a. `NOOP` states a fact; it is **not** permission to create. **(b) `just_reconciled = true`** → **skip the warning and the question entirely**; tell SQA already bound, no second copy. Asking here would invite a duplicate moments after telling SQA 无需再建. |
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

```bash
cawplan qa-insights requirements create <product_id> --body-file <path>
```

Body: `module_tree_node_id` + the five fields + non-empty `summary` (+ `ticket_id` when a ticket was used). Write it to a temp file — long JSON is error-prone to inline. See 仓库根 `references/CAWPLAN_OPEN_API.md` §15 — subsection **Create Requirement**. The CLI injects `is_ai_generated: true` at the **request body top level** — do not put it in `--body-file`.

The command POSTs directly — it does **not** look for duplicates first. Preventing duplicates is this skill's job (step 11 Gate + Table B + 10b reconcile), not the command's.

**After the call**: branch on `outcome` (see **Command outcomes**) and update session state per step 10 (**Pending write**). On `SUCCESS` → **Confirmation**.

**本步完成标准**（POST / PATCH / 11b-MD 通用）：`SUCCESS` 后本轮**最终回复**已包含 `output-confirmation.md` §6 成功回执（需求 `REQ-xxxxx`、Knowledge Doc Link、Test Suite Link；`browse_url` / `redirect_url` 为空的按 §6 省略）。生成回执前先 Read 该文件，并按其规则执行 `cawplan config env` 拼接链接。收尾摘要不能替代回执。

#### 11b. Update a bound Requirement (11b-MD / 11b-PATCH)

When Table B routes here (bound; SQA changes the requirement content, or `summary` / `ticket_id` differ from their snapshots). Two routes, never mixed in one call:

- **11b-MD** — requirement **content** (the Markdown document). Defined below, after the shared confirmation.
- **11b-PATCH** — `summary` / `ticket_id` only (`requirements update`). The five-field keys are never sent again after binding.

**更新确认**（两条路由共用）— **仅当 `location_confirmed` 不为 true** 时执行乙式确认。§8 刚完成选位置时 **禁止**再弹「确认更新这条需求?」。11b-MD 的确认框**上方**放 `diff -u` 结果；`location_confirmed` 在已绑定后总是 false，所以 11b-MD 总会确认一次。

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

The server stores the requirement content as one free-form Markdown document, and a write **replaces the whole document**. So: read the real text → change **only** what SQA asked → show the diff → confirm → write → verify. Never retype the whole document in the conversation — read and write through **files**.

**Target — exactly one document**: the bound Requirement's own `knowledge_document` (`dataset_id` + `id`, step 10 **Store**). If it is not stored yet (e.g. right after a create), run `requirements get <product_id> <bound_requirement_id>` first and take it from that response. Never search documents by name; never use the `data.document.id` of a write response; no `cawplan api`.

Shell variables do **not** survive between Bash calls. Create the temp directory once, **write its absolute path down**, and spell that absolute path in every later command (below `$D` stands for it). Keep it until the session ends — `orig.md` is the rollback source.

```bash
D="$(cawplan session temp-dir)/req-md-<display_id>-$(date +%s)"; mkdir -p "$D"
cawplan knowledge documents get --dataset <ds> --document <doc> --refresh --no-interactive --output "$D/orig.md"
cp "$D/orig.md" "$D/new.md"
#   …edit new.md only…
diff -u "$D/orig.md" "$D/new.md"
#   …after SQA confirms…
cawplan knowledge documents get --dataset <ds> --document <doc> --refresh --no-interactive --output "$D/pre.md"
cmp "$D/orig.md" "$D/pre.md"
cawplan knowledge documents update --dataset <ds> --document <doc> --text-file "$D/new.md"
cawplan knowledge documents get --dataset <ds> --document <doc> --refresh --no-interactive --output "$D/verify.md"
cmp "$D/new.md" "$D/verify.md"
```

Spell `--dataset <ds> --document <doc>` out in full in every command (or keep them in two separate variables). Never pack several options into one variable and expand it as `$A`: zsh does not word-split, so the CLI fails with `required option '--dataset' not specified` and nothing runs.

`--refresh` is mandatory on every read (the CLI caches document content for 12 h and a write does not clear it). `--no-interactive` only keeps a real terminal from opening a menu. Do **not** pass `--name`, and use `--text-file` only (never `--file`).

1. **Read.** Run the first `documents get` into `orig.md`. Stdout is `{code, data:{output_path, length}}`; check, in order:
   - `knowledge_document` missing or empty → output the **统一提示** (`output-confirmation.md`「需求文档更新」) and stop; do not write.
   - `code` is not `SUCCESS`, or stdout is not the `output_path` form (a wrong `document_id` returns `code: "SUCCESS"` with `data.status: "not_found"` and no content — that is this case) → output the 统一提示 plus the command's `msg`; stop. The file was **not** written — never use an older file in its place.
   - `length` is 0, or `grep -q '[^[:space:]]' "$D/orig.md"` finds nothing → say the requirement document is empty and stop; do **not** re-analyse the requirement and write it back.
   - Otherwise treat the file as the requirement Markdown. Read it by meaning — do not assume any fixed headings or sections. Then `cp` to `new.md`.
2. **Edit** `new.md` only, with **local replacements**: change the original sentence to the new one; put added content in the semantically closest section. **Before replacing, confirm the original sentence occurs exactly once in `orig.md`** (zero or several matches → do not edit; ask SQA which one). Forbidden: rewriting the whole document, reordering sections, changing headings, translating, normalising wording, adding inference markers. Unsure which section something belongs in → ask SQA, do not guess.
3. **Show.** The `diff -u` output is "what changes". No difference → tell SQA nothing changes and **do not write**. `new.md` empty, or much shorter than `orig.md` without SQA asking to delete → stop and confirm with SQA; do not write.
4. **Confirm** with the shared 乙式确认闸 above (diff above the box).
5. **Pre-write comparison.** Read again into `pre.md` and `cmp` it with `orig.md`.
   - Identical → continue.
   - Different → **do not write**. Tell SQA the document was changed by someone else while confirming; go back to step 1 on the new content and redo the same edit there. The old `new.md` is void — never merge it with the new content and write.
   - The read fails → 统一提示 and stop.
   This only narrows the race to the instant between compare and write; it is **not** a lock, and that residual window is accepted.
6. **Write.** `documents update --text-file "$D/new.md"` (no `name`). Success = stdout `code == "SUCCESS"`; failure = `{code, data:null, msg}` + exit 1 — report the `msg` truthfully.
7. **Verify by read-back** — after **every** write attempt (success, failure, or no response): read into `verify.md` and `cmp` it with `new.md`.
   - Identical → the write landed → success receipt (`output-confirmation.md`「需求文档更新」).
   - Write failed with `DIFY_ERROR` / `Document is not available` → the previous write is still being processed (large documents take longer): **wait ~5 s and retry the same `new.md`, up to 3 times** before reading back; this wait is not the "retry once" below.
   - Different, or the write errored → retry **once** with the **same** `new.md` (no pre-write comparison before the retry), then read back again. Still different → failure receipt with the temp directory path. A full overwrite is idempotent, so the retry is safe; no `pending_write` / reconcile is involved.
8. **Rollback** ("撤销刚才的修改"): first compare a fresh read (`pre.md`) with the **last written `new.md`**; different → stop and tell SQA someone changed it since. Identical → `documents update --text-file "$D/orig.md"`, then read-back verify as in step 7.
9. **Success = `outcome: SUCCESS`** for the cross-skill relay: nothing extra to do — a relay only starts from an unsaved draft (a create), so it is never triggered from this route.

Same request also changes `summary` / `ticket_id` → finish 11b-MD (including verification) first, then run 11b-PATCH as a separate call.

##### 11b-PATCH. Update `summary` / `ticket_id`

**After confirmation or skip** — record `pending_write` (operation `PATCH`, `target_requirement_id`) then call:

```bash
cawplan qa-insights requirements update <product_id> <bound_requirement_id> \
  --desired '<summary 与/或 ticket_id 的期望状态 JSON，不含五字段键>' \
  --snapshot '<summary_snapshot + ticket_id_snapshot 原样 JSON>'
```

Pass **complete** states, not a hand-computed diff — the command works out which keys changed and PATCHes only those. (`--desired-file` / `--snapshot-file` accept the same content from files when the JSON is long.) Include `ticket_id` in both objects when comparing or changing the ticket link (display_id, or `null` to clear). The CLI adds `is_ai_generated: true` to every non-empty PATCH body — do not put it in `--desired` / `--snapshot`.

**`--snapshot` must be the values last written to CawPlan** — i.e. `summary_snapshot` + `ticket_id_snapshot` from step 10, verbatim. Not a value you made up for the edit (that yields `NOOP` and silently drops it), and not a fresh `GET` taken to "compare" (that re-sends someone else's concurrent edit as if it were yours). Neither mistake raises an error.

Record returned `patch_body` keys internally (session / retry); **do not** print a changed-field list to SQA.

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

`cawplan knowledge ...` commands (used by 11b-MD) have **no `outcome` envelope**: success is `code == "SUCCESS"` on stdout; a failure prints `{code, data: null, msg}` and exits 1. Judge them by `code` **and** by the read-back comparison in 11b-MD, never by exit code alone.

`error.type` refines a `FAILURE`: `validation` (bad body — fix it), `not_found` (target gone), `auth` / `feature_disabled` (permissions), `api` (server-side business error).

**Session flag `just_reconciled`** — set to `true` when Table A binds via `strong_match_single` or `patch_already_applied`. **Cleared after the next `requirements create` / `requirements update` call, regardless of what that call returns (`NOOP`, `SUCCESS`, `FAILURE`, or `UNKNOWN`).** It exists solely to pick the branch in **Table B** row 2.

## Write body rules

Field names are **snake_case**. A `create` body carries `module_tree_node_id`, the five fields, a non-empty `summary`, and `ticket_id` only when a ticket was used. A `update` `--desired` / `--snapshot` pair may also carry `ticket_id` (display_id, or `null` to unlink); it is compared like `summary` — **not** part of reconcile strong match.

**`is_ai_generated`**: Skill 归档的写请求由 CLI 统一注入 `is_ai_generated: true`（boolean）。`requirements create` → 请求体**顶层**；`requirements update` → 非空 PATCH body **顶层**；`testpoints archive` → `test_points` **每个元素内**。与 `is_edited` 正交；Skill/agent **不要**在 `--body-file` / `--desired` / `--snapshot` 里手写该字段。

The command rejects a body containing `product_id`, `review_status`, or `is_edited` and sends nothing — so a `FAILURE` / `validation` here means the body you built was wrong, not that the server refused. (These keys do appear in `GET` responses; that is expected — the restriction is on what you send.)
