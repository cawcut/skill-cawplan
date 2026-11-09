import { homedir } from "node:os";
import { resolve } from "node:path";
import { getApiBase } from "./products.js";

/** Adds a missing https:// scheme and drops trailing slashes. */
export function normalizeApiBase(base: string): string {
  let url = base.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }
  return url.replace(/\/+$/, "");
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost"
    || host.endsWith(".localhost")
    || /^127(\.\d{1,3}){3}$/.test(host)
    || host === "[::1]";
}

/** Throws unless the API base is HTTPS, or plain HTTP to a loopback host. */
export function assertSecureApiBase(base: string): string {
  const url = new URL(base);
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    throw new Error(
      `Refusing to send CawPlan credentials over plain HTTP to ${url.host}. ` +
      "Use an https:// apiBase (http:// is only allowed for localhost).",
    );
  }
  return base;
}

/**
 * Normalized API base URL. Reads from ~/.cawplan/config.json or products.json.
 * Throws for plain HTTP to a non-loopback host.
 */
export function getBaseUrl(): string {
  return assertSecureApiBase(normalizeApiBase(getApiBase()));
}

export function getCachePath(): string {
  return process.env.CAWPLAN_CACHE_PATH ?? resolve(homedir(), ".cawplan", "cache.json");
}

export function getCacheTtlMs(): number {
  const hoursRaw = process.env.CAWPLAN_CACHE_TTL_HOURS;
  if (hoursRaw !== undefined) {
    const hours = Number(hoursRaw);
    if (Number.isFinite(hours) && hours > 0) return hours * 60 * 60 * 1000;
  }
  return 12 * 60 * 60 * 1000;
}
