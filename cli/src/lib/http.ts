import { assertSecureApiBase, getBaseUrl, normalizeApiBase } from "./config.js";
import {
  credentialApiBase,
  readCredentials,
  writeCredentials,
  isAccessTokenExpired,
  withAccessTokenIdentity,
  type Credentials,
} from "./credentials.js";
import { OAUTH_INVALID_OR_EXPIRED_CODE } from "./oauth.js";

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
  /** A string[] value is sent as repeated `key=a&key=b` params (for BE array-typed query
   * params bound via Gin's form binding, e.g. `group_by`/`fields`/`tag` on key-metrics query) —
   * not comma-joined, which Gin's []string form binding does not split. */
  query?: Record<string, string | string[]>;
  body?: unknown;
  /** Multipart form body (e.g. file uploads). Mutually exclusive with `body`; when set, the
   * `content-type` header is left for fetch to set itself (with the multipart boundary). */
  formData?: FormData;
}

interface AuthContext {
  header: string;
  credentials: Credentials | null;
}

/** Refuses to send tokens to an environment other than the one that issued them. */
function assertCredentialsForApiBase(credentials: Credentials, apiBase: string): void {
  const issuer = credentialApiBase(credentials);
  if (issuer !== apiBase) {
    throw new ApiError(
      `Stored credentials were issued for ${issuer}, but the active environment uses ${apiBase}. ` +
      "Run: cawplan auth login",
      401,
    );
  }
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    throw new Error("path must be relative, not a full URL");
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

const REVOKE_TIMEOUT_MS = 5000;

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expire: number }> {
  const baseUrl = getBaseUrl();
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

  // BE response: { code, data: { access_token, expire, refresh_token? } }
  // A server that rotates refresh tokens returns a new refresh_token, which
  // replaces the old one; a server that slides the TTL in place omits it.
  const payload = (data.data ?? data) as Record<string, unknown>;
  if (!payload.access_token || typeof payload.expire !== "number") {
    const message = responseMessage(data);
    if (message !== "unknown") {
      throw new ApiError(`Token refresh failed: ${message}. Run: cawplan auth login`, res.status, data);
    }
    throw new ApiError("Token refresh failed: unexpected response", res.status, data);
  }

  const rotated = typeof payload.refresh_token === "string" ? payload.refresh_token.trim() : "";
  return {
    accessToken: payload.access_token as string,
    refreshToken: rotated || refreshToken,
    expire: payload.expire as number,
  };
}

function isRejectedRefreshToken(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 401) return true;
  const body = err.body;
  return typeof body === "object" && body !== null
    && (body as Record<string, unknown>).code === OAUTH_INVALID_OR_EXPIRED_CODE;
}

async function refreshStoredAccessToken(
  credentials: Credentials,
): Promise<{ accessToken: string; credentials: Credentials }> {
  if (!credentials.refreshToken) {
    throw new ApiError("Session expired. Run: cawplan auth login", 401);
  }
  assertCredentialsForApiBase(credentials, getBaseUrl());

  let base = credentials;
  let refreshed: Awaited<ReturnType<typeof refreshAccessToken>>;
  try {
    refreshed = await refreshAccessToken(credentials.refreshToken);
  } catch (err) {
    // With server-side rotation, a concurrent cawplan process may have used
    // the same refresh token first and stored its successor. Retry once with
    // whatever is on disk now; otherwise surface the original error.
    if (!isRejectedRefreshToken(err)) throw err;
    const latest = await readCredentials().catch(() => null);
    if (!latest?.refreshToken || latest.refreshToken === credentials.refreshToken) throw err;
    assertCredentialsForApiBase(latest, getBaseUrl());
    base = latest;
    refreshed = await refreshAccessToken(latest.refreshToken);
  }

  const nextCredentials = withAccessTokenIdentity({
    ...base,
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

/**
 * Revoke a refresh token server-side (RFC 7009, used by `auth logout`).
 * Best-effort: never throws, so sign-out still clears local credentials when
 * the server is unreachable or predates the revoke endpoint (404).
 * `apiBase` is the environment that issued the token (default: the active one).
 */
export async function revokeRefreshToken(refreshToken: string, apiBase?: string): Promise<boolean> {
  try {
    const baseUrl = apiBase ? assertSecureApiBase(normalizeApiBase(apiBase)) : getBaseUrl();
    const res = await fetch(`${baseUrl}/api/v1/cli/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    return data.code === "SUCCESS";
  } catch {
    return false;
  }
}

async function resolveAuthContext(): Promise<AuthContext | null> {
  const creds = await readCredentials();
  let refreshError: unknown;
  if (creds?.accessToken) {
    assertCredentialsForApiBase(creds, getBaseUrl());
  }

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

/**
 * Extract the BE's finer-grained diagnostic (e.g. `data.details` on a 400)
 * from an ApiError's response body. `responseMessage()` only surfaces
 * `msg`/`message`/`code`, which for validation failures is often a generic
 * "invalid request body" — the actionable reason lives in `data`.
 * Returns undefined when there's nothing beyond what responseMessage already showed.
 */
export function apiErrorDetails(err: unknown): string | undefined {
  if (!(err instanceof ApiError) || !err.body || typeof err.body !== "object") {
    return undefined;
  }
  const body = err.body as Record<string, unknown>;
  const data = body.data;
  if (data && typeof data === "object" && "details" in (data as Record<string, unknown>)) {
    const details = (data as Record<string, unknown>).details;
    if (typeof details === "string" && details.trim()) return details;
  }
  if (data !== undefined && data !== null) {
    try {
      return JSON.stringify(data);
    } catch {
      return String(data);
    }
  }
  return undefined;
}

export async function cawplanRequest(options: RequestOptions): Promise<unknown> {
  const baseUrl = getBaseUrl();
  const url = new URL(`${baseUrl}${normalizePath(options.path)}`);

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, v);
      } else {
        url.searchParams.set(key, value);
      }
    }
  }

  let auth = await resolveAuthContext();
  if (!auth) {
      console.error("Not authenticated. Run: cawplan auth login");
      process.exit(1);
  }

  const method = options.method ?? "GET";
  const body: BodyInit | undefined =
    options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined);
  const fetchWithAuth = async (authHeader: string) => {
    const headers: Record<string, string> = {
      Authorization: authHeader,
      accept: "application/json",
    };
    if (options.body !== undefined && !options.formData) {
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
