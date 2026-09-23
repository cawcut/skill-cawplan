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

**First-time dataset creation** — these only take effect when the dataset doesn't exist yet (no
effect on a dataset that's already resolved by name):

| Env var | Effect |
|---|---|
| `KNOWLEDGE_DATASET_PRODUCT_ID` | Binds the new dataset to a CawPlan product id (see `cawplan products list`), so it's scoped for product-scoped knowledge search. |
| `KNOWLEDGE_DATASET_MODULE_ID` | Also places the new dataset under that product's `product_modules` tree node. Only applied when `KNOWLEDGE_DATASET_PRODUCT_ID` is also set. |

```bash
KNOWLEDGE_DATASET_PRODUCT_ID=<id> scripts/sync-knowledge.sh
KNOWLEDGE_DATASET_PRODUCT_ID=<id> KNOWLEDGE_DATASET_MODULE_ID=<id> scripts/sync-knowledge.sh
```

To rebind an *existing* dataset's product or module later, don't re-run this script with the env
vars set (no effect) — use the CLI directly:

```bash
cawplan knowledge datasets products set --dataset <id> --product <product_id>
cawplan knowledge datasets products set-module --dataset <id> --product <product_id> --module <module_id>
```

To find a `module_id`, list a product's module tree (`{id, parent_id, name}` only):

```bash
cawplan knowledge datasets modules --product <product_id>
```

**Interactive bootstrap**: pass `-i`/`--interactive` to this script itself (only has an effect
when the dataset doesn't exist yet — ignored once it does):

```bash
scripts/sync-knowledge.sh -i
```

This runs `cawplan knowledge datasets create --name "<repo dataset name>" -i` **uncaptured** (a
real terminal on stdout, which the CLI's own picker needs), so you get the product-then-module
menu; the script then resolves the new dataset's id with a separate, plain (capturable) lookup by
name. Every other call the script makes stays non-interactive — only that one create call is
special-cased. For CI or repeat runs afterward, skip `-i` and set the env vars above instead.

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
