#!/usr/bin/env python3
"""Scan tracked files or all reachable Git history without printing sensitive matches."""
import argparse
import collections
import json
import pathlib
import re
import subprocess
import sys

RULES = {
    "employee-email": r"[A-Za-z0-9._%+\-]+@(?:ui\.com|ubnt\.com|ubiquiti\.[A-Za-z]+)",
    "personal-path": r"/(?:Users|home|media)/(?!dev(?:[/\s\"'`<>\\]|$))[^\s/\"'`<>\\]+",
    "private-domain": r"(?:[A-Za-z0-9-]+\.)*(?:uid\.(?:dev|alpha|qa)\.ui\.com|ubiquiti\.atlassian\.net|unifihome\.testrail\.io|ubnt\.zendesk\.com|ui\.slack\.com)",
    "private-repository": r"\b(?:uid\.(?:core-product|core-web-product|slice)|uid\x2dchat|uid\x2dteam-skills|flow\.cawcut-pay|uid\x2drate-limiting)\b",
    "personal-identifier": r"(?i)\b(?:\x78in\.li|\x79upeng|\x73px|\x71ieqie|\x7aayne\.zhang)\b",
    "internal-skill-reference": r"\bcawplan\x2dinternal-[a-z0-9-]+",
    "private-key": r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
    "provider-token": r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,})\b",
}
PATTERNS = {name: re.compile(pattern) for name, pattern in RULES.items()}
FORBIDDEN_PATHS = [
    re.compile(pattern) for pattern in (
        r"^skills/cawplan\x2dinternal-[^/]+/",
        r"(?:^|/)(?:\.playwright-mcp|\.cawplan)/",
        r"\.jsonl$",
        r"(?:^|/)ai-daily-[^/]+\.json$",
        r"(?:^|/)(?:daily\.api|latest)\.json$",
        r"^docs/",
        r"(?:^|/)\.env(?:\.[^/]+)?$",
        r"\.(?:pem|key|p12|pfx)$",
    )
]
# Only model logo images are shipped; new binary assets need explicit review.
APPROVED_BINARY = re.compile(r"^cli/src/lib/assign/assets/model-(?:claude|cursor|gpt|deepseek)\.png$")
TEXT_SUFFIXES = {".ts", ".js", ".mjs", ".py", ".md", ".json", ".sh", ".yml", ".yaml", ".txt", ".toml"}


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args])


def inspect_text(data, path, oid, findings, employee_email_data=None):
    text = data.decode("utf-8", errors="replace")
    for name, pattern in PATTERNS.items():
        scanned = employee_email_data.decode("utf-8", errors="replace") if name == "employee-email" and employee_email_data is not None else text
        lines = sorted({scanned.count("\n", 0, match.start()) + 1 for match in pattern.finditer(scanned)})
        if lines:
            findings.append({"rule": name, "path": path, "object": oid, "lines": lines})


def inspect_path(path, oid, findings):
    if any(pattern.search(path) for pattern in FORBIDDEN_PATHS):
        findings.append({"rule": "prohibited-file", "path": path, "object": oid})


def inspect_commit(data, oid, findings):
    # Author/committer emails are deliberate public Git identity metadata.
    # Exempt only that field in valid headers, never names or the commit message.
    headers, separator, message = data.partition(b"\n\n")
    headers = re.sub(
        rb"^(author|committer) ([^\n]*) <([^<>\n]+)> (-?\d+) ([+-]\d{4})$",
        rb"\1 \2 <commit-identity@example.com> \4 \5", headers, flags=re.M)
    inspect_text(data, "<commit>", oid, findings, employee_email_data=headers + separator + message)


def scan(repo, history=False):
    findings = []
    objects = {}
    if history:
        for row in git(repo, "rev-list", "--objects", "--all").decode().splitlines():
            oid, _, path = row.partition(" ")
            objects[oid] = path
        paths = set(git(repo, "log", "--all", "--root", "--format=", "--name-only", "--no-renames", "--full-history").decode().splitlines())
        for path in sorted(paths - {""}):
            inspect_path(path, None, findings)
    else:
        for row in git(repo, "ls-files", "-z").decode().split("\0"):
            if row:
                objects[row] = row
    blob_count = binary_count = 0
    proc = subprocess.Popen(["git", "-C", str(repo), "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE) if history else None
    try:
        for oid, path in objects.items():
            if history:
                proc.stdin.write((oid + "\n").encode())
                proc.stdin.flush()
                header = proc.stdout.readline().decode().split()
                data = proc.stdout.read(int(header[2]))
                proc.stdout.read(1)
                kind = header[1]
                if kind == "commit":
                    inspect_commit(data, oid, findings)
                    continue
                if kind == "tag":
                    inspect_text(data, "<" + kind + ">", oid, findings)
                    continue
                if kind != "blob":
                    continue
            else:
                file = repo / path
                if file.is_symlink():
                    findings.append({"rule": "tracked-symlink-review", "path": path})
                    continue
                if not file.is_file():
                    continue
                data = file.read_bytes()
                inspect_path(path, oid, findings)
            blob_count += 1
            # Text files with NUL bytes still receive the full text scan.
            if b"\0" in data and pathlib.Path(path).suffix not in TEXT_SUFFIXES:
                binary_count += 1
                if not APPROVED_BINARY.fullmatch(path):
                    findings.append({"rule": "unreviewed-binary", "path": path, "object": oid})
            inspect_text(data, path, oid, findings)
    finally:
        if proc:
            proc.stdin.close()
            proc.wait()
            proc.stdout.close()
    if history:
        inspect_text(git(repo, "for-each-ref", "--format=%(refname)"), "<refs>", None, findings)
    return {"scope": "all-reachable-history" if history else "tracked-working-tree", "objects": len(objects), "blobs": blob_count, "binary_blobs": binary_count, "finding_count": len(findings), "findings": findings}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=pathlib.Path, default=pathlib.Path.cwd())
    parser.add_argument("--history", action="store_true")
    parser.add_argument("--report", type=pathlib.Path)
    args = parser.parse_args()
    result = scan(args.repo.resolve(), args.history)
    if args.report:
        args.report.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key != "findings"}, indent=2))
    for finding in result["findings"][:30]:
        print(f"{finding['rule']}: {finding['path']}", file=sys.stderr)
    return 1 if result["finding_count"] else 0


if __name__ == "__main__":
    sys.exit(main())
