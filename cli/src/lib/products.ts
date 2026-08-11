import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readUserConfigSync } from "./user-config.js";

const _require = createRequire(import.meta.url);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EnvConfig {
  portalBase: string;
  apiBase: string;
}

interface ProductConfig {
  displayName: string;
  cliName: string;
  defaultEnv: string;
  env: Record<string, EnvConfig>;
}

interface ProductsFile {
  products: Record<string, ProductConfig>;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

function loadProductConfig(): ProductConfig {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const data = _require(resolve(__dirname, "../../config/products.json")) as ProductsFile;
  const product = data.products["cawplan"];
  if (!product) throw new Error("products.json: missing 'cawplan' entry");

  return product;
}

export function getEnvNames(): string[] {
  return Object.keys(loadProductConfig().env);
}

export function getDefaultEnvName(): string {
  return loadProductConfig().defaultEnv;
}

export function getProductEnvConfig(envName: string): EnvConfig {
  const product = loadProductConfig();
  const envConfig = product.env[envName];
  if (!envConfig) throw new Error(`products.json: unknown env '${envName}'`);

  return envConfig;
}

function getSelectedEnvName(): string {
  const product = loadProductConfig();
  const userConfig = readUserConfigSync();
  return userConfig?.env ?? product.defaultEnv;
}

function loadEnvConfig(): EnvConfig {
  const product = loadProductConfig();
  const envName = getSelectedEnvName();
  const envConfig = product.env[envName] ?? product.env[product.defaultEnv];
  if (!envConfig) throw new Error(`products.json: unknown env '${envName}'`);

  return envConfig;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * API base URL for the cawplan backend.
 * Priority: ~/.cawplan/config.json > products.json.
 */
export function getApiBase(): string {
  return loadEnvConfig().apiBase;
}

/**
 * Portal (web app) base URL.
 * Priority: ~/.cawplan/config.json > products.json.
 */
export function getPortalBase(): string {
  return loadEnvConfig().portalBase;
}

/**
 * Normalize a core-product API path for the configured base URL.
 * Paths are always /api/v1/... relative to the service root (direct BE or gateway .../core-product).
 */
export function resolveApiPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error("API path is required");
  }

  let normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (normalized.startsWith("/core-product/")) {
    normalized = normalized.slice("/core-product".length);
  }

  if (!normalized.startsWith("/api/v1/")) {
    throw new Error(`API path must start with /api/v1/: ${path}`);
  }

  return normalized;
}

/** True when apiBase already includes the gateway /core-product suffix. */
export function apiBaseUsesGatewayPrefix(): boolean {
  return getApiBase().includes("/core-product");
}
