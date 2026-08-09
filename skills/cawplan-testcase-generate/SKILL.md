---
version: 0.2.6
name: cawplan-testcase-generate
description: |
  Expand archived test points under a CawPlan Requirement into executable test cases and export a team CSV file (read-only — does not write to CawPlan).
  Use when: generating or expanding test cases with executable steps, exporting CSV test cases, or hot handoff after A2 ("按上面的生成用例", "generate test cases from above", or similar); cold handoff via Requirement portal link or requirement_id.
  NOT for: test-point coverage outlines (use `cawplan-testpoint-generate`); requirement analysis or archiving (use `cawplan-requirement-analyze`); viewing or editing archived test points in Test Suites (web UI); unarchived five-field drafts only (archive via A1 first).
argument-hint: "[Requirement portal link or requirement_id, or '按上面的生成用例' / 'generate test cases from above']"
allowed-tools: Bash
---

# CawPlan TestCase Generate

## Bootstrap

```bash
cawplan skill check
```

## 红线 0 — 防臆造（最高优先级，压过一切展开与导出）

- 用例 Title / Preconditions / Step / Expected 里的**具体值**（次数、阈值、错误码、提示文案）**只能来自测试点或五字段**。
- 源里没有 → 方向占位或 **(甲) 诚实带尾巴**（如「应提示密码长度不符(具体文案以实现为准)」），**绝不落成硬值**。
- 四法只建议取哪一类值、铺哪几步；细则见 `references/test-design-methods.md`，但红线 0 不可外包给 reference。

## Workflow

### 1. Resolve target Requirement (entry priority)

On each **generate test cases** request, pick the active target in this order:

| Priority | Condition | Action |
|----------|-----------|--------|
| 1 | This message has an explicit reference (portal URL / `requirement_id` / switch to another Requirement) | **Cold handoff** — rebind; ignore prior session binding |
| 2 | No explicit reference; user says **「按上面的生成用例」** / **"generate test cases from above"** / **"expand the test points above"** / **「接着生成用例」** / **「把上面的展开成用例」** (same intent as SPEC hot handoff) | **Hot handoff** — use current session binding (`product_id` + `requirement_id` + test points if present) |
| 3 | No binding; only an unarchived A1 five-field draft | **Stop** — tell SQA to archive via `cawplan-requirement-analyze` first |

**Hot handoff — unarchived branch (current version; §4.9 draft bypass not supported)**:

If context has test-point drafts or a table but **no valid `requirement_id`** (Requirement not archived) → **stop immediately**:

> 当前版本需先归档 Requirement 才能展开用例，请先归档。

**Do not** fall through to cold GET (would return empty and mislead SQA toward A2). Unarchived fast-path is **not** supported in this release.

**Trigger routing** (when intent is ambiguous):

| User wants | Route to |
|------------|----------|
| 测试点大纲 / 覆盖面 / 「生成测试点」 | **A2** `cawplan-testpoint-generate` |
| 分析需求 / 五字段 / 归档 Requirement | **A1** `cawplan-requirement-analyze` |
| 可执行步骤 / 导出 CSV 用例 / 按上面的生成用例 | **A3** (this skill) |

**Anti-confusion**:

- **Object unclear** ("生成用例" with no Requirement in message or context) → ask which Requirement (id or portal link). Missing `product_id` → ask; **do not** scan product lists.
- **Draft already exists** + vague "生成用例" again → stop and ask: **重新生成** or **在现有基础上调整/展开?** (prevent overwriting SQA-edited draft).
- A3 **never** invents new coverage surfaces — gaps go to 存疑清单, suggest back to **A2**.

**Portal URL** (parse only — never fetch):

`/product/{product_id}/qa-insights/test-suites/requirements/{requirement_id}`

- Extract `product_id` + `requirement_id` from the string only.
- **Forbidden**: `cawplan api GET {url}`, HTTP fetch, or any request to the portal path.

**Only `requirement_id`, missing `product_id`**: ask for `product_id` or a full portal link.

**Rebind** replaces whole context. One active Requirement at a time.

### 2. Refresh before expand (always)

Before expanding (cold **or** hot), pull live data — **library is source of truth**:

```bash
cawplan qa-insights requirements get <product_id> <requirement_id>
```

On `outcome: SUCCESS`, use envelope `data` for five fields + `module_tree_node_id` + metadata (`url`, etc.).

```bash
cawplan qa-insights testpoints list <product_id> <requirement_id>
```

On `outcome: SUCCESS`, use `data.test_points[]` in `sort_order`. Map each row: `id` → `TestPointId`, `title` → `TestPointTitle`, `tags[]` → Tag (`/` join if multiple), `group` → Group.

| Result | Action |
|--------|--------|
| Requirement found (`outcome: SUCCESS`) | Use latest five fields silently |
| Requirement missing (`error.type: not_found`, often `status: 404`) | Report honestly; do not expand from stale chat |
| Read fails (`outcome: FAILURE` or `UNKNOWN`) | Report error; **no fake success, no blind retry, no guessing** |

**Five-field drift**: if refresh shows five fields (especially `constraints`) changed since test points were written → one light 存疑 line before expand; do not expand silently.

### 3. Hard stop (after refresh, before expand)

| Condition | Action |
|-----------|--------|
| `test_points.length === 0` | **Stop** — "该 Requirement 尚无测试点，请先用 A2 生成测试点". Do not invent cases. |
| No valid `requirement_id` / not archived | **Stop** — "请先在 A1 归档成 Requirement 再来展开用例" |

### 4. Read references (on demand — do not inline into SKILL)

| When | Read (in this skill's directory) |
|------|----------------------------------|
| Before expanding each test point | `references/test-design-methods.md` — EP/BVA/ST/EG toolbox |
| Before writing Title / Preconditions / Step / Expected; when inferring Priority (P0–P3) | `references/testcase-writing-spec.md` — field rules, split/merge, priority 升降 |
| Before export | `references/csv-template-mapping.md` — 12 columns, cross-row, escape |
| Column layout truth source | `assets/testcase-template.csv` |

### 5. Expand test cases

**Expansion boundary (first rule)**:

- Four methods expand **only on archived test points** — do not invent coverage.
- Missing surface with no parent test point → **存疑 only**: "此面无测试点覆盖，建议回 A2 补一条后刷新重展开." **No orphan cases.**
- Every exported case must have non-empty `testPointId` under the **archived main path** (see §7).

**One test point → N cases**: split when **expected response differs**; merge when same response, different data only — see `references/testcase-writing-spec.md`. Do not skip values listed in A2 titles.

**Three-tier output rhythm**:

| Tier | Case-level columns | Detail columns (Preconditions / Step / Expected) | Trigger |
|------|-------------------|--------------------------------------------------|---------|
| **Title only** | filled | **empty** | Default first pass — say "生成测试用例" |
| **Partial** | filled | filled for named cases only | "先展开这 1–3 条" |
| **Full** | filled | all filled | "全部展开" |

- Default: produce **title-only CSV immediately** — do **not** paste a markdown case table in chat first.
- Detail three columns are **always generated together** per case (all or none).
- Large Requirement → proactively offer batches ("建议分批，先展开 1–20 条?").

**Priority**: infer P0–P3 per `references/testcase-writing-spec.md` (升降规则); script maps to Critical/High/Medium/Low on export.

**存疑 format** (align A2): 〔指向哪〕+〔为什么疑〕+〔建议动作〕. Say "无" if none.

### 6. Pre-export self-review (internal — do not show SQA a checklist)

1. Per `references/testcase-writing-spec.md` — would merging reduce duplicate verification goals?
2. Every case has non-empty `testPointId` (archived path); no orphan coverage → 存疑 back to A2, do not export orphans.

### 7. Confirm before writing files

| Action | Confirm? |
|--------|----------|
| First **title-only** CSV | **No** — nothing to overwrite yet |
| **Expand steps** (title → partial/full) | **Yes** — "本次将为这 N 条用例展开步骤，确认?" |
| **Regenerate entire set** | **Yes** — prevent overwriting SQA edits |
| Delete / retitle / SQA-directed tweak → re-export | **No** — SQA initiated |

### 8. Export via script (mandatory — no AI-written CSV)

AI produces finalized **interim JSON**; script lays out cells only — **no improvisation, no inline CSV text, no ad-hoc export code**.

**Interim JSON contract** (`{ requirementTitle, cases: [...] }`):

| Field | Notes |
|-------|-------|
| `requirementTitle` | For filename (`<title>_<timestamp>.csv`) |
| `title` | Case title |
| `priority` | P0–P3 (or English — script maps) |
| `tag`, `group`, `testPointTitle` | Inherit from parent test point |
| `testPointId`, `requirementId` | From GET — **required under archived main path** |
| `moduleTreeNodeId` | From GET five fields; empty + 存疑 if missing |
| `preconditions` | string or string[]; title-only tier → omit or empty |
| `steps[]`, `expected[]` | **Equal length**; title-only → both `[]` |

**Script hard gates** (archived main path): empty `testPointId` / `requirementId` / `title` → fail; `steps.length !== expected.length` → fail.

```bash
# Ephemeral path — timestamp avoids $$ cross-invocation collisions; run all three lines in one shell
TMP_JSON="/tmp/a3_export_$(date +%Y%m%d_%H%M%S)_$RANDOM.json"

cat > "$TMP_JSON" <<'EOF'
{ "requirementTitle": "...", "cases": [ ... ] }
EOF

node scripts/export_to_csv.js "$TMP_JSON" -o testcases   # zero npm deps; run from this skill directory

rm -f "$TMP_JSON"
```

- Default output dir: `testcases/` under cwd; override with `-o <dir>` when SQA specifies.
- On script failure → report stderr honestly; fix JSON upstream, retry.
- **Forbidden**: writing CSV by hand in chat or generating one-off Python/JS export snippets.

### 9. Present (thin summary only)

After export, reply with **only**:

1. Requirement display name + **exported file path** (from script stdout `已导出: ...`)
2. Group-level counts (e.g. "3 组 / 12 条")
3. 存疑清单 (if any)

**Forbidden in chat**: pasting case titles, steps, or expected results (CSV is the single source; prevents context blow-up).

## Session state (in-conversation only)

- **Binding**: `product_id`, `requirement_id`, latest five fields, `module_tree_node_id`, test-point rows from GET.
- **Draft**: in-memory `cases[]` for the current working set — adjust in chat → **re-export full CSV** (no diff).
- **No disk state**: no `.memory`, no retained interim JSON, no cross-session cache. Interim JSON in `/tmp/` is deleted after export.

**Out of scope (v1)**: offline CSV edit round-trip (路 B); no `is_edited`; A3 never POST/PATCH CawPlan.

## Walkthrough (title-only → expand → export)

**Setup**: Requirement archived; A2 has test point `1.1` "错误账号或密码登录应失败并给出明确提示" (`异常`, group `登录校验`). After refresh GET, expand to cases.

**Step A — "生成测试用例"** → title-only CSV (no confirm). Interim JSON (illustrative):

```json
{
  "requirementTitle": "账号密码登录",
  "cases": [
    {
      "title": "错误账号或密码点击 Sign In 应失败并给出明确提示",
      "priority": "P1",
      "tag": "异常",
      "group": "登录校验",
      "testPointTitle": "错误账号或密码登录应失败并给出明确提示",
      "testPointId": "019fd7aa-0000-0000-0000-000000000002",
      "requirementId": "019fd634-8ffd-7d62-b46e-32f8132b4520",
      "moduleTreeNodeId": "019fd633-47c8-7be0-a7c5-1ea1179c7195",
      "steps": [],
      "expected": []
    }
  ]
}
```

Run §8 export → present path + "1 组 / 1 条" + 存疑 if any.

**Step B — SQA: "展开步骤"** → confirm: "本次将为这 1 条用例展开步骤，确认?" → on yes, fill detail columns and re-export.

输入与点击同属铺垫、验证点只在登录结果 — **不为拆而拆**，合并为一步一预期（见 `references/testcase-writing-spec.md` Step/Expected 拆分判据）。Expanded fragment:

```json
{
  "title": "错误账号或密码点击 Sign In 应失败并给出明确提示",
  "priority": "P1",
  "tag": "异常",
  "group": "登录校验",
  "testPointTitle": "错误账号或密码登录应失败并给出明确提示",
  "testPointId": "019fd7aa-0000-0000-0000-000000000002",
  "requirementId": "019fd634-8ffd-7d62-b46e-32f8132b4520",
  "moduleTreeNodeId": "019fd633-47c8-7be0-a7c5-1ea1179c7195",
  "preconditions": "1. 当前处于未登录状态",
  "steps": [
    "在登录页输入错误账号或密码并点击 Sign In 按钮"
  ],
  "expected": [
    "登录失败，停留登录页并提示账号或密码错误(具体文案以实现为准)"
  ]
}
```

Column layout: see `assets/testcase-template.csv`.

## Output & Confirmation

- **Title-only first pass** → §5 + §8 + §9 (no confirm)
- **Expand / regenerate** → §7 confirm → §5 detail → §6 → §8 → §9
- **Failures** → §2 honest error; keep in-memory draft if safe

## References

- `references/CAWPLAN_OPEN_API.md` — Requirement / TestPoints field shapes (§15); CLI reads via `cawplan qa-insights requirements get` / `testpoints list`
- `references/test-design-methods.md`
- `references/testcase-writing-spec.md`
- `references/csv-template-mapping.md`
