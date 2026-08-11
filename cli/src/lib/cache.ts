import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { getBaseUrl, getCachePath, getCacheTtlMs } from "./config.js";
import {readCredentials, userIdFromAccessToken} from "./credentials.js";

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

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

export async function getCacheScope(): Promise<string> {
  const base = `base:${shortHash(getBaseUrl())}`;
  const credentials = await readCredentials();

  if (credentials?.accessToken) {
    const payload = decodeJwtPayload(credentials.accessToken);
    const workspaceId = payload?.workspace_id;
    if (typeof workspaceId === "string" && workspaceId.trim()) {
      return `${base}:workspace:${workspaceId}`;
    }

    const userId = credentials.user_id ?? userIdFromAccessToken(credentials.accessToken) ?? credentials.email;
    if (typeof userId === "string" && userId.trim()) {
      return `${base}:oauth:${shortHash(userId)}`;
    }
  }

  return `${base}:anonymous`;
}

export async function buildScopedCacheKey(
  prefix: string,
  query: Record<string, string> | undefined,
): Promise<string> {
  const scope = await getCacheScope();
  return `${scope}:${buildCacheKey(prefix, query)}`;
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
