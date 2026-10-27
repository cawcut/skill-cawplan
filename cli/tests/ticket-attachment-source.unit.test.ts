import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as http from "../src/lib/http.js";
import { collectFragmentRefs, rewriteFragments } from "../src/lib/ticket-html-report.js";
import { buildContent, buildDirectoryContent, renderMarkdown } from "../src/lib/ticket-attachment-source.js";
import { addTicketAttachments } from "../src/lib/ticket-attachment-add.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "cawplan-source-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content = "x") {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), content);
}

const rel = (p: string) => path.relative(dir, p);

describe("renderMarkdown", () => {
  test("renders images, links and raw HTML", () => {
    const html = renderMarkdown("# T\n\n![](<shots/case 1.png>) [rec](rec/录屏.mp4)\n\n<video src=\"a.mp4\"></video>");
    expect(html).toContain(`<img src="shots/case%201.png" alt="">`);
    expect(html).toContain(`<a href="rec/%E5%BD%95%E5%B1%8F.mp4">rec</a>`);
    expect(html).toContain(`<video src="a.mp4"></video>`);
  });

  test("percent-encoded Markdown links resolve to the local files", async () => {
    write("report.md", "![](<shots/case 1.png>)\n\n[录屏](rec/录屏.mp4)");
    write("shots/case 1.png");
    write("rec/录屏.mp4");
    const built = await buildContent({ kind: "md", path: path.join(dir, "report.md") });
    expect(built.defaultBlockId).toBe("report");
    const collected = collectFragmentRefs(built.fragments);
    expect(collected.missing).toEqual([]);
    expect(collected.files.map((f) => rel(f.path)).sort()).toEqual(["rec/录屏.mp4", "shots/case 1.png"]);
  });
});

describe("buildDirectoryContent", () => {
  beforeEach(() => {
    write("README.md", "# QA run\n\n| Case | Result |\n|---|---|\n| login | PASS |\n\nSee ![](overview.png)");
    write("overview.png");
    write("extra.har");
    write(".DS_Store");
    write("case-10-logout/1.png");
    write("case-2-login/notes.md", "Steps: open the page.\n\n![step 2](2.png)");
    write("case-2-login/other.md", "Second note.");
    write("case-2-login/1.png");
    write("case-2-login/2.png");
    write("case-2-login/rec/session.mp4");
    write("case-2-login/.hidden.png");
  });

  test("intro first, one section per case in natural order, loose files last", async () => {
    const fragments = await buildDirectoryContent(dir);
    expect(fragments.map((f) => rel(f.baseDir))).toEqual(["", "case-2-login", "case-10-logout", ""]);

    const [intro, login, logout, other] = fragments.map((f) => f.html);
    expect(intro).toContain("<table>");
    expect(intro).toContain(`<img src="overview.png" alt="">`);
    expect(login!.indexOf("<h3>case-2-login</h3>")).toBe(0);
    expect(login!.indexOf("Steps: open the page.")).toBeLessThan(login!.indexOf("Second note."));
    // 2.png is already referenced by the notes, so only 1.png and the recording are appended.
    expect(login!.match(/2\.png/g)).toHaveLength(1);
    expect(login).toContain(`<p><img src="1.png" alt="1.png"></p>`);
    expect(login).toContain(`<p><a href="rec/session.mp4">session.mp4</a></p>`);
    expect(login).not.toContain(".hidden");
    expect(logout).toBe(`<h3>case-10-logout</h3>\n<p><img src="1.png" alt="1.png"></p>`);
    // overview.png is referenced by the intro; only extra.har is loose.
    expect(other).toBe(`<h3>Attachments</h3>\n<p><a href="extra.har">extra.har</a></p>`);
  });

  test("same file name in different cases stays two attachments", async () => {
    const collected = collectFragmentRefs(await buildDirectoryContent(dir));
    expect(collected.missing).toEqual([]);
    expect(collected.files.map((f) => rel(f.path))).toEqual([
      "overview.png",
      "case-2-login/rec/session.mp4",
      "case-2-login/2.png",
      "case-2-login/1.png",
      "case-10-logout/1.png",
      "extra.har",
    ]);

    const uploaded = new Map(
      collected.files.map((f, i) => [
        f.path,
        { path: f.path, filename: path.basename(f.path), type: f.path.endsWith(".mp4") ? ("video" as const) : f.path.endsWith(".har") ? ("file" as const) : ("image" as const), bytes: 1, key: `k${i}`, url: `https://cdn/u${i}`, html: "" },
      ]),
    );
    const html = rewriteFragments(await buildDirectoryContent(dir), uploaded);
    expect(html).toContain(`<img src="https://cdn/u3" alt="1.png">`);
    expect(html).toContain(`<img src="https://cdn/u4" alt="1.png">`);
    expect(html).toContain(`data-type="video-attachment" class="video-attachment" data-src="https://cdn/u1"`);
    expect(html).not.toMatch(/(src|href)="(?!https:)/);
  });
});

describe("addTicketAttachments with a directory", () => {
  test("dry run uses the directory name as block id and lists every file", async () => {
    write("run-42/case-1/a.png");
    write("run-42/case-1/rec.mp4");
    const spy = vi.spyOn(http, "cawplanRequest");
    const summary = await addTicketAttachments(
      { productId: "p", versionId: "v", ticketId: "t" },
      { source: { kind: "dir", path: path.join(dir, "run-42") }, field: "comment", mode: "append", dryRun: true },
    );
    expect(summary.block_id).toBe("run-42");
    expect(summary.source.kind).toBe("dir");
    expect(summary.files.map((f) => f.filename).sort()).toEqual(["a.png", "rec.mp4"]);
    expect(summary.missing).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  test("an empty directory is rejected", async () => {
    mkdirSync(path.join(dir, "empty"));
    await expect(
      addTicketAttachments(
        { productId: "p", versionId: "v", ticketId: "t" },
        { source: { kind: "dir", path: path.join(dir, "empty") }, field: "comment", mode: "append", dryRun: true },
      ),
    ).rejects.toThrow("is empty");
  });
});

describe("plain files and notes", () => {
  test("a flat folder of files is listed without a heading", async () => {
    write("logs/app.log");
    write("logs/shot 2.png");
    write("logs/shot 10.png");
    const fragments = await buildDirectoryContent(path.join(dir, "logs"));
    expect(fragments).toHaveLength(1);
    expect(fragments[0]!.html).toBe(
      `<p><a href="app.log">app.log</a></p>\n<p><img src="shot 2.png" alt="shot 2.png"></p>\n<p><img src="shot 10.png" alt="shot 10.png"></p>`,
    );
  });

  test("--file keeps the given order and defaults to a timestamp block id", async () => {
    write("b.log");
    write("a.png");
    const built = await buildContent(
      { kind: "files", paths: [path.join(dir, "b.log"), path.join(dir, "a.png")] },
      new Date(2026, 9, 19, 8, 5, 3),
    );
    expect(built.defaultBlockId).toBe("attach-20261019-080503");
    expect(collectFragmentRefs(built.fragments).files.map((f) => rel(f.path))).toEqual(["b.log", "a.png"]);
  });

  test("--file rejects a directory and reports a missing file by its path", async () => {
    mkdirSync(path.join(dir, "folder"));
    await expect(buildContent({ kind: "files", paths: [path.join(dir, "folder")] })).rejects.toThrow("use --dir");
    const built = await buildContent({ kind: "files", paths: [path.join(dir, "nope.log")] });
    expect(collectFragmentRefs(built.fragments).missing.map((m) => m.ref)).toEqual([path.join(dir, "nope.log")]);
  });

  test("--note is rendered before the files and appends with a fresh block per run", async () => {
    write("crash.log", "boom");
    const puts: Array<Record<string, unknown>> = [];
    vi.spyOn(http, "cawplanRequest").mockImplementation(async (req) => {
      if (req.path.endsWith("/attachments/upload-url")) {
        const body = req.body as { filename: string };
        return {
          code: "SUCCESS",
          data: { key: "attachments/ws/k1.log", upload_url: "https://s3/put", url: "https://cdn/k1.log", filename: body.filename, type: "file", expires_at: 1 },
        };
      }
      if (req.method === "GET") return { code: "SUCCESS", data: { version: 3, comment: "<p>earlier</p>" } };
      puts.push(req.body as Record<string, unknown>);
      return { code: "SUCCESS", data: { version: 4 } };
    });
    const summary = await addTicketAttachments(
      { productId: "p", versionId: "v", ticketId: "t" },
      {
        source: { kind: "files", paths: [path.join(dir, "crash.log")] },
        note: "Crash log from **build 42**",
        field: "comment",
        mode: "append",
        fetchImpl: vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch,
      },
    );
    expect(summary.block_id).toMatch(/^attach-\d{8}-\d{6}$/);
    const value = puts[0]!.comment as string;
    expect(value.startsWith(`<p>earlier</p><!-- cawplan-report:${summary.block_id} --><p>Crash log from <strong>build 42</strong></p>`)).toBe(true);
    expect(value).toContain(`data-type="zip-attachment" class="zip-attachment" data-src="https://cdn/k1.log" data-filename="crash.log"`);
    expect(puts[0]!.version).toBe(3);
  });
});
