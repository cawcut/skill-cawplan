import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { cawplanRequest } from "../src/lib/http";
import { registerAuthCommand } from "../src/commands/auth";
import { readCredentials, writeCredentials } from "../src/lib/credentials";

let tmpDir: string;
let originalFetch: typeof globalThis.fetch;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ["CAWPLAN_CREDENTIALS_PATH", "CAWPLAN_CONFIG_PATH", "CAWPLAN_CACHE_PATH"];

interface Call {
  path: string;
  authorization?: string;
  body?: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Records every request and answers it with the first matching route handler. */
function mockFetch(routes: Record<string, (call: Call) => Response | Promise<Response>>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(input.toString()).pathname;
    const call: Call = {
      path,
      authorization: (init?.headers as Record<string, string> | undefined)?.Authorization,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const route = Object.keys(routes).find((suffix) => path.endsWith(suffix));
    if (!route) throw new Error(`unexpected request: ${path}`);
    return routes[route]!(call);
  }) as typeof globalThis.fetch;
  return calls;
}

const API_PATH = "/api/v1/public/openapi/products";
const nowSeconds = () => Math.floor(Date.now() / 1000);

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  tmpDir = await mkdtemp(join(tmpdir(), "cawplan-refresh-rotation-"));
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

describe("refresh token rotation", () => {
  test("persists a rotated refresh_token returned by the server", async () => {
    await writeCredentials({ accessToken: "old-access", refreshToken: "refresh-1", expire: 1 });
    const calls = mockFetch({
      "/cli/oauth/refresh": () =>
        json({ code: "SUCCESS", data: { access_token: "new-access", refresh_token: "refresh-2", expire: 4102444800 } }),
      [API_PATH]: () => json({ code: "SUCCESS", data: [] }),
    });

    await cawplanRequest({ path: API_PATH });

    expect(calls[0]!.body).toEqual({ refresh_token: "refresh-1" });
    expect(calls[1]!.authorization).toBe("Bearer new-access");
    const saved = await readCredentials();
    expect(saved?.accessToken).toBe("new-access");
    expect(saved?.refreshToken).toBe("refresh-2");
    expect(saved?.expire).toBe(4102444800);
  });

  test("keeps the existing refresh token when the server does not return one", async () => {
    await writeCredentials({ accessToken: "old-access", refreshToken: "refresh-1", expire: 1 });
    mockFetch({
      "/cli/oauth/refresh": () => json({ code: "SUCCESS", data: { access_token: "new-access", expire: 4102444800 } }),
      [API_PATH]: () => json({ code: "SUCCESS", data: [] }),
    });

    await cawplanRequest({ path: API_PATH });

    const saved = await readCredentials();
    expect(saved?.accessToken).toBe("new-access");
    expect(saved?.refreshToken).toBe("refresh-1");
  });

  test("ignores an empty refresh_token in the refresh response", async () => {
    await writeCredentials({ accessToken: "old-access", refreshToken: "refresh-1", expire: 1 });
    mockFetch({
      "/cli/oauth/refresh": () =>
        json({ code: "SUCCESS", data: { access_token: "new-access", refresh_token: "  ", expire: 4102444800 } }),
      [API_PATH]: () => json({ code: "SUCCESS", data: [] }),
    });

    await cawplanRequest({ path: API_PATH });

    expect((await readCredentials())?.refreshToken).toBe("refresh-1");
  });

  test("retries once with the refresh token another process rotated in", async () => {
    await writeCredentials({ accessToken: "old-access", refreshToken: "refresh-1", expire: 1 });
    const calls = mockFetch({
      "/cli/oauth/refresh": async (call) => {
        const token = (call.body as { refresh_token: string }).refresh_token;
        if (token === "refresh-1") {
          // Simulate a concurrent cawplan process that won the race: it already
          // rotated refresh-1 -> refresh-2 and saved it before we got our answer.
          await writeCredentials({ accessToken: "other-access", refreshToken: "refresh-2", expire: nowSeconds() + 3600 });
          return json({ code: "INVALID_OR_EXPIRED", msg: "invalid or expired refresh token", data: null });
        }
        return json({ code: "SUCCESS", data: { access_token: "new-access", refresh_token: "refresh-3", expire: 4102444800 } });
      },
      [API_PATH]: () => json({ code: "SUCCESS", data: [] }),
    });

    await cawplanRequest({ path: API_PATH });

    expect(calls.map((c) => c.body)).toEqual([
      { refresh_token: "refresh-1" },
      { refresh_token: "refresh-2" },
      undefined,
    ]);
    expect(calls[2]!.authorization).toBe("Bearer new-access");
    const saved = await readCredentials();
    expect(saved?.accessToken).toBe("new-access");
    expect(saved?.refreshToken).toBe("refresh-3");
  });

  test("does not retry when the stored refresh token is unchanged", async () => {
    await writeCredentials({ accessToken: "old-access", refreshToken: "refresh-1", expire: 1 });
    const calls = mockFetch({
      "/cli/oauth/refresh": () => json({ code: "INVALID_OR_EXPIRED", msg: "invalid or expired refresh token", data: null }),
    });

    await expect(cawplanRequest({ path: API_PATH })).rejects.toThrow(
      "Token refresh failed: invalid or expired refresh token. Run: cawplan auth login",
    );
    expect(calls).toHaveLength(1);
  });

  test("does not retry on errors other than a rejected refresh token", async () => {
    await writeCredentials({ accessToken: "old-access", refreshToken: "refresh-1", expire: 1 });
    const calls = mockFetch({
      "/cli/oauth/refresh": async () => {
        await writeCredentials({ accessToken: "other-access", refreshToken: "refresh-2", expire: 1 });
        return json({ code: "TOO_MANY_REQUESTS" }, 429);
      },
    });

    await expect(cawplanRequest({ path: API_PATH })).rejects.toThrow("Token expired, run: cawplan auth login");
    expect(calls).toHaveLength(1);
  });
});

describe("auth logout", () => {
  async function runLogout(): Promise<void> {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const program = new Command();
    registerAuthCommand(program);
    await program.parseAsync(["node", "cawplan", "auth", "logout"], { from: "node" });
  }

  test("revokes the refresh token server-side before deleting local credentials", async () => {
    await writeCredentials({ accessToken: "access", refreshToken: "refresh-1", expire: nowSeconds() + 3600 });
    let credentialsAtRevoke: unknown = "unset";
    const calls = mockFetch({
      "/cli/oauth/revoke": async () => {
        credentialsAtRevoke = await readCredentials();
        return json({ code: "SUCCESS", msg: "success" });
      },
    });

    await runLogout();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.path.endsWith("/api/v1/cli/oauth/revoke")).toBe(true);
    expect(calls[0]!.body).toEqual({ refresh_token: "refresh-1" });
    expect(credentialsAtRevoke).not.toBeNull();
    expect(await readCredentials()).toBeNull();
  });

  test("still deletes local credentials when the server has no revoke endpoint (404)", async () => {
    await writeCredentials({ accessToken: "access", refreshToken: "refresh-1", expire: nowSeconds() + 3600 });
    mockFetch({ "/cli/oauth/revoke": () => new Response("404 page not found", { status: 404 }) });

    await runLogout();

    expect(await readCredentials()).toBeNull();
  });

  test("still deletes local credentials when the revoke request fails", async () => {
    await writeCredentials({ accessToken: "access", refreshToken: "refresh-1", expire: nowSeconds() + 3600 });
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;

    await runLogout();

    expect(await readCredentials()).toBeNull();
  });

  test("skips revoke when there is no refresh token", async () => {
    await writeCredentials({ accessToken: "access", expire: nowSeconds() + 3600 });
    const calls = mockFetch({});

    await runLogout();

    expect(calls).toHaveLength(0);
    expect(await readCredentials()).toBeNull();
  });
});
