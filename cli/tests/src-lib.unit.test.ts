import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { cawplanRequest, ApiError } from "../src/lib/http";
import {
  deleteCredentials,
  getCredentialsPath,
  readCredentials,
  writeCredentials,
} from "../src/lib/credentials";
import {
  browserOpenCommand,
  buildConsentUrl,
  formatOAuthValidity,
  pollOAuthExchange,
  runOAuthLogin,
  startOAuthLogin,
} from "../src/lib/oauth";
import { getAuthState } from "../src/lib/auth-state";
import { buildScopedCacheKey, getCacheScope } from "../src/lib/cache";
import {
  apiBaseUsesGatewayPrefix,
  getApiBase,
  getPortalBase,
  resolveApiPath,
} from "../src/lib/products";
import { getConfigPath, readUserConfig, writeUserConfig } from "../src/lib/user-config";
import { normalizeSessionRepoContext } from "../src/lib/collect";
import { buildDailyApiJson } from "../src/lib/collect/aggregators/daily";
import { calculateCost } from "../src/lib/collect/pricing";
import { collectCodexSessions } from "../src/lib/collect/agents/codex";
import { aggregateUsageBuckets } from "../src/lib/collect/aggregators/tokens";
import {
  aggregateCursorUsageBySession,
  buildCursorAttributionWindows,
  buildCursorSessionWindows,
  clusterUsageEventsIntoBursts,
  burstPosForSequenceOrder,
  humanInputBillingActivityWeight,
  humanInputFileActivityWeight,
  refineCursorHumanInputsFromBillingEvents,
  refineHumanInputsFromAttributedEvents,
  mapAttributedEventTimesByHumanInput,
  shouldPreserveExactHumanInputTime,
  refineSessionHumanInputsFromBillingBursts,
} from "../src/lib/collect/agents/cursor-api";
import type { SessionData } from "../src/lib/collect/types";

let originalFetch: typeof fetch;
let tmpDir: string;
let originalApiKey: string | undefined;
let originalBaseUrl: string | undefined;
let originalPortalUrl: string | undefined;
let originalEnv: string | undefined;
let originalCredentialsPath: string | undefined;
let originalConfigPath: string | undefined;
let originalCachePath: string | undefined;
let originalCodexHome: string | undefined;

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
  originalCodexHome = process.env.CODEX_HOME;

  tmpDir = await mkdtemp(join(tmpdir(), "cawplan-tests-"));
  process.env.CAWPLAN_CREDENTIALS_PATH = join(tmpDir, "credentials.json");
  process.env.CAWPLAN_CONFIG_PATH = join(tmpDir, "config.json");
  process.env.CAWPLAN_CACHE_PATH = join(tmpDir, "cache.json");
  process.env.CAWPLAN_BASE_URL = "https://api.test/core-product";
  delete process.env.CAWPLAN_PORTAL_URL;
  delete process.env.CAWPLAN_ENV;
  delete process.env.CAWPLAN_API_KEY;
  delete process.env.CODEX_HOME;
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

  if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalCodexHome;

  await rm(tmpDir, { recursive: true, force: true });
});

function createCodexStateDb(codexHome: string): DatabaseSync {
  const db = new DatabaseSync(join(codexHome, "state_5.sqlite"));
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      model TEXT,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      cwd TEXT NOT NULL,
      has_user_event INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER,
      updated_at_ms INTEGER,
      recency_at_ms INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

function insertCodexThread(
  db: DatabaseSync,
  values: {
    id: string;
    rolloutPath?: string;
    createdAt: number;
    updatedAt?: number;
    model?: string;
    tokensUsed?: number;
    title?: string;
    cwd?: string;
    hasUserEvent?: number;
  }
): void {
  const updatedAt = values.updatedAt ?? values.createdAt;
  db.prepare(`
    INSERT INTO threads (
      id,
      rollout_path,
      created_at,
      updated_at,
      model,
      tokens_used,
      title,
      cwd,
      has_user_event,
      created_at_ms,
      updated_at_ms,
      recency_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    values.id,
    values.rolloutPath ?? "",
    values.createdAt,
    updatedAt,
    values.model ?? "gpt-5-codex",
    values.tokensUsed ?? 0,
    values.title ?? values.id,
    values.cwd ?? "/repo/flow-cawplan-skill",
    values.hasUserEvent ?? 1,
    values.createdAt * 1000,
    updatedAt * 1000,
    updatedAt * 1000,
  );
}

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

describe("src lib collect repo context normalization", () => {
  test("uses git remote repo name for all agents when cwd folder name differs", () => {
    const sessions = ["claude-code", "cursor-cli", "codex"].map((agent) => ({
      schema: "2.0" as const,
      date: "2026-06-17",
      agent,
      session_id: `${agent}-session-id`,
      session_name: `${agent} session`,
      project: "local-folder-name",
      cwd: `/work/${agent}/local-folder-name`,
      time_range: { display: "10:00 - 10:05", timezone: "UTC" },
      model_usage: {},
      usage_breakdown: [],
      files_changed: 0,
      repos_touched: [],
      message_stats: { user: 1, assistant: 1, tool_calls: 0 },
    }));

    normalizeSessionRepoContext(sessions, () => "Ubiquiti-UID/real-repo-name");

    expect(sessions.map((session) => session.project)).toEqual([
      "real-repo-name",
      "real-repo-name",
      "real-repo-name",
    ]);
  });

  test("prefers cwd git remote over repos_touched when normalizing project", () => {
    const sessions = [{
      schema: "2.0" as const,
      date: "2026-06-17",
      agent: "cursor-cli",
      session_id: "cursor-cli-session-id",
      session_name: "cursor-cli session",
      project: "local-folder-name",
      cwd: "/work/local-folder-name",
      time_range: { display: "10:00 - 10:05", timezone: "UTC" },
      model_usage: {},
      usage_breakdown: [],
      files_changed: 1,
      repos_touched: [{ repo: "Ubiquiti-UID/repo-from-repos-touched", files: 1, added: 0, deleted: 0 }],
      message_stats: { user: 1, assistant: 1, tool_calls: 0 },
    }];

    normalizeSessionRepoContext(sessions, () => "Ubiquiti-UID/repo-from-cwd");

    expect(sessions[0]?.project).toBe("repo-from-cwd");
  });

  test("falls back to repos_touched when cwd cannot resolve a repo", () => {
    const sessions = [{
      schema: "2.0" as const,
      date: "2026-06-17",
      agent: "cursor-gui",
      session_id: "cursor-gui-session-id",
      session_name: "cursor-gui session",
      project: "local-folder-name",
      cwd: "",
      time_range: { display: "10:00 - 10:05", timezone: "UTC" },
      model_usage: {},
      usage_breakdown: [],
      files_changed: 1,
      repos_touched: [{ repo: "Ubiquiti-UID/repo-from-repos-touched", files: 1, added: 0, deleted: 0 }],
      message_stats: { user: 1, assistant: 1, tool_calls: 0 },
    }];

    normalizeSessionRepoContext(sessions, () => "");

    expect(sessions[0]?.project).toBe("repo-from-repos-touched");
  });

  test("falls back to repos_touched when git remote resolver returns original cwd", () => {
    const cwd = "/work/local-folder-name";
    const sessions = [{
      schema: "2.0" as const,
      date: "2026-06-17",
      agent: "codex",
      session_id: "codex-session-id",
      session_name: "codex session",
      project: "local-folder-name",
      cwd,
      time_range: { display: "10:00 - 10:05", timezone: "UTC" },
      model_usage: {},
      usage_breakdown: [],
      files_changed: 1,
      repos_touched: [{ repo: "Ubiquiti-UID/repo-from-repos-touched", files: 1, added: 0, deleted: 0 }],
      message_stats: { user: 1, assistant: 1, tool_calls: 0 },
    }];

    normalizeSessionRepoContext(sessions, () => cwd);

    expect(sessions[0]?.project).toBe("repo-from-repos-touched");
  });
});

describe("src lib collect cost currency", () => {
  test("dollar costs pass through unchanged in daily output", () => {
    const session: SessionData = {
      schema: "2.0",
      date: "2026-06-17",
      agent: "claude-code",
      session_id: "session-usd-cost",
      session_name: "Dollar cost session",
      project: "flow-cawplan-skill",
      cwd: "/repo/flow-cawplan-skill",
      time_range: { display: "10:00 - 10:05", timezone: "UTC" },
      model_usage: {
        "deepseek-v4-pro": {
          api_calls: 1,
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          cost: 1.0,
          currency: "$",
        },
      },
      usage_breakdown: [
        {
          model: "deepseek-v4-pro",
          speed: "standard",
          service_tier: "standard",
          effort: "default",
          api_calls: 1,
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          cost: 1.0,
          currency: "$",
        },
      ],
      files_changed: 0,
      repos_touched: [],
      message_stats: { user: 1, assistant: 1, tool_calls: 0 },
    };

    const daily = buildDailyApiJson([session], "2026-06-17", "xin.li");

    expect(daily.totals.cost).toEqual({ "$": 1 });
    expect(daily.usage_breakdown[0]?.currency).toBe("$");
    expect(daily.usage_breakdown[0]?.cost).toBe(1);
    expect(daily.model_usage["deepseek-v4-pro"]?.currency).toBe("$");
    expect(daily.model_usage["deepseek-v4-pro"]?.cost).toBe(1);
    expect(daily.sessions[0]?.usage_breakdown[0]?.currency).toBe("$");
    expect(daily.sessions[0]?.session_cost).toBe(1);
  });

  test("calculateCost does not double-count cache tokens", () => {
    // 1M input tokens with 100K cache reads and 50K cache writes.
    // Non-cache input = 1M - 100K - 50K = 850K
    // Expected: 850K * 0.14 + 0 * 0.28 + 100K * 0.0028 + 50K * 0.14
    // = 0.119 + 0 + 0.00028 + 0.007 = $0.12628
    const cost = calculateCost("deepseek-v4-flash", {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 100_000,
      cache_creation_input_tokens: 50_000,
    });
    expect(cost).toBeCloseTo(0.12628, 4);

    // If we had the old double-counting bug:
    // 1M * 0.14 + 0 + 100K * 0.0028 + 50K * 0.14 = 0.14 + 0.00028 + 0.007 = 0.14728
    // Our fixed cost (0.12628) < old bug cost (0.14728)
  });

  test("calculateCost handles input without cache tokens", () => {
    // Pure input, no cache — billableInput = input
    const cost = calculateCost("deepseek-v4-pro", {
      input_tokens: 1_000_000,
      output_tokens: 500_000,
    });
    // 1M * 0.435 + 500K * 0.87 = 0.435 + 0.435 = 0.87
    expect(cost).toBeCloseTo(0.87, 4);
  });

  test("calculateCost uses current Claude dollar pricing", () => {
    expect(calculateCost("claude-fable-5", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    })).toBeCloseTo(60, 4);

    expect(calculateCost("claude-mythos-5", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    })).toBeCloseTo(60, 4);

    // Sonnet 5 has temporary pricing through August 31, 2026.
    expect(calculateCost("claude-sonnet-5", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    })).toBeCloseTo(12, 4);

    // Claude official pricing does not define a separate fast multiplier.
    expect(calculateCost("claude-opus-4-7", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    }, { speed: "fast" })).toBeCloseTo(30, 4);
  });
});

describe("src lib oauth", () => {
  test("builds consent URL with public code query params for polling", () => {
    process.env.CAWPLAN_PORTAL_URL = "https://core-web-product.uid.dev.ui.com";

    const url = buildConsentUrl("code-123");
    const parsed = new URL(url);

    expect(parsed.origin).toBe("https://core-web-product.uid.dev.ui.com");
    expect(parsed.pathname).toBe("/cli/auth");
    expect(parsed.searchParams.get("client")).toBe("cawplan-cli");
    expect(parsed.searchParams.get("code")).toBe("code-123");
    expect([...parsed.searchParams.keys()].sort()).toEqual(["client", "code"]);
  });

  test("opens OAuth URL on Windows without routing ampersands through cmd", () => {
    const url = "https://core-web-product.uid.dev.ui.com/cli/auth?client=cawplan-cli&code=code-123";

    const command = browserOpenCommand(url, "win32");

    expect(command.command).toBe("rundll32.exe");
    expect(command.args).toEqual(["url.dll,FileProtocolHandler", url]);
  });

  test("formats OAuth verification validity for terminal prompt", () => {
    expect(formatOAuthValidity(300)).toBe("5 minutes");
  });

  test("prints OAuth verification validity in login prompt", async () => {
    process.env.CAWPLAN_BASE_URL = "https://api.test/core-product";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            code: "SUCCESS",
            data: {
              code: "browser-code",
              token: "private-token",
              expires_in: 300,
              interval: 1,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          code: "SUCCESS",
          data: {
            access_token: "access",
            refresh_token: "refresh",
            expire: 1770000000,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    await runOAuthLogin({
      openBrowser: async () => undefined,
      pollIntervalMs: 1,
      pollingTimeoutMs: 1000,
    });

    expect(consoleError).toHaveBeenCalledWith("This verification is valid for 5 minutes.");
    consoleError.mockRestore();
  });

  test("starts OAuth login and returns code with private polling token", async () => {
    process.env.CAWPLAN_BASE_URL = "https://api.test/core-product";
    const calls: string[] = [];
    globalThis.fetch = async (_url, init) => {
      calls.push(String(init?.body));
      return new Response(
        JSON.stringify({
          code: "SUCCESS",
          data: {
            code: "browser-code",
            token: "private-token",
            expires_in: 300,
            interval: 2,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    await expect(startOAuthLogin()).resolves.toEqual({
      code: "browser-code",
      token: "private-token",
      expiresIn: 300,
      interval: 2,
    });
    expect(calls).toEqual([JSON.stringify({ client: "cawplan-cli" })]);
  });

  test("polls OAuth exchange until browser consent completes", async () => {
    process.env.CAWPLAN_BASE_URL = "https://api.test/core-product";
    const calls: string[] = [];
    globalThis.fetch = async (_url, init) => {
      calls.push(String(init?.body));
      if (calls.length === 1) {
        return new Response(JSON.stringify({ code: "PENDING", message: "authorization pending" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          code: "SUCCESS",
          data: {
            access_token: "access",
            refresh_token: "refresh",
            expire: 1770000000,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    await expect(pollOAuthExchange("private-token", 1000, 1)).resolves.toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      expire: 1770000000,
    });
    expect(calls).toEqual([
      JSON.stringify({ token: "private-token" }),
      JSON.stringify({ token: "private-token" }),
    ]);
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

  test("surfaces refresh failure when no API key fallback is configured", async () => {
    await writeCredentials({
      accessToken: "old-access",
      refreshToken: "expired-refresh-token",
      expire: 1,
    });

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ code: "INVALID_REFRESH_TOKEN" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });

    await expect(
      cawplanRequest({ method: "GET", path: "/api/v1/public/openapi/products" }),
    ).rejects.toThrow("Token expired, run: cawplan auth login");
  });

  test("surfaces refresh business error returned with HTTP 200", async () => {
    await writeCredentials({
      accessToken: "old-access",
      refreshToken: "expired-refresh-token",
      expire: 1,
    });

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          code: "INVALID_OR_EXPIRED",
          data: null,
          msg: "invalid or expired refresh token",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );

    await expect(
      cawplanRequest({ method: "GET", path: "/api/v1/public/openapi/products" }),
    ).rejects.toThrow(
      "Token refresh failed: invalid or expired refresh token. Run: cawplan auth login",
    );
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

describe("src lib collect codex", () => {
  test("keeps total-only Codex tokens out of output_tokens", async () => {
    const codexHome = join(tmpDir, "codex");
    await mkdir(codexHome, { recursive: true });
    process.env.CODEX_HOME = codexHome;

    const db = createCodexStateDb(codexHome);
    try {
      insertCodexThread(db, {
        id: "codex-total-only",
        createdAt: Math.floor(new Date("2026-06-17T02:00:00.000Z").getTime() / 1000),
        tokensUsed: 1234,
      });
    } finally {
      db.close();
    }

    const [session] = collectCodexSessions("2026-06-17");

    expect(session?.total_tokens).toBe(1234);
    expect(session?.usage_breakdown[0]).toMatchObject({
      input_tokens: 0,
      output_tokens: 0,
      cost: 0,
      token_source: "total_only",
    });

    const daily = buildDailyApiJson([session!], "2026-06-17", "xin.li");
    expect(daily.sessions[0]?.total_tokens).toBe(1234);
    expect(daily.sessions[0]?.cost_basis).toBe("unknown");
    expect(daily.totals.cost).toEqual({ "$": 0 });
    expect(daily.usage_breakdown[0]?.output_tokens).toBe(0);
    expect(daily.usage_breakdown[0]?.cost).toBe(0);
  });

  test("skips Codex threads with no user activity or rollout activity", async () => {
    const codexHome = join(tmpDir, "codex");
    await mkdir(codexHome, { recursive: true });
    process.env.CODEX_HOME = codexHome;

    const db = createCodexStateDb(codexHome);
    try {
      insertCodexThread(db, {
        id: "empty-thread",
        createdAt: Math.floor(new Date("2026-06-17T02:00:00.000Z").getTime() / 1000),
        hasUserEvent: 0,
      });
    } finally {
      db.close();
    }

    expect(collectCodexSessions("2026-06-17")).toEqual([]);
  });

  test("does not collapse distinct Codex prompts with the same prefix", async () => {
    const codexHome = join(tmpDir, "codex");
    const sessionsDir = join(codexHome, "sessions", "codex-human-inputs");
    await mkdir(sessionsDir, { recursive: true });
    process.env.CODEX_HOME = codexHome;

    const commonPrefix = "请根据当前代码实现日报收集逻辑，并保持现有接口兼容。".repeat(4);
    const rolloutPath = join(sessionsDir, "rollout.jsonl");
    const events = [
      {
        type: "response_item",
        timestamp: "2026-06-17T02:00:00.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: `${commonPrefix}第一项：修复 token 统计。` }],
        },
      },
      {
        type: "response_item",
        timestamp: "2026-06-17T02:01:00.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "好的。" }],
        },
      },
      {
        type: "response_item",
        timestamp: "2026-06-17T02:05:00.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: `${commonPrefix}第二项：修复 prompt 去重。` }],
        },
      },
      {
        type: "response_item",
        timestamp: "2026-06-17T02:06:00.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "收到。" }],
        },
      },
    ];
    await writeFile(rolloutPath, events.map((event) => JSON.stringify(event)).join("\n"), "utf-8");

    const db = createCodexStateDb(codexHome);
    try {
      insertCodexThread(db, {
        id: "codex-human-inputs",
        rolloutPath,
        createdAt: Math.floor(new Date("2026-06-17T01:59:00.000Z").getTime() / 1000),
      });
    } finally {
      db.close();
    }

    const [session] = collectCodexSessions("2026-06-17");

    expect(session?.human_inputs).toHaveLength(2);
    expect(session?.human_inputs?.map((input) => input.content)).toEqual([
      `${commonPrefix}第一项：修复 token 统计。`,
      `${commonPrefix}第二项：修复 prompt 去重。`,
    ]);
  });

  test("resolves Codex rollout paths copied from another sessions root", async () => {
    const codexHome = join(tmpDir, "codex");
    const rolloutDir = join(codexHome, "sessions", "2026", "06", "17");
    await mkdir(rolloutDir, { recursive: true });
    process.env.CODEX_HOME = codexHome;

    const rolloutPath = join(rolloutDir, "rollout.jsonl");
    await writeFile(
      rolloutPath,
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-06-17T02:00:00.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "请修复 Codex 日报成本统计。" }],
        },
      }),
      "utf-8",
    );

    const db = createCodexStateDb(codexHome);
    try {
      insertCodexThread(db, {
        id: "codex-relocated-rollout",
        rolloutPath: "/old-home/.codex/sessions/2026/06/17/rollout.jsonl",
        createdAt: Math.floor(new Date("2026-06-17T01:59:00.000Z").getTime() / 1000),
      });
    } finally {
      db.close();
    }

    const [session] = collectCodexSessions("2026-06-17");
    expect(session?.human_inputs?.[0]?.content).toBe("请修复 Codex 日报成本统计。");
  });

  test("keeps Codex threads with ISO timestamps in date filtering", async () => {
    const codexHome = join(tmpDir, "codex");
    await mkdir(codexHome, { recursive: true });
    process.env.CODEX_HOME = codexHome;

    const db = new DatabaseSync(join(codexHome, "state_5.sqlite"));
    try {
      db.exec(`
        CREATE TABLE threads (
          id TEXT PRIMARY KEY,
          rollout_path TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          model TEXT,
          tokens_used INTEGER NOT NULL DEFAULT 0,
          title TEXT NOT NULL,
          cwd TEXT NOT NULL,
          has_user_event INTEGER NOT NULL DEFAULT 0
        );
      `);
      db.prepare(`
        INSERT INTO threads (
          id, rollout_path, created_at, updated_at, model, tokens_used, title, cwd, has_user_event
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "codex-iso-time",
        "",
        "2026-06-17T02:00:00.000Z",
        "2026-06-17T02:10:00.000Z",
        "gpt-5-codex",
        99,
        "ISO Time",
        "/repo/flow-cawplan-skill",
        1,
      );
    } finally {
      db.close();
    }

    const [session] = collectCodexSessions("2026-06-17");
    expect(session?.session_id).toBe("codex-iso-time");
    expect(session?.total_tokens).toBe(99);
  });

  test("marks detailed Codex usage as unknown cost when model pricing is unavailable", async () => {
    const codexHome = join(tmpDir, "codex");
    const sessionsDir = join(codexHome, "sessions", "codex-unpriced");
    await mkdir(sessionsDir, { recursive: true });
    process.env.CODEX_HOME = codexHome;

    const rolloutPath = join(sessionsDir, "rollout.jsonl");
    await writeFile(
      rolloutPath,
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-06-17T02:00:00.000Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 40,
              output_tokens: 20,
            },
          },
        },
      }),
      "utf-8",
    );

    const db = createCodexStateDb(codexHome);
    try {
      insertCodexThread(db, {
        id: "codex-unpriced",
        rolloutPath,
        createdAt: Math.floor(new Date("2026-06-17T01:59:00.000Z").getTime() / 1000),
        model: "unpriced-codex-model",
      });
    } finally {
      db.close();
    }

    const [session] = collectCodexSessions("2026-06-17");
    expect(session?.usage_breakdown[0]).toMatchObject({
      input_tokens: 60,
      cache_read_input_tokens: 40,
      output_tokens: 20,
      cost: 0,
      token_source: "codex_token_count_estimate",
    });

    const daily = buildDailyApiJson([session!], "2026-06-17", "xin.li");
    expect(daily.totals.cost).toEqual({ "$": 0 });
    expect(daily.sessions[0]?.cost_basis).toBe("unknown");
  });

  test("collects today's Codex rollout files even when they are not indexed by state db", async () => {
    const codexHome = join(tmpDir, "codex");
    const rolloutDir = join(codexHome, "sessions", "2026", "06", "17");
    await mkdir(rolloutDir, { recursive: true });
    process.env.CODEX_HOME = codexHome;

    const db = createCodexStateDb(codexHome);
    db.close();

    await writeFile(
      join(rolloutDir, "rollout-orphan.jsonl"),
      [
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-06-17T02:00:00.000Z",
          payload: {
            type: "token_count",
            info: {
              model: "gpt-5.5",
              last_token_usage: {
                input_tokens: 200,
                cached_input_tokens: 50,
                output_tokens: 25,
              },
            },
          },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: "2026-06-17T02:01:00.000Z",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "统计今天遗漏的 Codex rollout。" }],
          },
        }),
      ].join("\n"),
      "utf-8",
    );

    const [session] = collectCodexSessions("2026-06-17");
    expect(session?.session_id).toBe("rollout-orphan");
    expect(session?.usage_breakdown[0]).toMatchObject({
      model: "gpt-5.5",
      input_tokens: 150,
      cache_read_input_tokens: 50,
      output_tokens: 25,
      token_source: "codex_token_count_estimate",
    });
    expect(session?.usage_breakdown[0]?.cost).toBeGreaterThan(0);
  });
});

describe("src lib collect daily aggregator", () => {
  test("attributes Cursor API usage to matching session windows", () => {
    const windows = buildCursorSessionWindows([
      {
        session_id: "cursor-session-1",
        agent: "cursor-gui",
        time_range: {
          start: "2026-06-17T02:00:00.000Z",
          display: "10:00 - 10:30",
        },
      },
    ]);

    const bySession = aggregateCursorUsageBySession(
      [
        {
          timestamp: "2026-06-17T02:10:00.000Z",
          model: "gpt-5.5-medium",
          tokenUsage: {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 300,
            cacheWriteTokens: 0,
          },
          chargedCents: 12,
        },
      ],
      "2026-06-17",
      windows
    );

    expect(bySession["cursor-session-1"]?.modelUsage["gpt-5.5-medium"]).toMatchObject({
      api_calls: 1,
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 300,
      cost: 0.12,
      token_source: "dashboard_api",
    });
    expect(bySession["cursor-session-1"]?.usageBreakdown[0]).toMatchObject({
      model: "gpt-5.5-medium",
      service_tier: "api",
      agents: ["cursor", "cursor-gui"],
    });
  });

  test("attributes Cursor API usage to human-input time windows", () => {
    const windows = buildCursorAttributionWindows(
      [
        {
          session_id: "cursor-session-2",
          agent: "cursor-gui",
          time_range: {start: "2026-06-17T02:00:00.000Z", display: "10:00 - 12:00"},
          human_inputs: [
            {start_time: "2026-06-17T02:00:00.000Z", end_time: "2026-06-17T02:15:00.000Z"},
            {start_time: "2026-06-17T02:30:00.000Z", end_time: null},
          ],
        },
      ],
      "2026-06-17"
    );

    const bySession = aggregateCursorUsageBySession(
      [
        {
          timestamp: "2026-06-17T02:05:00.000Z",
          model: "gpt-5.5-medium",
          tokenUsage: {inputTokens: 10, outputTokens: 5},
          chargedCents: 10,
        },
        {
          timestamp: "2026-06-17T02:35:00.000Z",
          model: "gpt-5.5-medium",
          tokenUsage: {inputTokens: 20, outputTokens: 10},
          chargedCents: 20,
        },
      ],
      "2026-06-17",
      windows
    );

    expect(bySession["cursor-session-2"]?.modelUsage["gpt-5.5-medium"]?.cost).toBeCloseTo(0.3);
    expect(bySession["cursor-session-2"]?.humanInputCosts).toEqual({0: 0.1, 1: 0.2});
    expect(bySession["cursor-session-2"]?.humanInputApiCalls).toEqual({0: 1, 1: 1});
  });

  test("clusters dashboard usage events into billing bursts", () => {
    const bursts = clusterUsageEventsIntoBursts(
      [
        {timestamp: "2026-06-24T06:10:00.000Z", chargedCents: 10},
        {timestamp: "2026-06-24T06:11:00.000Z", chargedCents: 5},
        {timestamp: "2026-06-24T06:20:00.000Z", chargedCents: 20},
      ],
      5 * 60 * 1000
    );

    expect(bursts).toHaveLength(2);
    expect(bursts[0]?.eventCount).toBe(2);
    expect(bursts[0]?.chargedCents).toBe(15);
    expect(bursts[1]?.startMs).toBe(new Date("2026-06-24T06:20:00.000Z").getTime());
  });

  test("refines approximate human inputs from billing bursts before attribution", () => {
    const humanInputs = [
      {
        category: "direction" as const,
        content: "first prompt",
        start_time: "2026-06-24T02:00:00.000Z",
        end_time: "2026-06-24T02:00:00.000Z",
        time_precision: "approximate" as const,
      },
      {
        category: "direction" as const,
        content: "second prompt",
        start_time: "2026-06-24T03:00:00.000Z",
        end_time: "2026-06-24T03:00:00.000Z",
        time_precision: "approximate" as const,
      },
    ];
    const refined = refineSessionHumanInputsFromBillingBursts(humanInputs, [
      {startMs: new Date("2026-06-24T06:10:00.000Z").getTime(), endMs: new Date("2026-06-24T06:12:00.000Z").getTime(), eventCount: 2, chargedCents: 10},
      {startMs: new Date("2026-06-24T06:30:00.000Z").getTime(), endMs: new Date("2026-06-24T06:35:00.000Z").getTime(), eventCount: 1, chargedCents: 20},
    ]);

    expect(refined[0]?.start_time).toBe("2026-06-24T06:10:00.000Z");
    expect(refined[0]?.time_precision).toBe("inferred_from_billing");
    expect(refined[1]?.start_time).toBe("2026-06-24T06:30:00.000Z");
  });

  test("anchors active human inputs to billable bursts in transcript order", () => {
    const humanInputs = [
      {
        category: "direction" as const,
        content: "passive early",
        start_time: "2026-06-24T01:00:00.000Z",
        end_time: "2026-06-24T01:00:00.000Z",
        time_precision: "approximate" as const,
        sequence_index: 5,
      },
      {
        category: "correction" as const,
        content: "first code change",
        start_time: "2026-06-24T02:00:00.000Z",
        end_time: "2026-06-24T02:00:00.000Z",
        time_precision: "approximate" as const,
        sequence_index: 8,
        files_changed: 1,
        lines_added: 10,
      },
      {
        category: "correction" as const,
        content: "code change",
        start_time: "2026-06-24T02:00:00.000Z",
        end_time: "2026-06-24T02:00:00.000Z",
        time_precision: "approximate" as const,
        sequence_index: 10,
        files_changed: 2,
        lines_added: 40,
        lines_deleted: 10,
      },
      {
        category: "correction" as const,
        content: "third code change",
        start_time: "2026-06-24T02:30:00.000Z",
        end_time: "2026-06-24T02:30:00.000Z",
        time_precision: "approximate" as const,
        sequence_index: 12,
        files_changed: 1,
        lines_added: 5,
      },
      {
        category: "direction" as const,
        content: "passive late",
        start_time: "2026-06-24T03:00:00.000Z",
        end_time: "2026-06-24T03:00:00.000Z",
        time_precision: "approximate" as const,
        sequence_index: 20,
      },
    ];
    const bursts = [
      {startMs: new Date("2026-06-24T06:10:00.000Z").getTime(), endMs: new Date("2026-06-24T06:12:00.000Z").getTime(), eventCount: 1, chargedCents: 0},
      {startMs: new Date("2026-06-24T06:16:00.000Z").getTime(), endMs: new Date("2026-06-24T06:18:00.000Z").getTime(), eventCount: 2, chargedCents: 12},
      {startMs: new Date("2026-06-24T06:27:00.000Z").getTime(), endMs: new Date("2026-06-24T06:29:00.000Z").getTime(), eventCount: 3, chargedCents: 30},
    ];

    expect(humanInputFileActivityWeight(humanInputs[2]!)).toBe(52);

    const refined = refineSessionHumanInputsFromBillingBursts(humanInputs, bursts);

    expect(refined[2]?.start_time).toBe("2026-06-24T06:16:00.000Z");
    expect(refined[2]?.time_precision).toBe("inferred_from_billing");
    expect(refined[1]?.start_time).toBe("2026-06-24T06:10:00.000Z");
    expect(refined[3]?.start_time).toBe("2026-06-24T06:16:00.000Z");
    expect(refined[0]?.start_time).toBe("2026-06-24T06:10:00.000Z");
    expect(refined[4]?.start_time).toBe("2026-06-24T06:27:00.000Z");
  });

  test("maps late-sequence active inputs to late billing bursts", () => {
    const bursts = Array.from({length: 10}, (_, i) => ({
      startMs: new Date(`2026-06-24T${(10 + i).toString().padStart(2, "0")}:00:00.000Z`).getTime(),
      endMs: new Date(`2026-06-24T${(10 + i).toString().padStart(2, "0")}:05:00.000Z`).getTime(),
      eventCount: 1,
      chargedCents: 10,
    }));
    const humanInputs = [
      ...Array.from({length: 15}, (_, i) => ({
        category: "direction" as const,
        content: `early passive ${i}`,
        start_time: "2026-06-24T02:00:00.000Z",
        end_time: "2026-06-24T02:00:00.000Z",
        time_precision: "approximate" as const,
        sequence_index: 10 + i,
      })),
      {
        category: "correction" as const,
        content: "late code change",
        start_time: "2026-06-24T02:00:00.000Z",
        end_time: "2026-06-24T02:00:00.000Z",
        time_precision: "approximate" as const,
        sequence_index: 81,
        files_changed: 2,
        lines_added: 100,
      },
      {
        category: "direction" as const,
        content: "late passive",
        start_time: "2026-06-24T02:00:00.000Z",
        end_time: "2026-06-24T02:00:00.000Z",
        time_precision: "approximate" as const,
        sequence_index: 89,
      },
      {
        category: "decision" as const,
        content: "late decision",
        start_time: "2026-06-24T02:00:00.000Z",
        end_time: "2026-06-24T02:00:00.000Z",
        time_precision: "approximate" as const,
        sequence_index: 91,
        files_changed: 1,
        lines_added: 10,
      },
    ];

    const refined = refineSessionHumanInputsFromBillingBursts(humanInputs, bursts);
    const lateCode = refined.find((h) => h.content === "late code change");
    const latePassive = refined.find((h) => h.content === "late passive");
    const lateDecision = refined.find((h) => h.content === "late decision");

    expect(lateCode?.start_time).toBe("2026-06-24T18:00:00.000Z");
    expect(lateDecision?.start_time).toBe("2026-06-24T19:00:00.000Z");
    expect(latePassive?.start_time).toBe("2026-06-24T19:00:00.000Z");
    expect(burstPosForSequenceOrder(81, 10, 81, 10)).toBe(8);
    expect(burstPosForSequenceOrder(91, 10, 81, 10)).toBe(9);
  });

  test("refineCursorHumanInputsFromBillingEvents updates windows used for cost attribution", () => {
    const sessions = [
      {
        session_id: "billing-session",
        agent: "cursor-gui",
        time_range: {start: "2026-06-24T06:00:00.000Z", display: "14:00 - 18:00"},
        human_inputs: [
          {
            category: "direction" as const,
            content: "early prompt",
            start_time: "2026-06-24T01:00:00.000Z",
            end_time: "2026-06-24T01:00:00.000Z",
            time_precision: "approximate" as const,
            sequence_index: 0,
            files_changed: 1,
          },
          {
            category: "correction" as const,
            content: "later prompt",
            start_time: "2026-06-24T02:00:00.000Z",
            end_time: "2026-06-24T02:00:00.000Z",
            time_precision: "approximate" as const,
            sequence_index: 1,
            files_changed: 1,
            lines_added: 5,
          },
        ],
      },
    ];
    const events = [
      {
        timestamp: "2026-06-24T06:05:00.000Z",
        model: "composer-2.5",
        tokenUsage: {inputTokens: 10, outputTokens: 5},
        chargedCents: 10,
      },
      {
        timestamp: "2026-06-24T06:25:00.000Z",
        model: "composer-2.5",
        tokenUsage: {inputTokens: 20, outputTokens: 10},
        chargedCents: 20,
      },
    ];

    refineCursorHumanInputsFromBillingEvents(sessions, events, "2026-06-24");
    const windows = buildCursorAttributionWindows(sessions, "2026-06-24");
    const bySession = aggregateCursorUsageBySession(events, "2026-06-24", windows);

    expect(sessions[0]?.human_inputs?.[0]?.start_time).toBe("2026-06-24T06:05:00.000Z");
    expect(sessions[0]?.human_inputs?.[1]?.start_time).toBe("2026-06-24T06:25:00.000Z");
    expect(sessions[0]?.human_inputs?.[1]?.time_precision).toBe("inferred_from_billing");
    expect(bySession["billing-session"]?.humanInputCosts).toEqual({0: 0.1, 1: 0.2});
  });

  test("refineHumanInputsFromAttributedEvents snaps to attributed event timestamps", () => {
    const sessions = [
      {
        session_id: "attr-session",
        agent: "cursor-gui",
        human_inputs: [
          {
            category: "direction" as const,
            content: "early",
            start_time: "2026-06-24T10:00:00.000Z",
            end_time: "2026-06-24T10:00:00.000Z",
            time_precision: "inferred_from_billing" as const,
            sequence_index: 1,
            api_calls: 2,
          },
          {
            category: "direction" as const,
            content: "between",
            start_time: "2026-06-24T11:00:00.000Z",
            end_time: "2026-06-24T11:00:00.000Z",
            time_precision: "inferred_from_billing" as const,
            sequence_index: 3,
          },
          {
            category: "correction" as const,
            content: "late",
            start_time: "2026-06-24T12:00:00.000Z",
            end_time: "2026-06-24T12:00:00.000Z",
            time_precision: "inferred_from_billing" as const,
            sequence_index: 5,
            api_calls: 1,
          },
        ],
      },
    ];
    const windows = [
      {
        sessionId: "attr-session",
        agent: "cursor-gui",
        startMs: new Date("2026-06-24T10:00:00.000Z").getTime(),
        endMs: new Date("2026-06-24T11:00:00.000Z").getTime(),
        humanInputIndex: 0,
      },
      {
        sessionId: "attr-session",
        agent: "cursor-gui",
        startMs: new Date("2026-06-24T12:00:00.000Z").getTime(),
        endMs: new Date("2026-06-24T13:00:00.000Z").getTime(),
        humanInputIndex: 2,
      },
    ];
    const events = [
      {
        timestamp: "2026-06-24T10:05:00.000Z",
        model: "composer-2.5",
        chargedCents: 10,
      },
      {
        timestamp: "2026-06-24T10:08:00.000Z",
        model: "composer-2.5",
        chargedCents: 5,
      },
      {
        timestamp: "2026-06-24T12:30:00.000Z",
        model: "composer-2.5",
        chargedCents: 20,
      },
    ];

    const mapped = mapAttributedEventTimesByHumanInput(events, "2026-06-24", windows);
    expect(mapped.get("attr-session")?.get(0)).toEqual([
      new Date("2026-06-24T10:05:00.000Z").getTime(),
      new Date("2026-06-24T10:08:00.000Z").getTime(),
    ]);

    refineHumanInputsFromAttributedEvents(sessions, events, "2026-06-24", windows);

    expect(sessions[0]?.human_inputs?.[0]?.start_time).toBe("2026-06-24T10:05:00.000Z");
    expect(sessions[0]?.human_inputs?.[0]?.end_time).toBe("2026-06-24T10:08:00.000Z");
    expect(sessions[0]?.human_inputs?.[0]?.time_precision).toBe("inferred_from_attributed_events");
    expect(sessions[0]?.human_inputs?.[2]?.start_time).toBe("2026-06-24T12:30:00.000Z");
    expect(sessions[0]?.human_inputs?.[1]?.start_time).toBe("2026-06-24T11:17:30.000Z");
  });

  test("refineHumanInputsFromAttributedEvents keeps exact composer times when events are nearby", () => {
    const sessions = [
      {
        session_id: "exact-session",
        agent: "cursor-gui",
        human_inputs: [
          {
            category: "direction" as const,
            content: "live prompt",
            start_time: "2026-06-26T12:26:00.000Z",
            end_time: "2026-06-26T12:26:00.000Z",
            time_precision: "exact" as const,
            sequence_index: 12,
            api_calls: 1,
          },
        ],
      },
    ];
    const windows = [
      {
        sessionId: "exact-session",
        agent: "cursor-gui",
        startMs: new Date("2026-06-26T12:26:00.000Z").getTime(),
        endMs: new Date("2026-06-26T12:27:00.000Z").getTime(),
        humanInputIndex: 0,
      },
    ];
    const events = [{timestamp: "2026-06-26T12:26:22.000Z", chargedCents: 10}];

    expect(
      shouldPreserveExactHumanInputTime(sessions[0]!.human_inputs![0]!, [
        new Date("2026-06-26T12:26:22.000Z").getTime(),
      ])
    ).toBe(true);

    refineHumanInputsFromAttributedEvents(sessions, events, "2026-06-26", windows);

    expect(sessions[0]?.human_inputs?.[0]?.start_time).toBe("2026-06-26T12:26:00.000Z");
    expect(sessions[0]?.human_inputs?.[0]?.end_time).toBe("2026-06-26T12:26:22.000Z");
    expect(sessions[0]?.human_inputs?.[0]?.time_precision).toBe("exact");
  });

  test("aggregates only billable Claude usage with usage dimensions", () => {
    const buckets = aggregateUsageBuckets([
      {
        type: "assistant",
        timestamp: "2026-06-17T00:00:00Z",
        message: {
          id: "empty",
          model: "claude-sonnet-4-6",
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
      {
        type: "assistant",
        timestamp: "2026-06-17T00:01:00Z",
        message: {
          id: "billable",
          model: "claude-sonnet-4-6",
          effort: "message-effort",
          usage: {
            input_tokens: 1,
            output_tokens: 2,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 4,
            speed: "standard",
            service_tier: "standard",
            effort: "usage-effort",
          },
        },
      },
    ]);

    const rows = Object.values(buckets);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      api_calls: 1,
      input_tokens: 1,
      output_tokens: 2,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 4,
      speed: "standard",
      service_tier: "standard",
      effort: "usage-effort",
    });
  });

  test("serializes human_inputs only in the top-level rollup", () => {
    const session: SessionData = {
      schema: "2.0",
      date: "2026-06-17",
      agent: "cursor-cli",
      session_id: "session-1",
      session_name: "Cursor Work",
      project: "flow-cawplan-skill",
      cwd: "/repo/flow-cawplan-skill",
      time_range: {
        display: "10:00 - 10:05",
        timezone: "Asia/Shanghai",
        start: "2026-06-17T10:00:00+08:00",
      },
      model_usage: {
        "composer-2.5": {
          api_calls: 1,
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 40,
          cost: 1.234,
          currency: "$",
          token_source: "char-based estimate (API unavailable)",
          agents: ["cursor-cli"],
        },
      },
      usage_breakdown: [
        {
          model: "composer-2.5",
          speed: "standard",
          service_tier: "standard",
          effort: "default",
          api_calls: 1,
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 40,
          cost: 1.234,
          currency: "$",
          token_source: "char-based estimate (API unavailable)",
          agents: ["cursor-cli"],
        },
      ],
      files_changed: 2,
      files_added: 3,
      files_deleted: 4,
      repos_touched: [{ repo: "Ubiquiti-UID/flow-cawplan-skill", files: 2, added: 3, deleted: 4 }],
      message_stats: { user: 1, assistant: 1, tool_calls: 0 },
      human_inputs: [
        {
          category: "direction",
          content: "生成日报",
          session_title: "Cursor Work",
          session_agent: "cursor-cli",
        },
      ],
    };

    const daily = buildDailyApiJson([session], "2026-06-17", "xin.li");
    const [apiSession] = daily.sessions;

    expect(daily.totals.agents).toEqual(["cursor-cli"]);
    expect(daily.usage_breakdown[0]).toMatchObject({
      model: "composer-2.5",
      agent: "cursor",
      agents: ["cursor-cli"],
    });
    expect(apiSession).toMatchObject({
      schema: "2.0",
      date: "2026-06-17",
      agent: "cursor-cli",
      source: "cli",
      session_id: "session-1",
      session_name: "Cursor Work",
      session_title: "Cursor Work",
      time_range: {
        display: "10:00 - 10:05",
        timezone: "Asia/Shanghai",
        start: "2026-06-17T10:00:00+08:00",
      },
      project: "flow-cawplan-skill",
      cwd: "/repo/flow-cawplan-skill",
      model_usage: {
        "composer-2.5": expect.objectContaining({
          cost: 1.234,
        }),
      },
      usage_breakdown: [
        expect.objectContaining({
          model: "composer-2.5",
          cost: 1.234,
        }),
      ],
      models: ["composer-2.5"],
      total_tokens: 100,
      session_cost: 1.23,
      cost_basis: "estimate",
      token_source: "char-based estimate (API unavailable)",
      files_changed: 2,
      files_added: 3,
      files_deleted: 4,
      repos_touched: [{ repo: "Ubiquiti-UID/flow-cawplan-skill", files: 2, added: 3, deleted: 4 }],
    });
    expect(apiSession).not.toHaveProperty("human_inputs");
    expect(daily.human_inputs).toHaveLength(1);
    expect(daily.human_inputs[0]).toMatchObject({
      category: "direction",
      content: "生成日报",
      session_id: "session-1",
      session_title: "Cursor Work",
      session_agent: "cursor-cli",
    });
  });
});
