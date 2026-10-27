import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("audit", Path(__file__).parents[1] / "audit-public-content.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class PublicContentAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Example Contributor")
        self.git("config", "user.email", "contributor@example.com")

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], stderr=subprocess.DEVNULL)

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-qm", "test fixture")

    def test_deleted_sensitive_content_is_still_detected_in_history(self):
        (self.repo / "example.txt").write_text("person" + "@" + "ui.com")
        self.commit()
        (self.repo / "example.txt").write_text("synthetic@example.com")
        self.commit()
        self.assertEqual(audit.scan(self.repo)["finding_count"], 0)
        result = audit.scan(self.repo, history=True)
        self.assertTrue(any(f["rule"] == "employee-email" for f in result["findings"]))
        self.assertNotIn("matches", result["findings"][0])

    def test_deleted_internal_skill_is_detected_as_a_prohibited_path(self):
        path = self.repo / "skills" / ("cawplan-" + "internal-demo") / "SKILL.md"
        path.parent.mkdir(parents=True)
        path.write_text("synthetic tooling")
        self.commit()
        path.unlink()
        self.commit()
        result = audit.scan(self.repo, history=True)
        self.assertTrue(any(f["rule"] == "prohibited-file" for f in result["findings"]))

    def test_company_email_is_allowed_only_in_commit_identity_fields(self):
        (self.repo / "example.txt").write_text("safe")
        self.git("config", "user.email", "person" + "@" + "ui.com")
        self.commit()
        result = audit.scan(self.repo, history=True)
        self.assertEqual(result["finding_count"], 0)
        self.git("commit", "--allow-empty", "-qm", "Contact person" + "@" + "ui.com")
        result = audit.scan(self.repo, history=True)
        self.assertTrue(any(f["path"] == "<commit>" for f in result["findings"]))

    def test_identity_shaped_message_does_not_bypass_email_scan(self):
        findings = []
        audit.inspect_commit(b"tree abc\n\nauthor Example <person" + b"@" + b"ui.com> 123 +0000\n", "fixture", findings)
        self.assertTrue(any(f["rule"] == "employee-email" for f in findings))

    def test_other_secrets_in_commit_identity_are_still_detected(self):
        findings = []
        audit.inspect_commit(b"author /Users/" + b"example-person <person" + b"@" + b"ui.com> 123 +0000\n\nSafe\n", "fixture", findings)
        self.assertTrue(any(f["rule"] == "personal-path" for f in findings))
        findings = []
        audit.inspect_commit(b"author Example <ghp_" + b"A" * 36 + b"@ui.com> 123 +0000\n\nSafe\n", "fixture", findings)
        self.assertTrue(any(f["rule"] == "provider-token" for f in findings))

    def test_company_email_in_files_is_not_exempted_by_commit_identity(self):
        self.git("config", "user.email", "person" + "@" + "ui.com")
        (self.repo / "example.txt").write_text("person" + "@" + "ui.com")
        self.commit()
        result = audit.scan(self.repo, history=True)
        self.assertTrue(any(f["path"] == "example.txt" and f["rule"] == "employee-email" for f in result["findings"]))

    def test_personal_paths_fail_but_generic_fixtures_pass(self):
        (self.repo / "example.txt").write_text("/Users/" + "example-person/work")
        self.commit()
        self.assertGreater(audit.scan(self.repo)["finding_count"], 0)
        (self.repo / "example.txt").write_text("/home/dev/work synthetic@example.com")
        self.assertEqual(audit.scan(self.repo)["finding_count"], 0)

    def test_new_binary_assets_need_explicit_review(self):
        (self.repo / "screenshot.png").write_bytes(b"\x89PNG\0example")
        self.commit()
        result = audit.scan(self.repo)
        self.assertTrue(any(f["rule"] == "unreviewed-binary" for f in result["findings"]))

    def test_text_with_nul_bytes_is_not_skipped(self):
        (self.repo / "example.ts").write_bytes(b"\0/Users/" + b"example-person/work")
        self.commit()
        result = audit.scan(self.repo, history=True)
        self.assertTrue(any(f["rule"] == "personal-path" for f in result["findings"]))


if __name__ == "__main__":
    unittest.main()
