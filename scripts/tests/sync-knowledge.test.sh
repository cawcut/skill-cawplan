#!/usr/bin/env bash
# Tests for scripts/sync-knowledge.sh against a stateful fake `cawplan` (fake-cawplan.sh).
# Run: bash scripts/tests/sync-knowledge.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYNC="$HERE/../sync-knowledge.sh"
FAILURES=0
CHECKS=0

ok() { CHECKS=$((CHECKS + 1)); }
fail() { CHECKS=$((CHECKS + 1)); FAILURES=$((FAILURES + 1)); echo "  FAIL: $1"; }
expect_eq() { if [[ "$2" == "$3" ]]; then ok; else fail "$1: expected [$3], got [$2]"; fi; }
expect_contains() { if grep -qF -- "$3" <<<"$2"; then ok; else fail "$1: expected to contain [$3]"; fi; }
expect_not_contains() { if grep -qF -- "$3" <<<"$2"; then fail "$1: must not contain [$3]"; else ok; fi; }
calls() { grep -c -- "$1" "$FAKE_DIR/calls.log" 2>/dev/null || true; }
reset_calls() { : > "$FAKE_DIR/calls.log"; }

# new_env: a fresh repo called "myrepo" (the repo name drives the dataset/module names) with a
# fake cawplan first on PATH.
new_env() {
  TMP="$(mktemp -d)"
  REPO="$TMP/myrepo"
  FAKE_DIR="$TMP/fake"
  mkdir -p "$REPO/scripts" "$FAKE_DIR" "$TMP/bin"
  cp "$SYNC" "$REPO/scripts/sync-knowledge.sh"
  cp "$HERE/fake-cawplan.sh" "$TMP/bin/cawplan"
  export FAKE_DIR
  export PATH="$TMP/bin:$ORIG_PATH"
  : > "$FAKE_DIR/calls.log"
  unset KNOWLEDGE_DATASET_PRODUCT_ID KNOWLEDGE_DATASET_NAME KNOWLEDGE_MODULE_NAME
}
ORIG_PATH="$PATH"
run_sync() { (cd "$REPO" && bash scripts/sync-knowledge.sh "$@" 2>&1); }
mod_id() { jq -r --arg path "$1" '
  . as $all
  | def find($parent; $names):
      if ($names | length) == 0 then $parent
      else ([$all[] | select((.parent_id // "") == $parent and .name == $names[0])][0].id // "") as $id
           | if $id == "" then "" else find($id; $names[1:]) end end;
  find(""; ($path | split("/")))' "$FAKE_DIR/modules.json"; }
doc_module() { jq -r --arg n "$1" --arg m "$2" '[.[] | select(.name == $n and (.module_id // "") == $m)] | length' "$FAKE_DIR/docs.json"; }
sample_repo() {
  mkdir -p "$REPO/docs/design" "$REPO/a/b/c/d/e/f"
  echo "# readme" > "$REPO/README.md"
  echo "# docs readme" > "$REPO/docs/README.md"
  echo "# a" > "$REPO/docs/a.md"
  echo "# b" > "$REPO/docs/design/b.md"
  echo "# deep" > "$REPO/a/b/c/d/e/f/deep.md"
}

echo "1. first sync with --product mirrors the directory tree as modules"
new_env; sample_repo
out="$(run_sync --product prod-1)"
expect_contains "dataset is created owned by the product" "$(cat "$FAKE_DIR/calls.log")" "datasets create --name myrepo --owner-product prod-1 --product prod-1"
expect_eq "one top-level module named after the repo" "$(jq -r '[.[] | select(.parent_id == null)] | map(.name) | join(",")' "$FAKE_DIR/modules.json")" "myrepo"
ROOT="$(mod_id myrepo)"; DOCS="$(mod_id myrepo/docs)"; DESIGN="$(mod_id myrepo/docs/design)"; DEEP="$(mod_id myrepo/a/b/c/d)"
expect_eq "docs is a sub-module of the repo module" "$(jq -r --arg id "$DOCS" '.[] | select(.id == $id) | .parent_id' "$FAKE_DIR/modules.json")" "$ROOT"
expect_eq "docs/design is a sub-module of docs" "$(jq -r --arg id "$DESIGN" '.[] | select(.id == $id) | .parent_id' "$FAKE_DIR/modules.json")" "$DOCS"
expect_eq "5 documents uploaded" "$(jq 'length' "$FAKE_DIR/docs.json")" "5"
expect_eq "README.md at the root is in the repo module" "$(doc_module README.md "$ROOT")" "1"
expect_eq "docs/README.md is in the docs module (same name, other module)" "$(doc_module README.md "$DOCS")" "1"
expect_eq "docs/design/b.md is in docs/design" "$(doc_module b.md "$DESIGN")" "1"
expect_eq "a directory deeper than 5 module levels is folded into its level-5 ancestor" "$(doc_module deep.md "$DEEP")" "1"
expect_eq "no module is deeper than 5 levels" "$(jq 'length' "$FAKE_DIR/modules.json")" "7"
expect_contains "says when a directory is folded" "$out" "NOTE   a/b/c/d/e/f/deep.md"
expect_eq "state keeps each document's module id" "$(jq -r '.files["docs/design/b.md"].module_id' "$REPO/.knowledge-sync-state.json")" "$DESIGN"
expect_eq "state keeps the module path" "$(jq -r '.files["docs/design/b.md"].module_path' "$REPO/.knowledge-sync-state.json")" "myrepo/docs/design"
expect_eq "state remembers the product" "$(jq -r '.product_id' "$REPO/.knowledge-sync-state.json")" "prod-1"
expect_contains "summary" "$out" "5 new, 0 updated, 0 moved, 0 unchanged, 0 failed"

echo "2. a second run with nothing changed only reads from the server"
reset_calls
out="$(run_sync)"
expect_eq "no upload" "$(calls 'documents upload')" "0"
expect_eq "no update" "$(calls 'documents update')" "0"
expect_eq "no set-module" "$(calls 'set-module')" "0"
expect_eq "no module created" "$(calls 'modules create')" "0"
expect_eq "fetched the module tree (product remembered from the state file)" "$(calls 'modules list --product prod-1')" "1"
expect_eq "fetched all documents" "$(calls 'documents list')" "1"
expect_contains "summary" "$out" "0 new, 0 updated, 0 moved, 5 unchanged, 0 failed"

echo "3. an edited file is the only one updated"
touch -t 203001010000 "$REPO/docs/a.md"
reset_calls
out="$(run_sync)"
expect_eq "one update" "$(calls 'documents update')" "1"
expect_contains "it is the edited file's document" "$(cat "$FAKE_DIR/calls.log")" "--text-file $REPO/docs/a.md"
expect_eq "no upload" "$(calls 'documents upload')" "0"
reset_calls
run_sync >/dev/null
expect_eq "unchanged afterwards" "$(calls 'documents update')" "0"

echo "4. a document moved on the server is moved back to its directory's module"
DOC_B="$(jq -r '[.[] | select(.name == "b.md")][0].id' "$FAKE_DIR/docs.json")"
jq --arg id "$DOC_B" --arg m "$ROOT" 'map(if .id == $id then .module_id = $m else . end)' "$FAKE_DIR/docs.json" > "$TMP/d.json" && mv "$TMP/d.json" "$FAKE_DIR/docs.json"
reset_calls
out="$(run_sync)"
expect_contains "reports the move" "$out" "MOVE   docs/design/b.md -> myrepo/docs/design"
expect_contains "uses set-module with the right module" "$(cat "$FAKE_DIR/calls.log")" "documents set-module --dataset ds-1 --document $DOC_B --module $DESIGN"
expect_eq "server module corrected" "$(jq -r --arg id "$DOC_B" '.[] | select(.id == $id) | .module_id' "$FAKE_DIR/docs.json")" "$DESIGN"
expect_eq "nothing re-uploaded" "$(calls 'documents upload')" "0"

echo "5. a document deleted on the server is uploaded again"
jq --arg id "$DOC_B" 'map(select(.id != $id))' "$FAKE_DIR/docs.json" > "$TMP/d.json" && mv "$TMP/d.json" "$FAKE_DIR/docs.json"
reset_calls
out="$(run_sync)"
expect_contains "reports it" "$out" "GONE   docs/design/b.md"
expect_eq "one upload" "$(calls 'documents upload')" "1"
expect_contains "uploaded into its module" "$(cat "$FAKE_DIR/calls.log")" "--module $DESIGN"
expect_eq "state points at the new document" "$(jq -r '.files["docs/design/b.md"].document_id' "$REPO/.knowledge-sync-state.json")" "$(jq -r '[.[] | select(.name == "b.md")][0].id' "$FAKE_DIR/docs.json")"

echo "6. a lost state file adopts the documents already on the server"
rm "$REPO/.knowledge-sync-state.json"
reset_calls
out="$(run_sync --product prod-1)"
expect_eq "nothing uploaded again" "$(calls 'documents upload')" "0"
expect_eq "no module created again" "$(calls 'modules create')" "0"
expect_eq "every document re-synced" "$(calls 'documents update')" "5"
expect_eq "still 5 documents" "$(jq 'length' "$FAKE_DIR/docs.json")" "5"
expect_contains "adoption is reported" "$out" "ADOPT  docs/README.md"
expect_eq "each README.md keeps its own document" "$(jq -r '.files["README.md"].document_id == .files["docs/README.md"].document_id' "$REPO/.knowledge-sync-state.json")" "false"

echo "7. without a product the dataset is synced flat"
new_env
mkdir -p "$REPO/docs"; echo "# r" > "$REPO/README.md"; echo "# a" > "$REPO/docs/a.md"
out="$(run_sync)"
expect_contains "says it is flat" "$out" "Product: none"
expect_eq "no module calls" "$(calls 'modules')" "0"
expect_not_contains "uploads carry no module" "$(cat "$FAKE_DIR/calls.log")" "--module"
expect_eq "2 documents" "$(jq 'length' "$FAKE_DIR/docs.json")" "2"

echo "8. --dry-run changes nothing"
new_env; sample_repo
out="$(run_sync --product prod-1 --dry-run)"
expect_contains "plans the modules" "$out" "[dry-run] would create module \"myrepo/docs/design\""
expect_contains "plans the uploads" "$out" "NEW    docs/design/b.md  [myrepo/docs/design]"
expect_contains "summary" "$out" "[dry-run] would sync: 5 new"
expect_eq "no dataset created" "$(calls 'datasets create')" "0"
expect_eq "no upload" "$(calls 'documents upload')" "0"
expect_eq "no module created" "$(calls 'modules create')" "0"
expect_eq "no state file written" "$([[ -f "$REPO/.knowledge-sync-state.json" ]] && echo yes || echo no)" "no"

echo "9. a dataset the product doesn't own fails clearly"
new_env; mkdir -p "$REPO/docs"; echo "# a" > "$REPO/docs/a.md"
echo '[{"id":"ds-9","name":"myrepo","owner":""}]' > "$FAKE_DIR/datasets.json"
out="$(run_sync --product prod-1)"; code=$?
expect_contains "explains why" "$out" "is not owned by product prod-1"
(cd "$REPO" && bash scripts/sync-knowledge.sh --product prod-1 >/dev/null 2>&1); expect_eq "non-zero exit" "$([[ $? -ne 0 ]] && echo failed || echo ok)" "failed"

echo "10. every page of the server's documents is fetched"
new_env; mkdir -p "$REPO"; echo "# only" > "$REPO/only.md"
echo '[{"id":"ds-1","name":"myrepo","owner":"prod-1"}]' > "$FAKE_DIR/datasets.json"
jq -nc '[range(0; 250) | {id: ("old-\(.)"), dataset: "ds-1", name: ("old-\(.).md"), module_id: null}]' > "$FAKE_DIR/docs.json"
out="$(run_sync --product prod-1)"
expect_eq "3 pages of 100" "$(calls 'documents list')" "3"
expect_contains "sees all of them" "$out" "Server: 250 document(s)"

echo "11. KNOWLEDGE_DATASET_PRODUCT_ID and KNOWLEDGE_MODULE_NAME are honoured"
new_env; mkdir -p "$REPO"; echo "# r" > "$REPO/README.md"
out="$(cd "$REPO" && KNOWLEDGE_DATASET_PRODUCT_ID=prod-7 KNOWLEDGE_MODULE_NAME="Custom Root" bash scripts/sync-knowledge.sh 2>&1)"
expect_contains "owner from the env var" "$(cat "$FAKE_DIR/calls.log")" "--owner-product prod-7"
expect_contains "custom root module" "$(cat "$FAKE_DIR/calls.log")" "modules create --product prod-7 --name Custom Root"

echo ""
if [[ "$FAILURES" -gt 0 ]]; then
  echo "$FAILURES of $CHECKS checks FAILED"
  exit 1
fi
echo "all $CHECKS checks passed"
