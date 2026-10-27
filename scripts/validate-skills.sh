#!/usr/bin/env bash
# Validate skill frontmatter, version sync, marketplace listing, and references.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail=0

echo "→ Validating frontmatter and name..."
for skill_dir in skills/cawplan-*/; do
  skill_name="${skill_dir%/}"
  skill_name="${skill_name#skills/}"
  skill_md="${skill_dir}SKILL.md"
  if [ ! -f "$skill_md" ]; then
    echo "::error::${skill_md} missing"
    fail=1
    continue
  fi

  python3 - "$skill_md" "$skill_name" <<'PY' || fail=1
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
expected_name = sys.argv[2]
text = path.read_text()
match = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
if not match:
    print(f"::error file={path}::no YAML frontmatter")
    sys.exit(1)

frontmatter = match.group(1)
fields = {}
current_key = None
for line in frontmatter.splitlines():
    if not line.strip():
        continue
    if not line.startswith(" ") and ":" in line:
        key, value = line.split(":", 1)
        current_key = key.strip()
        fields[current_key] = value.strip()
    elif current_key == "description":
        fields[current_key] += "\n" + line.strip()

errors = []
if fields.get("name") != expected_name:
    errors.append(f"name '{fields.get('name')}' != directory '{expected_name}'")
if not fields.get("version"):
    errors.append("version missing")
description = fields.get("description", "")
if not description:
    errors.append("description missing")
if len(description) > 1024:
    errors.append(f"description exceeds 1024 characters ({len(description)})")
if "Use when" not in description:
    errors.append("description missing 'Use when' trigger phrases")
if "NOT for" not in description:
    errors.append("description missing 'NOT for' boundary")
if not fields.get("argument-hint"):
    errors.append("argument-hint missing")
if fields.get("allowed-tools") != "Bash":
    errors.append("allowed-tools must be Bash")

for err in errors:
    print(f"::error file={path}::{err}")
if errors:
    sys.exit(1)
print(f"✓ {path} — frontmatter valid (name={fields['name']}, version={fields['version']})")
PY
done
[ "$fail" -eq 0 ]

echo "→ Validating version sync..."
ROOT_VERSION="$(tr -d '[:space:]' < VERSION)"
echo "Root VERSION: ${ROOT_VERSION}"

for skill_dir in skills/cawplan-*/; do
  v=$(awk '/^---/{c++; next} c==1 && /^version:/{gsub(/^version:[[:space:]]*/,""); gsub(/[[:space:]]*#.*$/,""); gsub(/[[:space:]]/,""); print; exit}' "${skill_dir}SKILL.md")
  if [ "$v" != "$ROOT_VERSION" ]; then
    echo "::error file=${skill_dir}SKILL.md::version ${v} != VERSION ${ROOT_VERSION}"
    fail=1
  fi
done

for file in .claude-plugin/plugin.json .codex-plugin/plugin.json .cursor-plugin/plugin.json; do
  v=$(python3 -c "import json; print(json.load(open('${file}'))['version'])")
  if [ "$v" != "$ROOT_VERSION" ]; then
    echo "::error file=${file}::version ${v} != VERSION ${ROOT_VERSION}"
    fail=1
  fi
done

v=$(python3 -c "import json; print(json.load(open('.claude-plugin/marketplace.json'))['plugins'][0]['version'])")
if [ "$v" != "$ROOT_VERSION" ]; then
  echo "::error file=.claude-plugin/marketplace.json::plugins[0].version ${v} != VERSION ${ROOT_VERSION}"
  fail=1
fi
[ "$fail" -eq 0 ] && echo "✓ all version locations match ${ROOT_VERSION}"

echo "→ Validating marketplace.json lists every skill folder..."
listed=$(python3 -c "
import json
m = json.load(open('.claude-plugin/marketplace.json'))['plugins'][0]
paths = [s['path'] for s in m.get('skills', [])]
paths += [s['path'] for s in m.get('optionalSkills', [])]
print(' '.join(paths))
")
for skill_dir in skills/cawplan-*/; do
  skill_path="${skill_dir%/}"
  if ! echo " ${listed} " | grep -q " ${skill_path} "; then
    echo "::error::skill folder '${skill_path}' is not listed in .claude-plugin/marketplace.json (skills or optionalSkills)"
    fail=1
  fi
done
[ "$fail" -eq 0 ] && echo "✓ marketplace.json includes every skill folder"

echo "→ Validating optional-skills.json matches marketplace optionalSkills..."
python3 - <<'PY' || fail=1
import json
import pathlib

opt_manifest = json.loads(pathlib.Path("scripts/optional-skills.json").read_text())
expected = set(opt_manifest.get("skills", []))
market = json.load(open(".claude-plugin/marketplace.json"))["plugins"][0]
listed = {
    pathlib.Path(s["path"]).name for s in market.get("optionalSkills", [])
}
if expected != listed:
    print(
        "::error::scripts/optional-skills.json skills "
        f"{sorted(expected)} != marketplace optionalSkills {sorted(listed)}"
    )
    raise SystemExit(1)
print(f"✓ optional-skills.json matches marketplace ({len(expected)} skills)")
PY

echo "→ Validating cli/config/skill-roles.json covers the default skills..."
python3 - <<'PY' || fail=1
import json
import pathlib

roles_config = json.loads(pathlib.Path("cli/config/skill-roles.json").read_text())
market = json.load(open(".claude-plugin/marketplace.json"))["plugins"][0]
default_skills = {pathlib.Path(s["path"]).name for s in market.get("skills", [])}
skill_folders = {p.name for p in pathlib.Path("skills").glob("cawplan-*") if p.is_dir()}
# "optional" = skills deliberately left out of every role (internal tooling).
optional = set(roles_config.get("optional", []))

mapped = set(roles_config.get("common", []))
for role in roles_config.get("roles", {}).values():
    mapped.update(role.get("skills", []))

errors = []
missing = default_skills - mapped - optional
if missing:
    errors.append(f"default skills neither assigned to a role nor listed as optional: {sorted(missing)}")
unknown = mapped - default_skills
if unknown:
    errors.append(f"roles reference skills that are not default marketplace skills: {sorted(unknown)}")
overlap = mapped & optional
if overlap:
    errors.append(f"skills both assigned to a role and listed as optional: {sorted(overlap)}")
stale = optional - skill_folders
if stale:
    errors.append(f"optional lists skills with no skills/ folder: {sorted(stale)}")
for err in errors:
    print(f"::error file=cli/config/skill-roles.json::{err}")
if errors:
    raise SystemExit(1)
print(f"✓ skill-roles.json maps {len(mapped)} skills to roles, {len(optional)} optional")
PY

echo "→ Validating references..."
for skill_dir in skills/cawplan-*/; do
  for src_file in "${skill_dir}SKILL.md" "${skill_dir}"references/*.md; do
    [ -f "$src_file" ] || continue
    src_basename="$(basename "$src_file")"
    for ref in $(grep -oE 'references/[a-zA-Z0-9_./-]+\.md' "$src_file" | sort -u || true); do
      # Skip a file referencing its own filename (self-description, not a real dependency).
      [ "$ref" = "references/${src_basename}" ] && continue
      if [ ! -f "$ref" ] && [ ! -f "${skill_dir}${ref}" ]; then
        echo "::error file=${src_file}::references ${ref} but file is missing"
        fail=1
      fi
    done
  done
done
[ "$fail" -eq 0 ] && echo "✓ all references resolve"

echo "→ Validating no parent-dir references..."
for skill_dir in skills/cawplan-*/; do
  if grep -nE '(^|[^./])\.\./' "${skill_dir}SKILL.md" 2>/dev/null; then
    echo "::error file=${skill_dir}SKILL.md::contains parent-dir (../) reference"
    fail=1
  fi
done
[ "$fail" -eq 0 ] && echo "✓ no parent-dir references"

echo "→ Validating cawplan-requirement-analyze rules dual-copy (normalized)..."
python3 - <<'PY' || fail=1
import pathlib
import re
import sys

ROOT = pathlib.Path(".")
skill_md = ROOT / "skills/cawplan-requirement-analyze/SKILL.md"
rules_global = ROOT / "skills/cawplan-requirement-analyze/references/rules-global.md"

if not skill_md.is_file():
    print(f"::error file={skill_md}::missing")
    sys.exit(1)
if not rules_global.is_file():
    print(f"::error file={rules_global}::missing (rules dual-copy check)")
    sys.exit(1)


def normalize_lines(lines: list[str]) -> str:
    out: list[str] = []
    for raw in lines:
        line = raw.replace("\r\n", "\n").replace("\r", "\n").rstrip("\n")
        while True:
            if line.startswith("> "):
                line = line[2:]
                continue
            if line.startswith(">"):
                line = line[1:]
                continue
            m = re.match(r"^(\s*)-\s+(.*)$", line)
            if m:
                line = m.group(2)
                continue
            break
        out.append(line.strip())
    return "\n".join(out)


def extract_trigger_boundary(text: str) -> list[str]:
    for line in text.splitlines():
        if re.match(r"^-\s+\*\*Trigger boundary\*\*:", line):
            return [line]
    return []


def extract_cross_skill_relay(text: str) -> list[str]:
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if re.match(r"^-\s+\*\*跨 skill 接力", line):
            block = [line]
            for nxt in lines[i + 1 :]:
                if not nxt.strip():
                    continue
                if re.match(r"^\s+-\s+", nxt):
                    block.append(nxt)
                    continue
                break
            return block
    return []


def compare_block(name: str, main_lines: list[str], ref_lines: list[str]) -> bool:
    if not main_lines:
        print(f"::error file={skill_md}::missing {name} block in main SKILL.md")
        return False
    if not ref_lines:
        print(f"::error file={rules_global}::missing {name} block in rules-global.md")
        return False
    main_norm = normalize_lines(main_lines)
    ref_norm = normalize_lines(ref_lines)
    if main_norm != ref_norm:
        print(f"::error file={skill_md}::{name} normalized text differs from rules-global.md")
        return False
    print(f"✓ {name} — normalized dual-copy match")
    return True


skill_text = skill_md.read_text(encoding="utf-8")
rules_text = rules_global.read_text(encoding="utf-8")

ok = True
ok &= compare_block(
    "Trigger boundary",
    extract_trigger_boundary(skill_text),
    extract_trigger_boundary(rules_text),
)
ok &= compare_block(
    "跨 skill 接力",
    extract_cross_skill_relay(skill_text),
    extract_cross_skill_relay(rules_text),
)

if not ok:
    sys.exit(1)
PY

echo "→ Validating qa-insights terminology-en.md two-way byte-identical copy..."
# Existence is covered by "Validating references" above (workflow-analysis.md /
# coverage-dimensions.md reference these paths). This step only checks content drift.
# A3 (cawplan-testcase-generate) has no copy — it never references terminology-en.md
# (its Title/Expected honesty-tail phrasing is inlined in SKILL.md 红线 0 instead).
TERM_A1="skills/cawplan-requirement-analyze/references/terminology-en.md"
TERM_A2="skills/cawplan-testpoint-generate/references/terminology-en.md"
if [ -f "$TERM_A1" ] && [ -f "$TERM_A2" ]; then
  if ! diff -q "$TERM_A1" "$TERM_A2" >/dev/null; then
    echo "::error file=${TERM_A2}::differs from ${TERM_A1} (terminology-en.md must be byte-identical across A1/A2)"
    fail=1
  fi
fi
[ "$fail" -eq 0 ] && echo "✓ terminology-en.md — byte-identical across A1/A2"

echo "→ Validating QUERY_RESILIENCE.md skill copies are byte-identical..."
# The hosted agent bundles only skills/, so every skill that references
# references/QUERY_RESILIENCE.md carries its own copy. The root file is canonical.
QR_CANONICAL="references/QUERY_RESILIENCE.md"
for skill_dir in skills/cawplan-*/; do
  if grep -q 'references/QUERY_RESILIENCE.md' "${skill_dir}SKILL.md" 2>/dev/null; then
    copy="${skill_dir}references/QUERY_RESILIENCE.md"
    if [ ! -f "$copy" ]; then
      echo "::error file=${skill_dir}SKILL.md::references QUERY_RESILIENCE.md but ${copy} is missing (hosted bundles only skills/)"
      fail=1
    elif ! diff -q "$QR_CANONICAL" "$copy" >/dev/null; then
      echo "::error file=${copy}::differs from ${QR_CANONICAL} (copies must be byte-identical)"
      fail=1
    fi
  fi
done
[ "$fail" -eq 0 ] && echo "✓ QUERY_RESILIENCE.md — skill copies byte-identical"

[ "$fail" -eq 0 ] || exit 1
echo "All skill validations passed."
