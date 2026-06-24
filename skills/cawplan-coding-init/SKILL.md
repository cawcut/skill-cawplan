---
version: 0.2.0
name: cawplan-coding-init
description: |
  Use when setting up the current git repository for CawPlan AI coding session reporting by creating or verifying product-repo mappings.
  NOT for: collecting or uploading daily AI reports, querying costs, or creating tickets.
argument-hint: "[optional product or repository context]"
allowed-tools: Bash
---

# CawPlan Coding Init

## Bootstrap

```bash
command -v cawplan >/dev/null || { echo "cawplan is not installed. Run: npm install -g cawplan@0.0.4"; exit 1; }
[ "$(cawplan --version)" = "0.0.4" ] || { echo "cawplan 0.0.4 is required. Run: npm install -g cawplan@0.0.4"; exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
git rev-parse --show-toplevel >/dev/null || { echo "Run /cawplan-coding-init inside a git repository."; exit 1; }
```

## Purpose

Initialize the current repository's default Product/Repo mapping for AI coding session reports.

After this mapping exists, `/cawplan-coding-commit` can automatically assign sessions from this repository to the correct CawPlan product.

## Workflow

### Step 1 — Identify The Current Repository

Run:

```bash
git remote get-url origin
```

Normalize the result to a GitHub HTTPS URL:

- `git@github.com:owner/repo.git` -> `https://github.com/owner/repo`
- `https://github.com/owner/repo.git` -> `https://github.com/owner/repo`

Do not continue if the remote is missing or is not a GitHub repository URL. Tell the user to set `origin` first.

### Step 2 — Check Existing Mapping

Run:

```bash
cawplan ai-session product-repos
```

If the current repository is already mapped, report the mapped `product_name`, `product_id`, `repo_name`, and `repo_url`, then stop.

### Step 3 — Choose Product

Run:

```bash
cawplan ai-session products
```

Ask the user which Product to map this repository to. Use the exact `product_id` from the product list.

If the user already named a product in the prompt, still verify it against the product list before continuing.

### Step 4 — Confirm Before Creating

Before creating any cloud mapping, show:

- Product name
- Product ID
- Repository URL
- Repository name

Ask the user to confirm. Do not create mappings without explicit confirmation.

### Step 5 — Create Mapping

After confirmation, run:

```bash
cawplan ai-session product-repos create \
  --product-id <product_id> \
  --repo-url https://github.com/owner/repo
```

Then report the created mapping and tell the user future `/cawplan-coding-commit` runs will use it automatically.

## Rules

- This skill only initializes Product/Repo mapping. It does not collect, generate, or upload daily reports.
- Never guess product IDs.
- Never create a mapping for a repository URL that was not derived from the current git `origin`.
- Never create a product-repo mapping without explicit user confirmation.
- GitHub repository URLs must be in the format `https://github.com/owner/repo`.
