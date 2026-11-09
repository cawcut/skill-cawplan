import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { cawplanRequest } from "../src/lib/http";
import { registerAuthCommand } from "../src/commands/auth";
import { getAuthState } from "../src/lib/auth-state";
import { getBaseUrl, isLoopbackHost } from "../src/lib/config";
import { readCredentials, writeCredentials } from "../src/lib/credentials";
import { writeUserConfig } from "../src/lib/user-config";

let tmpDir: string;
let originalFetch: typeof globalThis.fetch;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ["CAWPLAN_CREDENTIALS_PATH", "CAWPLAN_CONFIG_PATH", "CAWPLAN_CACHE_PATH"];

const PRD_API = "https://api.cawplan.com/core-product";
const API_PATH = "/api/v1/public/openapi/products";
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Records every requested URL and answers each with SUCCESS. */
function mockFetch(): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(input.toString());
    return new Response(JSON.stringify({ code: "SUCCESS", data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return urls;
}

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  tmpDir = await mkdtemp(join(tmpdir(), "cawplan-cred-env-"));
  process.env.CAWPLAN_CREDENTIALS_PATH = join(tmpDir, "credentials.json");
  process.env.CAWPLAN_CONFIG_PATH = join(tmpDir, "config.json");
  process.env.CAWPLAN_CACHE_PATH = join(tmpDir, "cache.json");
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.restoreAllMocks();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("credentials bound to the issuing environment", () => {
  test("legacy credentials without apiBase keep working against prd", async () => {
    await writeCredentials({ accessToken: "prd-access", refreshToken: "prd-refresh", expire: nowSeconds() + 3600 });
    const urls = mockFetch();

    await cawplanRequest({ path: API_PATH });

    expect(urls).toEqual([`${PRD_API}${API_PATH}`]);
  });

  test("legacy prd credentials are not sent to the local environment", async () => {
    await writeCredentials({ accessToken: "prd-access", refreshToken: "prd-refresh", expire: nowSeconds() + 3600 });
    await writeUserConfig({ env: "local" });
    const urls = mockFetch();

    await expect(cawplanRequest({ path: API_PATH })).rejects.toThrow(
      `Stored credentials were issued for ${PRD_API}, but the active environment uses http://localhost. Run: cawplan auth login`,
    );
    expect(urls).toEqual([]);
  });

  test("expired prd credentials are not refreshed against another environment", async () => {
    await writeCredentials({ accessToken: "prd-access", refreshToken: "prd-refresh", expire: 1, apiBase: PRD_API });
    await writeUserConfig({ env: "local" });
    const urls = mockFetch();

    await expect(cawplanRequest({ path: API_PATH })).rejects.toThrow("Run: cawplan auth login");
    expect(urls).toEqual([]);
    expect((await readCredentials())?.refreshToken).toBe("prd-refresh");
  });

  test("a user config that overrides prd cannot redirect prd credentials", async () => {
    await writeCredentials({ accessToken: "prd-access", refreshToken: "prd-refresh", expire: nowSeconds() + 3600 });
    await writeUserConfig({
      environments: { prd: { apiBase: "https://evil.example.com", portalBase: "https://evil.example.com" } },
    });
    const urls = mockFetch();

    await expect(cawplanRequest({ path: API_PATH })).rejects.toThrow(
      `Stored credentials were issued for ${PRD_API}, but the active environment uses https://evil.example.com`,
    );
    expect(urls).toEqual([]);
  });

  test("credentials issued for local are used against local", async () => {
    await writeUserConfig({ env: "local" });
    await writeCredentials({
      accessToken: "local-access",
      refreshToken: "local-refresh",
      expire: nowSeconds() + 3600,
      apiBase: "http://localhost/",
    });
    const urls = mockFetch();

    await cawplanRequest({ path: API_PATH });

    expect(urls).toEqual([`http://localhost${API_PATH}`]);
  });

  test("auth state reports the mismatch as not authenticated", async () => {
    await writeCredentials({ accessToken: "prd-access", refreshToken: "prd-refresh", expire: nowSeconds() + 3600 });
    await writeUserConfig({ env: "local" });

    const state = await getAuthState();

    expect(state.active).toBe("none");
    expect(state.envMismatch).toEqual({ issuedFor: PRD_API, active: "http://localhost" });
  });

  test("logout revokes against the issuing environment, not the active one", async () => {
    await writeCredentials({ accessToken: "prd-access", refreshToken: "prd-refresh", expire: nowSeconds() + 3600 });
    await writeUserConfig({ env: "local" });
    const urls = mockFetch();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const program = new Command();
    registerAuthCommand(program);

    await program.parseAsync(["node", "cawplan", "auth", "logout"], { from: "node" });

    expect(urls).toEqual([`${PRD_API}/api/v1/cli/oauth/revoke`]);
    expect(await readCredentials()).toBeNull();
  });
});

describe("plain HTTP api bases", () => {
  test("allows loopback hosts only", () => {
    for (const host of ["localhost", "api.localhost", "127.0.0.1", "127.1.2.3", "[::1]"]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
    for (const host of ["example.com", "localhost.example.com", "10.0.0.1", "128.0.0.1"]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });

  test("refuses to send credentials over plain HTTP to a remote host", async () => {
    const remote = "http://cawplan.example.com";
    await writeUserConfig({ env: "dev", environments: { dev: { apiBase: remote, portalBase: remote } } });
    await writeCredentials({ accessToken: "dev-access", refreshToken: "dev-refresh", expire: nowSeconds() + 3600, apiBase: remote });
    const urls = mockFetch();

    expect(() => getBaseUrl()).toThrow("Refusing to send CawPlan credentials over plain HTTP to cawplan.example.com");
    await expect(cawplanRequest({ path: API_PATH })).rejects.toThrow("plain HTTP");
    expect(urls).toEqual([]);
  });
});
