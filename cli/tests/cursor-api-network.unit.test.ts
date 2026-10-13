import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  describeCursorApiRoute,
  fetchUsageEvents,
  isRetryableNetworkError,
  markCursorUsageUnavailable,
  resolveHttpsProxy,
  withNetworkRetries,
} from "../src/lib/collect/agents/cursor-api.js";
import type { SessionData } from "../src/lib/collect/types.js";

const CURSOR = new URL("https://cursor.com/api/dashboard/get-filtered-usage-events");

describe("resolveHttpsProxy", () => {
  test("uses HTTPS_PROXY, preferring the lowercase variable like curl", () => {
    expect(resolveHttpsProxy(CURSOR, { HTTPS_PROXY: "http://127.0.0.1:7897" })?.href).toBe("http://127.0.0.1:7897/");
    expect(
      resolveHttpsProxy(CURSOR, { https_proxy: "http://lower:1", HTTPS_PROXY: "http://upper:2" })?.host,
    ).toBe("lower:1");
  });

  test("falls back to ALL_PROXY and accepts a bare host:port", () => {
    expect(resolveHttpsProxy(CURSOR, { ALL_PROXY: "127.0.0.1:7897" })?.href).toBe("http://127.0.0.1:7897/");
  });

  test("ignores HTTP_PROXY for https targets", () => {
    expect(resolveHttpsProxy(CURSOR, { HTTP_PROXY: "http://127.0.0.1:7897" })).toBeNull();
  });

  test("connects directly when NO_PROXY matches", () => {
    const proxy = { HTTPS_PROXY: "http://127.0.0.1:7897" };
    for (const noProxy of ["*", "cursor.com", ".cursor.com", "localhost, cursor.com", "cursor.com:443"]) {
      expect(resolveHttpsProxy(CURSOR, { ...proxy, NO_PROXY: noProxy }), noProxy).toBeNull();
    }
    expect(resolveHttpsProxy(new URL("https://api2.cursor.sh/x"), { ...proxy, no_proxy: ".cursor.sh" })).toBeNull();
    for (const noProxy of ["example.com", "notcursor.com", "cursor.com:8443", "localhost,127.0.0.1,::1,.local"]) {
      expect(resolveHttpsProxy(CURSOR, { ...proxy, NO_PROXY: noProxy }), noProxy).not.toBeNull();
    }
  });

  test("skips unsupported proxy schemes instead of misusing them", () => {
    expect(resolveHttpsProxy(CURSOR, { HTTPS_PROXY: "socks5://127.0.0.1:7897" })).toBeNull();
    expect(resolveHttpsProxy(CURSOR, { HTTPS_PROXY: "" })).toBeNull();
  });

  test("describeCursorApiRoute never prints proxy credentials", () => {
    expect(describeCursorApiRoute({ HTTPS_PROXY: "http://alice:s3cret@proxy.corp:3128" })).toBe(
      "via proxy http://proxy.corp:3128",
    );
    expect(describeCursorApiRoute({})).toBe("direct");
  });
});

describe("network retries", () => {
  test("classifies transient network failures as retryable, HTTP client errors as not", () => {
    const tls = new Error("Client network socket disconnected before secure TLS connection was established");
    const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    expect(isRetryableNetworkError(tls)).toBe(true);
    expect(isRetryableNetworkError(reset)).toBe(true);
    expect(isRetryableNetworkError(new Error("Cursor API request timed out after 30s"))).toBe(true);
    expect(isRetryableNetworkError(new Error("Cursor API HTTP 503: unavailable"))).toBe(true);
    expect(isRetryableNetworkError(new Error("Cursor API HTTP 401: unauthorized"))).toBe(false);
  });

  test("withNetworkRetries retries transient failures then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }))
      .mockResolvedValueOnce("ok");
    await expect(withNetworkRetries(run, [10, 20], sleep)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  test("withNetworkRetries gives up after the last delay and does not retry non-network errors", async () => {
    const sleep = vi.fn(async () => {});
    const flaky = vi.fn(async () => {
      throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    });
    await expect(withNetworkRetries(flaky, [1, 1], sleep)).rejects.toThrow("ECONNRESET");
    expect(flaky).toHaveBeenCalledTimes(3);

    const denied = vi.fn(async () => {
      throw new Error("Cursor API HTTP 401: unauthorized");
    });
    await expect(withNetworkRetries(denied, [1, 1], sleep)).rejects.toThrow("401");
    expect(denied).toHaveBeenCalledTimes(1);
  });
});

describe("fetchUsageEvents through an HTTP proxy", () => {
  const servers: Server[] = [];
  const savedEnv = { ...process.env };

  afterEach(async () => {
    process.env = { ...savedEnv };
    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
  });

  test("tunnels to cursor.com with CONNECT and proxy credentials", async () => {
    const connects: Array<{ target: string | undefined; auth: string | undefined }> = [];
    const proxy = createServer();
    proxy.on("connect", (req: IncomingMessage, socket: Socket) => {
      connects.push({ target: req.url, auth: req.headers["proxy-authorization"] });
      socket.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
    });
    servers.push(proxy);
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const { port } = proxy.address() as AddressInfo;

    process.env = { ...savedEnv, HTTPS_PROXY: `http://alice:s3cret@127.0.0.1:${port}`, NO_PROXY: "" };
    delete process.env.https_proxy;
    delete process.env.no_proxy;

    await expect(fetchUsageEvents(0, 1, "cookie")).rejects.toThrow(/407/);
    expect(connects).toEqual([
      { target: "cursor.com:443", auth: `Basic ${Buffer.from("alice:s3cret").toString("base64")}` },
    ]);
  });
});

describe("markCursorUsageUnavailable", () => {
  const session = (agent: string, withUsage = false): SessionData =>
    ({
      agent,
      session_id: agent,
      model_usage: {},
      usage_breakdown: withUsage
        ? [{ model: "m", input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost: 0 }]
        : [],
    }) as unknown as SessionData;

  test("labels only Cursor GUI sessions that ended up without usage", () => {
    const sessions = [session("cursor-gui"), session("cursor-gui", true), session("cursor-cli"), session("codex")];
    const count = markCursorUsageUnavailable(sessions, "read ECONNRESET");
    expect(count).toBe(1);
    expect(sessions.map((s) => s.token_source)).toEqual([
      "unavailable (Cursor dashboard API failed: read ECONNRESET)",
      undefined,
      undefined,
      undefined,
    ]);
  });
});
