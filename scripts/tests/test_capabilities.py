import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("capabilities", Path(__file__).parents[1] / "capabilities.py")
capabilities = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capabilities)

REGISTRY = {
    "capabilities": {
        "tickets.search": {
            "summary": "Find tickets.",
            "write": False,
            "cli": {"command": "tickets search", "args": {"display_ids": "--display_ids <csv>"}},
            "mcp": {"tool": "search_tickets", "args": {"display_ids": "body.display_ids"}},
        }
    }
}

CLI_SOURCE = """
const tickets = program.command("tickets").description("Manage tickets");
tickets.command("search").option("--display_ids <csv>", "Ticket display IDs");
"""

SKILL = """---
name: cawplan-example
---
Look up tickets with capability `tickets.search`. See `references/CAPABILITIES.md`.
"""


class CapabilityRegistryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.write("references/capabilities.json", json.dumps(REGISTRY))
        self.write("references/mcp-tools.json", json.dumps({"tools": ["search_tickets", "get_ticket"]}))
        self.write("cli/src/commands/tickets.ts", CLI_SOURCE)
        self.write("skills/cawplan-example/SKILL.md", SKILL)
        self.run_cli("render")

    def tearDown(self):
        self.temp.cleanup()

    def write(self, rel, text):
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def run_cli(self, *args):
        return capabilities.main(["--root", str(self.root), *args])

    def errors(self):
        return capabilities.check(self.root)

    def assert_error(self, fragment):
        errors = self.errors()
        self.assertTrue(any(fragment in e for e in errors), errors)

    def test_rendered_fixture_is_consistent(self):
        self.assertEqual([], self.errors())
        copy = self.root / "skills/cawplan-example/references/CAPABILITIES.md"
        self.assertEqual((self.root / "references/CAPABILITIES.md").read_text(), copy.read_text())

    def test_repository_registry_is_consistent(self):
        self.assertEqual([], capabilities.check(capabilities.ROOT))

    def test_unknown_capability_in_skill(self):
        self.write("skills/cawplan-example/SKILL.md", SKILL + "Then use capability `tickets.delete`.\n")
        self.assert_error("unknown capability 'tickets.delete'")

    def test_skill_must_not_name_cli_command(self):
        self.write("skills/cawplan-example/SKILL.md", SKILL + "Run `cawplan tickets search --display_ids X`.\n")
        self.assert_error("names a cawplan CLI command")

    def test_skill_must_not_name_mcp_tool(self):
        self.write("skills/cawplan-example/SKILL.md", SKILL + "Call mcp__cawplan__search_tickets.\n")
        self.assert_error("names MCP tool 'search_tickets'")

    def test_resolver_skill_needs_a_capability(self):
        self.write("skills/cawplan-example/SKILL.md", "See `references/CAPABILITIES.md`.\n")
        self.assert_error("names no capability")

    def test_stale_generated_docs(self):
        self.write("references/CAPABILITIES.md", "edited by hand\n")
        self.assert_error("is stale")
        self.write("skills/cawplan-example/references/CAPABILITIES.md", "edited by hand\n")
        self.assert_error("missing or differs")

    def test_mcp_tool_must_exist_in_snapshot(self):
        self.write("references/mcp-tools.json", json.dumps({"tools": ["get_ticket"]}))
        self.assert_error("MCP tool 'search_tickets' is not in")

    def test_cli_command_and_options_must_exist(self):
        self.write("cli/src/commands/tickets.ts", 'program.command("tickets");\ntickets.command("search");\n')
        self.assert_error("CLI option '--display_ids' not found")
        self.write("cli/src/commands/tickets.ts", 'program.command("tickets");\n')
        self.assert_error("CLI subcommand 'tickets search' not found")
        self.write("cli/src/commands/tickets.ts", "")
        self.assert_error("CLI command group 'tickets' not found")

    def test_nested_subcommand_with_positional_and_required_option(self):
        registry = json.loads(json.dumps(REGISTRY))
        registry["capabilities"]["knowledge.documents.get"] = {
            "summary": "Get a document.",
            "write": False,
            "cli": {"command": "knowledge documents get", "args": {"dataset_id": "--dataset <id>"}},
            "mcp": {"tool": "get_ticket", "args": {"dataset_id": "dataset_id"}},
            "example": {"dataset_id": "d1"},
        }
        registry["capabilities"]["backlog.get"] = {
            "summary": "Get a backlog ticket.",
            "write": False,
            "cli": {"command": "backlog get", "args": {"product_id": "<product_id>", "ticket_id": "<ticket_id>"}},
            "mcp": {"tool": "get_ticket", "args": {"product_id": "product_id", "ticket_id": "ticket_id"}},
            "example": {"ticket_id": "t1", "product_id": "p1"},
        }
        self.write("references/capabilities.json", json.dumps(registry))
        self.write(
            "cli/src/commands/knowledge.ts",
            'const knowledge = program.command("knowledge");\nconst documents = knowledge.command("documents");\n'
            'documents.command("get").requiredOption("--dataset <id>", "Dataset");\n',
        )
        self.write("cli/src/commands/backlog.ts", 'const backlog = program.command("backlog");\nbacklog.command("get <product_id> <ticket_id>");\n')
        self.run_cli("render")
        self.assertEqual([], self.errors())
        # Positional arguments render in declaration order, not example order.
        self.assertIn("`cawplan backlog get p1 t1`", (self.root / "references/CAPABILITIES.md").read_text())
        self.write("cli/src/commands/knowledge.ts", 'const knowledge = program.command("knowledge");\nknowledge.command("documents");\n')
        self.assert_error("CLI subcommand 'knowledge documents get' not found")

    def test_cli_example_quotes_values_with_spaces(self):
        cli = {"command": "tickets create-backlog", "args": {"product_id": "<product_id>", "description": "--description <text>"}}
        example = {"product_id": "p1", "description": "Login fails on Safari"}
        self.assertEqual(
            "cawplan tickets create-backlog p1 --description 'Login fails on Safari'",
            capabilities.cli_example(cli, example),
        )

    def test_sync_mcp_reads_tool_names(self):
        core = self.root / "core-product"
        tools_go = core / "internal/handler/mcpserver/tools.go"
        tools_go.parent.mkdir(parents=True)
        tools_go.write_text('var toolDefs = []toolDef{\n\t{\n\t\tName:  "list_products",\n\t},\n\t{\n\t\tName: "search_tickets",\n\t},\n}\n')
        for args in (["init", "-q"], ["add", "-A"], ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "x"]):
            subprocess.check_call(["git", "-C", str(core), *args])
        self.assertEqual(0, self.run_cli("sync-mcp", "--core-product", str(core)))
        snapshot = json.loads((self.root / "references/mcp-tools.json").read_text())
        self.assertEqual(["list_products", "search_tickets"], snapshot["tools"])


if __name__ == "__main__":
    unittest.main()
