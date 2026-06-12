import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface Credentials {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  /** Unix timestamp (seconds) when access token expires */
  expire?: number;
  /** Email of the authenticated user (from OAuth) */
  email?: string;
}

const CREDENTIALS_MODE = 0o600;

export const CREDENTIALS_PATH = join(homedir(), ".cawplan", "credentials.json");

export function getCredentialsPath(): string {
  return process.env.CAWPLAN_CREDENTIALS_PATH ?? CREDENTIALS_PATH;
}

export function isAccessTokenExpired(
  credentials: Credentials,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (credentials.expire == null) return true;
  return credentials.expire <= nowSeconds;
}

export async function readCredentials(): Promise<Credentials | null> {
  try {
    const raw = await readFile(getCredentialsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Credentials>;
    // Return whatever fields are present; no required fields check
    return {
      apiKey: parsed.apiKey,
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expire: parsed.expire,
      email: parsed.email,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function writeCredentials(creds: Credentials): Promise<void> {
  const credentialsPath = getCredentialsPath();
  await mkdir(dirname(credentialsPath), { recursive: true });
  const payload = `${JSON.stringify(creds, null, 2)}\n`;
  await writeFile(credentialsPath, payload, { encoding: "utf8", mode: CREDENTIALS_MODE });
  await chmod(credentialsPath, CREDENTIALS_MODE);
}

export async function deleteCredentials(): Promise<void> {
  try {
    await unlink(getCredentialsPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}
