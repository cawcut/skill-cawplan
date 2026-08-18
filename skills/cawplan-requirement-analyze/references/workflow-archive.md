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

**Cold handoff** (SQA provides a requirement `id`, Requirement link, or asks to continue an existing Requirement):

When `product_id` + `requirement_id` are known (Requirement portal link `/product/{product_id}/qa-insights/test-suites/requirements/{requirement_id}`, or SQA gives both):

```bash
cawplan qa-insights requirements get <product_id> <requirement_id>
```

On `outcome: SUCCESS`, use `data` as the row (single `QARequirement` object; no list filter).

When only `module_tree_node_id` is available and you must filter by `id`:

```bash
cawplan qa-insights requirements list <product_id> --module-tree-node-id <node_id>
```

On `outcome: SUCCESS`, `data` is the requirement array — filter client-side by `id` when SQA names a specific requirement.

Map the row's five fields into the current draft. Set `bound_requirement_id`, `five_field_snapshot` (five fields per Field comparison), `summary_snapshot`, and `ticket_id_snapshot` from that row. If `summary` is `null`, **generate** a display summary for the draft now (step 4); next archive **PATCH** writes `summary`. Clear any `pending_write` / UNKNOWN. Re-show five fields + display summary + open-questions list if SQA wants to edit before the next archive/update.

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
| `strong_match_single` | Bind `reconcile.matched_requirement_ids[0]`; refresh snapshots from `api`/server; clear `pending_write` and UNKNOWN; **set `just_reconciled = true`**. Tell SQA（逐字，下接 **Confirmation** §6 成功回执）：`这条上次其实已经保存成功了(当时没返回确认)。已绑定到那一条,没有重复创建。` **Do not create.** |
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

**保存确认（新建 POST）** — **乙式**：AskUserQuestion 无「框上正文」字段 — **先**纯文字输出路径行，**再**弹框；**勿**把路径塞进 `question`。

框上方正文（逐字，填入 `{模块树节点全路径}`）：

> 将需求保存到「{模块树节点全路径}」下。

**优先 AskUserQuestion**（**两个选项，每项须带 `label` + `description`**；工具若自动追加 Other 行，**勿在 skill 里定义 Other**）：

| 字段 | 值 |
|------|-----|
| `header` | 确认保存 |
| `question` | 确认保存这条需求? |
| option 1 · `label` | 确认保存 |
| option 1 · `description` | 存到 CawPlan |
| option 2 · `label` | 先不保存 |
| option 2 · `description` | 先留着草稿 |

**AskUserQuestion 不可用时** — 纯文字降级（逐字）：

```text
将需求保存到「{模块树节点全路径}」下。 确认保存这条需求? 1. 确认保存 2. 先不保存(回序号)
```

**落点**：

- **确认保存**（或同义肯定）→ 记录 `pending_write` 后 POST（见下方）。
- **先不保存** → 逐字回执，**不 POST**：
  > 好的,先不保存。需求草稿还在,你可以继续改;想好了说一声「保存到 CawPlan」。

**重试保存确认**（Table A `no_match` 后重试 POST — 逻辑同新建，仅框上方多一句安抚）：

框上方正文（逐字，两行）：

> 上次保存没确认成功,查过没有重复,现在重存一次。将需求保存到「{模块树节点全路径}」下。

再接与上相同的 **AskUserQuestion** / 降级 / **先不保存** 落点。**勿**输出推断核对、存疑 soft note 或「不是另建第二条」等技术措辞。

Wait for SQA confirmation. **Do not POST** without it.

**After confirmation** — record `pending_write` (operation `POST`, full five fields + `summary`) then call:

```bash
cawplan qa-insights requirements create <product_id> --body-file <path>
```

Body: `module_tree_node_id` + the five fields + non-empty `summary` (+ `ticket_id` when a ticket was used). Write it to a temp file — long JSON is error-prone to inline. See 仓库根 `references/CAWPLAN_OPEN_API.md` §15 — subsection **Create Requirement**. The CLI injects `is_ai_generated: true` at the **request body top level** — do not put it in `--body-file`.

The command POSTs directly — it does **not** look for duplicates first. Preventing duplicates is this skill's job (step 11 Gate + Table B + 10b reconcile), not the command's.

**After the call**: branch on `outcome` (see **Command outcomes**) and update session state per step 10 (**Pending write**). On `SUCCESS` → **Confirmation**.

#### 11b. Update (PATCH)

When Table B routes here (bound + snapshot diff shows changes).

**更新确认** — **乙式**（与 11a 相同：先路径正文，再弹框）。若更新场景无节点上下文 / 位置不变，**可省**框上方路径行。

框上方正文（逐字，填入 `{模块树节点全路径}`）：

> 将需求更新到「{模块树节点全路径}」下。

**优先 AskUserQuestion**（**两个选项，每项须带 `label` + `description`**）：

| 字段 | 值 |
|------|-----|
| `header` | 确认更新 |
| `question` | 确认更新这条需求? |
| option 1 · `label` | 确认更新 |
| option 1 · `description` | 更新到 CawPlan |
| option 2 · `label` | 先不更新 |
| option 2 · `description` | 先留着草稿 |

**AskUserQuestion 不可用时** — 纯文字降级（逐字）：

```text
将需求更新到「{模块树节点全路径}」下。 确认更新这条需求? 1. 确认更新 2. 先不更新(回序号)
```

**落点**：

- **确认更新**（或同义肯定）→ 记录 `pending_write` 后 PATCH（见下方）。
- **先不更新** → 逐字回执，**不 PATCH**：
  > 好的,先不更新。需求草稿还在,你可以继续改;想好了说一声「保存到 CawPlan」。

Wait for SQA confirmation. **Do not PATCH** without it.

**After confirmation** — record `pending_write` (operation `PATCH`, `target_requirement_id`) then call:

```bash
cawplan qa-insights requirements update <product_id> <bound_requirement_id> \
  --desired '<五字段 + summary + ticket_id 的期望状态 JSON>' \
  --snapshot '<five_field_snapshot + summary_snapshot + ticket_id_snapshot 原样 JSON>'
```

Pass **complete** states, not a hand-computed diff — the command works out which keys changed and PATCHes only those. (`--desired-file` / `--snapshot-file` accept the same content from files when the JSON is long.) Include `ticket_id` in both objects when comparing or changing the ticket link (display_id, or `null` to clear); reconcile strong match still uses **five fields only**. The CLI adds `is_ai_generated: true` to every non-empty PATCH body — do not put it in `--desired` / `--snapshot`.

**`--snapshot` must be the values last written to CawPlan** — i.e. `five_field_snapshot` + `summary_snapshot` + `ticket_id_snapshot` from step 10, verbatim. Not the current draft (that yields `NOOP` and silently drops the edit), and not a fresh `GET` (that re-sends someone else's concurrent edit as if it were yours). Neither mistake raises an error.

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

`error.type` refines a `FAILURE`: `validation` (bad body — fix it), `not_found` (target gone), `auth` / `feature_disabled` (permissions), `api` (server-side business error).

**Session flag `just_reconciled`** — set to `true` when Table A binds via `strong_match_single` or `patch_already_applied`. **Cleared after the next `requirements create` / `requirements update` call, regardless of what that call returns (`NOOP`, `SUCCESS`, `FAILURE`, or `UNKNOWN`).** It exists solely to pick the branch in **Table B** row 2.

## Write body rules

Field names are **snake_case**. A `create` body carries `module_tree_node_id`, the five fields, a non-empty `summary`, and `ticket_id` only when a ticket was used. A `update` `--desired` / `--snapshot` pair may also carry `ticket_id` (display_id, or `null` to unlink); it is compared like `summary` — **not** part of reconcile strong match.

**`is_ai_generated`**: Skill 归档的写请求由 CLI 统一注入 `is_ai_generated: true`（boolean）。`requirements create` → 请求体**顶层**；`requirements update` → 非空 PATCH body **顶层**；`testpoints archive` → `test_points` **每个元素内**。与 `is_edited` 正交；Skill/agent **不要**在 `--body-file` / `--desired` / `--snapshot` 里手写该字段。

The command rejects a body containing `product_id`, `review_status`, or `is_edited` and sends nothing — so a `FAILURE` / `validation` here means the body you built was wrong, not that the server refused. (These keys do appear in `GET` responses; that is expected — the restriction is on what you send.)
