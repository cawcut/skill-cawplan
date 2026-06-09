import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCachePath, getCacheTtlMs } from "./config.js";

type CacheEntry = { fetched_at: number; data: unknown };
type CacheStore = { version: 1; entries: Record<string, CacheEntry> };

export function loadCache(): CacheStore {
  const cachePath = getCachePath();
  if (!existsSync(cachePath)) return { version: 1, entries: {} };
  try {
    const raw = readFileSync(cachePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && typeof parsed.entries === "object") {
      return parsed as CacheStore;
    }
  } catch {
    // Ignore cache read/parse errors
  }
  return { version: 1, entries: {} };
}

export function saveCache(store: CacheStore): void {
  const cachePath = getCachePath();
  try {
    mkdirSync(resolve(cachePath, ".."), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(store, null, 2));
  } catch {
    // Ignore cache write errors
  }
}

export function getCache(key: string, refresh: boolean): unknown | undefined {
  if (refresh) return undefined;
  const store = loadCache();
  const entry = store.entries[key];
  if (!entry) return undefined;
  const ttlMs = getCacheTtlMs();
  if (Date.now() - entry.fetched_at > ttlMs) return undefined;
  return entry.data;
}

export function setCache(key: string, data: unknown): void {
  const store = loadCache();
  store.entries[key] = { fetched_at: Date.now(), data };
  saveCache(store);
}

export function clearCache(): void {
  const cachePath = getCachePath();
  try {
    if (existsSync(cachePath)) {
      unlinkSync(cachePath);
    }
  } catch {
    // Ignore cache delete errors
  }
}

export function buildCacheKey(prefix: string, query: Record<string, string> | undefined): string {
  if (!query) return prefix;
  const normalized = Object.keys(query)
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join("&");
  return `${prefix}?${normalized}`;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${(value as unknown[]).map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
  return `{${entries.join(",")}}`;
}

export function buildQueryFromFlags(
  flags: Record<string, string>,
  allow: string[],
): Record<string, string> | undefined {
  const query: Record<string, string> = {};
  for (const key of allow) {
    if (flags[key] !== undefined) {
      query[key] = flags[key];
    }
  }
  return Object.keys(query).length ? query : undefined;
}

export function csvToArray(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}
