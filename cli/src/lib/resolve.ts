import { cawplanRequest } from "./http.js";
import { getCache, setCache, buildScopedCacheKey } from "./cache.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PagedData<T> {
  data: T[];
}

interface Product {
  unique_id: string;
  name: string;
}

interface Version {
  version_id: string;
  version: string;
}

interface User {
  unique_id: string;
  email: string;
  name?: string;
}

// ─── Product ──────────────────────────────────────────────────────────────────

/**
 * Resolve a product name (or pass-through if it looks like a UUID) to a product_id.
 * Caches the full products list so repeated calls within a session are free.
 */
export async function resolveProductId(nameOrId: string): Promise<string> {
  if (looksLikeId(nameOrId)) return nameOrId;

  const key = await buildScopedCacheKey("products:list", { search: nameOrId });
  const cached = getCache(key, false);
  let products: Product[];

  if (cached) {
    products = extractList<Product>(cached);
  } else {
    const result = await cawplanRequest({
      method: "GET",
      path: "/api/v1/public/openapi/products",
      query: { search: nameOrId },
    });
    setCache(key, result);
    products = extractList<Product>(result);
  }

  if (products.length === 0) throw new Error(`No product found matching "${nameOrId}"`);

  // Prefer exact match over fuzzy search results
  const needle = nameOrId.trim().toLowerCase();
  const exact = products.filter((p) => p.name.toLowerCase() === needle);
  if (exact.length === 1) return exact[0].unique_id;

  const startsWith = products.filter((p) => p.name.toLowerCase().startsWith(needle));
  if (startsWith.length === 1) return startsWith[0].unique_id;

  const candidates = exact.length > 0 ? exact : startsWith.length > 0 ? startsWith : products;
  const names = candidates.map((p) => `"${p.name}" (${p.unique_id})`).join(", ");
  throw new Error(`Multiple products match "${nameOrId}": ${names}. Use a more specific name.`);
}

// ─── Version ──────────────────────────────────────────────────────────────────

/**
 * Resolve a version name (e.g. "4.3.1") to a version_id for the given product.
 * Fetches all versions and finds the closest match.
 */
export async function resolveVersionId(productId: string, nameOrId: string): Promise<string> {
  if (looksLikeId(nameOrId)) return nameOrId;

  const key = await buildScopedCacheKey(`versions:list:${productId}`, undefined);
  const cached = getCache(key, false);
  let versions: Version[];

  if (cached) {
    versions = extractList<Version>(cached);
  } else {
    const result = await cawplanRequest({
      method: "GET",
      path: `/api/v1/public/openapi/product/${productId}/versions`,
      query: { page_size: "100" },
    });
    setCache(key, result);
    versions = extractList<Version>(result);
  }

  const needle = nameOrId.trim().toLowerCase();
  const exact = versions.find((v) => v.version?.toLowerCase() === needle);
  if (exact) return exact.version_id;

  const prefix = versions.filter((v) => v.version?.toLowerCase().startsWith(needle));
  if (prefix.length === 1) return prefix[0].version_id;
  if (prefix.length > 1) {
    const names = prefix.map((v) => `"${v.version}"`).join(", ");
    throw new Error(`Multiple versions match "${nameOrId}": ${names}. Use the full version name.`);
  }

  throw new Error(`No version found matching "${nameOrId}" for this product`);
}

// ─── User ─────────────────────────────────────────────────────────────────────

/**
 * Resolve a user email to a user_id. Caches results per email.
 */
export async function resolveUserId(email: string): Promise<string> {
  if (looksLikeId(email)) return email;

  const key = await buildScopedCacheKey("users:query", { email });
  const cached = getCache(key, false);
  let users: User[];

  if (cached) {
    users = extractList<User>(cached);
  } else {
    const result = await cawplanRequest({
      method: "POST",
      path: "/api/v1/public/openapi/users/query",
      body: { email },
    });
    setCache(key, result);
    users = extractList<User>(result);
  }

  if (users.length === 0) throw new Error(`No user found with email "${email}"`);
  return users[0].unique_id;
}

/**
 * Resolve multiple emails in parallel.
 */
export async function resolveUserIds(emails: string[]): Promise<string[]> {
  return Promise.all(emails.map(resolveUserId));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function looksLikeId(value: string): boolean {
  // UUIDs or short alphanumeric IDs (no spaces, not a version like "4.3.1")
  return /^[0-9a-f-]{20,}$/i.test(value.trim());
}

function extractList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const p = payload as Record<string, unknown>;
  // Common response shapes: { data: [...] } or { data: { list: [...] } }
  if (Array.isArray(p?.data)) return p.data as T[];
  const inner = p?.data as Record<string, unknown> | undefined;
  if (Array.isArray(inner?.list)) return inner.list as T[];
  if (Array.isArray(inner?.data)) return inner.data as T[];
  return [];
}
