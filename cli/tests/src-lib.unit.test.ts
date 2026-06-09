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

let originalFetch: typeof fetch;
let tmpDir: string;
let originalApiKey: string | undefined;
let originalBaseUrl: string | undefined;
let originalCredentialsPath: string | undefined;

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  originalApiKey = process.env.CAWPLAN_API_KEY;
  originalBaseUrl = process.env.CAWPLAN_BASE_URL;
  originalCredentialsPath = process.env.CAWPLAN_CREDENTIALS_PATH;

  tmpDir = await mkdtemp(join(tmpdir(), "cawplan-tests-"));
  process.env.CAWPLAN_CREDENTIALS_PATH = join(tmpDir, "credentials.json");
  process.env.CAWPLAN_BASE_URL = "https://api.test/core-product";
  delete process.env.CAWPLAN_API_KEY;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;

  if (originalApiKey === undefined) delete process.env.CAWPLAN_API_KEY;
  else process.env.CAWPLAN_API_KEY = originalApiKey;

  if (originalBaseUrl === undefined) delete process.env.CAWPLAN_BASE_URL;
  else process.env.CAWPLAN_BASE_URL = originalBaseUrl;

  if (originalCredentialsPath === undefined) delete process.env.CAWPLAN_CREDENTIALS_PATH;
  else process.env.CAWPLAN_CREDENTIALS_PATH = originalCredentialsPath;

  await rm(tmpDir, { recursive: true, force: true });
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
