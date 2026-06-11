import { homedir } from "node:os";
import { resolve } from "node:path";
import { getApiBase } from "./products.js";

/**
 * API base URL. Reads from products.json (env selected by CAWPLAN_ENV),
 * overridable via CAWPLAN_BASE_URL for advanced use / debugging.
 */
export function getBaseUrl(): string {
  return getApiBase();
}

export function getApiKey(): string | undefined {
  return process.env.CAWPLAN_API_KEY;
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
