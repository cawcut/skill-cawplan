import { createHash } from "node:crypto";
import { chmodSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isCacheEnabled } from "../cache.js";
import { getCacheTtlMs, getDocumentCacheDir } from "../config.js";
import { ensurePrivateDirSync, PRIVATE_FILE_MODE } from "../private-fs.js";

/**
 * Cached knowledge document contents, one private file per document under the cache directory
 * (not in the shared cache.json, so a large body never slows the other caches). At most
 * MAX_CACHED_DOCUMENTS are kept: writing one drops the files past the cache TTL and then the
 * oldest ones beyond the cap.
 */

export const MAX_CACHED_DOCUMENTS = 100;

export type DocumentEntry = { fetched_at: number; data: unknown };

function fileFor(key: string): string {
  return join(getDocumentCacheDir(), `${createHash("sha256").update(key).digest("hex")}.json`);
}

/** The cached entry of a key, or undefined when absent, unreadable, or older than the TTL. */
export function readDocumentEntry(key: string): DocumentEntry | undefined {
  if (!isCacheEnabled(true)) return undefined;
  const file = fileFor(key);
  try {
    if (!existsSync(file)) return undefined;
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    if (!parsed || parsed.key !== key || typeof parsed.fetched_at !== "number") return undefined;
    if (Date.now() - parsed.fetched_at > getCacheTtlMs()) return undefined;
    return { fetched_at: parsed.fetched_at, data: parsed.data };
  } catch {
    return undefined;
  }
}

export function writeDocumentEntry(key: string, data: unknown): void {
  if (!isCacheEnabled(true)) return;
  try {
    const dir = getDocumentCacheDir();
    ensurePrivateDirSync(dir);
    const file = fileFor(key);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ key, fetched_at: Date.now(), data }), { mode: PRIVATE_FILE_MODE });
    chmodSync(tmp, PRIVATE_FILE_MODE);
    renameSync(tmp, file); // atomic: a reader never sees a half-written file
    trimDocumentCache();
  } catch {
    // Ignore cache write errors
  }
}

export function deleteDocumentEntry(key: string): void {
  try {
    rmSync(fileFor(key), { force: true });
  } catch {
    // Ignore cache delete errors
  }
}

/** Removes files past the TTL, then the oldest beyond the cap. Returns how many were removed. */
export function trimDocumentCache(max = MAX_CACHED_DOCUMENTS, ttlMs = getCacheTtlMs(), now = Date.now()): number {
  const dir = getDocumentCacheDir();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  const alive: { file: string; at: number }[] = [];
  for (const name of names) {
    const file = join(dir, name);
    if (name.endsWith(".tmp")) continue;
    let at: number;
    try {
      at = JSON.parse(readFileSync(file, "utf-8")).fetched_at;
      if (typeof at !== "number") at = statSync(file).mtimeMs;
    } catch {
      at = 0; // unreadable: first to go
    }
    if (now - at > ttlMs) {
      rmSync(file, { force: true });
      removed += 1;
    } else {
      alive.push({ file, at });
    }
  }
  alive.sort((a, b) => b.at - a.at);
  for (const { file } of alive.slice(Math.max(max, 0))) {
    rmSync(file, { force: true });
    removed += 1;
  }
  return removed;
}
