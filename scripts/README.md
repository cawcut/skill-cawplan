# scripts/

Repo-maintenance and integration scripts for flow-cawplan-skill.

## sync-knowledge.sh

Syncs every Markdown file in the *current* repo into one CawPlan knowledge dataset named after
that repo, via the `cawplan` CLI (`cawplan knowledge ...`), and — when you give it a product —
mirrors the repo's directory structure as that product's module tree. Meant to be copied into (or
symlinked from) another repo's `scripts/` directory and run there — it always resolves paths
relative to its own location, not to this repo.

```bash
scripts/sync-knowledge.sh --product <product_id>   # sync into the product's module tree
scripts/sync-knowledge.sh                          # sync again (product remembered in the state file)
scripts/sync-knowledge.sh --dry-run                # show what would happen, without changing anything
```

Requires the `cawplan` CLI (logged in, `cawplan skill check` passes) and `jq` on `PATH`. Works with
the bash 3.2 that ships with macOS.

**Product and module tree** (`--product <id>`, or `KNOWLEDGE_DATASET_PRODUCT_ID`; see
`cawplan products list`):

- A new dataset is created **owned** by that product (`datasets create --owner-product`, which is
  what lets its documents live in the product's modules) and also **linked** to it (`--product`),
  so it stays scoped for product-scoped knowledge search. Ownership can't be changed from this
  script, so for an *existing* dataset the product must already be its owner.
- A top-level module named after the repo is created under the product (override the name with
  `KNOWLEDGE_MODULE_NAME`), and **one sub-module per directory**: `docs/design/api.md` goes in
  `<repo>/docs/design`; files at the repo root go in `<repo>`. Missing modules are created,
  existing ones (same name under the same parent) are reused.
- The module tree is at most 5 levels deep, so directories nested deeper than the repo module + 4
  levels are filed under their level-5 ancestor (the script prints a `NOTE` for each).
- Every document is created under its directory's module, and the state file keeps each
  document's `module_id` and `module_path`.
- Without a product the dataset is synced flat, with no modules (files with the same name in
  different directories can't be told apart then if the state file is lost).

**Every run** first fetches **all** documents of the dataset (and, with a product, the whole module
tree) from the server, compares them with the local files, and only then changes anything:

| Situation | Action |
|---|---|
| No document for the file yet | `NEW` — `documents upload --module <dir module>` |
| The recorded document is gone from the server | `GONE` + `NEW` — uploaded again |
| Not in the state file, but the server has a document with the same name **and module** | `ADOPT` — reused and re-synced (e.g. after a lost state file) |
| The document's module differs from its directory's module | `MOVE` — `documents set-module` |
| File mtime is newer than the last sync | `EDIT` — `documents update` |
| Otherwise | skipped |

The server is the source of truth for modules, so a document moved by hand is moved back on the
next run. Uploads always pass `--force`: the same file name may exist in several directories, and
the script does its own duplicate detection (by name **and** module) from the server's list.
Deletions are **not** handled — removing a local `.md` file does not delete or archive its
knowledge document (or an emptied module); do that manually if a doc is retired.

**State**: tracked in `.knowledge-sync-state.json` at the repo root — `dataset_id`, `product_id`
and `files` (`path -> {document_id, synced_mtime, module_id, module_path}`). Commit this file so
contributors and CI share the same mapping instead of re-uploading duplicates.

| Env var / flag | Effect |
|---|---|
| `--product <id>` / `KNOWLEDGE_DATASET_PRODUCT_ID` | Product that owns the dataset and whose module tree is used (see above). Remembered in the state file. |
| `KNOWLEDGE_DATASET_NAME` | Dataset name (default: the repo name). |
| `KNOWLEDGE_MODULE_NAME` | Name of the top-level module (default: the repo name). |
| `--dry-run` | Reads from the server but changes nothing, and writes no state file. |

To relink an *existing* dataset's products, or move a document by hand, use the CLI directly:

```bash
cawplan knowledge datasets products set --dataset <id> --product <product_id>
cawplan knowledge documents set-module --dataset <id> --document <document_id> --module <module_id>
cawplan knowledge documents set-module --dataset <id> --document <document_id> --clear
cawplan knowledge modules list --product <product_id>      # {id, parent_id, name, knowledge}
```

**Interactive bootstrap**: pass `-i`/`--interactive` to this script itself (only has an effect
when the dataset doesn't exist yet — ignored once it does):

```bash
scripts/sync-knowledge.sh -i
```

This runs `cawplan knowledge datasets create --name "<repo dataset name>" -i` **uncaptured** (a
real terminal on stdout, which the CLI's own picker needs), so you get a product menu; the picked
product becomes the dataset's owner and is also linked, and the script reads it back to build the
module tree. Every other call the script makes stays non-interactive. For CI or repeat runs
afterward, skip `-i` and pass `--product`.

**Tests**: `bash scripts/tests/sync-knowledge.test.sh` runs the script against a stateful fake
`cawplan` (`scripts/tests/fake-cawplan.sh`) — module tree creation, no-op re-runs, edits, moved and
deleted documents, adoption after a lost state file, flat mode, `--dry-run`, pagination.

## validate-skills.sh

CI/pre-publish check: validates every `skills/cawplan-*/SKILL.md`'s frontmatter and name, version
sync across the repo, marketplace listing entries, and cross-references. Run it locally before
opening a PR that touches a skill:

```bash
scripts/validate-skills.sh
```

## optional-skills.json

Only approved public skills are distributed here.
