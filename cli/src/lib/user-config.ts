import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface UserConfig {
  env?: string;
  baseUrl?: string;
  portalUrl?: string;
}

const CONFIG_MODE = 0o600;

export const CONFIG_PATH = join(homedir(), ".cawplan", "config.json");

export function getConfigPath(): string {
  return process.env.CAWPLAN_CONFIG_PATH ?? CONFIG_PATH;
}

function normalizeConfig(parsed: Partial<UserConfig>): UserConfig {
  return {
    env: parsed.env,
    baseUrl: parsed.baseUrl,
    portalUrl: parsed.portalUrl,
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
  await mkdir(dirname(configPath), { recursive: true });
  const payload = `${JSON.stringify(config, null, 2)}\n`;
  await writeFile(configPath, payload, { encoding: "utf8", mode: CONFIG_MODE });
  await chmod(configPath, CONFIG_MODE);
}
