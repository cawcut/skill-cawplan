#!/usr/bin/env bash
# A stateful stand-in for the `cawplan` CLI, used by sync-knowledge.test.sh. It models just
# enough of the knowledge API: datasets (with an owner product), the product module tree, and
# documents (name, module). State lives in $FAKE_DIR/*.json; every call is logged to calls.log.
set -euo pipefail
D="${FAKE_DIR:?FAKE_DIR is required}"
[[ -f "$D/datasets.json" ]] || echo '[]' > "$D/datasets.json"
[[ -f "$D/modules.json" ]] || echo '[]' > "$D/modules.json"
[[ -f "$D/docs.json" ]] || echo '[]' > "$D/docs.json"
echo "$*" >> "$D/calls.log"

next_id() { local n; n="$(cat "$D/counter" 2>/dev/null || echo 0)"; n=$((n + 1)); echo "$n" > "$D/counter"; echo "$1-$n"; }
arg() { # arg --name "$@" -> value of a flag
  local flag="$1"; shift
  while [[ $# -gt 0 ]]; do [[ "$1" == "$flag" ]] && { echo "${2:-}"; return; }; shift; done
}
has() { local flag="$1"; shift; for a in "$@"; do [[ "$a" == "$flag" ]] && return 0; done; return 1; }
upd() { local f="$1"; shift; local t; t="$(mktemp)"; jq "$@" "$f" > "$t" && mv "$t" "$f"; }

[[ "$1" == "knowledge" ]] || { echo "fake cawplan: unsupported: $*" >&2; exit 2; }
shift
case "$1 $2" in
  "datasets list")
    jq -c '{code:"SUCCESS", data:{datasets: map({id,name,document_count:0})}, msg:"success"}' "$D/datasets.json" ;;
  "datasets create")
    shift 2
    id="$(next_id ds)"
    owner="$(arg --owner-product "$@")"
    upd "$D/datasets.json" --arg id "$id" --arg n "$(arg --name "$@")" --arg o "$owner" '. + [{id:$id,name:$n,owner:$o}]'
    jq -nc --arg id "$id" '{code:"SUCCESS", data:{id:$id}, msg:"success"}' ;;
  "modules list")
    jq -c '{code:"SUCCESS", data:., msg:"success"}' "$D/modules.json" ;;
  "modules create")
    shift 2
    id="$(next_id mod)"
    parent="$(arg --parent "$@")"
    upd "$D/modules.json" --arg id "$id" --arg n "$(arg --name "$@")" --arg p "$parent" \
      '. + [{id:$id,name:$n,parent_id:(if $p=="" then null else $p end)}]'
    jq -nc --arg id "$id" '{code:"SUCCESS", data:{id:$id}, msg:"success"}' ;;
  "documents list")
    shift 2
    page="$(arg --page "$@")"; limit="$(arg --limit "$@")"
    ds="$(arg --dataset "$@")"
    jq -c --argjson page "${page:-1}" --argjson limit "${limit:-20}" --arg ds "$ds" \
      '[.[] | select(.dataset == $ds)] as $all
       | {code:"SUCCESS", data:{data: $all[($page-1)*$limit : $page*$limit], has_more: ($all|length) > $page*$limit, total: ($all|length)}, msg:"success"}' "$D/docs.json" ;;
  "documents upload")
    shift 2
    file="$(arg --file "$@")"; ds="$(arg --dataset "$@")"; module="$(arg --module "$@")"
    name="$(basename "$file")"
    owner="$(jq -r --arg ds "$ds" '.[] | select(.id==$ds) | .owner' "$D/datasets.json")"
    if [[ -n "$module" && -z "$owner" ]]; then
      jq -nc '{code:"SUCCESS", data:{results:[{code:"BAD_REQUEST", msg:"module_id requires a dataset owned by a product"}]}, msg:"success"}'
      exit 0
    fi
    if ! has --force "$@" && [[ -n "$(jq -r --arg ds "$ds" --arg n "$name" '.[] | select(.dataset==$ds and .name==$n) | .id' "$D/docs.json")" ]]; then
      jq -nc '{code:"SUCCESS", data:{results:[{code:"SKIPPED_DUPLICATE"}]}, msg:"success"}'
      exit 0
    fi
    id="$(next_id doc)"
    upd "$D/docs.json" --arg id "$id" --arg ds "$ds" --arg n "$name" --arg m "$module" \
      '. + [{id:$id,dataset:$ds,name:$n,module_id:(if $m=="" then null else $m end)}]'
    jq -nc --arg id "$id" '{code:"SUCCESS", data:{results:[{code:"SUCCESS", document_id:$id, status:"succeeded"}]}, msg:"success"}' ;;
  "documents update")
    jq -nc '{code:"SUCCESS", data:{}, msg:"success"}' ;;
  "documents set-module")
    shift 2
    doc="$(arg --document "$@")"; module="$(arg --module "$@")"
    upd "$D/docs.json" --arg id "$doc" --arg m "$module" '[.[] | if .id==$id then .module_id=(if $m=="" then null else $m end) else . end]'
    jq -nc '{code:"SUCCESS", data:{}, msg:"success"}' ;;
  *) echo "fake cawplan: unsupported: $*" >&2; exit 2 ;;
esac
