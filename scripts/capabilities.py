#!/usr/bin/env python3
"""Capability registry for transport-neutral skills.

Skills that reference references/CAPABILITIES.md name capabilities such as
`tickets.search` instead of a cawplan CLI command or an MCP tool. The agent
resolves each capability with the rules in CAPABILITIES.md.

  render                         regenerate references/CAPABILITIES.md and the
                                 per-skill copies from references/capabilities.json
  check                          validate the registry against the CLI source and
                                 the MCP tool snapshot, and lint resolver skills
  sync-mcp --core-product PATH   refresh references/mcp-tools.json from a
                                 CawPlan backend checkout
"""

import argparse
import json
import re
import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = Path("references/capabilities.json")
MCP_SNAPSHOT = Path("references/mcp-tools.json")
CANONICAL = Path("references/CAPABILITIES.md")
SKILL_REF = "references/CAPABILITIES.md"
CLI_COMMANDS = Path("cli/src/commands")
MCP_TOOLS_GO = Path("internal/handler/mcpserver/tools.go")

CAPABILITY_REF = re.compile(r"capability `([a-z0-9_.]+)`")
RAW_CLI = re.compile(r"(^|[`\s(])cawplan [a-z]", re.MULTILINE)

HEADER = """# CawPlan Capabilities

<!-- Generated from references/capabilities.json by scripts/capabilities.py render. Do not edit. -->

Skills name **capabilities** (for example `tickets.search`), not a transport. Resolve each capability to the `cawplan` CLI or to the CawPlan MCP server with these rules.

## Choose a route (required, before the first capability call)

Check the routes in this order and use the first one that works. Keep the order even when CawPlan MCP tools are available in the session: the CLI is checked first.

1. **CLI**: if you have a shell tool (for example Bash), run `cawplan skill check` before any CawPlan MCP call (it verifies the CLI version and sign-in; checking PATH alone is not enough). If it exits 0, use the CLI route for the rest of the session and do not call CawPlan MCP tools.
2. **MCP**: only if you have no shell tool or the CLI check fails, and the session has CawPlan MCP tools (the tool name ends with the MCP tool below, for example `mcp__cawplan__search_tickets`), use the MCP route.
3. **Neither**: tell the user to either install and sign in to the CLI (`npm install -g cawplan`, then `cawplan auth login`) or connect the CawPlan MCP server, then stop.

If the chosen route has no implementation for a capability (`-` below), use the other route when it is available; otherwise tell the user the capability is not available in this environment. Never fall back to raw HTTP requests.

## Call a capability

- Use the exact argument spelling below (for example `--display_ids`, not `--display-ids`); each capability has a complete example for both routes.
- MCP route: path and query arguments are top-level; request-body fields go inside `body`.
- Both routes return the CawPlan Open API envelope `{"code", "msg", "data"}`. Any `code` other than `SUCCESS` is an error. Read results the same way on either route.
- A capability marked **write** changes data: confirm the target and content with the user before calling it, on either route.

## Capabilities

| Capability | Write | CLI | MCP tool | Summary |
|---|---|---|---|---|
"""


def load(root: Path):
    registry = json.loads((root / REGISTRY).read_text())["capabilities"]
    tools = json.loads((root / MCP_SNAPSHOT).read_text())["tools"]
    return registry, tools


def cli_example(cli: dict, example: dict) -> str:
    positional, options = [], []
    for arg, spec in cli.get("args", {}).items():
        if arg not in example:
            continue
        value = example[arg]
        value = ",".join(value) if isinstance(value, list) else str(value)
        if re.search(r"[\s'\"$`;&|()]", value):
            value = shlex.quote(value)
        if spec.startswith("<"):
            positional.append(value)
        else:
            options += [spec.split()[0], value]
    return " ".join(["cawplan", cli["command"]] + positional + options)


def mcp_example(mcp: dict, example: dict) -> str:
    args = {}
    for arg, value in example.items():
        spec = mcp.get("args", {}).get(arg)
        if not spec:
            continue
        node, keys = args, spec.split()[0].split(".")
        for key in keys[:-1]:
            node = node.setdefault(key, {})
        node[keys[-1]] = value
    return "%s %s" % (mcp["tool"], json.dumps(args))


def render(registry: dict) -> str:
    rows, details = [], []
    for name in sorted(registry):
        cap = registry[name]
        cli = cap.get("cli")
        mcp = cap.get("mcp")
        cli_cell = "`cawplan %s`" % cli["command"] if cli else "-"
        mcp_cell = "`%s`" % mcp["tool"] if mcp else "-"
        mode = "write" if cap.get("write") else "read"
        rows.append(f"| `{name}` | {mode} | {cli_cell} | {mcp_cell} | {cap['summary']} |")
        args = sorted(set((cli or {}).get("args", {})) | set((mcp or {}).get("args", {})))
        details.append(f"\n### `{name}`\n")
        if args:
            details.append("| Argument | CLI | MCP |\n|---|---|---|")
            for arg in args:
                c = (cli or {}).get("args", {}).get(arg)
                m = (mcp or {}).get("args", {}).get(arg)
                details.append(f"| `{arg}` | {f'`{c}`' if c else '-'} | {f'`{m}`' if m else '-'} |")
        example = cap.get("example", {})
        details.append("\nExample:\n")
        if cli:
            details.append(f"- CLI: `{cli_example(cli, example)}`")
        if mcp:
            details.append(f"- MCP: `{mcp_example(mcp, example)}`")
    out = HEADER + "\n".join(rows) + "\n"
    if details:
        out += "\n## Arguments\n" + "\n".join(details) + "\n"
    return out


def resolver_skills(root: Path):
    for skill_md in sorted((root / "skills").glob("*/SKILL.md")):
        if SKILL_REF in skill_md.read_text():
            yield skill_md


def cli_command_errors(root: Path, name: str, cli: dict) -> list:
    group, *subs = cli["command"].split()
    for src in sorted((root / CLI_COMMANDS).glob("*.ts")):
        text = src.read_text()
        if not re.search(rf'program\s*\.command\(\s*"{re.escape(group)}"', text):
            continue
        errors = []
        # Subcommands may declare positional arguments: .command("get <product_id>").
        for sub in subs:
            if not re.search(rf'\.command\(\s*"{re.escape(sub)}[ "]', text):
                errors.append(f"{name}: CLI subcommand '{cli['command']}' not found in {src.relative_to(root)}")
        for flag in cli.get("args", {}).values():
            opt = flag.split()[0]
            if opt.startswith("--") and not re.search(rf'\.(?:option|requiredOption)\(\s*"{re.escape(opt)}[ ",]', text):
                errors.append(f"{name}: CLI option '{opt}' not found in {src.relative_to(root)}")
        return errors
    return [f"{name}: CLI command group '{group}' not found under {CLI_COMMANDS}"]


def check(root: Path) -> list:
    errors = []
    registry, tools = load(root)
    for name, cap in sorted(registry.items()):
        if not cap.get("cli") and not cap.get("mcp"):
            errors.append(f"{name}: needs a cli or mcp implementation")
        if cap.get("mcp") and cap["mcp"]["tool"] not in tools:
            errors.append(f"{name}: MCP tool '{cap['mcp']['tool']}' is not in {MCP_SNAPSHOT}")
        if cap.get("cli"):
            errors.extend(cli_command_errors(root, name, cap["cli"]))
        for arg in cap.get("example", {}):
            for route in ("cli", "mcp"):
                if cap.get(route) and arg not in cap[route].get("args", {}):
                    errors.append(f"{name}: example argument '{arg}' has no {route} mapping")

    expected = render(registry)
    canonical = root / CANONICAL
    if not canonical.exists() or canonical.read_text() != expected:
        errors.append(f"{CANONICAL} is stale: run python3 scripts/capabilities.py render")

    for skill_md in resolver_skills(root):
        rel = skill_md.relative_to(root)
        copy = skill_md.parent / SKILL_REF
        if not copy.exists() or copy.read_text() != expected:
            errors.append(f"{copy.relative_to(root)} missing or differs from {CANONICAL} (hosted bundles only skills/)")
        text = skill_md.read_text()
        refs = CAPABILITY_REF.findall(text)
        if not refs:
            errors.append(f"{rel}: references {SKILL_REF} but names no capability (write: capability `name`)")
        for ref in refs:
            if ref not in registry:
                errors.append(f"{rel}: unknown capability '{ref}'")
        if RAW_CLI.search(text):
            errors.append(f"{rel}: names a cawplan CLI command; use a capability instead")
        for tool in tools:
            if f"`{tool}`" in text or f"__{tool}" in text:
                errors.append(f"{rel}: names MCP tool '{tool}'; use a capability instead")
    return errors


def sync_mcp(root: Path, core_product: Path) -> None:
    source = (core_product / MCP_TOOLS_GO).read_text()
    names = re.findall(r'^\s*Name:\s*"([a-z_]+)"', source, re.MULTILINE)
    if not names:
        sys.exit(f"no tool names found in {core_product / MCP_TOOLS_GO}")
    sha = subprocess.check_output(["git", "-C", str(core_product), "rev-parse", "--short", "HEAD"], text=True).strip()
    snapshot = {
        "source": f"CawPlan backend {MCP_TOOLS_GO} @ {sha}",
        "refresh": "python3 scripts/capabilities.py sync-mcp --core-product <path to the CawPlan backend checkout>",
        "tools": names,
    }
    (root / MCP_SNAPSHOT).write_text(json.dumps(snapshot, indent=2) + "\n")
    print(f"wrote {MCP_SNAPSHOT} ({len(names)} tools @ {sha})")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", type=Path, default=ROOT, help=argparse.SUPPRESS)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("render")
    sub.add_parser("check")
    sync = sub.add_parser("sync-mcp")
    sync.add_argument("--core-product", type=Path, required=True)
    args = parser.parse_args(argv)

    if args.cmd == "render":
        registry, _ = load(args.root)
        text = render(registry)
        (args.root / CANONICAL).write_text(text)
        for skill_md in resolver_skills(args.root):
            copy = skill_md.parent / SKILL_REF
            copy.parent.mkdir(exist_ok=True)
            copy.write_text(text)
        return 0
    if args.cmd == "sync-mcp":
        sync_mcp(args.root, args.core_product)
        return 0

    errors = check(args.root)
    for err in errors:
        print(f"::error::{err}")
    if not errors:
        print("✓ capability registry and resolver skills are consistent")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
