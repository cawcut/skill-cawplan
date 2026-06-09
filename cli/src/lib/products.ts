import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";

const _require = createRequire(import.meta.url);

// ─── Types ────────────────────────────────────────────────────────────────────

interface EnvConfig {
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

function loadEnvConfig(): EnvConfig {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const data = _require(resolve(__dirname, "../../config/products.json")) as ProductsFile;
    const product = data.products["cawplan"];
    if (!product) throw new Error("products.json: missing 'cawplan' entry");

    const envName = process.env.CAWPLAN_ENV ?? product.defaultEnv;
    const envConfig = product.env[envName] ?? product.env[product.defaultEnv];
    if (!envConfig) throw new Error(`products.json: unknown env '${envName}'`);

    return envConfig;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * API base URL for the cawplan backend.
 * Priority: CAWPLAN_BASE_URL env var > products.json[CAWPLAN_ENV].apiBase
 */
export function getApiBase(): string {
    return process.env.CAWPLAN_BASE_URL ?? loadEnvConfig().apiBase;
}

/**
 * Portal (web app) base URL.
 * Priority: CAWPLAN_PORTAL_URL env var > products.json[CAWPLAN_ENV].portalBase
 */
export function getPortalBase(): string {
    return process.env.CAWPLAN_PORTAL_URL ?? loadEnvConfig().portalBase;
}
