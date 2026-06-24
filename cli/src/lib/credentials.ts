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
  /** User unique_id of the authenticated user (from OAuth access token) */
  user_id?: string;
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

function decodeAccessToken(token?: string): Record<string, unknown> | null {
  if (!token) return null;
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function userIdFromAccessToken(token?: string): string | undefined {
  const decoded = decodeAccessToken(token);
  const userId = decoded?.user_id;
  return typeof userId === "string" && userId.trim() ? userId.trim() : undefined;
}

export function emailFromAccessToken(token?: string): string | undefined {
  const decoded = decodeAccessToken(token);
  const email = decoded?.email;
  return typeof email === "string" && email.trim() ? email.trim() : undefined;
}

export function withAccessTokenIdentity(creds: Credentials): Credentials {
  const rest: Credentials = {...creds};
  delete rest.email;
  delete rest.user_id;
  const email = emailFromAccessToken(creds.accessToken);
  const userId = userIdFromAccessToken(creds.accessToken);
  return {
    ...rest,
    ...(email ? {email} : {}),
    ...(userId ? {user_id: userId} : {}),
  };
}

export async function readCredentials(): Promise<Credentials | null> {
  try {
    const raw = await readFile(getCredentialsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Credentials>;
    // Return whatever fields are present; no required fields check
    return withAccessTokenIdentity({
      apiKey: parsed.apiKey,
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expire: parsed.expire,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function writeCredentials(creds: Credentials): Promise<void> {
  const credentialsPath = getCredentialsPath();
  const payloadCreds = withAccessTokenIdentity(creds);
  await mkdir(dirname(credentialsPath), { recursive: true });
  const payload = `${JSON.stringify(payloadCreds, null, 2)}\n`;
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
