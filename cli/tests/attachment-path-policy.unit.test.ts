import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as http from "../src/lib/http.js";
import { isInsideBase, isWithin, sensitivePathReason } from "../src/lib/attachment-path-policy.js";
import { addTicketAttachments } from "../src/lib/ticket-attachment-add.js";
import { uploadTicketAttachmentFiles } from "../src/lib/ticket-attachment-upload.js";

const TICKET = { productId: "p", versionId: "v", ticketId: "t" };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "cawplan-policy-"));
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

  test("explicit --file paths are not confined", async () => {
    const summary = await addTicketAttachments(TICKET, {
      source: { kind: "files", paths: [path.join(dir, "outside.png")] },
      field: "comment",
      mode: "append",
      dryRun: true,
    });
    expect(summary.blocked).toEqual([]);
    expect(summary.files.map((f) => f.filename)).toEqual(["outside.png"]);
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
    const summary = await addTicketAttachments(TICKET, {
      source: { kind: "files", paths: [path.join(dir, "report/shots/a.png")] },
      note: `see ![](${path.join(dir, "outside.png")})`,
      field: "comment",
      mode: "append",
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
});
