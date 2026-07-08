import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";

export interface LocalProductMapping {
  dir: string;
  product_id: string;
}

export interface UserConfig {
  env?: string;
  baseUrl?: string;
  portalUrl?: string;
  local_mapping?: LocalProductMapping[];
}

const CONFIG_MODE = 0o600;

export const CONFIG_PATH = join(homedir(), ".cawplan", "config.json");

export function getConfigPath(): string {
  return process.env.CAWPLAN_CONFIG_PATH ?? CONFIG_PATH;
}

function normalizeLocalMappings(mappings?: LocalProductMapping[]): LocalProductMapping[] | undefined {
  if (!Array.isArray(mappings)) return undefined;

  const byDir = new Map<string, LocalProductMapping>();
  for (const mapping of mappings) {
    const dir = typeof mapping?.dir === "string" ? resolve(mapping.dir) : "";
    const productId = typeof mapping?.product_id === "string" ? mapping.product_id.trim() : "";
    if (!dir || !productId) continue;

    // Keep a single entry per normalized dir, with the latest product selection.
    byDir.delete(dir);
    byDir.set(dir, { dir, product_id: productId });
  }

  const normalized = [...byDir.values()];
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeConfig(parsed: Partial<UserConfig>): UserConfig {
  const localMapping = normalizeLocalMappings(parsed.local_mapping);

  return {
    env: parsed.env,
    baseUrl: parsed.baseUrl,
    portalUrl: parsed.portalUrl,
    ...(localMapping && localMapping.length > 0 ? { local_mapping: localMapping } : {}),
  };
}

export function readUserConfigSync(): UserConfig | null {
  try {
    const raw = readFileSync(getConfigPath(), "utf8");
    return normalizeConfig(JSON.parse(raw) as Partial<UserConfig>);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function readUserConfig(): Promise<UserConfig | null> {
  try {
    const raw = await readFile(getConfigPath(), "utf8");
    return normalizeConfig(JSON.parse(raw) as Partial<UserConfig>);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function writeUserConfig(config: UserConfig): Promise<void> {
  const configPath = getConfigPath();
  const normalizedConfig = normalizeConfig(config);
  await mkdir(dirname(configPath), { recursive: true });
  const payload = `${JSON.stringify(normalizedConfig, null, 2)}\n`;
  await writeFile(configPath, payload, { encoding: "utf8", mode: CONFIG_MODE });
  await chmod(configPath, CONFIG_MODE);
}

export async function upsertLocalProductMapping(dir: string, productId: string): Promise<UserConfig> {
  const config = await readUserConfig() ?? {};
  const normalizedDir = resolve(dir);
  const normalizedProductId = productId.trim();
  if (!normalizedProductId) throw new Error("product_id is required");

  const mappings = (config.local_mapping ?? []).filter((mapping) => resolve(mapping.dir) !== normalizedDir);
  const nextConfig: UserConfig = {
    ...config,
    local_mapping: [...mappings, { dir: normalizedDir, product_id: normalizedProductId }],
  };
  await writeUserConfig(nextConfig);
  return nextConfig;
}

export function findLocalProductMappingForDir(dir: string, config = readUserConfigSync()): LocalProductMapping | undefined {
  const cwd = resolve(dir);
  const mappings = [...(config?.local_mapping ?? [])]
    .map((mapping) => ({ ...mapping, dir: resolve(mapping.dir) }))
    .sort((a, b) => b.dir.length - a.dir.length);

  return mappings.find((mapping) => {
    const prefix = mapping.dir.endsWith(sep) ? mapping.dir : `${mapping.dir}${sep}`;
    return cwd === mapping.dir || cwd.startsWith(prefix);
  });
}
