import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cawplanRequest, ApiError } from "../src/lib/http";
import {
  deleteCredentials,
  getCredentialsPath,
  readCredentials,
  writeCredentials,
} from "../src/lib/credentials";
import { exchangeStateToken } from "../src/lib/oauth";
import { getAuthState } from "../src/lib/auth-state";
import { buildScopedCacheKey, getCacheScope } from "../src/lib/cache";
import {
  apiBaseUsesGatewayPrefix,
  getApiBase,
  getPortalBase,
  resolveApiPath,
} from "../src/lib/products";
import { getConfigPath, readUserConfig, writeUserConfig } from "../src/lib/user-config";

let originalFetch: typeof fetch;
let tmpDir: string;
let originalApiKey: string | undefined;
let originalBaseUrl: string | undefined;
let originalPortalUrl: string | undefined;
let originalEnv: string | undefined;
let originalCredentialsPath: string | undefined;
let originalConfigPath: string | undefined;
let originalCachePath: string | undefined;

function unsignedJwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "",
  ].join(".");
}

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  originalApiKey = process.env.CAWPLAN_API_KEY;
  originalBaseUrl = process.env.CAWPLAN_BASE_URL;
  originalPortalUrl = process.env.CAWPLAN_PORTAL_URL;
  originalEnv = process.env.CAWPLAN_ENV;
  originalCredentialsPath = process.env.CAWPLAN_CREDENTIALS_PATH;
  originalConfigPath = process.env.CAWPLAN_CONFIG_PATH;
  originalCachePath = process.env.CAWPLAN_CACHE_PATH;

  tmpDir = await mkdtemp(join(tmpdir(), "cawplan-tests-"));
  process.env.CAWPLAN_CREDENTIALS_PATH = join(tmpDir, "credentials.json");
  process.env.CAWPLAN_CONFIG_PATH = join(tmpDir, "config.json");
  process.env.CAWPLAN_CACHE_PATH = join(tmpDir, "cache.json");
  process.env.CAWPLAN_BASE_URL = "https://api.test/core-product";
  delete process.env.CAWPLAN_PORTAL_URL;
  delete process.env.CAWPLAN_ENV;
  delete process.env.CAWPLAN_API_KEY;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;

  if (originalApiKey === undefined) delete process.env.CAWPLAN_API_KEY;
  else process.env.CAWPLAN_API_KEY = originalApiKey;

  if (originalBaseUrl === undefined) delete process.env.CAWPLAN_BASE_URL;
  else process.env.CAWPLAN_BASE_URL = originalBaseUrl;

  if (originalPortalUrl === undefined) delete process.env.CAWPLAN_PORTAL_URL;
  else process.env.CAWPLAN_PORTAL_URL = originalPortalUrl;

  if (originalEnv === undefined) delete process.env.CAWPLAN_ENV;
  else process.env.CAWPLAN_ENV = originalEnv;

  if (originalCredentialsPath === undefined) delete process.env.CAWPLAN_CREDENTIALS_PATH;
  else process.env.CAWPLAN_CREDENTIALS_PATH = originalCredentialsPath;

  if (originalConfigPath === undefined) delete process.env.CAWPLAN_CONFIG_PATH;
  else process.env.CAWPLAN_CONFIG_PATH = originalConfigPath;

  if (originalCachePath === undefined) delete process.env.CAWPLAN_CACHE_PATH;
  else process.env.CAWPLAN_CACHE_PATH = originalCachePath;

  await rm(tmpDir, { recursive: true, force: true });
});

describe("src lib products", () => {
  test("resolveApiPath keeps gateway-relative paths unchanged", () => {
    expect(resolveApiPath("/api/v1/public/openapi/tickets/search")).toBe(
      "/api/v1/public/openapi/tickets/search",
    );
  });

  test("resolveApiPath strips legacy /core-product prefix", () => {
    expect(resolveApiPath("/core-product/api/v1/public/openapi/activities/query")).toBe(
      "/api/v1/public/openapi/activities/query",
    );
  });

  test("apiBaseUsesGatewayPrefix follows CAWPLAN_BASE_URL", () => {
    process.env.CAWPLAN_BASE_URL = "https://api.test/core-product";
    expect(apiBaseUsesGatewayPrefix()).toBe(true);

    process.env.CAWPLAN_BASE_URL = "http://localhost";
    expect(apiBaseUsesGatewayPrefix()).toBe(false);
  });

  test("uses ~/.cawplan config when env vars are not set", async () => {
    delete process.env.CAWPLAN_BASE_URL;
    delete process.env.CAWPLAN_PORTAL_URL;
    delete process.env.CAWPLAN_ENV;

    await writeUserConfig({
      env: "local",
      baseUrl: "http://configured-api",
      portalUrl: "http://configured-portal",
    });

    expect(getConfigPath()).toBe(join(tmpDir, "config.json"));
    expect(await readUserConfig()).toEqual({
      env: "local",
      baseUrl: "http://configured-api",
      portalUrl: "http://configured-portal",
    });
    expect(getApiBase()).toBe("http://configured-api");
    expect(getPortalBase()).toBe("http://configured-portal");
  });

  test("environment variables override ~/.cawplan config", async () => {
    await writeUserConfig({
      env: "local",
      baseUrl: "http://configured-api",
      portalUrl: "http://configured-portal",
    });

    process.env.CAWPLAN_BASE_URL = "https://env-api/core-product";
    process.env.CAWPLAN_PORTAL_URL = "https://env-portal";

    expect(getApiBase()).toBe("https://env-api/core-product");
    expect(getPortalBase()).toBe("https://env-portal");
  });

  test("CAWPLAN_ENV selects a profile before stored URLs", async () => {
    delete process.env.CAWPLAN_BASE_URL;
    delete process.env.CAWPLAN_PORTAL_URL;
    await writeUserConfig({
      env: "local",
      baseUrl: "http://configured-api",
      portalUrl: "http://configured-portal",
    });

    process.env.CAWPLAN_ENV = "proto";

    expect(getApiBase()).toBe("https://core-api-gw.uid.dev.ui.com/core-product");
    expect(getPortalBase()).toBe("https://core-web-product.uid.dev.ui.com");
  });
});

describe("src lib auth-state", () => {
  test("treats env API key as authenticated", async () => {
    process.env.CAWPLAN_API_KEY = "cwpu_api_test_key_value";
    await deleteCredentials();

    const state = await getAuthState();
    expect(state.hasApiKey).toBe(true);
    expect(state.active).toBe("apiKey");
  });

  test("prefers OAuth when access token is still valid", async () => {
    await writeCredentials({
      apiKey: "file-key",
      accessToken: "access",
      refreshToken: "refresh",
      expire: Math.floor(Date.now() / 1000) + 3600,
    });

    const state = await getAuthState();
    expect(state.active).toBe("oauth");
  });
});

describe("src lib credentials", () => {
  test("writes credentials with 0600 permissions", async () => {
    await writeCredentials({ apiKey: "test-key" });

    expect((await readCredentials())?.apiKey).toBe("test-key");
    expect(getCredentialsPath()).toBe(join(tmpDir, "credentials.json"));

    const mode = (await stat(getCredentialsPath())).mode & 0o777;
    expect(mode).toBe(0o600);

    await deleteCredentials();
    expect(await readCredentials()).toBeNull();
  });
});

describe("src lib cache", () => {
  test("scopes cache keys by OAuth workspace", async () => {
    await writeCredentials({
      accessToken: unsignedJwt({ workspace_id: "workspace-a", uid_id: "user-a" }),
      expire: Math.floor(Date.now() / 1000) + 3600,
    });
    const first = await buildScopedCacheKey("products:list", { search: "UniFi" });

    await writeCredentials({
      accessToken: unsignedJwt({ workspace_id: "workspace-b", uid_id: "user-a" }),
      expire: Math.floor(Date.now() / 1000) + 3600,
    });
    const second = await buildScopedCacheKey("products:list", { search: "UniFi" });

    expect(first).toContain(":workspace:workspace-a:");
    expect(second).toContain(":workspace:workspace-b:");
    expect(first).not.toBe(second);
  });

  test("falls back to API key scope when no OAuth token exists", async () => {
    await writeCredentials({ apiKey: "cwpu_api_test_key_value" });

    const scope = await getCacheScope();

    expect(scope).toContain(":api-key:");
  });
});

describe("src lib oauth", () => {
  test("exchange error reads message before falling back to unknown", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: "state token expired" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });

    await expect(exchangeStateToken("expired")).rejects.toThrow(
      "Exchange failed (401): state token expired",
    );
  });
});

describe("src lib http", () => {
  test("refreshes OAuth token and retries once on API 401", async () => {
    await writeCredentials({
      accessToken: "old-access",
      refreshToken: "refresh-token",
      expire: Math.floor(Date.now() / 1000) + 3600,
    });

    const calls: Array<{ url: string; authorization?: string; body?: string }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: input.toString(),
        authorization: (init?.headers as Record<string, string> | undefined)?.Authorization,
        body: init?.body ? String(init.body) : undefined,
      });

      if (calls.length === 1) {
        return new Response(JSON.stringify({ code: "UNAUTHORIZED" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      if (calls.length === 2) {
        return new Response(
          JSON.stringify({ data: { access_token: "new-access", expire: 4102444800 } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({ code: "SUCCESS", data: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await cawplanRequest({
      method: "GET",
      path: "/api/v1/public/openapi/products",
    });

    expect(result).toEqual({ code: "SUCCESS", data: { ok: true } });
    expect(calls.map((call) => call.authorization)).toEqual([
      "Bearer old-access",
      undefined,
      "Bearer new-access",
    ]);
    expect(calls[1].url).toBe("https://api.test/core-product/api/v1/cli/oauth/refresh");
    expect(calls[1].body).toBe(JSON.stringify({ refresh_token: "refresh-token" }));
    expect((await readCredentials())?.accessToken).toBe("new-access");
  });

  test("reports API key invalid on API-key 401", async () => {
    process.env.CAWPLAN_API_KEY = "bad-key";
    await deleteCredentials();

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ code: "INVALID_API_KEY" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });

    await expect(
      cawplanRequest({ method: "GET", path: "/api/v1/public/openapi/products" }),
    ).rejects.toThrow("API Key invalid. Run: cawplan auth configure");

    try {
      await cawplanRequest({ method: "GET", path: "/api/v1/public/openapi/products" });
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(401);
    }
  });
});
