#!/usr/bin/env bash
# Syncs every Markdown file in this repo into one CawPlan knowledge dataset named after the
# repo (override with KNOWLEDGE_DATASET_NAME), via the `cawplan` CLI.
#
# - If the dataset doesn't exist yet and KNOWLEDGE_DATASET_PRODUCT_ID is set, the new dataset is
#   bound to that CawPlan product id (see: cawplan products list) so it's scoped for
#   product-scoped knowledge search. Only applied at creation time — has no effect on a dataset
#   that already exists (use `cawplan knowledge datasets products set` to rebind one later).
# - New files (no entry in the state file below) are uploaded with `documents upload`.
# - Existing files are re-synced with `documents update` only when their mtime has advanced past
#   the mtime recorded at last sync — unchanged files are skipped.
# - Each document's source directory (relative to the repo root) is passed as `--folder`, stored
#   as Dify "folder" metadata, so callers can sort/group documents by original directory later via
#   `documents list`/`get`.
# - Deletions are NOT handled: removing a local .md file does not delete or archive its knowledge
#   document. Handle that manually if a doc is retired.
#
# State is tracked in .knowledge-sync-state.json at the repo root (path -> {document_id, folder,
# synced_mtime}), plus the resolved dataset_id. Commit this file so the mapping is shared across
# contributors and CI runs, instead of re-uploading duplicates.
#
# Requires: cawplan CLI (with `documents update` and `--folder` support — see
# flow-cawplan-skill/cli), jq.
#
# Usage:
#   scripts/sync-knowledge.sh                                        # sync
#   scripts/sync-knowledge.sh --dry-run                              # show what would happen, without calling the API
#   KNOWLEDGE_DATASET_PRODUCT_ID=<id> scripts/sync-knowledge.sh       # bind a newly-created dataset to a product

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATASET_NAME="${KNOWLEDGE_DATASET_NAME:-$(basename "$REPO_ROOT")}"
STATE_FILE="$REPO_ROOT/.knowledge-sync-state.json"

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

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
  printf '{"dataset_id": null, "dataset_name": %s, "files": {}}\n' "$(jq -Rn --arg n "$DATASET_NAME" '$n')" > "$STATE_FILE"
fi

DATASET_ID="$(jq -r '.dataset_id // empty' "$STATE_FILE")"

if [[ -z "$DATASET_ID" ]]; then
  echo "Resolving dataset \"$DATASET_NAME\"..."
  DATASET_ID="$(cawplan knowledge datasets list | jq -r --arg name "$DATASET_NAME" \
    '.data.datasets[]? | select(.name == $name) | .id' | head -n1)"
  if [[ -z "$DATASET_ID" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "[dry-run] would create dataset \"$DATASET_NAME\""
      DATASET_ID="<dry-run-dataset-id>"
    else
      echo "Dataset \"$DATASET_NAME\" not found, creating it..."
      create_args=(knowledge datasets create --name "$DATASET_NAME")
      [[ -n "${KNOWLEDGE_DATASET_PRODUCT_ID:-}" ]] && create_args+=(--product "$KNOWLEDGE_DATASET_PRODUCT_ID")
      DATASET_ID="$(cawplan "${create_args[@]}" | jq -r '.data.id')"
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
echo "Dataset: $DATASET_NAME ($DATASET_ID)"
echo ""

new_count=0
updated_count=0
skipped_count=0
failed_count=0

while IFS= read -r -d '' file; do
  rel_path="${file#"$REPO_ROOT"/}"
  folder_dir="$(dirname "$rel_path")"
  [[ "$folder_dir" == "." ]] && folder_dir=""
  mtime="$(file_mtime "$file")"

  existing_doc_id="$(jq -r --arg p "$rel_path" '.files[$p].document_id // empty' "$STATE_FILE")"
  synced_mtime="$(jq -r --arg p "$rel_path" '.files[$p].synced_mtime // 0' "$STATE_FILE")"

  if [[ -z "$existing_doc_id" ]]; then
    echo "NEW    $rel_path"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      new_count=$((new_count + 1))
      continue
    fi

    args=(knowledge documents upload --dataset "$DATASET_ID" --file "$file")
    [[ -n "$folder_dir" ]] && args+=(--folder "$folder_dir")

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
      continue
    fi
    jq_update_in_place --arg p "$rel_path" --arg id "$doc_id" --arg folder "$folder_dir" --argjson mtime "$mtime" \
      '.files[$p] = {document_id: $id, folder: $folder, synced_mtime: $mtime}'
    new_count=$((new_count + 1))

  elif [[ "$mtime" -gt "$synced_mtime" ]]; then
    echo "EDIT   $rel_path"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      updated_count=$((updated_count + 1))
      continue
    fi

    args=(knowledge documents update --dataset "$DATASET_ID" --document "$existing_doc_id" --text-file "$file")
    [[ -n "$folder_dir" ]] && args+=(--folder "$folder_dir")

    if ! resp="$(cawplan "${args[@]}")"; then
      echo "  FAILED: $rel_path"
      failed_count=$((failed_count + 1))
      continue
    fi
    code="$(echo "$resp" | jq -r '.code // empty')"
    if [[ "$code" != "SUCCESS" ]]; then
      echo "  FAILED: $rel_path:"
      echo "$resp"
      failed_count=$((failed_count + 1))
      continue
    fi
    jq_update_in_place --arg p "$rel_path" --arg folder "$folder_dir" --argjson mtime "$mtime" \
      '.files[$p].folder = $folder | .files[$p].synced_mtime = $mtime'
    updated_count=$((updated_count + 1))

  else
    skipped_count=$((skipped_count + 1))
  fi
done < <(find "$REPO_ROOT" -type f -name '*.md' -not -path '*/.git/*' -not -path '*/node_modules/*' -print0)

echo ""
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] would sync: $new_count new, $updated_count updated, $skipped_count unchanged"
else
  echo "Sync complete: $new_count new, $updated_count updated, $skipped_count unchanged, $failed_count failed."
fi

[[ "$failed_count" -gt 0 ]] && exit 1
exit 0
