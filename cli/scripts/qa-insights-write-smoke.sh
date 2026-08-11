#!/usr/bin/env bash
#
# QA Insights write-command smoke test — MANUAL, LOCAL ONLY.
#
#   Requires: cawplan auth login before running.
#   Scope:    ONLY the test product below. Never point this at another product.
#   CI:       This script must NOT be wired into GitHub Actions (OQ#7).
#
# WARNING — this script WRITES to the test product and leaves data behind:
#   * Step 3 deliberately creates a DUPLICATE requirement to prove that
#     `requirements create` does not de-duplicate on its own (that is the
#     skill's Table B decision, not a CLI guard). This is intended behaviour.
#   * The Open API exposes NO DELETE for requirements, module tree nodes, or
#     test points, so nothing here can be cleaned up programmatically.
#   * Every run therefore ACCUMULATES rows. Periodic manual cleanup via the
#     Test Suites UI is expected.
#   * All created rows are prefixed with [SMOKE-<UTC timestamp>] so they can be
#     identified and grepped later.
#
set -uo pipefail

PRODUCT_ID="019fb1ff-d547-741f-bfa2-405386d04d5b"
STAMP="$(date -u +%Y%m%dT%H%M)"
PREFIX="[SMOKE-${STAMP}]"
# CAWPLAN_BIN may be a bare binary name or a multi-word command such as
# "node /path/to/dist/index.js" (useful for testing a local build before it is
# installed globally), so it is expanded as an array rather than a single word.
read -r -a CAWPLAN <<< "${CAWPLAN_BIN:-cawplan}"

PASS=0
FAIL=0
WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

note() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

# Assert the JSON on stdin carries the expected `outcome`.
check_outcome() {
  local label="$1" expected="$2" output="$3"
  local actual
  actual="$(printf '%s' "${output}" | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin).get("outcome", "<no outcome>"))
except Exception:
    print("<unparseable>")' 2>/dev/null)"

  if [ "${actual}" = "${expected}" ]; then
    printf '  \033[32mPASS\033[0m %-52s outcome=%s\n' "${label}" "${actual}"
    PASS=$((PASS + 1))
  else
    printf '  \033[31mFAIL\033[0m %-52s expected=%s actual=%s\n' "${label}" "${expected}" "${actual}"
    printf '       %s\n' "${output}" | head -20
    FAIL=$((FAIL + 1))
  fi
}

json_field() {
  printf '%s' "$2" | python3 -c "import json,sys
d=json.load(sys.stdin)
for k in '$1'.split('.'):
    d = d.get(k) if isinstance(d, dict) else None
print(d if d is not None else '')" 2>/dev/null
}

qa() { "${CAWPLAN[@]}" qa-insights "$@" 2>&1; }

cat <<BANNER
QA Insights write smoke test
  product : ${PRODUCT_ID}
  prefix  : ${PREFIX}
  NOTE    : this WRITES real rows that cannot be deleted via the API.
BANNER

# --- 1. module tree node -----------------------------------------------------
note "1. module-tree node create"
OUT="$(qa module-tree node create "${PRODUCT_ID}" --name "${PREFIX} 冒烟节点")"
check_outcome "module-tree node create" "SUCCESS" "${OUT}"
NODE_ID="$(json_field 'api.data.id' "${OUT}")"
if [ -z "${NODE_ID}" ]; then
  echo "  cannot continue without a module tree node id" >&2
  exit 1
fi
echo "  node_id = ${NODE_ID}"

# --- 2. requirement create ---------------------------------------------------
note "2. requirements create (fresh five fields)"
cat > "${WORKDIR}/create.json" <<JSON
{
  "module_tree_node_id": "${NODE_ID}",
  "function_description": "${PREFIX} 冒烟功能描述",
  "entry_trigger": "${PREFIX} 冒烟入口",
  "normal_expectation": "${PREFIX} 冒烟正常预期",
  "constraints": "${PREFIX} 冒烟约束",
  "out_of_scope": "（素材未提及）",
  "summary": "${PREFIX} 冒烟摘要"
}
JSON
OUT="$(qa requirements create "${PRODUCT_ID}" --body-file "${WORKDIR}/create.json")"
check_outcome "requirements create" "SUCCESS" "${OUT}"
REQ_ID="$(json_field 'api.data.id' "${OUT}")"
echo "  requirement_id = ${REQ_ID}"

# --- 3. duplicate create (INTENTIONAL) ---------------------------------------
note "3. requirements create again, same five fields (P1 — no CLI dedup)"
echo "  NOTE: this intentionally creates a duplicate row and leaves it behind."
OUT="$(qa requirements create "${PRODUCT_ID}" --body-file "${WORKDIR}/create.json")"
check_outcome "duplicate create still POSTs" "SUCCESS" "${OUT}"

# --- 4. reconcile: multiple strong matches (P13) ------------------------------
note "4. requirements reconcile (P2/P13 — two identical rows now exist)"
python3 - "${WORKDIR}/create.json" "${WORKDIR}/probe.json" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
body = json.load(open(src))
probe = {k: body[k] for k in (
    "function_description", "entry_trigger",
    "normal_expectation", "constraints", "out_of_scope")}
json.dump(probe, open(dst, "w"), ensure_ascii=False)
PY
OUT="$(qa requirements reconcile "${PRODUCT_ID}" \
  --module-tree-node-id "${NODE_ID}" --probe-file "${WORKDIR}/probe.json")"
# Steps 2 and 3 created two identical rows, so Table A row 2 applies:
# list every id and let SQA choose — the CLI must not auto-bind.
check_outcome "reconcile finds multiple matches" "FAILURE" "${OUT}"
echo "  decision = $(json_field 'reconcile.decision' "${OUT}")"
echo "  matched  = $(printf '%s' "${OUT}" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("reconcile",{}).get("matched_requirement_ids"))' 2>/dev/null)"

# --- 5. requirements update (P4) ---------------------------------------------
note "5. requirements update (P4 — summary only)"
cp "${WORKDIR}/create.json" "${WORKDIR}/snapshot.json"
python3 - "${WORKDIR}/create.json" "${WORKDIR}/desired.json" "${PREFIX}" <<'PY'
import json, sys
body = json.load(open(sys.argv[1]))
body["summary"] = f"{sys.argv[3]} 冒烟摘要（已更新）"
json.dump(body, open(sys.argv[2], "w"), ensure_ascii=False)
PY
OUT="$(qa requirements update "${PRODUCT_ID}" "${REQ_ID}" \
  --desired-file "${WORKDIR}/desired.json" --snapshot-file "${WORKDIR}/snapshot.json")"
check_outcome "update patches changed keys only" "SUCCESS" "${OUT}"
echo "  patch_body = $(printf '%s' "${OUT}" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin).get("patch_body"), ensure_ascii=False))' 2>/dev/null)"

# --- 6. update with no changes → NOOP ----------------------------------------
note "6. requirements update with an identical snapshot (NOOP)"
OUT="$(qa requirements update "${PRODUCT_ID}" "${REQ_ID}" \
  --desired-file "${WORKDIR}/snapshot.json" --snapshot-file "${WORKDIR}/snapshot.json")"
check_outcome "empty diff yields NOOP" "NOOP" "${OUT}"

# --- 7. testpoints archive (P7) ----------------------------------------------
note "7. testpoints archive (P7 — 3 rows)"
cat > "${WORKDIR}/batch.json" <<JSON
{"test_points":[
  {"title":"${PREFIX} 冒烟测试点 1","tags":["冒烟"],"group":"${PREFIX} 分组","is_edited":false},
  {"title":"${PREFIX} 冒烟测试点 2","tags":[],"group":"${PREFIX} 分组","is_edited":false},
  {"title":"${PREFIX} 冒烟测试点 3","tags":["边界"],"group":"","is_edited":true}
]}
JSON
OUT="$(qa testpoints archive "${PRODUCT_ID}" "${REQ_ID}" --body-file "${WORKDIR}/batch.json")"
check_outcome "batch archive of 3" "SUCCESS" "${OUT}"

# --- 8. testpoints reconcile (P8) --------------------------------------------
note "8. testpoints reconcile (P8 — baseline 0, batch 3, now 3)"
OUT="$(qa testpoints reconcile "${PRODUCT_ID}" "${REQ_ID}" --count-before 0 --batch-size 3)"
check_outcome "count reconcile 0 + 3 = 3" "RECONCILED" "${OUT}"

note "8b. testpoints reconcile with a wrong baseline (count_unexpected)"
OUT="$(qa testpoints reconcile "${PRODUCT_ID}" "${REQ_ID}" --count-before 0 --batch-size 99)"
check_outcome "mismatched count is flagged" "FAILURE" "${OUT}"
echo "  decision = $(json_field 'reconcile.decision' "${OUT}")"

# --- 9. forbidden field (P6) — must not reach the network --------------------
note "9. forbidden product_id in body (P6 — validation, no HTTP)"
python3 - "${WORKDIR}/create.json" "${WORKDIR}/bad.json" "${PRODUCT_ID}" <<'PY'
import json, sys
body = json.load(open(sys.argv[1]))
body["product_id"] = sys.argv[3]
json.dump(body, open(sys.argv[2], "w"), ensure_ascii=False)
PY
OUT="$(qa requirements create "${PRODUCT_ID}" --body-file "${WORKDIR}/bad.json")"
check_outcome "forbidden product_id rejected" "FAILURE" "${OUT}"
echo "  error.type = $(json_field 'error.type' "${OUT}")"

# --- 10. dry run — must write nothing ----------------------------------------
note "10. --dry-run (writes nothing)"
OUT="$(qa requirements create "${PRODUCT_ID}" --body-file "${WORKDIR}/create.json" --dry-run)"
check_outcome "dry-run previews without writing" "SUCCESS" "${OUT}"
echo "  dry_run = $(json_field 'meta.dry_run' "${OUT}")"

# --- summary -----------------------------------------------------------------
printf '\n\033[1m== Summary ==\033[0m\n  passed: %d\n  failed: %d\n' "${PASS}" "${FAIL}"
cat <<FOOTER

Leftover data (cannot be deleted via the Open API — clean up manually):
  module tree node : ${NODE_ID}
  requirement      : ${REQ_ID}  (plus one intentional duplicate from step 3)
  test points      : 3 rows under the requirement above
  grep prefix      : ${PREFIX}
FOOTER

[ "${FAIL}" -eq 0 ]
