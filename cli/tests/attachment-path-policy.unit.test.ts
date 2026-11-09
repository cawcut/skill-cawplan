import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as http from "../src/lib/http.js";
import {
  isInsideBase,
  isWithin,
  openUploadFile,
  sensitivePathReason,
  uploadPathRefusal,
  uploadScope,
  workspaceRoot,
} from "../src/lib/attachment-path-policy.js";
import { addTicketAttachments } from "../src/lib/ticket-attachment-add.js";
import { uploadTicketAttachmentFiles } from "../src/lib/ticket-attachment-upload.js";

const TICKET = { productId: "p", versionId: "v", ticketId: "t" };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "cawplan-policy-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content = "x") {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), content);
}

describe("isWithin / isInsideBase", () => {
  test("accepts paths below the root and rejects ../ escapes", () => {
    expect(isWithin("/a/b", "/a/b/c.png")).toBe(true);
    expect(isWithin("/a/b", "/a/b/..x/c.png")).toBe(true);
    expect(isWithin("/a/b", "/a/c.png")).toBe(false);
    expect(isWithin("/a/b", "/a/bc/c.png")).toBe(false);
  });

  test("a symlink inside the base that points out is outside", () => {
    write("base/in.png");
    write("secret.txt");
    symlinkSync(path.join(dir, "secret.txt"), path.join(dir, "base/link.png"));
    expect(isInsideBase(path.join(dir, "base/in.png"), path.join(dir, "base"))).toBe(true);
    expect(isInsideBase(path.join(dir, "base/link.png"), path.join(dir, "base"))).toBe(false);
  });
});

describe("sensitivePathReason", () => {
  test("refuses credential dirs, symlinks into them and .env files", () => {
    const home = path.join(dir, "home");
    write("home/.ssh/id_rsa");
    write("home/.aws/credentials");
    write("home/.cawplan/credentials.json");
    write("home/docs/a.png");
    write("proj/.env");
    write("proj/.env.local");
    write("proj/env.md");
    symlinkSync(path.join(home, ".ssh/id_rsa"), path.join(dir, "proj/key.png"));

    expect(sensitivePathReason(path.join(home, ".ssh/id_rsa"), home)).toBe("~/.ssh");
    expect(sensitivePathReason(path.join(home, ".aws/credentials"), home)).toBe("~/.aws");
    expect(sensitivePathReason(path.join(home, ".cawplan/credentials.json"), home)).toBe("~/.cawplan");
    expect(sensitivePathReason(path.join(dir, "proj/key.png"), home)).toBe("~/.ssh");
    expect(sensitivePathReason(path.join(dir, "proj/.env"), home)).toBe(".env");
    expect(sensitivePathReason(path.join(dir, "proj/.env.local"), home)).toBe(".env");
    expect(sensitivePathReason(path.join(dir, "proj/env.md"), home)).toBeUndefined();
    expect(sensitivePathReason(path.join(home, "docs/a.png"), home)).toBeUndefined();
  });

  test.each([
    ["home/.config/gh/hosts.yml", "~/.config/gh"],
    ["home/.config/gcloud/application_default_credentials.json", "~/.config/gcloud"],
    ["home/.kube/config", "~/.kube"],
    ["home/.gnupg/private-keys-v1.d/a.key", "~/.gnupg"],
    ["home/.azure/msal_token_cache.json", "~/.azure"],
    ["home/.docker/config.json", "~/.docker/config.json"],
    ["home/.claude/.credentials.json", "~/.claude/.credentials.json"],
    ["home/.codex/auth.json", "~/.codex/auth.json"],
    ["home/.netrc", ".netrc"],
    ["proj/.git-credentials", ".git-credentials"],
    ["proj/.npmrc", ".npmrc"],
    ["proj/.pypirc", ".pypirc"],
    ["proj/certs/server.pem", "*.pem"],
    ["proj/certs/TLS.KEY", "*.key"],
    ["proj/keys/id_ed25519", "id_* private key"],
    ["proj/keys/id_rsa", "id_* private key"],
    // CWP-26673 follow-up: files a cwd of ~ used to let through.
    ["home/Library/Keychains/login.keychain-db", "~/Library/Keychains"],
    ["home/Library/Application Support/Google/Chrome/Default/Cookies", "~/Library/Application Support/Google/Chrome"],
    ["home/Library/Application Support/BraveSoftware/Brave-Browser/Default/Login Data", "~/Library/Application Support/BraveSoftware"],
    ["home/Library/Application Support/Microsoft Edge/Default/Web Data", "~/Library/Application Support/Microsoft Edge"],
    ["home/Library/Application Support/Firefox/Profiles/x.default/key4.db", "~/Library/Application Support/Firefox"],
    ["home/Library/Safari/History.db", "~/Library/Safari"],
    ["home/Library/Cookies/Cookies.binarycookies", "~/Library/Cookies"],
    ["home/.config/google-chrome/Default/Preferences", "~/.config/google-chrome"],
    ["home/.config/chromium/Default/Preferences", "~/.config/chromium"],
    ["home/.mozilla/firefox/x.default/places.sqlite", "~/.mozilla"],
    ["home/.zsh_history", "shell history"],
    ["home/.bash_history", "shell history"],
    ["home/.local/share/fish/fish_history", "shell history"],
    ["home/.zsh_sessions/abc.history", "~/.zsh_sessions"],
    ["proj/.envrc", ".envrc"],
    ["home/.vault-token", ".vault-token"],
    ["home/.pgpass", ".pgpass"],
    ["home/.terraform.d/credentials.tfrc.json", "~/.terraform.d"],
    ["home/.config/op/config", "~/.config/op"],
    ["proj/backup/Cookies", "cookies"],
    ["proj/backup/Login Data", "login data"],
    ["proj/backup/cookies.sqlite", "cookies.sqlite"],
    ["proj/certs/client.p12", "*.p12"],
    ["proj/certs/client.PFX", "*.pfx"],
    ["proj/android/release.jks", "*.jks"],
    ["proj/android/debug.keystore", "*.keystore"],
    ["proj/putty.ppk", "*.ppk"],
    ["proj/vault.kdbx", "*.kdbx"],
    ["proj/old.keychain", "*.keychain"],
    ["proj/keys/id_rsa.bak", "SSH private key"],
    ["proj/keys/id_ed25519.old", "SSH private key"],
    ["proj/keys/github_rsa", "SSH private key"],
    ["proj/keys/deploy_ed25519", "SSH private key"],
    ["proj/keys/work_ecdsa", "SSH private key"],
    ["proj/keys/backup_ed25519_sk", "SSH private key"],
    ["proj/keys/github_rsa.bak", "SSH private key"],
    ["proj/etc/ssh_host_ed25519_key", "SSH host key"],
  ])("refuses %s", (rel, reason) => {
    write(rel);
    expect(sensitivePathReason(path.join(dir, rel), path.join(dir, "home"))).toBe(reason);
  });

  test.each([
    "home/.docker/daemon.json",
    "home/.claude/settings.json",
    "home/.codex/config.toml",
    "home/.config/other/a.json",
    "proj/keys/id_ed25519.pub",
    "proj/keys/github_rsa.pub",
    "proj/keys/id_rsa.bak.pub",
    "proj/etc/ssh_host_ed25519_key.pub",
    "proj/id_card.png",
    "proj/keyboard.png",
    "proj/rsa_notes.md",
    "proj/my_rsa_notes.txt",
    "proj/history.md",
    "proj/cookies.md",
    "home/Library/Application Support/Code/User/settings.json",
    "home/.config/other/a.json",
  ])("allows %s", (rel) => {
    write(rel);
    expect(sensitivePathReason(path.join(dir, rel), path.join(dir, "home"))).toBeUndefined();
  });

  test("resolves symlinks to credential files and to symlinked credential dirs", () => {
    const home = path.join(dir, "home");
    write("home/.netrc");
    write("store/kube/config");
    mkdirSync(home, { recursive: true });
    symlinkSync(path.join(dir, "store/kube"), path.join(home, ".kube"));
    symlinkSync(path.join(home, ".netrc"), path.join(dir, "notes.txt"));
    symlinkSync(path.join(dir, "store/kube/config"), path.join(dir, "cluster.png"));

    expect(sensitivePathReason(path.join(dir, "notes.txt"), home)).toBe(".netrc");
    expect(sensitivePathReason(path.join(dir, "cluster.png"), home)).toBe("~/.kube");
  });
});

describe("workspaceRoot", () => {
  test("is the enclosing git repository, or the directory itself outside one", () => {
    write("repo/.git/HEAD");
    write("repo/src/a.ts");
    write("plain/a.txt");
    const real = (rel: string) => realpathSync.native(path.join(dir, rel));
    expect(workspaceRoot(path.join(dir, "repo/src"))).toBe(real("repo"));
    expect(workspaceRoot(path.join(dir, "plain"))).toBe(real("plain"));
  });
});

describe("uploadScope", () => {
  const real = (rel: string) => realpathSync.native(path.join(dir, rel));

  test("a project directory confines uploads to itself", () => {
    write("home/proj/a.png");
    write("home/other.txt");
    const scope = uploadScope(path.join(dir, "home/proj"), path.join(dir, "home"));
    expect(scope.tooBroad).toBe(false);
    expect(scope.workspace).toBe(real("home/proj"));
    expect(uploadPathRefusal(path.join(dir, "home/proj/a.png"), scope)).toBeUndefined();
    expect(uploadPathRefusal(path.join(dir, "home/other.txt"), scope)).toMatch(/^refused: outside the current directory/);
  });

  test("a cwd of $HOME, above it or the filesystem root confines nothing", () => {
    write("home/.zsh_history");
    write("home/Documents/secret.txt");
    write("home/proj/a.png");
    const home = path.join(dir, "home");
    for (const cwd of [home, dir, path.parse(dir).root]) {
      const scope = uploadScope(cwd, home);
      expect(scope.tooBroad).toBe(true);
      for (const rel of ["home/Documents/secret.txt", "home/proj/a.png"]) {
        expect(uploadPathRefusal(path.join(dir, rel), scope)).toMatch(/is your home directory or above it/);
      }
      expect(uploadPathRefusal(path.join(dir, "home/.zsh_history"), scope)).toMatch(/^refused: credential file/);
    }
    // --allow-outside-cwd (no scope) lets them through; credential files stay refused.
    expect(uploadPathRefusal(path.join(dir, "home/Documents/secret.txt"), undefined)).toBeUndefined();
    expect(uploadPathRefusal(path.join(dir, "home/.zsh_history"), undefined)).toMatch(/^refused: credential file/);
  });

  test("a git repository at $HOME (dotfiles) is not a workspace", () => {
    write("home/.git/HEAD");
    write("home/proj/a.png");
    write("home/Documents/secret.txt");
    const home = path.join(dir, "home");
    expect(uploadScope(home, home).tooBroad).toBe(true);
    // Below it the current directory is the workspace, not the whole home.
    const scope = uploadScope(path.join(home, "proj"), home);
    expect(scope).toMatchObject({ tooBroad: false, workspace: real("home/proj") });
    expect(uploadPathRefusal(path.join(home, "proj/a.png"), scope)).toBeUndefined();
    expect(uploadPathRefusal(path.join(home, "Documents/secret.txt"), scope)).toMatch(/^refused: outside the current directory/);
  });

  test("the CLI's own temp dirs are allowed from any directory", () => {
    const staged = path.join(os.tmpdir(), "cawplan-ai-daily", `policy-test-${process.pid}.md`);
    mkdirSync(path.dirname(staged), { recursive: true });
    writeFileSync(staged, "x");
    try {
      const home = path.join(dir, "home");
      mkdirSync(home, { recursive: true });
      expect(uploadPathRefusal(staged, uploadScope(home, home))).toBeUndefined();
      expect(uploadPathRefusal(staged, uploadScope(dir, home))).toBeUndefined();
    } finally {
      rmSync(staged, { force: true });
    }
  });
});

describe("openUploadFile", () => {
  test("refuses before opening and reads the checked real path", async () => {
    write("proj/a.txt", "public");
    write("proj/.env", "TOKEN=1");
    symlinkSync(path.join(dir, "proj/a.txt"), path.join(dir, "proj/link.txt"));
    const scope = uploadScope(path.join(dir, "proj"), path.join(dir, "home"));
    await expect(openUploadFile(path.join(dir, "proj/.env"), scope)).rejects.toThrow(/credential file \(\.env\)/);
    const opened = await openUploadFile(path.join(dir, "proj/link.txt"), scope);
    try {
      expect(opened.realPath).toBe(realpathSync.native(path.join(dir, "proj/a.txt")));
      expect(opened.bytes).toBe(6);
    } finally {
      await opened.handle.close();
    }
  });
});

describe("addTicketAttachments reference confinement", () => {
  beforeEach(() => {
    write("outside.png");
    write("report/shots/a.png");
    symlinkSync(path.join(dir, "outside.png"), path.join(dir, "report/shots/link.png"));
  });

  const md = (body: string) => {
    write("report/notes.md", body);
    return { kind: "md" as const, path: path.join(dir, "report/notes.md") };
  };

  test("../, absolute, file: and symlinked references are blocked without touching the backend", async () => {
    const spy = vi.spyOn(http, "cawplanRequest");
    const outside = path.join(dir, "outside.png");
    const source = md(
      `![](shots/a.png) ![](../outside.png) ![](${outside}) [f](${pathToFileURL(outside).href}) ![](shots/link.png)`,
    );
    const summary = await addTicketAttachments(TICKET, { source, field: "comment", mode: "append" });
    expect(summary.files.map((f) => f.filename)).toEqual(["a.png"]);
    expect(summary.blocked).toHaveLength(2); // outside.png (3 spellings) and the symlink
    expect(summary.blocked.every((b) => b.reason === "outside_base")).toBe(true);
    expect(summary.blocked.find((b) => b.path === outside)!.refs).toHaveLength(3);
    expect(spy).not.toHaveBeenCalled();
  });

  test("--allow-outside-base lets them through and marks them in the dry run", async () => {
    const summary = await addTicketAttachments(TICKET, {
      source: md("![](shots/a.png) ![](../outside.png)"),
      field: "comment",
      mode: "append",
      allowOutsideBase: true,
      dryRun: true,
    });
    expect(summary.blocked).toEqual([]);
    expect(summary.files.map((f) => [f.filename, f.outside_base])).toEqual([
      ["a.png", undefined],
      ["outside.png", true],
    ]);
  });

  test("--base-dir moves the boundary", async () => {
    const summary = await addTicketAttachments(TICKET, {
      source: md("![](report/shots/a.png) ![](outside.png)"),
      baseDir: dir,
      field: "comment",
      mode: "append",
      dryRun: true,
    });
    expect(summary.blocked).toEqual([]);
    expect(summary.files).toHaveLength(2);
  });

  test("credential files stay blocked even with --allow-outside-base or as an explicit --file", async () => {
    write("report/.env", "TOKEN=1");
    const viaDoc = await addTicketAttachments(TICKET, {
      source: md("[env](.env)"),
      field: "comment",
      mode: "append",
      allowOutsideBase: true,
      dryRun: true,
    });
    expect(viaDoc.blocked).toEqual([
      { path: path.join(dir, "report/.env"), refs: [".env"], reason: "sensitive", detail: ".env" },
    ]);
    const viaFile = await addTicketAttachments(TICKET, {
      source: { kind: "files", paths: [path.join(dir, "report/.env")] },
      field: "comment",
      mode: "append",
      dryRun: true,
    });
    expect(viaFile.blocked.map((b) => b.reason)).toEqual(["sensitive"]);
    expect(viaFile.files).toEqual([]);
  });

  test("explicit --file paths must stay inside the current directory unless --allow-outside-cwd", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(path.join(dir, "report"));
    const files = (allowOutsideCwd?: boolean) => addTicketAttachments(TICKET, {
      source: {
        kind: "files",
        paths: [path.join(dir, "report/shots/a.png"), path.join(dir, "outside.png"), path.join(dir, "report/shots/link.png")],
      },
      field: "comment",
      mode: "append",
      allowOutsideCwd,
      dryRun: true,
    });

    const confined = await files();
    expect(confined.files.map((f) => f.filename)).toEqual(["a.png"]);
    // The symlink inside the cwd resolves to outside.png, so it is outside too.
    expect(confined.blocked.map((b) => [path.basename(b.path), b.reason])).toEqual([
      ["outside.png", "outside_cwd"],
      ["link.png", "outside_cwd"],
    ]);
    expect(confined.blocked[0]!.detail).toBe(realpathSync.native(path.join(dir, "report")));

    const allowed = await files(true);
    expect(allowed.blocked).toEqual([]);
    expect(allowed.files.map((f) => f.filename)).toEqual(["a.png", "outside.png", "link.png"]);
  });

  test("--dir sections may reference files elsewhere under the --dir root, not above it", async () => {
    write("run/overview.png");
    write("run/case-1/notes.md", "![](../overview.png) ![](../../outside.png)");
    const summary = await addTicketAttachments(TICKET, {
      source: { kind: "dir", path: path.join(dir, "run") },
      field: "comment",
      mode: "append",
      dryRun: true,
    });
    expect(summary.files.map((f) => f.filename)).toContain("overview.png");
    expect(summary.blocked.map((b) => [path.basename(b.path), b.reason])).toEqual([["outside.png", "outside_base"]]);
  });

  test("--note references are confined to the current directory", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(path.join(dir, "report"));
    const summary = await addTicketAttachments(TICKET, {
      source: { kind: "files", paths: [path.join(dir, "report/shots/a.png")] },
      note: `see ![](${path.join(dir, "outside.png")})`,
      field: "comment",
      mode: "append",
      allowOutsideCwd: true,
      dryRun: true,
    });
    expect(summary.blocked.map((b) => [path.basename(b.path), b.reason])).toEqual([["outside.png", "outside_base"]]);
  });
});

describe("uploadTicketAttachmentFiles", () => {
  test("refuses credential files before requesting an upload URL", async () => {
    write(".env", "TOKEN=1");
    const spy = vi.spyOn(http, "cawplanRequest");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await uploadTicketAttachmentFiles(TICKET, [{ path: path.join(dir, ".env") }], { fetchImpl });
    expect(result.uploaded).toEqual([]);
    expect(result.failed[0]!.error).toBe("refused: credential file (.env) is never uploaded");
    expect(spy).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("streams the file that was checked even if the path is swapped to another target mid-upload", async () => {
    write("report/a.png", "public");
    write("secret.txt", "SECRET");
    const link = path.join(dir, "report/shot.png");
    symlinkSync(path.join(dir, "report/a.png"), link);
    vi.spyOn(http, "cawplanRequest").mockImplementation(async () => {
      // Swap the symlink after the policy check, before the PUT reads the file.
      unlinkSync(link);
      symlinkSync(path.join(dir, "secret.txt"), link);
      return { code: "SUCCESS", data: { key: "k", upload_url: "https://s3/put", url: "https://cdn/a", filename: "shot.png", type: "file" } };
    });
    let sent = "";
    const fetchImpl = vi.fn(async (_url: unknown, init: RequestInit) => {
      sent = await new Response(init.body as BodyInit).text();
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const scope = uploadScope(path.join(dir, "report"), path.join(dir, "home"));
    const result = await uploadTicketAttachmentFiles(TICKET, [{ path: link }], { fetchImpl, scope });
    expect(result.failed).toEqual([]);
    expect(sent).toBe("public");
  });

  test("refuses files outside the given scope before requesting an upload URL", async () => {
    write("report/a.png");
    write("outside.png");
    const spy = vi.spyOn(http, "cawplanRequest");
    const scope = uploadScope(path.join(dir, "report"), path.join(dir, "home"));
    const result = await uploadTicketAttachmentFiles(TICKET, [{ path: path.join(dir, "outside.png") }], { scope });
    expect(result.failed[0]!.error).toMatch(/^refused: outside the current directory/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("addTicketAttachments with a cwd of $HOME", () => {
  test("blocks every file as broad_cwd unless --allow-outside-cwd", async () => {
    const home = path.join(dir, "home");
    write("home/Documents/report.pdf");
    vi.spyOn(os, "homedir").mockReturnValue(home);
    vi.spyOn(process, "cwd").mockReturnValue(home);
    const add = (allowOutsideCwd?: boolean) => addTicketAttachments(TICKET, {
      source: { kind: "files", paths: [path.join(home, "Documents/report.pdf")] },
      field: "comment",
      mode: "append",
      allowOutsideCwd,
      dryRun: true,
    });
    const refused = await add();
    expect(refused.blocked.map((b) => [path.basename(b.path), b.reason, b.detail])).toEqual([
      ["report.pdf", "broad_cwd", realpathSync.native(home)],
    ]);
    expect((await add(true)).files.map((f) => f.filename)).toEqual(["report.pdf"]);
  });
});

describe("addTicketAttachments source documents", () => {
  test("a credential file as --md-file is refused even with --allow-outside-cwd", async () => {
    const home = path.join(dir, "home");
    write("home/.zsh_history", "export TOKEN=1");
    vi.spyOn(os, "homedir").mockReturnValue(home);
    await expect(addTicketAttachments(TICKET, {
      source: { kind: "md", path: path.join(home, ".zsh_history") },
      field: "comment",
      mode: "append",
      allowOutsideCwd: true,
      dryRun: true,
    })).rejects.toThrow(/credential file \(shell history\)/);
  });

  test("--dir / --md-file / --base-dir outside the cwd need --allow-outside-cwd", async () => {
    write("elsewhere/run/a.png");
    write("elsewhere/notes.md", "![](run/a.png)");
    write("cwd/notes.md", "![](run/a.png)");
    vi.spyOn(process, "cwd").mockReturnValue(path.join(dir, "cwd"));
    const base = { field: "comment" as const, mode: "append" as const, dryRun: true };
    await expect(addTicketAttachments(TICKET, { ...base, source: { kind: "dir", path: path.join(dir, "elsewhere/run") } }))
      .rejects.toThrow(/outside the current directory or git repository/);
    await expect(addTicketAttachments(TICKET, { ...base, source: { kind: "md", path: path.join(dir, "elsewhere/notes.md") } }))
      .rejects.toThrow(/outside the current directory or git repository/);
    await expect(addTicketAttachments(TICKET, {
      ...base,
      source: { kind: "md", path: path.join(dir, "cwd/notes.md") },
      baseDir: path.join(dir, "elsewhere"),
    })).rejects.toThrow(/outside the current directory or git repository/);
    const allowed = await addTicketAttachments(TICKET, {
      ...base,
      source: { kind: "dir", path: path.join(dir, "elsewhere/run") },
      allowOutsideCwd: true,
    });
    expect(allowed.files.map((f) => f.filename)).toEqual(["a.png"]);
  });
});
