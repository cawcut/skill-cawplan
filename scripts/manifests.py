#!/usr/bin/env python3
"""Plugin manifest skill lists, generated from the role config.

The default skill set is every skill cli/config/skill-roles.json assigns to a
role (`common` plus each role's `skills`, in declaration order); its `optional`
list is the optional set. Only the skill lists are generated: other manifest
fields (version, description, ...) stay hand-maintained.

  render   rewrite the skill lists in .claude-plugin/marketplace.json,
           .codex-plugin/plugin.json, .cursor-plugin/plugin.json and
           scripts/optional-skills.json
  check    fail when a manifest differs from what render writes, or the role
           config disagrees with the skills/ folders or public_skills in
           scripts/public-export.json
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROLES = Path("cli/config/skill-roles.json")
PUBLIC_EXPORT = Path("scripts/public-export.json")
MARKETPLACE = Path(".claude-plugin/marketplace.json")
PLUGINS = (Path(".codex-plugin/plugin.json"), Path(".cursor-plugin/plugin.json"))
OPTIONAL = Path("scripts/optional-skills.json")
PREFIX = "cawplan-"


def read(root: Path, rel: Path) -> dict:
    return json.loads((root / rel).read_text())


def dump(value: dict) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def skill_sets(root: Path):
    """Return (default, optional) skill directory names from the role config."""
    config = read(root, ROLES)
    default = list(config.get("common", []))
    for role in config.get("roles", {}).values():
        default += role.get("skills", [])
    default = list(dict.fromkeys(default))
    return default, list(config.get("optional", []))


def marketplace_entry(name: str) -> dict:
    return {"name": name[len(PREFIX):], "path": f"skills/{name}", "invoke": f"/{name}"}


def plugin_entry(name: str) -> dict:
    return {"name": name, "path": f"skills/{name}"}


def rendered(root: Path) -> dict:
    """Map each manifest path to the text render writes."""
    default, optional = skill_sets(root)
    out = {}

    market = read(root, MARKETPLACE)
    market["plugins"][0]["skills"] = [marketplace_entry(s) for s in default]
    market["plugins"][0]["optionalSkills"] = [marketplace_entry(s) for s in optional]
    out[MARKETPLACE] = dump(market)

    for rel in PLUGINS:
        plugin = read(root, rel)
        plugin["skills"] = [plugin_entry(s) for s in default]
        out[rel] = dump(plugin)

    opt = read(root, OPTIONAL)
    opt["skills"] = optional
    out[OPTIONAL] = dump(opt)
    return out


def check(root: Path) -> list:
    errors = []
    default, optional = skill_sets(root)
    folders = {p.name for p in (root / "skills").glob(f"{PREFIX}*") if (p / "SKILL.md").is_file()}
    # The public mirror ships without the export policy; it only exists here.
    public = set(read(root, PUBLIC_EXPORT).get("public_skills", [])) if (root / PUBLIC_EXPORT).exists() else set()

    for name in sorted(set(default) & set(optional)):
        errors.append(f"{ROLES}: {name} is both assigned to a role and listed as optional")
    for name in sorted(set(default) | set(optional)):
        if name not in folders:
            errors.append(f"{ROLES}: {name} has no skills/{name}/SKILL.md")
    for name in sorted(folders - set(default) - set(optional)):
        errors.append(f"skills/{name} is neither assigned to a role nor listed as optional in {ROLES}")
    for name in sorted(n for n in default if n.startswith(f"{PREFIX}internal-")):
        errors.append(f"{ROLES}: internal skill {name} must be optional, not assigned to a role")
    for name in sorted(public - set(default)):
        errors.append(f"{PUBLIC_EXPORT}: public skill {name} is not a default skill in {ROLES}")

    for rel, text in rendered(root).items():
        path = root / rel
        if not path.exists() or path.read_text() != text:
            errors.append(f"{rel} skill list is stale: run python3 scripts/manifests.py render")
    return errors


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", type=Path, default=ROOT, help=argparse.SUPPRESS)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("render")
    sub.add_parser("check")
    args = parser.parse_args(argv)

    if args.cmd == "render":
        for rel, text in rendered(args.root).items():
            (args.root / rel).write_text(text)
        return 0

    errors = check(args.root)
    for err in errors:
        print(f"::error::{err}")
    if not errors:
        default, optional = skill_sets(args.root)
        print(f"✓ plugin manifests match {ROLES} ({len(default)} default, {len(optional)} optional skills)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
