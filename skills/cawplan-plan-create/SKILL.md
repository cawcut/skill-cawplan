---
version: 0.2.2
name: cawplan-plan-create
description: |
  Create a CawPlan version plan: create a version and optionally populate it with tickets.
  Use when: the user asks to create a version plan, set up a new release, create a version with goals or tasks, or plan a release train.
  NOT for: tracking an existing plan, creating standalone backlog tickets, querying product info, or metrics.
argument-hint: "[product name or ID, version name, and optional ticket descriptions]"
allowed-tools: Bash
---

# CawPlan Plan Create

## Bootstrap

```bash
command -v cawplan >/dev/null || { echo "cawplan is not installed or not on PATH. Do not search the filesystem for it (no find/locate/where scans) — just run: npm install -g cawplan@latest"; exit 1; }
cawplan_version="$(cawplan --version)"
latest_cawplan_version="$(npm view cawplan version 2>/dev/null)" || { echo "Unable to check latest cawplan version. Run: cawplan upgrade"; exit 1; }
node -e 'const [current, latest] = process.argv.slice(1); process.exit(current === latest ? 0 : 1);' "$cawplan_version" "$latest_cawplan_version" || { echo "cawplan $latest_cawplan_version is available (current: $cawplan_version). Run: cawplan upgrade"; exit 1; }
cawplan auth status >/dev/null || { echo "Not authenticated. Run: cawplan auth login"; exit 1; }
```

## Workflow

1. Resolve product name to `product_id`:
   ```bash
   cawplan products list --search "<product name>"
   ```

2. Create the version:
   ```bash
   cawplan versions create <product_id> --name <X.Y.Z> --description "<goals>"
   ```

3. If the user provided tickets or tasks, create them on the new version:
   ```bash
   cawplan tickets create-version <product_id> <version_id> \
     --description "<task description>" --type FEATURE --priority MEDIUM
   ```
   Repeat for each ticket. Resolve assignees with `cawplan users query --email <email>` when provided.

## Rules

- Ask for the version name if not provided. Do not invent or auto-increment a version number.
- Require an exact version name in `X.Y.Z` format before creating.
- If a `--major_id` is needed (to associate with a major version), resolve it first:
  ```bash
  cawplan versions list <product_id>
  ```
- Default ticket type to `FEATURE`, priority to `MEDIUM` unless specified.
- Do not create tickets unless the user explicitly describes them.

## Confirmation

After creating the version, report:

- Version name and unique ID.
- Product name and ID.
- Description (truncated if long).
- List of created tickets (display ID, type, description), or "No tickets created" if none.

## References

- `references/CAWPLAN_OPEN_API.md`
