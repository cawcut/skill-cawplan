#!/usr/bin/env bash
# Syncs every Markdown file in this repo into one CawPlan knowledge dataset named after the repo
# (override with KNOWLEDGE_DATASET_NAME), via the `cawplan` CLI, keeping the repo's directory
# structure as a product module tree.
#
# Product / modules
# - Pass the CawPlan product with --product <id> (or KNOWLEDGE_DATASET_PRODUCT_ID; see:
#   cawplan products list). A new dataset is then created OWNED by that product
#   (`datasets create --owner-product`, which is what lets its documents live in the product's
#   modules) and also linked to it (`--product`) so it stays scoped for product-scoped search.
#   The product id is remembered in the state file, so later runs don't need it again.
# - With a product, the repo is mirrored as a module tree under it: a top-level module named
#   after the repo (override with KNOWLEDGE_MODULE_NAME), one sub-module per directory, and every
#   document is created under the module of its directory (files at the repo root go in the repo
#   module). Missing modules are created, existing ones (same name under the same parent) are
#   reused. The module tree is at most 5 levels deep, so directories nested deeper than the repo
#   module + 4 levels are folded into their level-5 ancestor.
# - Without a product the dataset is synced flat (no modules), as before.
# - Pass -i / --interactive to pick the product from a menu when the dataset doesn't exist yet
#   (the picked product becomes the owner and is also linked). Only that one
#   `cawplan ... create -i` call runs uncaptured (the CLI's picker needs a real terminal); every
#   other call stays capturable/scriptable.
#
# Every run
# 1. Resolves the dataset, then fetches ALL of its documents (and, with a product, the whole
#    module tree) from the server.
# 2. Compares each local file with what the server has and only then changes anything:
#    - no document yet             -> upload (NEW), created under its module
#    - document gone on the server -> upload again (NEW)
#    - same name + module already on the server but not in the state file -> adopt and re-sync it
#    - module differs from the directory's module -> `documents set-module` (MOVE)
#    - mtime advanced past the last sync -> `documents update` (EDIT)
#    - otherwise skipped
# - Deletions are NOT handled: removing a local .md file does not delete or archive its knowledge
#   document (or empty module). Handle that manually if a doc is retired.
#
# State is tracked in .knowledge-sync-state.json at the repo root: dataset_id, product_id and
# files (path -> {document_id, synced_mtime, module_id, module_path}). Commit this file so the
# mapping is shared across contributors and CI runs, instead of re-uploading duplicates. The
# server stays the source of truth for module ids: they are re-checked on every run.
#
# Requires: cawplan CLI (with `modules` / `documents set-module` support — see
# flow-cawplan-skill/cli), jq. Works with the bash 3.2 that ships with macOS.
#
# Usage:
#   scripts/sync-knowledge.sh --product <id>                          # sync into the product's module tree
#   scripts/sync-knowledge.sh                                         # sync (product remembered in the state file; flat if none)
#   scripts/sync-knowledge.sh --dry-run                               # show what would happen, without changing anything
#   scripts/sync-knowledge.sh -i                                      # first-time create: pick the owner product from a menu
#   KNOWLEDGE_DATASET_PRODUCT_ID=<id> scripts/sync-knowledge.sh        # same as --product <id>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_NAME="$(basename "$REPO_ROOT")"
DATASET_NAME="${KNOWLEDGE_DATASET_NAME:-$REPO_NAME}"
MODULE_NAME="${KNOWLEDGE_MODULE_NAME:-$REPO_NAME}"
STATE_FILE="$REPO_ROOT/.knowledge-sync-state.json"
MAX_MODULE_DEPTH=5
PAGE_SIZE=100
MAX_PAGES=1000

PRODUCT_ID="${KNOWLEDGE_DATASET_PRODUCT_ID:-}"
DRY_RUN=0
INTERACTIVE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    -i|--interactive) INTERACTIVE=1 ;;
    --product)
      [[ $# -ge 2 && -n "$2" ]] || { echo "error: --product needs a product id" >&2; exit 1; }
      PRODUCT_ID="$2"
      shift
      ;;
    --product=*) PRODUCT_ID="${1#--product=}" ;;
    -h|--help)
      sed -n '2,/^set -euo pipefail/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "error: unknown argument: $1" >&2; exit 1 ;;
  esac
  shift
done

command -v cawplan >/dev/null 2>&1 || { echo "error: cawplan CLI not found on PATH" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "error: jq not found on PATH" >&2; exit 1; }

file_mtime() {
  stat -f %m "$1" 2>/dev/null || stat -c %Y "$1"
}

jq_update_in_place() {
  local filter="$1"
  shift
  local tmp
  tmp="$(mktemp "${STATE_FILE}.XXXXXX")"
  jq "$filter" "$@" "$STATE_FILE" > "$tmp"
  mv "$tmp" "$STATE_FILE"
}

if [[ ! -f "$STATE_FILE" ]]; then
  # --dry-run must not touch disk: synthesize the default state in a throwaway temp file instead
  # of creating the real one. Every write path below is already skipped when DRY_RUN=1, so this
  # redirect is the only thing needed to keep a first dry-run fully side-effect-free.
  if [[ "$DRY_RUN" -eq 1 ]]; then
    STATE_FILE="$(mktemp)"
  fi
  printf '{"dataset_id": null, "dataset_name": %s, "product_id": null, "files": {}}\n' "$(jq -Rn --arg n "$DATASET_NAME" '$n')" > "$STATE_FILE"
fi

DATASET_ID="$(jq -r '.dataset_id // empty' "$STATE_FILE")"
if [[ -z "$PRODUCT_ID" ]]; then
  PRODUCT_ID="$(jq -r '.product_id // empty' "$STATE_FILE")"
fi

if [[ -z "$DATASET_ID" ]]; then
  echo "Resolving dataset \"$DATASET_NAME\"..."
  EXISTING_DATASETS="$(cawplan knowledge datasets list)"
  DATASET_ID="$(echo "$EXISTING_DATASETS" | jq -r --arg name "$DATASET_NAME" \
    '.data.datasets[]? | select(.name == $name) | .id' | head -n1)"
  # A custom KNOWLEDGE_DATASET_NAME might not match an older dataset created before the override
  # was set (or after a repo rename) — fall back to the repo name before deciding no dataset
  # exists, so switching/adding an override doesn't spawn a duplicate dataset.
  if [[ -z "$DATASET_ID" && "$DATASET_NAME" != "$REPO_NAME" ]]; then
    echo "Not found by \"$DATASET_NAME\", falling back to repo name \"$REPO_NAME\"..."
    DATASET_ID="$(echo "$EXISTING_DATASETS" | jq -r --arg name "$REPO_NAME" \
      '.data.datasets[]? | select(.name == $name) | .id' | head -n1)"
  fi
  if [[ -z "$DATASET_ID" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "[dry-run] would create dataset \"$DATASET_NAME\""
      DATASET_ID="<dry-run-dataset-id>"
    else
      echo "Dataset \"$DATASET_NAME\" not found, creating it..."
      if [[ "$INTERACTIVE" -eq 1 ]]; then
        # Run uncaptured so the CLI's own -i picker gets a real terminal on stdout (see the
        # header comment above): we deliberately don't parse this call's JSON output, then
        # re-resolve the dataset id by name afterward with a plain, capturable lookup.
        cawplan knowledge datasets create --name "$DATASET_NAME" -i
        DATASET_ID="$(cawplan knowledge datasets list | jq -r --arg name "$DATASET_NAME" \
          '.data.datasets[]? | select(.name == $name) | .id' | head -n1)"
        # The picked product is both owner and link: read it back so the module tree can be used.
        if [[ -n "$DATASET_ID" && -z "$PRODUCT_ID" ]]; then
          PRODUCT_ID="$(cawplan knowledge datasets products get --dataset "$DATASET_ID" 2>/dev/null \
            | jq -r '.data.product_ids[0] // empty' 2>/dev/null || true)"
        fi
      else
        create_args=(knowledge datasets create --name "$DATASET_NAME")
        if [[ -n "$PRODUCT_ID" ]]; then
          create_args+=(--owner-product "$PRODUCT_ID" --product "$PRODUCT_ID")
        fi
        DATASET_ID="$(cawplan "${create_args[@]}" | jq -r '.data.id')"
      fi
      if [[ -z "$DATASET_ID" || "$DATASET_ID" == "null" ]]; then
        echo "error: failed to create dataset \"$DATASET_NAME\"" >&2
        exit 1
      fi
    fi
  fi
  if [[ "$DRY_RUN" -eq 0 ]]; then
    jq_update_in_place --arg id "$DATASET_ID" '.dataset_id = $id'
  fi
fi
if [[ "$DRY_RUN" -eq 0 && -n "$PRODUCT_ID" ]]; then
  jq_update_in_place --arg p "$PRODUCT_ID" '.product_id = $p'
fi
echo "Dataset: $DATASET_NAME ($DATASET_ID)"
if [[ -n "$PRODUCT_ID" ]]; then
  echo "Product: $PRODUCT_ID (module tree root: \"$MODULE_NAME\")"
else
  echo "Product: none -- syncing flat, without modules (pass --product <id> to mirror the directory tree as modules)"
fi
echo ""

# ---------------------------------------------------------------------------
# Server state, fetched once per run: the whole module tree and ALL documents of the dataset.
# ---------------------------------------------------------------------------

MODULES_JSON='[]'
REMOTE_DOCS_JSON='[]'

if [[ -n "$PRODUCT_ID" ]]; then
  resp=""
  if ! resp="$(cawplan knowledge modules list --product "$PRODUCT_ID")" || [[ "$(echo "$resp" | jq -r '.code // empty')" != "SUCCESS" ]]; then
    echo "error: failed to list the module tree of product $PRODUCT_ID:" >&2
    echo "$resp" >&2
    exit 1
  fi
  MODULES_JSON="$(echo "$resp" | jq -c '.data // []')"
fi

if [[ "$DATASET_ID" != "<dry-run-dataset-id>" ]]; then
  page=1
  while [[ "$page" -le "$MAX_PAGES" ]]; do
    resp=""
    if ! resp="$(cawplan knowledge documents list --dataset "$DATASET_ID" --page "$page" --limit "$PAGE_SIZE")" \
      || [[ "$(echo "$resp" | jq -r '.code // empty')" != "SUCCESS" ]]; then
      echo "error: failed to list the documents of dataset $DATASET_ID (page $page):" >&2
      echo "$resp" >&2
      exit 1
    fi
    REMOTE_DOCS_JSON="$(jq -c --argjson more "$(echo "$resp" | jq -c '.data.data // []')" '. + $more' <<<"$REMOTE_DOCS_JSON")"
    if [[ "$(echo "$resp" | jq -r '.data.has_more // false')" != "true" ]]; then
      break
    fi
    page=$((page + 1))
  done
  echo "Server: $(jq 'length' <<<"$REMOTE_DOCS_JSON") document(s) in the dataset, $(jq 'length' <<<"$MODULES_JSON") module(s) in the product"
  echo ""
fi

# module_path_for REL_DIR -> the "/"-joined module path for a directory ("." = repo root): the
# repo module plus one segment per directory, folded at MAX_MODULE_DEPTH levels.
module_path_for() {
  local rel_dir="$1" path="$MODULE_NAME" depth=1 seg
  local segs
  if [[ "$rel_dir" != "." && -n "$rel_dir" ]]; then
    IFS='/' read -r -a segs <<<"$rel_dir"
    for seg in "${segs[@]}"; do
      [[ -z "$seg" ]] && continue
      if [[ "$depth" -ge "$MAX_MODULE_DEPTH" ]]; then
        break
      fi
      path="$path/$seg"
      depth=$((depth + 1))
    done
  fi
  printf '%s' "$path"
}

# ensure_module_path PATH -> sets MODULE_RESULT to the id of the module at PATH ("root/a/b"),
# creating any missing module on the way (an existing module with the same name under the same
# parent is reused). Returns non-zero when a module can't be created.
MODULE_RESULT=""
ensure_module_path() {
  local path="$1" parent="" seg built="" id resp args
  local segs
  IFS='/' read -r -a segs <<<"$path"
  for seg in "${segs[@]}"; do
    built="${built:+$built/}$seg"
    id="$(jq -r --arg parent "$parent" --arg name "$seg" \
      '[.[] | select((.parent_id // "") == $parent and .name == $name)][0].id // empty' <<<"$MODULES_JSON")"
    if [[ -z "$id" ]]; then
      if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "[dry-run] would create module \"$built\""
        id="<new-module:$built>"
      else
        args=(knowledge modules create --product "$PRODUCT_ID" --name "$seg")
        [[ -n "$parent" ]] && args+=(--parent "$parent")
        resp=""
        if ! resp="$(cawplan "${args[@]}")" || [[ "$(echo "$resp" | jq -r '.code // empty')" != "SUCCESS" ]]; then
          echo "  FAILED to create module \"$built\":" >&2
          echo "$resp" >&2
          return 1
        fi
        id="$(echo "$resp" | jq -r '.data.id // empty')"
        if [[ -z "$id" ]]; then
          echo "  FAILED to create module \"$built\": no id in response" >&2
          return 1
        fi
        echo "MODULE $built"
      fi
      MODULES_JSON="$(jq -c --arg id "$id" --arg parent "$parent" --arg name "$seg" \
        '. + [{id: $id, parent_id: (if $parent == "" then null else $parent end), name: $name}]' <<<"$MODULES_JSON")"
    fi
    parent="$id"
  done
  MODULE_RESULT="$parent"
}

# remote_doc ID -> the server's document with that id (compact JSON) or empty.
remote_doc() {
  jq -c --arg id "$1" '[.[] | select(.id == $id)][0] // empty' <<<"$REMOTE_DOCS_JSON"
}

# find_remote_doc_id NAME MODULE_ID -> id of a server document with that name and module ("" =
# none), used to adopt documents the state file doesn't know about.
find_remote_doc_id() {
  jq -r --arg name "$1" --arg module "$2" \
    '[.[] | select(.name == $name and ((.module_id // "") == $module))][0].id // empty' <<<"$REMOTE_DOCS_JSON"
}

new_count=0
updated_count=0
moved_count=0
skipped_count=0
failed_count=0

record_state() {  # path doc_id mtime module_id module_path
  jq_update_in_place --arg p "$1" --arg id "$2" --argjson mtime "$3" --arg m "$4" --arg mp "$5" \
    '.files[$p] = {document_id: $id, synced_mtime: $mtime, module_id: (if $m == "" then null else $m end), module_path: (if $mp == "" then null else $mp end)}'
}

# Set once the server says the dataset isn't owned by the product: every further module call
# would fail the same way, so the run stops.
fatal_not_owner=0

while IFS= read -r -d '' file; do
  rel_path="${file#"$REPO_ROOT"/}"
  mtime="$(file_mtime "$file")"
  base_name="$(basename "$file")"

  desired_module_id=""
  desired_module_path=""
  if [[ -n "$PRODUCT_ID" ]]; then
    desired_module_path="$(module_path_for "$(dirname "$rel_path")")"
    if ! ensure_module_path "$desired_module_path"; then
      echo "FAILED $rel_path (module \"$desired_module_path\")"
      failed_count=$((failed_count + 1))
      continue
    fi
    desired_module_id="$MODULE_RESULT"
  fi
  module_label=""
  [[ -n "$desired_module_path" ]] && module_label="  [$desired_module_path]"
  if [[ -n "$PRODUCT_ID" && "$(dirname "$rel_path")" != "." ]]; then
    dir_depth="$(awk -F/ '{print NF}' <<<"$(dirname "$rel_path")")"
    if [[ "$dir_depth" -gt $((MAX_MODULE_DEPTH - 1)) ]]; then
      echo "NOTE   $rel_path is nested deeper than the module tree allows ($MAX_MODULE_DEPTH levels); filed under \"$desired_module_path\""
    fi
  fi

  existing_doc_id="$(jq -r --arg p "$rel_path" '.files[$p].document_id // empty' "$STATE_FILE")"
  synced_mtime="$(jq -r --arg p "$rel_path" '.files[$p].synced_mtime // 0' "$STATE_FILE")"
  needs_edit=0

  if [[ -n "$existing_doc_id" ]]; then
    remote="$(remote_doc "$existing_doc_id")"
    if [[ -z "$remote" && "$DATASET_ID" != "<dry-run-dataset-id>" ]]; then
      echo "GONE   $rel_path (document $existing_doc_id no longer on the server)"
      existing_doc_id=""
    fi
  fi

  if [[ -z "$existing_doc_id" ]]; then
    adopted="$(find_remote_doc_id "$base_name" "$desired_module_id")"
    if [[ -n "$adopted" ]]; then
      echo "ADOPT  $rel_path$module_label (server document $adopted has the same name and module)"
      existing_doc_id="$adopted"
      needs_edit=1
    fi
  fi

  # ---- NEW -----------------------------------------------------------------------------------
  if [[ -z "$existing_doc_id" ]]; then
    echo "NEW    $rel_path$module_label"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      new_count=$((new_count + 1))
      continue
    fi

    # --force: the same file name may legitimately exist in another directory (module); this
    # script does its own duplicate detection above, by name AND module.
    args=(knowledge documents upload --dataset "$DATASET_ID" --file "$file" --force)
    [[ -n "$desired_module_id" ]] && args+=(--module "$desired_module_id")

    resp=""
    if ! resp="$(cawplan "${args[@]}")"; then
      echo "  FAILED: $rel_path"
      failed_count=$((failed_count + 1))
      continue
    fi
    doc_id="$(echo "$resp" | jq -r '.data.results[0].document_id // empty')"
    if [[ -z "$doc_id" ]]; then
      echo "  FAILED: $rel_path:"
      echo "$resp"
      failed_count=$((failed_count + 1))
      if echo "$resp" | grep -q "owned by a product"; then
        echo "error: dataset $DATASET_ID is not owned by product $PRODUCT_ID, so its documents can't be placed in the product's modules." >&2
        echo "       Re-create the dataset with --product, or use a dataset created with 'datasets create --owner-product'." >&2
        fatal_not_owner=1
        break
      fi
      continue
    fi
    record_state "$rel_path" "$doc_id" "$mtime" "$desired_module_id" "$desired_module_path"
    new_count=$((new_count + 1))
    continue
  fi

  # ---- existing document: MOVE if its module differs, EDIT if the file changed ---------------
  remote="$(remote_doc "$existing_doc_id")"
  if [[ -n "$remote" ]]; then
    remote_module_id="$(echo "$remote" | jq -r '.module_id // empty')"
  else
    remote_module_id="$desired_module_id" # dry-run against a dataset that doesn't exist yet
  fi

  moved=0
  if [[ "$remote_module_id" != "$desired_module_id" ]]; then
    echo "MOVE   $rel_path -> ${desired_module_path:-<no module>}"
    if [[ "$DRY_RUN" -eq 0 ]]; then
      if [[ -n "$desired_module_id" ]]; then
        move_args=(knowledge documents set-module --dataset "$DATASET_ID" --document "$existing_doc_id" --module "$desired_module_id")
      else
        move_args=(knowledge documents set-module --dataset "$DATASET_ID" --document "$existing_doc_id" --clear)
      fi
      resp=""
      if ! resp="$(cawplan "${move_args[@]}")" || [[ "$(echo "$resp" | jq -r '.code // empty')" != "SUCCESS" ]]; then
        echo "  FAILED: $rel_path:"
        echo "$resp"
        failed_count=$((failed_count + 1))
        continue
      fi
    fi
    moved=1
    moved_count=$((moved_count + 1))
  fi

  if [[ "$needs_edit" -eq 1 || "$mtime" -gt "$synced_mtime" ]]; then
    echo "EDIT   $rel_path$module_label"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      updated_count=$((updated_count + 1))
      continue
    fi
    resp=""
    if ! resp="$(cawplan knowledge documents update --dataset "$DATASET_ID" --document "$existing_doc_id" --text-file "$file")"; then
      echo "  FAILED: $rel_path"
      failed_count=$((failed_count + 1))
      continue
    fi
    if [[ "$(echo "$resp" | jq -r '.code // empty')" != "SUCCESS" ]]; then
      echo "  FAILED: $rel_path:"
      echo "$resp"
      failed_count=$((failed_count + 1))
      continue
    fi
    record_state "$rel_path" "$existing_doc_id" "$mtime" "$desired_module_id" "$desired_module_path"
    updated_count=$((updated_count + 1))
  else
    if [[ "$DRY_RUN" -eq 0 ]]; then
      # Keep the state file's module id / path in step with the server (this also fills them in
      # for entries written by older versions of this script).
      record_state "$rel_path" "$existing_doc_id" "$synced_mtime" "$desired_module_id" "$desired_module_path"
    fi
    [[ "$moved" -eq 0 ]] && skipped_count=$((skipped_count + 1))
  fi
done < <(find "$REPO_ROOT" -type f -name '*.md' -not -path '*/.git/*' -not -path '*/node_modules/*' -print0 | sort -z)

echo ""
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] would sync: $new_count new, $updated_count updated, $moved_count moved, $skipped_count unchanged"
else
  echo "Sync complete: $new_count new, $updated_count updated, $moved_count moved, $skipped_count unchanged, $failed_count failed."
fi

[[ "$fatal_not_owner" -eq 1 || "$failed_count" -gt 0 ]] && exit 1
exit 0
