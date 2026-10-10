# scripts/

Repo-maintenance and integration scripts for flow-cawplan-skill.

## sync-knowledge.sh

Syncs every Markdown file in the *current* repo into one CawPlan knowledge dataset named after
that repo, via the `cawplan` CLI (`cawplan knowledge ...`). Meant to be copied into (or symlinked
from) another repo's `scripts/` directory and run there — it always resolves paths relative to
its own location, not to this repo.

```bash
scripts/sync-knowledge.sh            # sync
scripts/sync-knowledge.sh --dry-run  # show what would happen, without calling the API
```

Requires the `cawplan` CLI (logged in, `cawplan skill check` passes) and `jq` on `PATH`.

**What it does:**

- Resolves (or creates) a dataset named after the repo — override with `KNOWLEDGE_DATASET_NAME`.
- New `.md` files (no entry in the state file) are uploaded with `documents upload`.
- Changed files (mtime newer than last sync) are re-synced with `documents update`.
- Unchanged files are skipped.
- Deletions are **not** handled — removing a local `.md` file does not delete or archive its
  knowledge document; do that manually if a doc is retired.

**State**: tracked in `.knowledge-sync-state.json` at the repo root (`path -> {document_id,
synced_mtime}`, plus the resolved `dataset_id`). Commit this file so contributors and CI share the
same mapping instead of re-uploading duplicates.

**Product ownership and modules**:

| Env var | Effect |
|---|---|
| `KNOWLEDGE_DATASET_PRODUCT_ID` | Only when the dataset doesn't exist yet: creates it **owned** by that CawPlan product id (`datasets create --owner-product`, see `cawplan products list`) and also **links** it to the same product (`--product`), so it stays scoped for product-scoped knowledge search. Ownership is what allows its documents to use that product's modules. No effect on a dataset that's already resolved by name. |
| `KNOWLEDGE_DATASET_MODULE_ID` | Passed as `--module` on every `documents upload` the script performs, so new documents are created under that `product_modules` tree node. The module must belong to the dataset's owner product (otherwise the upload fails with `BAD_REQUEST`). Re-syncs via `documents update` don't move existing documents. |

```bash
KNOWLEDGE_DATASET_PRODUCT_ID=<id> scripts/sync-knowledge.sh
KNOWLEDGE_DATASET_PRODUCT_ID=<id> KNOWLEDGE_DATASET_MODULE_ID=<id> scripts/sync-knowledge.sh
```

To relink an *existing* dataset's products, or move an already-synced document into (or out of)
a module, use the CLI directly:

```bash
cawplan knowledge datasets products set --dataset <id> --product <product_id>
cawplan knowledge documents set-module --dataset <id> --document <document_id> --module <module_id>
cawplan knowledge documents set-module --dataset <id> --document <document_id> --clear
```

To find a `module_id`, list a product's module tree (`{id, parent_id, name, knowledge}`, where
`knowledge` lists the datasets that have at least one document under that node):

```bash
cawplan knowledge datasets modules --product <product_id>
```

**Interactive bootstrap**: pass `-i`/`--interactive` to this script itself (only has an effect
when the dataset doesn't exist yet — ignored once it does):

```bash
scripts/sync-knowledge.sh -i
```

This runs `cawplan knowledge datasets create --name "<repo dataset name>" -i` **uncaptured** (a
real terminal on stdout, which the CLI's own picker needs), so you get a product menu; the picked
product becomes the dataset's owner and is also linked. The script then resolves the new dataset's
id with a separate, plain (capturable) lookup by name. There is no module menu here — set
`KNOWLEDGE_DATASET_MODULE_ID` to upload documents into a module. Every other call the script makes
stays non-interactive — only that one create call is special-cased. For CI or repeat runs
afterward, skip `-i` and set the env vars above instead.

## validate-skills.sh

CI/pre-publish check: validates every `skills/cawplan-*/SKILL.md`'s frontmatter and name, version
sync across the repo, marketplace listing entries, and cross-references. Run it locally before
opening a PR that touches a skill:

```bash
scripts/validate-skills.sh
```

## optional-skills.json

Declares which in-repo skills are **not** installed by default (`./setup`, the Cursor/Codex
plugin, `npx skills add ... --all`). Install one on demand with:

```bash
npx skills add <marketplace>/<repo> --skill <name>
# or
./setup --optional-qa
```

Add a skill's directory name to the `skills` array here to keep it out of the default install.
