import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDocumentContent, invalidateDocumentContent } from "../src/lib/knowledge/document-cache.js";
import { MAX_CACHED_DOCUMENTS } from "../src/lib/knowledge/document-store.js";

const content = (text: string, updatedAt?: number) => ({
  code: "SUCCESS",
  data: { status: "succeeded", content: text, ...(updatedAt ? { updated_at: updatedAt } : {}) },
});
const notModified = (updatedAt: number) => ({
  code: "SUCCESS",
  data: { status: "succeeded", updated_at: updatedAt, not_modified: true },
});

describe("knowledge document content cache", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cawplan-kdoc-"));
    process.env.CAWPLAN_CACHE_PATH = join(dir, "cache.json");
    process.env.CAWPLAN_CONFIG_PATH = join(dir, "config.json"); // no user config: cache defaults on
    process.env.CAWPLAN_KNOWLEDGE_FRESH_SECONDS = "300";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CAWPLAN_CACHE_PATH;
    delete process.env.CAWPLAN_CONFIG_PATH;
    delete process.env.CAWPLAN_KNOWLEDGE_FRESH_SECONDS;
    rmSync(dir, { recursive: true, force: true });
  });

  it("is on by default and serves a fresh copy without a request", async () => {
    const fetcher = vi.fn().mockResolvedValue(content("v1", 100));
    await fetchDocumentContent("d", "x", false, fetcher);
    vi.setSystemTime(Date.now() + 60_000);
    const again = await fetchDocumentContent("d", "x", false, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((again as any).data.content).toBe("v1");
  });

  it("validates an older copy with if_updated_at and keeps it when not modified", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(content("v1", 100)).mockResolvedValueOnce(notModified(100));
    await fetchDocumentContent("d", "x", false, fetcher);
    vi.setSystemTime(Date.now() + 10 * 60_000);
    const again = await fetchDocumentContent("d", "x", false, fetcher);
    expect(fetcher).toHaveBeenLastCalledWith(100);
    expect((again as any).data.content).toBe("v1");
    // the fresh window restarted, so the next read needs no request
    await fetchDocumentContent("d", "x", false, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("replaces the cached copy when the cloud has a newer version", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(content("v1", 100)).mockResolvedValueOnce(content("v2", 200));
    await fetchDocumentContent("d", "x", false, fetcher);
    vi.setSystemTime(Date.now() + 10 * 60_000);
    const updated = await fetchDocumentContent("d", "x", false, fetcher);
    expect((updated as any).data.content).toBe("v2");
    vi.setSystemTime(Date.now() + 60_000);
    expect(((await fetchDocumentContent("d", "x", false, fetcher)) as any).data.content).toBe("v2");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fetches in full when the entry has no updated_at (older cloud) or on refresh", async () => {
    const fetcher = vi.fn().mockResolvedValue(content("v1"));
    await fetchDocumentContent("d", "x", false, fetcher);
    vi.setSystemTime(Date.now() + 10 * 60_000);
    await fetchDocumentContent("d", "x", false, fetcher);
    expect(fetcher).toHaveBeenLastCalledWith();
    await fetchDocumentContent("d", "x", true, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not cache an answer without content, and invalidate drops the entry", async () => {
    const missing = vi.fn().mockResolvedValue({ code: "SUCCESS", data: { status: "not_found" } });
    await fetchDocumentContent("d", "x", false, missing);
    await fetchDocumentContent("d", "x", false, missing);
    expect(missing).toHaveBeenCalledTimes(2);

    const fetcher = vi.fn().mockResolvedValue(content("v1", 100));
    await fetchDocumentContent("d", "y", false, fetcher);
    await invalidateDocumentContent("d", "y");
    await fetchDocumentContent("d", "y", false, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("stays off when the user turned the cache off", async () => {
    writeFileSync(process.env.CAWPLAN_CONFIG_PATH as string, JSON.stringify({ cache: false }));
    const fetcher = vi.fn().mockResolvedValue(content("v1", 100));
    await fetchDocumentContent("d", "z", false, fetcher);
    await fetchDocumentContent("d", "z", false, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps at most the cap and drops the oldest document first", async () => {
    const fetcher = vi.fn().mockImplementation(async () => content("body", 1));
    for (let i = 0; i < MAX_CACHED_DOCUMENTS + 1; i++) {
      await fetchDocumentContent("d", `doc-${i}`, false, fetcher);
      vi.setSystemTime(Date.now() + 1000);
    }
    expect(fetcher).toHaveBeenCalledTimes(MAX_CACHED_DOCUMENTS + 1);
    fetcher.mockClear();
    await fetchDocumentContent("d", "doc-0", false, fetcher); // the oldest was dropped
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockClear();
    await fetchDocumentContent("d", `doc-${MAX_CACHED_DOCUMENTS}`, false, fetcher); // a recent one stays
    expect(fetcher).toHaveBeenCalledTimes(0);
  });

  it("drops entries past the cache TTL when another document is saved", async () => {
    const fetcher = vi.fn().mockResolvedValue(content("body", 1));
    await fetchDocumentContent("d", "old", false, fetcher);
    vi.setSystemTime(Date.now() + 13 * 60 * 60 * 1000); // past the 12 hour default TTL
    await fetchDocumentContent("d", "new", false, fetcher);
    const files = readdirSync(join(dir, "knowledge-docs"));
    expect(files).toHaveLength(1);
    expect(readFileSync(join(dir, "knowledge-docs", files[0]), "utf-8")).toContain("new");
    expect(existsSync(process.env.CAWPLAN_CACHE_PATH as string)).toBe(false); // not in cache.json
  });
});
