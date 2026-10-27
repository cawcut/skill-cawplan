import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as http from "../src/lib/http.js";
import {
  formatAttachmentFileSize,
  renderAttachmentHtml,
  requestTicketAttachmentUploadUrl,
  uploadTicketAttachmentFiles,
} from "../src/lib/ticket-attachment-upload.js";
import {
  collectLocalRefs,
  extractReportBody,
  isLocalRef,
  mergeReportBlock,
  normalizeBlockId,
  rewriteLocalRefs,
} from "../src/lib/ticket-html-report.js";
import { addTicketAttachments } from "../src/lib/ticket-attachment-add.js";

const TICKET = {
  productId: "019d46c8-5084-7432-bbdd-f2972890d863",
  versionId: "01a055a1-fde1-7159-983a-8d00a3f03538",
  ticketId: "019f1a2b-3c4d-5e6f-7890-abcdef012345",
};
const TICKET_PATH = `/api/v1/public/openapi/product/${TICKET.productId}/versions/${TICKET.versionId}/tickets/${TICKET.ticketId}`;
const CDN = "https://cdn-attachment.example.com/attachments/ws";

function kindOf(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if ([".png", ".jpg", ".gif"].includes(ext)) return "image";
  if ([".mp4", ".mov"].includes(ext)) return "video";
  if (ext === ".pdf") return "pdf";
  return "file";
}

/** Fake BE: upload-url issues sequential keys; GET/PUT ticket are recorded. */
function mockBackend(
  opts: { field?: string; current?: string; version?: number; putStatuses?: number[]; contentType?: string } = {},
) {
  let n = 0;
  const puts: Array<Record<string, unknown>> = [];
  const putStatuses = [...(opts.putStatuses ?? [])];
  const spy = vi.spyOn(http, "cawplanRequest").mockImplementation(async (req) => {
    if (req.path.endsWith("/attachments/upload-url")) {
      const body = req.body as { filename: string; content_length: number };
      const key = `attachments/ws/2026/10/k${++n}${path.extname(body.filename)}`;
      return {
        code: "SUCCESS",
        data: {
          key,
          upload_url: `https://bucket.s3.amazonaws.com/${key}?X-Amz-Signature=put`,
          url: `https://cdn-attachment.example.com/${key}`,
          filename: body.filename,
          type: kindOf(body.filename),
          expires_at: 1_900_000_000,
          ...(opts.contentType ? { content_type: opts.contentType } : {}),
        },
      };
    }
    if (req.method === "GET" && req.path === TICKET_PATH) {
      return {
        code: "SUCCESS",
        data: { display_id: "CWP-1", version: opts.version ?? 7, [opts.field ?? "progress_comment"]: opts.current ?? "" },
      };
    }
    if (req.method === "PUT" && req.path === TICKET_PATH) {
      const status = putStatuses.shift();
      if (status === 409) throw new http.ApiError("API error 409: conflict", 409);
      puts.push(req.body as Record<string, unknown>);
      return { code: "SUCCESS", data: { version: (opts.version ?? 7) + 1 } };
    }
    throw new Error(`unexpected request ${req.method} ${req.path}`);
  });
  return { spy, puts };
}

function okFetch() {
  return vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("renderAttachmentHtml", () => {
  test("uses the editor attachment shapes", () => {
    const base = { url: `${CDN}/a.png`, bytes: 2048 };
    expect(renderAttachmentHtml({ ...base, filename: "a.png", type: "image" })).toBe(`<img src="${CDN}/a.png" alt="a.png">`);
    expect(renderAttachmentHtml({ ...base, url: `${CDN}/r.mov`, filename: "r.mov", type: "video" })).toBe(
      `<div data-type="video-attachment" class="video-attachment" data-src="${CDN}/r.mov" data-filename="r.mov" ` +
        `data-mime="video/quicktime"><span class="video-filename">r.mov</span></div>`,
    );
    expect(renderAttachmentHtml({ ...base, url: `${CDN}/d.pdf`, filename: "d.pdf", type: "pdf" })).toContain(
      `data-type="pdf-attachment" class="pdf-attachment" data-src="${CDN}/d.pdf" data-filename="d.pdf" data-file-size="2048"`,
    );
    expect(renderAttachmentHtml({ ...base, url: `${CDN}/l.log`, filename: `x"<y>.log`, type: "file" })).toContain(
      `data-type="zip-attachment" class="zip-attachment" data-src="${CDN}/l.log" data-filename="x&quot;&lt;y&gt;.log"`,
    );
  });

  test("formats sizes like the web editor", () => {
    expect(formatAttachmentFileSize(500)).toBe("500 B");
    expect(formatAttachmentFileSize(2048)).toBe("2 KB");
    expect(formatAttachmentFileSize(5 * 1024 * 1024 + 1)).toBe("5.0 MB");
    expect(formatAttachmentFileSize(50 * 1024 * 1024)).toBe("50 MB");
  });
});

describe("requestTicketAttachmentUploadUrl", () => {
  afterEach(() => vi.restoreAllMocks());

  test("posts filename and size to the version ticket route", async () => {
    const { spy } = mockBackend();
    await requestTicketAttachmentUploadUrl(TICKET, { filename: "a.png", contentLength: 12 });
    expect(spy).toHaveBeenCalledWith({
      method: "POST",
      path: `${TICKET_PATH}/attachments/upload-url`,
      body: { filename: "a.png", content_length: 12 },
    });
  });

  test("non-SUCCESS envelope becomes an error", async () => {
    vi.spyOn(http, "cawplanRequest").mockResolvedValue({ code: "FAILURE_INVALID_INPUT", msg: "file type is not allowed" });
    await expect(requestTicketAttachmentUploadUrl(TICKET, { filename: "a.exe", contentLength: 1 })).rejects.toThrow(
      "file type is not allowed",
    );
  });
});

describe("local reference rewriting", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "cawplan-report-"));
    mkdirSync(path.join(dir, "shots"));
    for (const f of ["shots/case 1.png", "shots/b.png", "rec.mp4", "log.txt", "spec.pdf"]) {
      writeFileSync(path.join(dir, f), "x".repeat(10));
    }
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("isLocalRef skips URLs, anchors and data URIs", () => {
    expect(isLocalRef("./a.png")).toBe(true);
    expect(isLocalRef("shots/a.png")).toBe(true);
    expect(isLocalRef("/abs/a.png")).toBe(true);
    expect(isLocalRef("file:///tmp/a.png")).toBe(true);
    for (const v of ["https://x/a.png", "//cdn/a.png", "#case-1", "data:image/png;base64,AA", "mailto:a@b", "", undefined]) {
      expect(isLocalRef(v)).toBe(false);
    }
  });

  const report = [
    `<h2>Case 1 <a href="#c1">#</a></h2>`,
    `<img src="./shots/case%201.png" width="320">`,
    `<p><a href="rec.mp4">recording</a> <a href="https://example.com/x">ext</a></p>`,
    `<a href="shots/b.png"><img src="shots/b.png"></a>`,
    `<video controls src="rec.mp4"></video>`,
    `<span data-type="zip-attachment" data-src="log.txt"></span>`,
    `<a href="spec.pdf">spec</a><img src="missing.png">`,
    `<img src="https://cdn.example.com/remote.png">`,
  ].join("\n");

  test("collects each local file once and reports missing files", () => {
    const collected = collectLocalRefs(report, dir);
    expect(collected.files.map((f) => path.relative(dir, f.path))).toEqual(["rec.mp4", "shots/b.png", "spec.pdf", "shots/case 1.png", "log.txt"]);
    expect(collected.files[0]!.refs).toEqual(["rec.mp4"]);
    expect(collected.missing).toEqual([expect.objectContaining({ element: "img", ref: "missing.png" })]);
  });

  test("rewrites references to editor attachments and keeps everything else", () => {
    const uploaded = new Map(
      collectLocalRefs(report, dir).files.map((f, i) => {
        const filename = path.basename(f.path);
        const type = kindOf(filename) as "image" | "video" | "pdf" | "file";
        const url = `${CDN}/u${i}${path.extname(filename)}`;
        return [f.path, { path: f.path, filename, type, bytes: 10, key: `k${i}`, url, html: "" }];
      }),
    );
    const out = rewriteLocalRefs(report, dir, uploaded);

    expect(out).toContain(`<a href="#c1">#</a>`);
    expect(out).toContain(`<img src="${CDN}/u3.png" width="320" alt="case 1.png">`);
    expect(out).toContain(`<p><div data-type="video-attachment" class="video-attachment" data-src="${CDN}/u0.mp4"`);
    expect(out).toContain(`<a href="https://example.com/x">ext</a>`);
    // The local link around the image collapses into a single image attachment.
    expect(out).toContain(`\n<img src="${CDN}/u1.png" alt="b.png">\n`);
    expect(out.match(/data-type="video-attachment"/g)).toHaveLength(2);
    expect(out).toContain(`<span data-type="zip-attachment" data-src="${CDN}/u4.txt" data-filename="log.txt" data-file-size="10"></span>`);
    expect(out).toContain(`data-type="pdf-attachment" class="pdf-attachment" data-src="${CDN}/u2.pdf"`);
    expect(out).toContain(`<img src="missing.png">`);
    expect(out).toContain(`<img src="https://cdn.example.com/remote.png">`);
  });

  test("extractReportBody keeps only body content", () => {
    const doc = `<!doctype html><html><head><title>T</title><style>p{}</style></head><body><p>hi</p><script>x()</script></body></html>`;
    expect(extractReportBody(doc)).toBe("<p>hi</p>");
    expect(extractReportBody(`<meta charset="utf-8"><p>a</p>`)).toBe("<p>a</p>");
  });
});

describe("mergeReportBlock", () => {
  const start = "<!-- cawplan-report:r1 -->";
  const end = "<!-- /cawplan-report:r1 -->";

  test("append adds, then upserts the same block id in place", () => {
    const first = mergeReportBlock("<p>old</p>", "<p>v1</p>", "append", "r1");
    expect(first).toBe(`<p>old</p>${start}<p>v1</p>${end}`);
    const second = mergeReportBlock(`${first}<p>tail</p>`, "<p>v2</p>", "append", "r1");
    expect(second).toBe(`<p>old</p>${start}<p>v2</p>${end}<p>tail</p>`);
  });

  test("replace overwrites the field", () => {
    expect(mergeReportBlock("<p>old</p>", "<p>v1</p>", "replace", "r1")).toBe(`${start}<p>v1</p>${end}`);
  });

  test("normalizeBlockId keeps marker-safe characters", () => {
    expect(normalizeBlockId(" QA run #3 -->")).toBe("QA-run-3");
    expect(normalizeBlockId("---")).toBe("report");
  });
});

describe("uploadTicketAttachmentFiles", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "cawplan-upload-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  test("PUTs bytes to the presigned URL without Authorization and reports failures", async () => {
    mockBackend();
    writeFileSync(path.join(dir, "a.png"), "12345");
    writeFileSync(path.join(dir, "empty.txt"), "");
    const fetchImpl = okFetch();

    const result = await uploadTicketAttachmentFiles(
      TICKET,
      [{ path: path.join(dir, "a.png") }, { path: path.join(dir, "empty.txt") }, { path: path.join(dir, "nope.png") }],
      { fetchImpl, concurrency: 2 },
    );

    expect(result.uploaded).toHaveLength(1);
    expect(result.uploaded[0]).toMatchObject({ filename: "a.png", type: "image", bytes: 5, key: "attachments/ws/2026/10/k1.png" });
    expect(result.uploaded[0]!.html).toBe(`<img src="https://cdn-attachment.example.com/attachments/ws/2026/10/k1.png" alt="a.png">`);
    expect(result.failed.map((f) => [f.filename, f.error.includes("empty") || f.error.includes("ENOENT")])).toEqual([
      ["empty.txt", true],
      ["nope.png", true],
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain("X-Amz-Signature=put");
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({ "content-type": "image/png", "content-length": "5" });
  });

  test("sends the server-signed content_type instead of guessing from the extension", async () => {
    mockBackend({ contentType: "application/octet-stream" });
    writeFileSync(path.join(dir, "notes.md"), "# hi");
    const fetchImpl = okFetch();

    const result = await uploadTicketAttachmentFiles(TICKET, [{ path: path.join(dir, "notes.md") }], { fetchImpl });

    expect(result.failed).toEqual([]);
    const [, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(init.headers).toEqual({ "content-type": "application/octet-stream", "content-length": "4" });
  });

  test("S3 error code is surfaced", async () => {
    mockBackend();
    writeFileSync(path.join(dir, "a.png"), "1");
    const fetchImpl = vi.fn(
      async () => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }),
    ) as unknown as typeof fetch;
    const result = await uploadTicketAttachmentFiles(TICKET, [{ path: path.join(dir, "a.png") }], { fetchImpl });
    expect(result.failed[0]!.error).toBe("upload failed: HTTP 403 AccessDenied");
  });
});

describe("addTicketAttachments", () => {
  let dir: string;
  let htmlFile: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "cawplan-submit-"));
    writeFileSync(path.join(dir, "a.png"), "123");
    writeFileSync(path.join(dir, "rec.mp4"), "123456");
    htmlFile = path.join(dir, "qa-results.html");
    writeFileSync(htmlFile, `<html><body><h2>Case 1</h2><img src="a.png"><a href="rec.mp4">rec</a></body></html>`);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  test("dry run lists files and touches nothing", async () => {
    const { spy } = mockBackend();
    const fetchImpl = okFetch();
    const summary = await addTicketAttachments(TICKET, { source: { kind: "html", path: htmlFile }, field: "progress_comment", mode: "append", dryRun: true, fetchImpl });
    expect(summary.block_id).toBe("qa-results");
    expect(summary.files.map((f) => [f.filename, f.bytes])).toEqual([["rec.mp4", 6], ["a.png", 3]]);
    expect(spy).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("missing reference stops before any upload", async () => {
    writeFileSync(htmlFile, `<img src="a.png"><img src="gone.png">`);
    const { spy } = mockBackend();
    const summary = await addTicketAttachments(TICKET, { source: { kind: "html", path: htmlFile }, field: "comment", mode: "append" });
    expect(summary.missing).toEqual([{ ref: "gone.png", element: "img" }]);
    expect(spy).not.toHaveBeenCalled();
  });

  test("failed upload does not update the ticket", async () => {
    const { puts } = mockBackend();
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const summary = await addTicketAttachments(TICKET, { source: { kind: "html", path: htmlFile }, field: "progress_comment", mode: "append", fetchImpl });
    expect(summary.failed).toHaveLength(2);
    expect(puts).toHaveLength(0);
  });

  test("uploads, merges into the field with the read version, and retries a 409", async () => {
    const { puts } = mockBackend({ current: "<p>earlier</p>", version: 7, putStatuses: [409] });
    const htmlOut = path.join(dir, "out.html");
    const summary = await addTicketAttachments(TICKET, {
      source: { kind: "html", path: htmlFile },
      field: "progress_comment",
      mode: "append",
      htmlOut,
      fetchImpl: okFetch(),
    });

    expect(summary.uploaded.map((u) => u.filename).sort()).toEqual(["a.png", "rec.mp4"]);
    expect(summary).toMatchObject({ display_id: "CWP-1", version: 8, field: "progress_comment" });
    expect(puts).toHaveLength(1);
    expect(puts[0]!.version).toBe(7);
    const value = puts[0]!.progress_comment as string;
    expect(value.startsWith("<p>earlier</p><!-- cawplan-report:qa-results --><h2>Case 1</h2><img src=\"https://cdn-attachment.example.com/")).toBe(true);
    expect(value).toContain(`data-type="video-attachment"`);
    expect(value.endsWith("<!-- /cawplan-report:qa-results -->")).toBe(true);
    expect(readFileSync(htmlOut, "utf8")).toBe(value.slice("<p>earlier</p><!-- cawplan-report:qa-results -->".length, -"<!-- /cawplan-report:qa-results -->".length));
  });
});
