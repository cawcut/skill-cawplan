---
version: 0.2.6
name: cawplan-testpoint-generate
description: |
  Generate test-point coverage outlines from an archived CawPlan Requirement (five fields), with an open-questions list, and batch-archive test points after SQA confirmation.
  Use when: an archived Requirement needs test points or a coverage outline; cold handoff (Requirement portal link or id); hot handoff after A1 archive ("generate test points for this requirement"); incremental test-point supplements on an existing Requirement.
  NOT for: structuring or archiving Requirements (use `cawplan-requirement-analyze`); expanding test points into step-by-step cases or Excel (A3); viewing or editing archived test points or review in Test Suites (use the web UI); unarchived five-field drafts only (archive via A1 first).
argument-hint: "[Requirement portal link or requirement_id, or 'continue the requirement just archived']"
allowed-tools: Bash
---

# CawPlan TestPoint Generate

## Bootstrap

```bash
cawplan skill check
```

## Workflow

### 1. Resolve target Requirement (entry priority)

On each **generate test points** request, pick the active target in this order:

| Priority | Condition | Action |
|----------|-----------|--------|
| 1 | This message has an explicit reference (portal URL / `requirement_id` / switch to another Requirement) | **Cold handoff** — rebind to it; ignore prior session binding |
| 2 | No explicit reference; user says "生成测试点" / "按上面那条" / "接着刚才那条" | **Hot handoff** — use current session binding |
| 3 | No binding; only an unarchived A1 five-field draft | **Stop** — tell SQA to archive via `cawplan-requirement-analyze` first. **Do not** call APIs or show a test-point table (no `requirement_id` for refresh) |

**Portal URL** (parse only — never fetch):

`/product/{product_id}/qa-insights/test-suites/requirements/{requirement_id}`

- Extract `product_id` + `requirement_id` from the string only.
- **Forbidden**: `cawplan api GET {url}`, HTTP fetch, or any request to the portal path.

**Only `requirement_id`, missing `product_id`**: ask for `product_id` or a full portal link. **Do not** guess the product or scan product lists.

**Rebind** replaces the whole context (`product_id`, `requirement_id`, five fields, test-point stubs). One active Requirement at a time. Same `requirement_id` as current binding = refresh same row, not rebind. Contradictory messages (new URL + "还是刚才那条") → ask; do not guess.

### 2. Refresh before generate (always)

Before generating or supplementing test points (cold or hot), pull live data:

```bash
cawplan api GET /api/v1/public/openapi/product/<product_id>/qa/requirements/<requirement_id>
```

Use `data` directly for the five fields + `url` (single `QARequirement` object; no list filter).

```bash
cawplan api GET /api/v1/public/openapi/product/<product_id>/qa/requirements/<requirement_id>/testpoints
```

| Result | Action |
|--------|--------|
| Requirement found (`code: SUCCESS`) | Use **latest** five fields silently; do not diff against chat cache |
| Requirement missing (`404` or explicit not-found) | Report "这条 Requirement 已不存在"; do not generate from stale context |

Use five fields for generation only. Do not track `module_tree_node_id`, `review_status`, or `ticket_id` for A2 logic.

### 3. Incremental gate (§9.3)

If `testpoints` is non-empty and intent is vague ("生成测试点" only) → stop and ask:

1. Supplement a few more on top of existing?
2. Show what's already archived first?

If intent is clear ("再补两条并发的" / "看看已有的") → proceed. If library is empty → generate directly.

### 4. Read coverage dimensions (required)

Before enumerating axes, **read the file** (do not rely on memory or hardcoded axes in this skill):

`references/coverage-dimensions.md` (in this skill's directory)

### 5. Generate test points (no write)

**Axis traversal (fixed order — only traversal order;三态适用性判断不变)**:

After reading `references/coverage-dimensions.md`, walk **variation axes** in **A → B → C → D** group order (within each group, top-to-bottom as listed). Do not jump randomly between groups.

For each axis, judge三态: **覆盖** / **不适用（静默跳过）** / **拿不准（进存疑清单）**. Path types (`正向` / `异常` / `逆向` / `边界`) **label only** — not axes for cross-multiply.

**Generate → prune → dedup → closure checks**:

1. Cross-multiply **representative** combinations from the five fields. Count is **coverage-driven** — no fixed min/max. When cross-multiplying enum/boundary values, follow **granularity rules** §2 (one row per verification goal, all values in title). When the five fields omit a case but `coverage-dimensions.md` judges a **基本盘** path type applicable (`正向` / `异常` / `边界` per section 3) and the title needs only **directional** assertions (**红线 0** below), add a representative row during cross-multiply (e.g. credential login → wrong credentials `异常`) — do not wait for closure to flag zero coverage.
2. Prune axes contradicted by `out_of_scope`.
3. **Batch-internal dedup** (verification goal — §2.2): merge per **granularity rules** §2; run on **all draft rows without `id`**, after generate/supplement, **before** closure checks and §6 self-critique. **Never** compare drafts to archived rows by semantics (cross-batch = id only, §10).
4. **Coverage closure** (scoped — **not** a per-axis status report for the full checklist). All generated titles obey **红线 0** first:
   - **(a) 基本盘四轴** — `正向` / `输入类型` / `边界` / `异常`: judged **适用** and **no draft row covers it** (standalone row **or** verification goal already covered per step 3):
     1. **对照 `coverage-dimensions.md` 第三节适用判断 + 展开追问** — if a **标配方向** (no implementation ambiguity), title needs only directional assertions (红线 0) → **generate 1 representative row**; do not 存疑 solely because the requirement did not spell out the case.
     2. **Multiple reasonable implementations** (e.g. menu hidden vs click error) → **存疑**; do not generate guessing which.
     3. Assertion **requires specific numbers / copy / thresholds / error codes** not in the five fields → **do not generate** that part (红线 0); 存疑 or generate only the directional segment.
   - **(b) 需求明写的技术轴** — rules / constraints / limits in the five fields that map to a variation axis (e.g. "立即刷新" → `一致性`; "不可重复提交 / 只扣一次" → `幂等`; "仅某类型可用" → `角色权限`). Same (a) logic when **zero coverage**: unambiguous directional row → generate 1; implementation ambiguity or invented specifics → 存疑. **(a)(b) = axis-level, zero coverage only.**
   - **(c) 同轴关键取值收口（取值级，仅已适用轴）** — run after (a)(b); prevents treating "one value on this axis" as "axis closed":
     - **Purpose**: for each **already applicable** variation axis, check whether **stretch / non-baseline key values** on that same axis are missing — not whether the axis was touched at all.
     - **「已适用」** (must meet **at least one**; do not infer applicability after the fact):
       1. This batch already has a draft row whose primary tag is that axis; or
       2. Generation judged the axis **覆盖** or **拿不准**; or
       3. (a)/(b) already maps a rule to that axis (including 基本盘四轴 judged applicable).
     - **基本盘标配首条取值不归 (c)** — first baseline on `异常` / `边界` (wrong credentials, empty required field, boundary card from five fields) is handled in step 1 / (a); **do not** 存疑 those as "B/C 未覆盖".
     - **Check**: for each applicable axis, compare draft coverage against that axis's **展开追问（取值提示）** column in `coverage-dimensions.md`. If a **明显常见** **stretch** key value **directly relevant to this requirement's shape** is not covered (no standalone row **and** verification goal not already covered per step 3) → one 存疑 line: `〔X 轴已测 A，B/C 未覆盖〕` + suggest补测试点或请确认. **Do not** force-generate stretch values.
     - **明显常见**: anchor on 展开追问 only — no ad-hoc enumeration. Must be **directly relevant** to this requirement's inputs / constraints / states / technical shape. E.g. requirement mentions popup blocking and a row covers it → weak-net / disconnect / timeout on the same axis may enter 存疑; if the requirement does not involve multi-client, do **not** auto-raise old-app / resolution sub-items just because another value on the axis was tested.
     - **Bounds**: applies only to axes already judged applicable — **笃定不适用 axes stay silent**; do not use (c) to drag in `幂等` / `并发` / `环境兼容` on pure UI features. Value-level, **not** a per-value checkbox matrix. **Stretch** missing values → 存疑 by default, not force-generate. **宁少不宁多** — edge or stretch values stay out. Merge with structural 存疑 (step 5) when the same gap would appear twice.
     - **Example** (illustration only — not limited to `环境兼容`): `环境兼容` row covers popup blocking but not disconnect / timeout → 存疑 to补 or confirm scope.
   - **All other axes**: unchanged —笃定不适用仍静默; axes neither explicitly written nor judged applicable by shape → no statement, no generation, no 存疑 for axis or value omission.
5. **Structural 存疑 self-check** (结构型 only — **no** lexical keyword triggers):
   - When the five fields state a **rule or type difference** but not its **failure / exception / boundary behavior** (e.g. "AD Video/Story 不提供入口" — menu hidden vs click error?), add 存疑 for SQA to confirm.
   - **Forbidden** as sole triggers: vague wording like `正常` / `正确` / `合理` / `若干` — 宁少不宁多.
6. **Soft self-check**: too many → case-level detail, **per-value row splits** (fix per granularity rules), or wrong axes? too few → missed applicable axes or obvious key values within (a)(b)(c)?
7. **Truly thin** five fields (nothing to cross-multiply) → stop and ask SQA to enrich; **thin but testable** → generate + put gaps in 存疑清单.

**红线 0 — 防臆造（最高优先级，压过一切「直接生成」与 closure 补行）**:

- Test-point titles may assert only **directional** outcomes unless the five fields already supply the value: `应成功` / `应失败` / `应拦截` / `应有明确提示` (`明确提示` = feedback type, not a literal sentence).
- **Forbidden** in titles without five-field source: specific copy, error codes, lockout counts, timeout seconds, invented thresholds.
- Before writing: would this assertion need a **number / literal message / threshold / error code**? If yes and not in the five fields → **do not generate** that part; 存疑 instead. **Prefer fewer rows over invented specifics.**
- Five-field numbers (e.g. 125-char limit, Free plan 50 cap) are **not** fabrication — use them.
- **「宁可少生成」** means fewer invented details — **not** skipping basic directional rows when `coverage-dimensions.md` section 3 applies.

**存疑清单纪律** (§5 — applies to step 4 closure and §7 presentation):

- Format: 〔指向哪〕+〔为什么疑〕+〔建议动作〕.
- **Forbidden sole triggers**: `素材未提及` / `需补充` (A1 requirement-gap phrasing — A2 covers gaps with test-point rows or scope/ambiguity 存疑, not A1 copy).
- **Unsure unique vs ambiguous** (implementation style, stretch scope) → lean **存疑**; do not skip B-class confirmation to seem helpful. **Unsure whether `异常` baseline applies** (e.g. wrong credentials on credential login) → follow checklist section 3 + step 1 / (a), not 存疑.
- When unsure whether to generate a **directional** baseline row vs 存疑 → **红线 0** first: if specifics would be invented, stop that part; if only directional, generate.

**Title rules & granularity (§4.1 — outline layer, not executable cases)**:

Test points are **coverage outlines (验证目标)**. Executable scripts (precondition + steps + per-value expected data) belong in **A3**.

**Granularity rules**:

1. **One row = one verification goal (测什么)** — no operation steps, no per-value row explosion at A2. Steps and data-driven per-value cases → A3.
2. **Merge decision** (same verification goal only — also governs §5 step 3 batch-internal dedup):
   - **Merge** when: **same operation** + **same expectation direction** + **no extra precondition** (e.g. plan/permission) — **one row**, **list all values in the title** (e.g. `各挡位 5s/10s/15s`). **Do not** split into one row per value.
   - Same **what we verify** with different data states, **data values only**, or wording → one row.
   - (①) Same goal, different precondition data → one row.
   - (②) "混合时/同时存在/共存" wrapper when core assertion matches an existing row → merge.
   - (③) **Same operation, only test data values differ** (e.g. Duration 5s/10s/15s) → **one row listing all values** in the title; drop per-value duplicate rows.
   - **Do not merge** when: operation differs, expectation direction differs, or a value triggers **extra precondition** (e.g. `4K` needs paid plan vs normal resolution) → **separate rows** or 存疑.
   - **Merge ≠ omit values** — all values (especially default) must appear in that one row (aligns with review-checklist A#2, closure (c)). The value list is the **A3 expand basis**; per-value executable cases → A3.
3. **Overline test** (pull back to goal layer):
   - If a draft has full **executable-case** structure (precondition + step sequence + per-value expected data) → **overline** — drop steps, keep **what** is verified; merge same-goal value splits per rule 2.
   - **Listing all values in one row ≠ listing operation steps per value.** ✅ `选择各 Duration 挡位（5s/10s/15s，含默认）后，导出视频时长应与所选挡位一致` — value inventory in one verification-goal sentence. ❌ `选 5s → 导出 → 验 5s；选 10s → 导出 → 验 10s…` — that packs multiple case scripts into one row; still overline. Splitting into three one-value rows is also wrong — merge values, not steps.

**Relationships (do not conflict)**:

- **Batch-internal dedup (step 3)**: apply granularity §2; different goals (e.g. `正常保存` vs `越权拦截`) → separate rows.
- **Enum completeness** (review-checklist A#2): merge requires **full value list in the title**, not fewer rows with missing values.

**Title shape**:

- Structure: precondition + behavior under test (+ implied expectation). **Obey 红线 0** (above).
- One verification goal per row; outline layer, not step-by-step cases.

Good: `Free plan 已有 50 个 workflow 时再 Duplicate 应提示超过上限且无法复制`

Bad: `测试复制功能` / `打开项目页 → 点更多 → 点 Duplicate` (steps → A3)

Bad (too fine — split): `选择 5s 挡位后视频时长应为 5s` + `选择 10s…` + `选择 15s…` (same goal → one row per rule 2)

Bad (overline — steps packed): `打开视频配置 → 分别选择 5s/10s/15s 导出并逐档检查时长` (executable script → A3)

### 6. Post-generation self-critique (internal — before first present)

**Skip** when §5 step 7 triggered (**truly thin** five fields — no draft to review). Otherwise, after §5 produces an **internal draft** (test-point rows + 存疑) and **before** any output to SQA:

1. **Read the checklist file** (same as §4 — do not rely on memory):

   `references/review-checklist.md` (in this skill's directory)

2. **Switch perspective** to 「资深测试评审」. Walk **A 层** items **in list order**, **one round only** — no multi-round loop. For each A-layer item, read **only the bold check line**; parenthetical maintainer notes are **not** required reading. **B 层** is capability-boundary awareness only — do **not** read B-layer items line by line.

3. **Compare draft against each A-layer item**. On a hit:
   - **Direction-clear universal baseline** (title needs only directional assertions per **红线 0**) → **add test-point row(s)**; merge into the formal list indistinguishably from §5 rows — **no source marking**; **re-group and re-number** as needed.
   - **Specific value / implementation unclear**, or a **B 层** theme → **add 存疑** (at most one line per B-layer theme); do **not** invent coverage or pretend covered.
   - All supplements obey **红线 0**, no coverage matrix, **宁少不宁多**, **笃定不适用 → silent**. Self-critique补 rows must obey **granularity rules** §2.

4. **Hard rules** (non-negotiable):
   - **Internal only, one version to SQA**: 生成初稿 → 自审补漏 → **only then** §7 present. **Forbidden**: show draft first, then a revised version; SQA sees **one** table set.
   - **Same turn, same context**: self-critique immediately follows §5 in **this** conversation — do **not** re-invoke as a separate pass re-feeding requirement + draft.
   - **No report, no checkmarks, no source tags**: do **not** tell SQA which checklist lines were applied; do **not** output per-line ☑/❌; do **not** mark which rows came from self-critique. Checklist is scaffolding, not an output artifact.
   - **Self-critique补 rows** are AI-generated → **`is_edited: false`** at archive (§9); not SQA edits.

5. **Scope**: run **once** before **first present of that round** on every generate/supplement that produced a draft. **Incremental**: self-critique **only this round's M new drafts** (no `id`), not re-audit archived N rows. **Do not** re-run after §8 SQA revision rounds unless SQA explicitly asks to regenerate.

**Division of labor**: `coverage-dimensions.md` = generate-time axes (§4–§5). `review-checklist.md` = post-generate retrospective for gaps generation mechanics miss. Do **not** duplicate axis closure (a)(b)(c) here. §5 step 6 soft self-check (quantity/axes) stays in §5; this step is the fixed漏点 pattern pass.

### 7. Present to SQA

1. **覆盖面一句话** (§2.3) — which axis classes are covered; no matrix.

2. **测试点清单 — 按 `group` 分节呈现（硬性要求，每次必做）**

   **禁止**把全部测试点挤进一张无分节的连续表。即使 `group` 字段已在各行有值，也**不得**只靠 `N.M` 序号暗示分组——**必须先打出组标题行，再跟该组的小表**。

   **分节规则**（仅排序与分表呈现；**不改** `group` 取值或分组逻辑）：

   - 按各行已有 `group` 字段归并；空 `group` → 组名显示为 `未分组`，且**永远排在最后一节**。
   - 节序号 N = 第 N 组（从 1 起）；组内行序号 N.M（M 从 1 递增）。

   **每一节固定两块输出**（节与节之间空一行）：

   ```text
   **N. {组名}**

   | 序号 | 标题 | 标签 |
   |------|------|------|
   | N.1 | … | … |
   | N.2 | … | … |
   ```

   - **组标题格式（硬性）**：单独一行，形如 `**1. 分享创建**`、`**2. 权限与访问控制**`。`{组名}` = 该节 `group` 字段原文（空则用 `未分组`）。**每一组都必须有标题行**——单组时也输出 `**1. …**`，不得省略。
   - **每节一张小表**：表内只放该 `group` 的行；**禁止**跨组合并成一张大表。
   - **每次呈现都要分节**：首次生成、SQA 修订后重展、增量合并展示——规则相同，组标题不可漏。

   **列定义**：

   - **First batch** (library empty): `序号 | 标题 | 标签` — no status column; no row bolding.
   - **Incremental** (library has archived rows): `序号 | 标题 | 标签 | 状态` — see rules below.

3. **存疑清单** after **all** group sections (§5): 〔指向哪〕+〔为什么疑〕+〔建议动作〕; no coverage checkbox matrix. If none: say so explicitly.

**Do not state draft totals** before archive (no `共 N 条草稿`, no N in archive prompts). SQA reviews the tables; **the only count SQA sees is in the post-POST success receipt** (§9.5).

**Incremental merged display** (only when library already has test points — N archived + M new drafts):

Per §7 step 2: **one section per `group`** (group title line + small table). Within each group, merge archived + new into **one** table; **continuous numbering** (archived first in API order, new drafts appended). 覆盖面 + 存疑 for **full** N+M set. Archive only drafts without `id`; edit/delete archived rows → Test Suites UI.

**Distinguish 新增 vs 已存** (two means — status column is required; bold is optional):

1. **Status column** (primary, plain text): `已存` (has `id`, read-only) or `新增` (this round's draft, no `id`). This column alone must make the distinction clear even if other formatting fails.
2. **Bold entire rows** (enhancement): status `新增` → bold all four cells (`**…**`); `已存` rows not bold. May write `🆕 新增` in the status column.

**No count summary after tables** — do **not** write `本轮新增 M 条` / `其余 K 条为已存` / `共 N 条` (agents cannot reliably count rows; see Rules Index · Draft totals). Optional **non-numeric** footer after all group sections: `已入库条目标为「已存」（只读，改/删请去 Test Suites 后台）；「新增」为本轮草稿，确认后仅归档新增行。`

**Rendering discipline**:

- **Group title lines are a hard requirement** — same priority as the incremental status column. Never skip them to save space or because `group` is already on each row internally.
- Bold and emoji in tables are **enhancements only** — some clients may not render `**` or emoji inside tables. **Status column text** (incremental) and **group title lines** must carry meaning without relying on table-only formatting.
- Never rely on bold/emoji alone to tell 新增 from 已存.

### 8. Revise from SQA feedback

Natural language: add / delete drafts / edit title, tags, group / adopt 存疑 items. Ambiguous edits → ask.

**Adopting 存疑 → new test-point rows** counts as a revision round (same as add): re-show full table, recompute 序号.

After **any** revision round → **re-show the full 分节清单** (every group title + per-group table, §7 step 2) with recomputed numbers; refresh 存疑 as needed. Prompt: review by title content, not old numbers only (§4.4).

**SQA insists on keeping two similar rows** → keep both; do not re-run §2.2 merge on those rows.

**Never auto-archive.** "看着不错" ≠ archive → ask e.g. `要现在归档，还是再调调？` — **no draft count** in this prompt.

**原稿** = first table shown to SQA this working set (**after §6 self-critique** — §5 internal draft does not count). Self-critique补 rows are part of 原稿. Track which draft rows SQA touched for `is_edited` (§9).

### 9. Archive (write — explicit confirm only)

Proceed only when SQA clearly says 存 / 归档 / 入库.

**Read-back** (§9.4) before POST — **no draft count** in the message:

- First batch: `将本批测试点归档到 Requirement〔标题〕下。确认归档？`
- Incremental: `将本轮新草稿归档到 Requirement〔标题〕下（已入库的不动）。确认归档？`

**Before POST**: build `test_points` from the last full table in display order — **one body entry per draft row without `id`**, same order as shown. Do not skip or duplicate rows.

Requirement display name: `summary` → truncate `function_description` → `requirement_id`.

POST **only drafts without `id`**, in display order:

```bash
cawplan api POST /api/v1/public/openapi/product/<product_id>/qa/requirements/<requirement_id>/testpoints/batch \
  --body '{"test_points":[{"title":"...","tags":["边界"],"group":"...","is_edited":false}]}'
```

Body per item: **only** `title`, `tags`, `group`, `is_edited`. Never send `id`, `sort_order`, `product_id`, `requirement_id`, or review fields.

**`is_edited`**: `false` if untouched since 原稿 (includes rows added in §6 self-critique — AI-generated, no source tag); `true` if SQA edited or added (including adopting 存疑). Incremental batch: only for **new** M drafts vs their 原稿; archived N rows excluded.

On `code: SUCCESS` and returned count matches POST → store returned `id`s as session stubs (§10); **do not** list them to SQA.

**Success receipt (§9.5)** — **only place SQA sees a count**. One short line. Use **`N` = `body.test_points.length`** (or response `test_points.length` on SUCCESS), e.g. `已归档 N 条到 Requirement〔标题〕下`. Requirement display name: `summary` → truncate `function_description` → `requirement_id`. If refresh returned a non-empty `url`, append it as-is on the same line or the next line. **If `url` is missing or null, say nothing about links** — never construct portal URLs, never note that `url` was unavailable.

**Forbidden in success receipt**: per-row tables; title lists; `id` lists; re-generated or summarized titles; any line about missing `url` (e.g. "未返回 url"/"无法附链接"); **apology or post-hoc recount explanations** (e.g. "之前误算成 13 条").

On failure → report `code` / `msg` honestly (§9.6). Do not fake success or blind-retry.

### 10. UNKNOWN write outcome (§9.4)

If POST outcome unclear → `write_outcome = UNKNOWN`. Re-`GET .../testpoints` and compare **counts** only:

- `old + batch` → treat as success; tell SQA already saved.
- `old` unchanged → retry **same** batch after read-back.
- Never auto POST a duplicate batch on ambiguity.

### 11. Archived row edits

SQA wants to change/delete a row **with `id`** → direct them to Test Suites UI. A2 only appends; no PATCH/DELETE.

## Session state (in-conversation only)

**① Binding**: `product_id`, `requirement_id`, five-field snapshot, `url`.

**② Work set**: 原稿 snapshot; touched-row marks; current drafts; archived stubs from last refresh.

**③ Write**: `pending_write` after read-back; `write_outcome` SUCCESS / failure / UNKNOWN.

Refresh binding + stubs before each generate. Rebind clears all. After successful archive, merge new `id`s into stubs; new supplement round gets a **new** 原稿 for the M drafts.

## Walkthrough example (workflow Duplicate — requirement `019fb63e-d5ad-7cb7-8b5f-761ceeb50c0a`)

**五字段（节选）**：workflow 项目 Duplicate；入口为项目卡片更多菜单；正常预期为生成副本、列表可见、新窗口打开；约束含仅 workflow 类型、他人分享不可复制、命名 `Copy of xxx`、125 字符上限、素材一并复制、Free plan 50 个上限等。

**判轴（节选）**：`输入类型`/`角色权限`（他人分享只读）/`边界`（50 上限、125 字符）/`存量兼容`（重名允许）— 不适用轴如 `并发` 对只读分享场景可静默或进存疑。

**批内去重示例**：已有「Free plan 达 50 个 workflow 时 Duplicate 应提示超限」→ 不再单独生成「第 51 次点击 Duplicate 仍提示超限」（同验证目标，仅状态不同）。

**样例测试点（草稿）**：

**1. 复制与命名**

| 序号 | 标题 | 标签 |
|------|------|------|
| 1.1 | 本人拥有的 workflow 项目点击 Duplicate 后应在列表出现名为「Copy of 原项目名」的副本 | `正向` |
| 1.2 | Free plan 账号已有 50 个 workflow 时再 Duplicate 应提示超过最大限制且无法复制 | `边界` |

**存疑（一条）**：约束未明确 AD Video / Story 类型是否隐藏 Duplicate 入口——建议在需求 `out_of_scope` 标明，或确认 UI 层入口不可见即可。

## Walkthrough example (login — baseline vs 红线 0)

**五字段（节选）**：账号 + 密码登录；入口为登录页；正常预期为登录成功并进入首页；约束未写账户锁定策略。

**生成（草稿）**：

**1. 登录校验**

| 序号 | 标题 | 标签 |
|------|------|------|
| 1.1 | 正确账号和密码登录应成功并进入预期页面 | `正向` |
| 1.2 | 错误账号或密码登录应失败并给出明确提示 | `异常` |

**存疑（可选一条）**：连续登录失败是否触发账户锁定 — 五字段未写策略，请确认是否在本次范围内。

**不生成**：「第 3 次失败锁定账户」「提示应为『用户名或密码错误』」等需具体次数/文案的测点（红线 0）。

## Walkthrough example (video config — granularity / Duration merge)

**五字段（节选）**：导出前可在视频配置面板设置 Duration 挡位 5s / 10s / 15s（默认 15s）与 Resolution；正常预期为导出视频时长与所选 Duration 一致；约束未写 4K 是否需要付费套餐。

**颗粒度**：Duration 三挡 → 一条列全值、不拆三条、不塞步骤 — 见 §5 **Granularity rules** 与 Good/Bad 示例。若五字段写明「4K 仅付费套餐可用」→ `4K` 与普通分辨率是**不同前置/预期** → 单独成条或进存疑（granularity §2 · do not merge）。

**样例测试点（草稿，节选）**：

**1. 导出与时长**

| 序号 | 标题 | 标签 |
|------|------|------|
| 1.1 | 选择各 Duration 挡位（5s/10s/15s，含默认 15s）后，导出视频时长应与所选挡位一致 | `正向` |

## Rules Index

Authoritative rules live in **Workflow**; this section is navigation only. On conflict: **红线 0** > closure 补行 > 宁少不宁多.

| Rule | Authority |
|------|-----------|
| **红线 0** — 防臆造 | §5 **红线 0** + step 4 closure |
| **Granularity** — outline vs A3 | §5 **Title rules & granularity** |
| **存疑清单** — format & discipline | §5 **存疑清单纪律**; presentation → §7 step 3 |
| **Coverage closure** (a)(b)(c) | §5 step 4 |
| **Self-critique** | §6 |
| **Presentation** — 分节、状态列 | §7 |
| **Draft totals** — SQA 只看归档后条数 | §7 · §9.5 · §9 read-back（禁草稿/归档前计数） |
| **Archive / confirm / receipt** | §9; UNKNOWN → §10 |
| **Cross-batch dedup** | §10 (`id` stubs); batch-internal → §5 step 3 + granularity §2 |
| **API** | `cawplan api` only; `references/CAWPLAN_OPEN_API.md` §15 |
| **Trigger boundary** | §1 priority 3 → A1; ticket URL without test-point intent → not this skill |
| **Failures** | §9 On failure; keep drafts |

## Output & Confirmation

- **Generate / revise (no archive)** → §6 then §7
- **Archive read-back + POST** → §9; UNKNOWN reconcile → §10

## References

- `references/CAWPLAN_OPEN_API.md`
- `references/coverage-dimensions.md`
- `references/review-checklist.md`
