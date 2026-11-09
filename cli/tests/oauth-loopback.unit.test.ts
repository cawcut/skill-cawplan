import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  NO_BROWSER_HINT,
  describeFetchError,
  runOAuthLogin,
  codeFromLoopbackCallback,
  detectRemoteLoginReason,
  pkceChallenge,
  runLoopbackLogin,
  startLoopbackListener,
  startOAuthLogin,
} from "../src/lib/oauth";
import { writeUserConfig } from "../src/lib/user-config";

const API_BASE = "https://proto-api.example.com/core-product";

let originalFetch: typeof fetch;
let originalConfigPath: string | undefined;
let tmpDir: string;

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  originalConfigPath = process.env.CAWPLAN_CONFIG_PATH;
  tmpDir = await mkdtemp(join(tmpdir(), "cawplan-loopback-"));
  process.env.CAWPLAN_CONFIG_PATH = join(tmpDir, "config.json");
  await writeUserConfig({
    env: "proto",
    environments: { proto: { apiBase: API_BASE, portalBase: "https://proto-portal.example.com" } },
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  if (originalConfigPath === undefined) delete process.env.CAWPLAN_CONFIG_PATH;
  else process.env.CAWPLAN_CONFIG_PATH = originalConfigPath;
  await rm(tmpDir, { recursive: true, force: true });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** Plain GET through node:http so the mocked global fetch is not involved. */
const PORTAL_ORIGIN = "https://proto-portal.example.com";

interface Reply {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function httpGet(
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    request(url, { method: options.method ?? "GET", headers: options.headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    })
      .on("error", reject)
      .end();
  });
}

interface FakeServer {
  startBody?: Record<string, string>;
  startUserAgent?: string;
  exchangeUserAgent?: string;
  exchangeBodies: Record<string, string>[];
}

/** Fakes the backend: loopback start, then exchange of the issued code. */
function fakeLoopbackBackend(server: FakeServer, issuedCode = "auth-code-1"): void {
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, string>;
    if (String(url).endsWith("/cli/oauth/start")) {
      server.startBody = body;
      server.startUserAgent = new Headers(init?.headers).get("user-agent") ?? undefined;
      return jsonResponse({ code: "SUCCESS", data: { mode: "loopback", code: "public-code", expires_in: 300 } });
    }
    server.exchangeBodies.push(body);
    server.exchangeUserAgent = new Headers(init?.headers).get("user-agent") ?? undefined;
    const ok = body.code === issuedCode &&
      pkceChallenge(body.code_verifier) === server.startBody?.code_challenge &&
      body.redirect_uri === server.startBody?.redirect_uri;
    return jsonResponse(ok
      ? { code: "SUCCESS", data: { access_token: "access", refresh_token: "refresh", expire: 1770000000 } }
      : { code: "INVALID_GRANT", msg: "code_verifier does not match code_challenge" });
  };
}

/**
 * Plays the browser after consent: navigates to the CLI's loopback callback.
 * Like a real browser launcher it returns before the page has loaded.
 */
function browserRedirecting(
  server: FakeServer,
  query: (state: string) => string,
  pages?: Promise<Reply>[],
) {
  return async () => {
    const page = httpGet(`${server.startBody?.redirect_uri}?${query(server.startBody?.state ?? "")}`);
    page.catch(() => undefined);
    pages?.push(page);
  };
}

describe("loopback login", () => {
  test("PKCE challenge is unpadded base64url(SHA-256(verifier))", () => {
    // Expected value computed independently with Python hashlib.
    expect(pkceChallenge("dBjftJeZ4CVP-mJ92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "ngF5GsXcbwljx6u133FFr3Xht9xooA_DuaX_3QwODtc",
    );
  });

  test("signs in through the loopback redirect with code, verifier and redirect_uri", async () => {
    const server: FakeServer = { exchangeBodies: [] };
    fakeLoopbackBackend(server);
    const pages: Promise<Reply>[] = [];

    const creds = await runLoopbackLogin({
      openBrowser: browserRedirecting(server, (state) => `code=auth-code-1&state=${encodeURIComponent(state)}`, pages),
      timeoutMs: 5000,
    });

    expect(creds).toMatchObject({ accessToken: "access", refreshToken: "refresh", apiBase: API_BASE });
    expect(server.startBody).toMatchObject({ client: "cawplan-cli", code_challenge_method: "S256" });
    expect(server.startUserAgent).toMatch(/^cawplan-cli\/\d+\.\d+\.\d+$/);
    expect(server.exchangeUserAgent).toBe(server.startUserAgent);
    expect(server.startBody?.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(server.startBody?.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(server.startBody?.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(server.exchangeBodies).toHaveLength(1);
    expect(server.exchangeBodies[0]).toMatchObject({ code: "auth-code-1", redirect_uri: server.startBody?.redirect_uri });
    expect(server.exchangeBodies[0]).not.toHaveProperty("token");
    const [page] = await Promise.all(pages);
    expect(page.status).toBe(200);
    expect(page.body).toContain("<h1>Connection successful</h1>");

    // The listener served its one request and is gone.
    await expect(httpGet(server.startBody?.redirect_uri ?? "")).rejects.toThrow();
  });

  test("answers a callback with the wrong state with 400 and keeps waiting for the real one", async () => {
    const server: FakeServer = { exchangeBodies: [] };
    fakeLoopbackBackend(server);
    let forged: Reply | undefined;

    const creds = await runLoopbackLogin({
      openBrowser: async () => {
        void (async () => {
          const uri = server.startBody?.redirect_uri ?? "";
          forged = await httpGet(`${uri}?code=attacker-code&state=forged`);
          expect((await httpGet(`${uri.replace("/callback", "/other")}?state=${server.startBody?.state}`)).status).toBe(404);
          await httpGet(`${uri}?code=auth-code-1&state=${encodeURIComponent(server.startBody?.state ?? "")}`);
        })().catch(() => undefined);
      },
      timeoutMs: 5000,
    });

    expect(creds).toMatchObject({ accessToken: "access" });
    expect(forged?.status).toBe(400);
    expect(server.exchangeBodies.map((b) => b.code)).toEqual(["auth-code-1"]);
  });

  test("a browser launcher that never returns does not stall the login", async () => {
    const server: FakeServer = { exchangeBodies: [] };
    fakeLoopbackBackend(server);
    const redirect = browserRedirecting(server, (state) => `code=auth-code-1&state=${encodeURIComponent(state)}`);

    await expect(runLoopbackLogin({
      openBrowser: async (url) => {
        await redirect(url);
        await new Promise(() => undefined);
      },
      timeoutMs: 5000,
    })).resolves.toMatchObject({ accessToken: "access" });

    // And the timeout still fires while the launcher hangs.
    await expect(runLoopbackLogin({ openBrowser: () => new Promise(() => undefined), timeoutMs: 50 }))
      .rejects.toThrow("timed out");
  });

  test("uses the server's expires_in for the loopback timeout", async () => {
    globalThis.fetch = async () =>
      jsonResponse({ code: "SUCCESS", data: { mode: "loopback", code: "public-code", expires_in: 0.05 } });
    const started = Date.now();
    await expect(runLoopbackLogin({ openBrowser: async () => undefined })).rejects.toThrow("timed out");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("tells the user the code is spent when the exchange fails", async () => {
    const server: FakeServer = { exchangeBodies: [] };
    fakeLoopbackBackend(server, "another-code");
    const pages: Promise<Reply>[] = [];
    await expect(runLoopbackLogin({
      openBrowser: browserRedirecting(server, (state) => `code=auth-code-1&state=${encodeURIComponent(state)}`, pages),
      timeoutMs: 5000,
    })).rejects.toThrow("cannot be retried; run: cawplan auth login");
    expect((await pages[0]).status).toBe(400);
  });

  test("stops when the user cancels on the consent page", async () => {
    const server: FakeServer = { exchangeBodies: [] };
    fakeLoopbackBackend(server);
    await expect(runLoopbackLogin({
      openBrowser: browserRedirecting(server, (state) => `error=access_denied&state=${encodeURIComponent(state)}`),
      timeoutMs: 5000,
    })).rejects.toThrow("cancelled");
    expect(server.exchangeBodies).toHaveLength(0);
  });

  test("tells the user about --no-browser when the browser cannot be opened, and on timeout", async () => {
    const server: FakeServer = { exchangeBodies: [] };
    fakeLoopbackBackend(server);
    const consoleError = vi.mocked(console.error);

    await expect(runLoopbackLogin({
      openBrowser: async () => {
        throw new Error("xdg-open: not found");
      },
      timeoutMs: 50,
    })).rejects.toThrow(NO_BROWSER_HINT);
    expect(consoleError).toHaveBeenCalledWith(`Could not open a browser. ${NO_BROWSER_HINT}`);
    expect(NO_BROWSER_HINT).toContain("cawplan auth login --no-browser");
  });

  test("falls back to the user-code flow when the server predates loopback logins", async () => {
    const calls: Record<string, string>[] = [];
    globalThis.fetch = async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return jsonResponse(calls.length === 1
        ? { code: "SUCCESS", data: { code: "browser-code", token: "private-token", user_code: "BCDF-GHJK", expires_in: 300, interval: 1 } }
        : { code: "SUCCESS", data: { access_token: "access", refresh_token: "refresh", expire: 1770000000 } });
    };

    const opened: string[] = [];
    await expect(runLoopbackLogin({ openBrowser: async (url) => void opened.push(url), timeoutMs: 5000 })).resolves.toMatchObject({
      accessToken: "access",
    });
    expect(calls[1]).toEqual({ token: "private-token" });
    // The code is shown only in the terminal, never put in the link.
    expect(opened).toHaveLength(1);
    expect(new URL(opened[0]).searchParams.has("user_code")).toBe(false);
    expect(opened[0]).not.toContain("BCDF");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("enter: BCDF-GHJK"));
  });

  test.each([
    ["rejects redirect_uri", () => jsonResponse({ code: "INVALID_INPUT", msg: "redirect_uri must be http://127.0.0.1:<port>/callback" })],
    ["answers 400 with INVALID_INPUT", () => new Response(JSON.stringify({ code: "INVALID_INPUT", msg: "bad request" }), { status: 400 })],
  ])("falls back to the user-code flow when the server %s", async (_name, rejectLoopback) => {
    const starts: Record<string, string>[] = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      if (String(url).endsWith("/cli/oauth/start")) {
        starts.push(body);
        if (body.redirect_uri) return rejectLoopback();
        return jsonResponse({ code: "SUCCESS", data: { mode: "user_code", code: "browser-code", token: "private-token", user_code: "BCDF-GHJK", expires_in: 300, interval: 1 } });
      }
      expect(body).toEqual({ token: "private-token" });
      return jsonResponse({ code: "SUCCESS", data: { access_token: "access", refresh_token: "refresh", expire: 1770000000 } });
    };

    await expect(runLoopbackLogin({ openBrowser: async () => undefined, timeoutMs: 60_000 })).resolves.toMatchObject({
      accessToken: "access",
    });
    expect(starts).toHaveLength(2);
    expect(starts[0].redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(starts[1]).toEqual({ client: "cawplan-cli", displays_user_code: true });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("using a sign-in code instead"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("enter: BCDF-GHJK"));
  });

  test.each([
    ["is rate limited (429)", () => new Response(JSON.stringify({ code: "TOO_MANY_REQUESTS", msg: "slow down" }), { status: 429 })],
    ["answers 400 without INVALID_INPUT", () => new Response(JSON.stringify({ msg: "bad request" }), { status: 400 })],
    ["fails (500)", () => new Response(JSON.stringify({ msg: "boom" }), { status: 500 })],
    ["answers another error code", () => jsonResponse({ code: "FAILURE", msg: "token store unavailable" })],
  ])("does not fall back when the server %s", async (_name, reply) => {
    let starts = 0;
    globalThis.fetch = async () => {
      starts += 1;
      return reply();
    };
    await expect(runLoopbackLogin({ openBrowser: async () => undefined, timeoutMs: 1000 })).rejects.toThrow("OAuth start failed");
    expect(starts).toBe(1);
  });

  test("does not fall back when the server is unreachable", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    };
    await expect(runLoopbackLogin({ openBrowser: async () => undefined, timeoutMs: 1000 })).rejects.toThrow("fetch failed");
    expect(calls).toBe(1);
  });

  test("start in loopback mode needs no polling token", async () => {
    globalThis.fetch = async () =>
      jsonResponse({ code: "SUCCESS", data: { mode: "loopback", code: "public-code", expires_in: 300 } });
    await expect(startOAuthLogin({ redirectUri: "http://127.0.0.1:1/callback", codeChallenge: "c", state: "s" }))
      .resolves.toMatchObject({ mode: "loopback", code: "public-code", token: "" });

    globalThis.fetch = async () => jsonResponse({ code: "SUCCESS", data: { code: "public-code" } });
    await expect(startOAuthLogin()).rejects.toThrow("missing required code/token");
  });
});

describe("loopback listener", () => {
  test("binds 127.0.0.1 only, ignores other paths and serves a single callback", async () => {
    const listener = await startLoopbackListener("s");
    try {
      expect(listener.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      const base = listener.redirectUri.replace("/callback", "");
      expect((await httpGet(`${base}/favicon.ico`)).status).toBe(404);
      expect((await httpGet(`${listener.redirectUri}?code=c&state=wrong`)).status).toBe(400);

      const waiting = listener.waitForCallback(5000);
      const page = httpGet(`${listener.redirectUri}?code=c&state=s`);
      const callback = await waiting;
      expect(callback.params.get("code")).toBe("c");
      callback.respond("success");
      expect((await page).status).toBe(200);
      await expect(httpGet(`${listener.redirectUri}?code=c2&state=s`)).rejects.toThrow();
    } finally {
      listener.close();
    }
  });

  test("reads the code only when the state matches", () => {
    const params = (q: string) => new URLSearchParams(q);
    expect(codeFromLoopbackCallback(params("code=c&state=s1"), "s1")).toBe("c");
    expect(() => codeFromLoopbackCallback(params("code=c&state=s2"), "s1")).toThrow("state mismatch");
    expect(() => codeFromLoopbackCallback(params("code=c"), "s1")).toThrow("state mismatch");
    expect(() => codeFromLoopbackCallback(params("state=s1"), "s1")).toThrow("missing the authorization code");
    expect(() => codeFromLoopbackCallback(params("error=server_error&state=s1"), "s1")).toThrow("server_error");
  });
});

describe("remote session detection", () => {
  test.each([
    [{ SSH_CONNECTION: "1.2.3.4 22 5.6.7.8 22" }, "darwin", "remote session detected (SSH_CONNECTION)"],
    [{ SSH_TTY: "/dev/pts/0" }, "darwin", "remote session detected (SSH_TTY)"],
    [{ SSH_CLIENT: "1.2.3.4 22 22" }, "win32", "remote session detected (SSH_CLIENT)"],
    [{ CODESPACES: "true", DISPLAY: ":0" }, "linux", "remote session detected (CODESPACES)"],
    [{ REMOTE_CONTAINERS: "true" }, "darwin", "remote session detected (REMOTE_CONTAINERS)"],
    [{}, "linux", "no graphical display (DISPLAY and WAYLAND_DISPLAY are unset)"],
    [{ DISPLAY: ":0" }, "linux", null],
    [{ WAYLAND_DISPLAY: "wayland-0" }, "linux", null],
    [{}, "darwin", null],
    [{}, "win32", null],
    [{ SSH_TTY: "" }, "darwin", null],
  ] as const)("%o on %s -> %s", (env, platform, reason) => {
    expect(detectRemoteLoginReason(env, platform)).toBe(reason);
  });
});

describe("loopback callback for the portal's fetch", () => {
  const login = async (exchange: (body: Record<string, string>) => Response) => {
    const server: { start?: Record<string, string> } = {};
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      if (String(url).endsWith("/cli/oauth/start")) {
        server.start = body;
        return jsonResponse({ code: "SUCCESS", data: { mode: "loopback", code: "public-code", expires_in: 300 } });
      }
      return exchange(body);
    };
    let reply: Promise<Reply> | undefined;
    const done = runLoopbackLogin({
      openBrowser: async () => {
        // Plays the portal after Connect: fetch from the portal origin.
        reply = httpGet(
          `${server.start?.redirect_uri}?code=auth-code-1&state=${encodeURIComponent(server.start?.state ?? "")}`,
          { headers: { Origin: PORTAL_ORIGIN } },
        );
        reply.catch(() => undefined);
      },
      timeoutMs: 5000,
    });
    return { done, reply: () => reply as Promise<Reply> };
  };

  test("lets the portal origin read a success answer, sent only after the exchange", async () => {
    let exchanged = false;
    const { done, reply } = await login(() => {
      exchanged = true;
      return jsonResponse({ code: "SUCCESS", data: { access_token: "access", refresh_token: "refresh", expire: 1770000000 } });
    });
    await expect(done).resolves.toMatchObject({ accessToken: "access" });
    const got = await reply();
    expect(exchanged).toBe(true);
    expect(got.status).toBe(200);
    expect(got.headers["access-control-allow-origin"]).toBe(PORTAL_ORIGIN);
    expect(got.headers.vary).toBe("Origin");
    expect(got.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  test("answers a failed exchange with an error status the portal can read", async () => {
    const { done, reply } = await login(() => jsonResponse({ code: "INVALID_GRANT", msg: "code_verifier does not match" }));
    await expect(done).rejects.toThrow("cannot be retried");
    const got = await reply();
    expect(got.status).toBe(400);
    expect(got.headers["access-control-allow-origin"]).toBe(PORTAL_ORIGIN);
    expect(got.body).toContain("Connection failed");
    expect(got.body).not.toContain("code_verifier");
  });

  test("gives other origins no CORS headers", async () => {
    const listener = await startLoopbackListener("s");
    try {
      const waiting = listener.waitForCallback(5000);
      const page = httpGet(`${listener.redirectUri}?code=c&state=s`, { headers: { Origin: "https://evil.example" } });
      (await waiting).respond("success");
      const got = await page;
      expect(got.headers["access-control-allow-origin"]).toBeUndefined();
      expect(got.headers.vary).toBe("Origin");
    } finally {
      listener.close();
    }
  });

  test("answers the CORS / Private Network Access preflight for the portal only", async () => {
    const listener = await startLoopbackListener("s");
    try {
      const preflight = (origin: string, method = "GET") =>
        httpGet(`${listener.redirectUri}?code=c&state=s`, {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Private-Network": "true",
          },
        });
      const ok = await preflight(PORTAL_ORIGIN);
      expect(ok.status).toBe(204);
      expect(ok.headers["access-control-allow-origin"]).toBe(PORTAL_ORIGIN);
      expect(ok.headers["access-control-allow-methods"]).toBe("GET");
      expect(ok.headers["access-control-allow-private-network"]).toBe("true");

      for (const bad of [await preflight("https://evil.example"), await preflight(PORTAL_ORIGIN, "POST")]) {
        expect(bad.status).toBe(403);
        expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
        expect(bad.headers["access-control-allow-private-network"]).toBeUndefined();
      }

      // The preflight does not consume the callback.
      const waiting = listener.waitForCallback(5000);
      const page = httpGet(`${listener.redirectUri}?code=c&state=s`);
      (await waiting).respond("success");
      expect((await page).status).toBe(200);
    } finally {
      listener.close();
    }
  });

  test.each([
    ["success", 200, "Connection successful"],
    ["denied", 400, "Sign-in cancelled"],
    ["expired", 400, "This sign-in has expired."],
  ] as const)("serves a styled page for %s on top-level navigation", async (result, status, text) => {
    const listener = await startLoopbackListener("s");
    try {
      const waiting = listener.waitForCallback(5000);
      const page = httpGet(`${listener.redirectUri}?code=<script>&state=s`);
      (await waiting).respond(result);
      const got = await page;
      expect(got.status).toBe(status);
      expect(got.body).toContain("<style>");
      expect(got.body).toContain("prefers-color-scheme:dark");
      expect(got.body).toContain(text);
      expect(got.body).not.toContain("<script>");
    } finally {
      listener.close();
    }
  });
});

describe("network errors", () => {
  const socketClosed = () =>
    Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }),
    });

  test("keeps the low-level cause that 'fetch failed' hides", () => {
    expect(describeFetchError(socketClosed())).toBe("fetch failed (UND_ERR_SOCKET: other side closed)");
    expect(describeFetchError(new TypeError("fetch failed"))).toBe("fetch failed");
  });

  const loopbackWithExchange = (exchange: () => Promise<Response>) => {
    const starts: Record<string, string>[] = [];
    const exchanges: Record<string, string>[] = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      if (String(url).endsWith("/cli/oauth/start")) {
        starts.push(body);
        return jsonResponse({ code: "SUCCESS", data: { mode: "loopback", code: "public-code", expires_in: 300 } });
      }
      exchanges.push(body);
      return exchange();
    };
    const run = runLoopbackLogin({
      openBrowser: async () => {
        void httpGet(`${starts[0].redirect_uri}?code=auth-code-1&state=${encodeURIComponent(starts[0].state)}`).catch(() => undefined);
      },
      timeoutMs: 5000,
    });
    return { run, exchanges };
  };

  test("retries the code exchange once when the connection drops", async () => {
    let calls = 0;
    const { run, exchanges } = loopbackWithExchange(async () => {
      calls += 1;
      if (calls === 1) throw socketClosed();
      return jsonResponse({ code: "SUCCESS", data: { access_token: "access", refresh_token: "refresh", expire: 1770000000 } });
    });
    await expect(run).resolves.toMatchObject({ accessToken: "access" });
    expect(exchanges).toHaveLength(2);
    expect(exchanges[1]).toEqual(exchanges[0]);
  });

  test("reports the cause when the retry fails too, and does not retry again", async () => {
    const { run, exchanges } = loopbackWithExchange(async () => {
      throw socketClosed();
    });
    await expect(run).rejects.toThrow("Exchange failed: fetch failed (UND_ERR_SOCKET: other side closed). This sign-in code has been used");
    expect(exchanges).toHaveLength(2);
  });

  test("does not retry when the server answered", async () => {
    const { run, exchanges } = loopbackWithExchange(async () =>
      jsonResponse({ code: "INVALID_GRANT", msg: "code_verifier does not match" }));
    await expect(run).rejects.toThrow("cannot be retried");
    expect(exchanges).toHaveLength(1);
  });

  const userCodeLogin = (exchange: (n: number) => Promise<Response>) => {
    let n = 0;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/cli/oauth/start")) {
        return jsonResponse({ code: "SUCCESS", data: { mode: "user_code", code: "c", token: "t", user_code: "BCDF-GHJK", expires_in: 300, interval: 1 } });
      }
      n += 1;
      return exchange(n);
    };
    return runOAuthLogin({ skipBrowser: true, pollIntervalMs: 1, pollingTimeoutMs: 300 });
  };

  test("keeps polling through a dropped connection", async () => {
    await expect(userCodeLogin(async (n) => {
      if (n === 1) throw socketClosed();
      if (n === 2) return jsonResponse({ code: "PENDING", msg: "authorization pending" });
      return jsonResponse({ code: "SUCCESS", data: { access_token: "access", refresh_token: "refresh", expire: 1770000000 } });
    })).resolves.toMatchObject({ accessToken: "access" });
  });

  test("reports the network cause when polling never got through", async () => {
    await expect(userCodeLogin(async () => {
      throw socketClosed();
    })).rejects.toThrow("UND_ERR_SOCKET: other side closed");
  });
});
