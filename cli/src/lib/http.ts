import { getBaseUrl } from "./config.js";
import {
  readCredentials,
  writeCredentials,
  isAccessTokenExpired,
  withAccessTokenIdentity,
  type Credentials,
} from "./credentials.js";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  method?: HttpMethod;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

interface AuthContext {
  header: string;
  credentials: Credentials | null;
}

function normalizeBaseUrl(base: string): string {
  let url = base.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }
  return url.replace(/\/$/, "");
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    throw new Error("path must be relative, not a full URL");
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expire: number }> {
  const baseUrl = normalizeBaseUrl(getBaseUrl());
  const url = `${baseUrl}/api/v1/cli/oauth/refresh`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError("Token expired, run: cawplan auth login", res.status, data);
  }

  // BE response: { code, data: { access_token, expire } }
  // refresh_token is slid server-side; the same token remains valid.
  const payload = (data.data ?? data) as Record<string, unknown>;
  if (!payload.access_token || typeof payload.expire !== "number") {
    const message = responseMessage(data);
    if (message !== "unknown") {
      throw new ApiError(`Token refresh failed: ${message}. Run: cawplan auth login`, res.status, data);
    }
    throw new ApiError("Token refresh failed: unexpected response", res.status, data);
  }

  return {
    accessToken: payload.access_token as string,
    refreshToken,           // unchanged — server slides TTL in place
    expire: payload.expire as number,
  };
}

async function refreshStoredAccessToken(
  credentials: Credentials,
): Promise<{ accessToken: string; credentials: Credentials }> {
  if (!credentials.refreshToken) {
    throw new ApiError("Session expired. Run: cawplan auth login", 401);
  }

  const refreshed = await refreshAccessToken(credentials.refreshToken);
  const nextCredentials = withAccessTokenIdentity({
    ...credentials,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expire: refreshed.expire,
  });
  await writeCredentials(nextCredentials);
  return {
    accessToken: refreshed.accessToken,
    credentials: nextCredentials,
  };
}

async function resolveAuthContext(): Promise<AuthContext | null> {
  const creds = await readCredentials();
  let refreshError: unknown;

  // Priority 1: valid access token
  if (creds?.accessToken && !isAccessTokenExpired(creds)) {
    return {
      header: `Bearer ${creds.accessToken}`,
      credentials: creds,
    };
  }

  // Priority 2: expired access token with refresh token -> auto-refresh
  if (creds?.accessToken && creds.refreshToken && isAccessTokenExpired(creds)) {
    try {
      const refreshed = await refreshStoredAccessToken(creds);
      return {
        header: `Bearer ${refreshed.accessToken}`,
        credentials: refreshed.credentials,
      };
    } catch (err) {
      refreshError = err;
      // Continue below so the refresh error can be surfaced consistently.
    }
  }

  if (refreshError) {
    if (refreshError instanceof ApiError) {
      throw refreshError;
    }
    const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
    throw new ApiError(`Token refresh failed: ${message}. Run: cawplan auth login`, 401, refreshError);
  }

  return null;
}

async function readResponsePayload(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") || "";
  return contentType.includes("application/json")
    ? await res.json().catch(() => ({}))
    : await res.text();
}

function responseMessage(payload: unknown): string {
  if (typeof payload === "object" && payload !== null) {
    const body = payload as Record<string, unknown>;
    const message = body.msg ?? body.message ?? body.code;
    if (typeof message === "string" && message.trim()) return message;
  }
  return String(payload || "unknown");
}

export async function cawplanRequest(options: RequestOptions): Promise<unknown> {
  const baseUrl = normalizeBaseUrl(getBaseUrl());
  const url = new URL(`${baseUrl}${normalizePath(options.path)}`);

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value);
    }
  }

  let auth = await resolveAuthContext();
  if (!auth) {
      console.error("Not authenticated. Run: cawplan auth login");
      process.exit(1);
  }

  const method = options.method ?? "GET";
  const body = options.body !== undefined ? JSON.stringify(options.body) : undefined;
  const fetchWithAuth = async (authHeader: string) => {
    const headers: Record<string, string> = {
      Authorization: authHeader,
      accept: "application/json",
    };
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    return fetch(url.toString(), { method, headers, body });
  };

  let res = await fetchWithAuth(auth.header);
  let payload = await readResponsePayload(res);

  if (res.status === 401) {
    try {
      const refreshed = await refreshStoredAccessToken(auth.credentials ?? {});
      auth = {
        header: `Bearer ${refreshed.accessToken}`,
        credentials: refreshed.credentials,
      };
      res = await fetchWithAuth(auth.header);
      payload = await readResponsePayload(res);
      if (res.status === 401) {
        throw new ApiError("Session expired. Run: cawplan auth login", 401, payload);
      }
    } catch {
      throw new ApiError("Session expired. Run: cawplan auth login", 401, payload);
    }
  }

  if (!res.ok) {
    const msg = responseMessage(payload);
    const err = new ApiError(`API error ${res.status}: ${msg}`, res.status, payload);
    throw err;
  }

  return payload;
}
