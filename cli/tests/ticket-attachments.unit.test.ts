import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as http from "../src/lib/http.js";
import {
  defaultAttachmentOutDir,
  downloadTicketAttachments,
  filterTicketAttachments,
  parseAttachmentTypesCsv,
  requestTicketAttachments,
  sanitizeAttachmentFilename,
  uniqueAttachmentFilename,
  unwrapTicketAttachmentList,
  type TicketAttachment,
  type TicketAttachmentList,
} from "../src/lib/ticket-attachments.js";

const PRODUCT = "019d46c8-5084-7432-bbdd-f2972890d863";
const VERSION = "01a055a1-fde1-7159-983a-8d00a3f03538";
const UNIQUE = "019f1a2b-3c4d-5e6f-7890-abcdef012345";

function attachment(overrides: Partial<TicketAttachment>): TicketAttachment {
  return {
    key: "attachments/2026/07/a.png",
    filename: "a.png",
    type: "image",
    source_field: "remarks",
    signed_url: "https://bucket.s3.amazonaws.com/attachments/2026/07/a.png?X-Amz-Signature=x",
    expires_at: 1_900_000_000,
    ...overrides,
  };
}

describe("requestTicketAttachments", () => {
  afterEach(() => vi.restoreAllMocks());

  test("version ticket path with expires_in", async () => {
    const request = vi.spyOn(http, "cawplanRequest").mockResolvedValue({ code: "SUCCESS", data: {} });
    await requestTicketAttachments({ productId: PRODUCT, versionId: VERSION, ticketId: UNIQUE, expiresIn: "120" });
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: `/api/v1/public/openapi/product/${PRODUCT}/versions/${VERSION}/tickets/${UNIQUE}/attachments`,
      query: { expires_in: "120" },
    });
  });

  test("backlog ticket path", async () => {
    const request = vi.spyOn(http, "cawplanRequest").mockResolvedValue({ code: "SUCCESS", data: {} });
    await requestTicketAttachments({ productId: PRODUCT, ticketId: UNIQUE });
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: `/api/v1/public/openapi/product/${PRODUCT}/tickets/${UNIQUE}/attachments`,
      query: {},
    });
  });
});

describe("unwrapTicketAttachmentList", () => {
  test("returns data on SUCCESS", () => {
    const data: TicketAttachmentList = { ticket_id: UNIQUE, attachments: [attachment({})] };
    expect(unwrapTicketAttachmentList({ code: "SUCCESS", msg: "success", data })).toBe(data);
  });

  test("throws on failure envelope", () => {
    expect(() =>
      unwrapTicketAttachmentList({ code: "FAILURE_INTERNAL_ERROR", msg: "attachments bucket is not configured", data: {} }),
    ).toThrow(/attachments bucket is not configured/);
  });
});

describe("filters", () => {
  const list = [
    attachment({ key: "k1", type: "image" }),
    attachment({ key: "k2", type: "pdf" }),
    attachment({ key: "k3", type: "file" }),
  ];

  test("by key and type", () => {
    expect(filterTicketAttachments(list, {}).map((a) => a.key)).toEqual(["k1", "k2", "k3"]);
    expect(filterTicketAttachments(list, { keys: ["k2", "k3"] }).map((a) => a.key)).toEqual(["k2", "k3"]);
    expect(filterTicketAttachments(list, { types: ["image", "file"] }).map((a) => a.key)).toEqual(["k1", "k3"]);
    expect(filterTicketAttachments(list, { keys: ["k1"], types: ["pdf"] })).toEqual([]);
  });

  test("parseAttachmentTypesCsv validates tokens", () => {
    expect(parseAttachmentTypesCsv(" PDF, image ")).toEqual(["pdf", "image"]);
    expect(() => parseAttachmentTypesCsv("pdf,exe")).toThrow(/invalid --type: exe/);
    expect(() => parseAttachmentTypesCsv(",")).toThrow(/invalid --type/);
  });
});

describe("sanitizeAttachmentFilename", () => {
  test.each([
    ["usage-metrics.md", "usage-metrics.md"],
    ["../../.ssh/authorized_keys", "authorized_keys"],
    ["..\\..\\evil.bat", "evil.bat"],
    ["..", "fallback.png"],
    ["", "fallback.png"],
    ["  .hidden  ", "hidden"],
    ["a\u0000b\nc:d?.txt", "a_b_c_d_.txt"],
    ["录屏 2026-08-12.mov", "录屏 2026-08-12.mov"],
  ])("%j -> %j", (input, expected) => {
    expect(sanitizeAttachmentFilename(input, "attachments/2026/07/fallback.png")).toBe(expected);
  });

  test("truncates long names but keeps the extension", () => {
    const name = sanitizeAttachmentFilename(`${"文".repeat(200)}.pdf`, "k");
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(200);
    expect(name.endsWith(".pdf")).toBe(true);
  });
});

describe("filesystem", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "cawplan-attachments-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("uniqueAttachmentFilename avoids duplicates and existing files", () => {
    writeFileSync(path.join(dir, "image.png"), "x");
    const taken = new Set<string>();
    expect(uniqueAttachmentFilename(dir, "image.png", taken)).toBe("image (1).png");
    expect(uniqueAttachmentFilename(dir, "image.png", taken)).toBe("image (2).png");
    expect(uniqueAttachmentFilename(dir, "Notes", taken)).toBe("Notes");
    expect(uniqueAttachmentFilename(dir, "notes", taken)).toBe("notes (1)");
  });

  test("defaultAttachmentOutDir uses display id", () => {
    expect(defaultAttachmentOutDir({ ticket_id: UNIQUE, display_id: "CWP-1", attachments: [] }, dir)).toBe(
      path.join(dir, "cawplan-attachments", "CWP-1"),
    );
    expect(defaultAttachmentOutDir({ ticket_id: UNIQUE, attachments: [] }, dir)).toBe(
      path.join(dir, "cawplan-attachments", UNIQUE),
    );
  });

  test("downloads without Authorization, hashes content, reports failures", async () => {
    const payload = Buffer.from("hello attachment");
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      if (String(url).includes("missing")) return new Response("denied", { status: 403 });
      return new Response(payload, { status: 200 });
    }) as unknown as typeof fetch;

    const list: TicketAttachmentList = {
      ticket_id: UNIQUE,
      display_id: "CWP-1",
      attachments: [
        attachment({ key: "attachments/2026/07/a.png", filename: "image.png" }),
        attachment({ key: "attachments/2026/07/b.png", filename: "image.png" }),
        attachment({ key: "attachments/2026/07/c.har", filename: "../../escape.har", type: "file" }),
        attachment({ key: "attachments/2026/07/d.pdf", filename: "d.pdf", type: "pdf", signed_url: "https://x/missing" }),
      ],
    };

    const progress: string[] = [];
    const summary = await downloadTicketAttachments(list, list.attachments, dir, {
      fetchImpl,
      onProgress: (m) => progress.push(m),
    });

    expect(summary.out_dir).toBe(path.resolve(dir));
    expect(summary.downloaded.map((d) => path.basename(d.path!))).toEqual(["image.png", "image (1).png", "escape.har"]);
    const sha = createHash("sha256").update(payload).digest("hex");
    for (const d of summary.downloaded) {
      expect(path.dirname(d.path!)).toBe(path.resolve(dir));
      expect(d.bytes).toBe(payload.length);
      expect(d.sha256).toBe(sha);
      expect(readFileSync(d.path!)).toEqual(payload);
    }
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]).toMatchObject({ key: "attachments/2026/07/d.pdf", error: "download failed: HTTP 403" });
    expect(existsSync(path.join(dir, "d.pdf"))).toBe(false);
    expect(readdirSync(dir).some((f) => f.endsWith(".part"))).toBe(false);
    expect(progress).toHaveLength(4);
  });
});
