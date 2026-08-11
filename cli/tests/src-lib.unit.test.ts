import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Command } from "commander";
import { cawplanRequest, ApiError } from "../src/lib/http";
import { registerConfigCommand } from "../src/commands/config";
import { applyTicketRefsToSessions } from "../src/lib/ai-session/ticket-context";
import {
  getCachedAssignmentTicketRefs,
  setCachedAssignmentTicketRefsFromSession,
} from "../src/lib/collect/assignment-ticket-cache";
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
import { collectCursorCliSessions } from "../src/lib/collect/agents/cursor-cli";
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
let originalCredentialsPath: string | undefined;
let originalConfigPath: string | undefined;
let originalCachePath: string | undefined;
let originalCodexHome: string | undefined;
let originalCursorHome: string | undefined;

function unsignedJwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "",
  ].join(".");
}

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  originalCredentialsPath = process.env.CAWPLAN_CREDENTIALS_PATH;
  originalConfigPath = process.env.CAWPLAN_CONFIG_PATH;
  originalCachePath = process.env.CAWPLAN_CACHE_PATH;
  originalCodexHome = process.env.CODEX_HOME;
  originalCursorHome = process.env.CURSOR_HOME;

  tmpDir = await mkdtemp(join(tmpdir(), "cawplan-tests-"));
  process.env.CAWPLAN_CREDENTIALS_PATH = join(tmpDir, "credentials.json");
  process.env.CAWPLAN_CONFIG_PATH = join(tmpDir, "config.json");
  process.env.CAWPLAN_CACHE_PATH = join(tmpDir, "cache.json");
  delete process.env.CODEX_HOME;
  delete process.env.CURSOR_HOME;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;

  if (originalCredentialsPath === undefined) delete process.env.CAWPLAN_CREDENTIALS_PATH;
  else process.env.CAWPLAN_CREDENTIALS_PATH = originalCredentialsPath;

  if (originalConfigPath === undefined) delete process.env.CAWPLAN_CONFIG_PATH;
  else process.env.CAWPLAN_CONFIG_PATH = originalConfigPath;

  if (originalCachePath === undefined) delete process.env.CAWPLAN_CACHE_PATH;
  else process.env.CAWPLAN_CACHE_PATH = originalCachePath;

  if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalCodexHome;

  if (originalCursorHome === undefined) delete process.env.CURSOR_HOME;
  else process.env.CURSOR_HOME = originalCursorHome;

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

function createCursorCliStoreDb(dbPath: string, messages: Array<Record<string, unknown>>): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB NOT NULL);
    `);
    const meta = Buffer.from(JSON.stringify({
      name: "Cursor CLI human input test",
      lastUsedModel: "composer-2.5",
      createdAt: Date.parse("2026-06-17T12:00:00.000Z"),
    })).toString("hex");
    db.prepare("INSERT INTO meta (key, value) VALUES ('0', ?)").run(meta);

    const insertBlob = db.prepare("INSERT INTO blobs (id, data) VALUES (?, ?)");
    messages.forEach((message, index) => {
      insertBlob.run(String(index + 1), Buffer.from(JSON.stringify(message)));
    });
  } finally {
    db.close();
  }
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

  test("apiBaseUsesGatewayPrefix follows selected env profile", async () => {
    await writeUserConfig({ env: "prd" });
    expect(apiBaseUsesGatewayPrefix()).toBe(true);

    await writeUserConfig({ env: "local" });
    expect(apiBaseUsesGatewayPrefix()).toBe(false);
  });

  test("uses ~/.cawplan env config", async () => {
    await writeUserConfig({
      env: "local",
    });

    expect(getConfigPath()).toBe(join(tmpDir, "config.json"));
    expect(await readUserConfig()).toEqual({
      env: "local",
    });
    expect(getApiBase()).toBe("http://localhost");
    expect(getPortalBase()).toBe("http://localhost:5173");
  });

  test("falls back to default env when config is empty", async () => {
    await writeUserConfig({
    });

    expect(getApiBase()).toBe("https://api.cawplan.com/core-product");
    expect(getPortalBase()).toBe("https://app.cawplan.com");
  });

  test("config env selects a profile when stored URLs are not set", async () => {
    await writeUserConfig({
      env: "proto",
    });

    expect(getApiBase()).toBe("https://core-api-gw.uid.dev.ui.com/core-product");
    expect(getPortalBase()).toBe("https://core-web-product.uid.dev.ui.com");
  });

  test("empty config env falls back to default profile", async () => {
    await writeFile(getConfigPath(), JSON.stringify({ env: "" }));

    expect(await readUserConfig()).toEqual({});
    expect(getApiBase()).toBe("https://api.cawplan.com/core-product");
    expect(getPortalBase()).toBe("https://app.cawplan.com");
  });

  test("null config env falls back to default profile", async () => {
    await writeFile(getConfigPath(), JSON.stringify({ env: null }));

    expect(await readUserConfig()).toEqual({});
    expect(getApiBase()).toBe("https://api.cawplan.com/core-product");
    expect(getPortalBase()).toBe("https://app.cawplan.com");
  });

  test("config env command sets selected profile", async () => {
    const program = new Command();
    program.exitOverride();
    registerConfigCommand(program);

    await program.parseAsync(["node", "cawplan", "config", "env", "proto"], { from: "node" });

    expect(await readUserConfig()).toEqual({ env: "proto" });
    expect(getApiBase()).toBe("https://core-api-gw.uid.dev.ui.com/core-product");
  });
});

describe("src lib auth-state", () => {
  test("reports none when no OAuth credentials exist", async () => {
    await deleteCredentials();

    const state = await getAuthState();
    expect(state.hasOAuth).toBe(false);
    expect(state.active).toBe("none");
  });

  test("prefers OAuth when access token is still valid", async () => {
    await writeCredentials({
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
    await writeCredentials({
      accessToken: "test-access",
      refreshToken: "test-refresh",
      expire: Math.floor(Date.now() / 1000) + 3600,
    });

    expect((await readCredentials())?.accessToken).toBe("test-access");
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

  test("uses anonymous scope when no OAuth token exists", async () => {
    await deleteCredentials();

    const scope = await getCacheScope();

    expect(scope).toContain(":anonymous");
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
      human_inputs: [{ category: "direction", content: "Verify dollar cost passthrough", session_id: "session-usd-cost" }],
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

  test("keeps ticket IDs on sessions only in daily output", () => {
    const session: SessionData = {
      schema: "2.0",
      date: "2026-06-17",
      agent: "claude-code",
      session_id: "session-ticket-context",
      session_name: "Ticket context session",
      project: "flow-cawplan-skill",
      cwd: "/repo/flow-cawplan-skill",
      time_range: { display: "10:00 - 10:05", timezone: "UTC" },
      model_usage: {},
      usage_breakdown: [],
      files_changed: 0,
      repos_touched: [],
      message_stats: { user: 1, assistant: 1, tool_calls: 0 },
      ticket_ids: ["ticket-14471", "CWP-14472"],
      human_inputs: [{
        category: "direction",
        content: "Continue ticket context work for CWP-14472",
      }],
    };

    const daily = buildDailyApiJson([session], "2026-06-17", "xin.li");

    expect("ticket_ids" in daily).toBe(false);
    expect("ticket_contexts" in daily).toBe(false);
    expect(daily.sessions[0]?.ticket_ids).toEqual(["ticket-14471", "CWP-14472"]);
    expect("ticket_contexts" in daily.sessions[0]!).toBe(false);
    expect("ticket_ids" in daily.human_inputs[0]!).toBe(false);
    expect("ticket_contexts" in daily.human_inputs[0]!).toBe(false);
  });

  test("applies ticket refs only for matching session product", async () => {
    const sessions: SessionData[] = [
      {
        schema: "2.0",
        date: "2026-08-11",
        agent: "cursor-gui",
        session_id: "shared-session",
        session_name: "Shared session",
        project: "repo-a",
        product_id: "product-a",
        cwd: "/repo-a",
        time_range: { display: "10:00", timezone: "UTC" },
        model_usage: {},
        usage_breakdown: [],
        files_changed: 0,
        repos_touched: [],
        message_stats: { user: 1, assistant: 1, tool_calls: 0 },
        human_inputs: [{
          category: "direction",
          content: "继续昨天的工作",
          session_agent: "cursor-gui",
          files_changed: 0,
          lines_added: 0,
          lines_deleted: 0,
        }],
      },
      {
        schema: "2.0",
        date: "2026-08-11",
        agent: "cursor-gui",
        session_id: "other-session",
        session_name: "Other session",
        project: "repo-b",
        product_id: "product-b",
        cwd: "/repo-b",
        time_range: { display: "11:00", timezone: "UTC" },
        model_usage: {},
        usage_breakdown: [],
        files_changed: 0,
        repos_touched: [],
        message_stats: { user: 1, assistant: 1, tool_calls: 0 },
      },
    ];

    const applied = await applyTicketRefsToSessions(
      sessions,
      [["CAWP-1", "CAWP-2"], ["CAWP-1"]],
      async () => [
        { ticket_id: "ticket-a", ticket_display_id: "CAWP-1", product_id: "product-a" },
        { ticket_id: "ticket-b", ticket_display_id: "CAWP-2", product_id: "product-b" },
      ],
    );

    expect(applied).toBe(1);
    expect(sessions[0]?.ticket_ids).toEqual(["ticket-a"]);
    expect(sessions[0]?.ticket_display_ids).toEqual(["CAWP-1"]);
    expect(sessions[1]?.ticket_ids).toBeUndefined();
  });

  test("caches assignment ticket refs by session for later collection", () => {
    setCachedAssignmentTicketRefsFromSession({
      schema: "2.0",
      date: "2026-08-10",
      agent: "cursor-gui",
      session_id: "shared-session",
      session_name: "Shared session",
      project: "repo-a",
      product_id: "product-a",
      cwd: "/repo-a",
      time_range: { display: "10:00", timezone: "UTC" },
      model_usage: {},
      usage_breakdown: [],
      files_changed: 0,
      repos_touched: [],
      message_stats: { user: 1, assistant: 1, tool_calls: 0 },
      ticket_ids: ["ticket-a"],
      ticket_display_ids: ["CAWP-1"],
    });

    expect(getCachedAssignmentTicketRefs("shared-session")).toEqual({
      product_id: "product-a",
      ticket_ids: ["ticket-a"],
      ticket_display_ids: ["CAWP-1"],
      date: "2026-08-10",
    });
  });

  test("prunes expired assignment ticket refs from cache file", async () => {
    const now = Date.now();
    const cachePath = process.env.CAWPLAN_CACHE_PATH!;
    await writeFile(cachePath, JSON.stringify({
      version: 1,
      entries: {
        "ai-session:assignment-ticket-refs:expired-session": {
          fetched_at: now - 31 * 24 * 60 * 60 * 1000,
          data: { ticket_ids: ["ticket-old"], ticket_display_ids: ["CAWP-OLD"] },
        },
        "ai-session:assignment-ticket-refs:fresh-session": {
          fetched_at: now - 24 * 60 * 60 * 1000,
          data: { ticket_ids: ["ticket-new"], ticket_display_ids: ["CAWP-NEW"] },
        },
      },
    }));

    expect(getCachedAssignmentTicketRefs("fresh-session")).toEqual({
      product_id: undefined,
      ticket_ids: ["ticket-new"],
      ticket_display_ids: ["CAWP-NEW"],
      date: undefined,
    });

    const store = JSON.parse(await readFile(cachePath, "utf-8")) as {
      entries: Record<string, unknown>;
    };
    expect(store.entries["ai-session:assignment-ticket-refs:expired-session"]).toBeUndefined();
    expect(store.entries["ai-session:assignment-ticket-refs:fresh-session"]).toBeDefined();
  });

  test("filters sessions whose human inputs only run cawplan coding commit", () => {
    const noHumanInputSession: SessionData = {
      schema: "2.0",
      date: "2026-06-17",
      agent: "cursor-cli",
      session_id: "empty-cwd",
      session_name: "Empty CWD",
      project: "empty-cwd",
      cwd: "",
      time_range: { display: "10:30", timezone: "UTC" },
      model_usage: {
        "composer-2.5": {
          api_calls: 0,
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          cost: 0.01,
          currency: "$",
        },
      },
      usage_breakdown: [{
        model: "composer-2.5",
        speed: "standard",
        service_tier: "standard",
        effort: "default",
        api_calls: 0,
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cost: 0.01,
        currency: "$",
      }],
      files_changed: 0,
      repos_touched: [],
      message_stats: { user: 1, assistant: 1, tool_calls: 0 },
    };
    const commitOnlySession: SessionData = {
      schema: "2.0",
      date: "2026-06-17",
      agent: "cursor-gui",
      session_id: "daily-upload-only",
      session_name: "Daily upload",
      project: "flow-cawplan-skill",
      cwd: "/repo/flow-cawplan-skill",
      time_range: { display: "10:00 - 10:05", timezone: "UTC" },
      model_usage: {},
      usage_breakdown: [],
      files_changed: 0,
      repos_touched: [],
      message_stats: { user: 2, assistant: 1, tool_calls: 0 },
      human_inputs: [
        { category: "direction", content: "/cawplan-coding-commit", session_id: "daily-upload-only" },
        { category: "direction", content: "run cawplan-coding-commit 2026-06-17", session_id: "daily-upload-only" },
      ],
    };
    const realWorkSession: SessionData = {
      schema: "2.0",
      date: "2026-06-17",
      agent: "cursor-gui",
      session_id: "real-work",
      session_name: "Real work",
      project: "flow-cawplan-skill",
      cwd: "/repo/flow-cawplan-skill",
      time_range: { display: "11:00 - 11:30", timezone: "UTC" },
      model_usage: {},
      usage_breakdown: [],
      files_changed: 1,
      repos_touched: [],
      message_stats: { user: 2, assistant: 2, tool_calls: 0 },
      human_inputs: [
        { category: "direction", content: "fix assignment ticket links", session_id: "real-work" },
        { category: "direction", content: "/cawplan-coding-commit", session_id: "real-work" },
      ],
    };

    const daily = buildDailyApiJson([noHumanInputSession, commitOnlySession, realWorkSession], "2026-06-17", "xin.li");

    expect(daily.sessions.map((session) => session.session_id)).toEqual(["real-work"]);
    expect(daily.human_inputs.map((input) => input.session_id)).toEqual(["real-work", "real-work"]);
    expect(daily.totals.sessions).toBe(1);
    expect(daily.totals.cost).toEqual({});
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

  test("calculateCost matches dotted GPT-5.6 model IDs after normalization", () => {
    expect(calculateCost("gpt-5.6-terra", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    })).toBeCloseTo(17.5, 4);

    expect(calculateCost("gpt-5.6-terra", {
      input_tokens: 1_000_000,
      cache_read_input_tokens: 500_000,
    })).toBeCloseTo(1.375, 4);
  });
});

describe("src lib oauth", () => {
  test("builds consent URL with public code query params for polling", async () => {
    await writeUserConfig({ env: "proto" });

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
    await writeUserConfig({ env: "proto" });
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
    await writeUserConfig({ env: "proto" });
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
    await writeUserConfig({ env: "proto" });
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
    await writeUserConfig({ env: "proto" });
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
    expect(calls[1].url).toBe("https://core-api-gw.uid.dev.ui.com/core-product/api/v1/cli/oauth/refresh");
    expect(calls[1].body).toBe(JSON.stringify({ refresh_token: "refresh-token" }));
    expect((await readCredentials())?.accessToken).toBe("new-access");
  });

  test("surfaces refresh failure", async () => {
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

});

describe("src lib collect cursor cli", () => {
  test("collects user messages as human_inputs", async () => {
    const cursorHome = join(tmpDir, "cursor-home");
    process.env.CURSOR_HOME = cursorHome;

    const convDir = join(cursorHome, "chats", "project-hash", "conversation-1");
    await mkdir(convDir, { recursive: true });

    createCursorCliStoreDb(join(convDir, "store.db"), [
      {
        role: "user",
        content: "<timestamp>Wednesday, Jun 17, 2026, 8:00 PM</timestamp>\n<user_query>\n请修复 Cursor CLI 日报 human input 采集\n</user_query>",
        timestamp: Date.parse("2026-06-17T12:00:00.000Z"),
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "我会检查 collector 并补上 human_inputs。" }],
        timestamp: Date.parse("2026-06-17T12:01:00.000Z"),
      },
    ]);
    await writeFile(
      join(convDir, "agent-transcript.jsonl"),
      `${JSON.stringify({ timestamp: "2026-06-17T12:00:00.000Z", cwd: "/repo/flow-cawplan-skill" })}\n`
    );
    await utimes(join(convDir, "store.db"), new Date("2026-06-17T12:00:00.000Z"), new Date("2026-06-17T12:00:00.000Z"));

    const sessions = collectCursorCliSessions("2026-06-17");

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.human_inputs).toHaveLength(1);
    expect(sessions[0]?.human_inputs?.[0]).toMatchObject({
      category: "correction",
      content: "请修复 Cursor CLI 日报 human input 采集",
      assistant_message: "我会检查 collector 并补上 human_inputs。",
      session_title: "Cursor CLI human input test",
      session_agent: "cursor-cli",
      session_model: "composer-2.5",
      start_time: "2026-06-17T12:00:00.000Z",
      end_time: "2026-06-17T12:01:00.000Z",
      time_precision: "exact",
    });
  });

  test("does not treat Cursor injected context as human input", async () => {
    const cursorHome = join(tmpDir, "cursor-home");
    process.env.CURSOR_HOME = cursorHome;

    const convDir = join(cursorHome, "chats", "project-hash", "context-only-conversation");
    await mkdir(convDir, { recursive: true });

    createCursorCliStoreDb(join(convDir, "store.db"), [
      {
        role: "user",
        content: [
          "<user_info>",
          "OS Version: darwin 25.0.0",
          "Workspace Path: /repo/flow-cawplan-skill",
          "</user_info>",
          "<rules>",
          "<user_rule>Always respond in Chinese-simplified</user_rule>",
          "</rules>",
          "<agent_skills>",
          "<agent_skill fullPath=\"/tmp/SKILL.md\" />",
          "</agent_skills>",
        ].join("\n"),
        timestamp: Date.parse("2026-06-17T12:00:00.000Z"),
      },
    ]);
    await writeFile(
      join(convDir, "agent-transcript.jsonl"),
      `${JSON.stringify({ timestamp: "2026-06-17T12:00:00.000Z", cwd: "/repo/flow-cawplan-skill" })}\n`
    );

    const sessions = collectCursorCliSessions("2026-06-17");

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.message_stats.user).toBe(1);
    expect(sessions[0]?.human_inputs).toBeUndefined();
  });

  test("falls back to project agent transcript when store messages are empty", async () => {
    const cursorHome = join(tmpDir, "cursor-home");
    process.env.CURSOR_HOME = cursorHome;

    const convId = "conversation-transcript-only";
    const convDir = join(cursorHome, "chats", "project-hash", convId);
    await mkdir(convDir, { recursive: true });
    createCursorCliStoreDb(join(convDir, "store.db"), []);

    const transcriptDir = join(cursorHome, "projects", "Users-test-repo", "agent-transcripts", convId);
    await mkdir(transcriptDir, { recursive: true });
    await writeFile(
      join(transcriptDir, `${convId}.jsonl`),
      [
        JSON.stringify({
          role: "user",
          message: {
            content: [{
              type: "text",
              text: "<timestamp>Wednesday, Jun 17, 2026, 8:10 PM (UTC+8)</timestamp>\n<user_query>\n开始处理 Cursor CLI transcript 兜底\n</user_query>",
            }],
          },
        }),
        JSON.stringify({
          role: "assistant",
          message: {
            content: [
              { type: "text", text: "我会从 project transcript 生成 human inputs。" },
              { type: "tool_use", name: "Read", input: { path: "/tmp/example.ts" } },
            ],
          },
        }),
      ].join("\n")
    );

    const sessions = collectCursorCliSessions("2026-06-17");

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.message_stats).toMatchObject({
      user: 1,
      assistant: 1,
      tool_calls: 1,
    });
    expect(sessions[0]?.human_inputs).toHaveLength(1);
    expect(sessions[0]?.human_inputs?.[0]).toMatchObject({
      category: "direction",
      content: "开始处理 Cursor CLI transcript 兜底",
      assistant_message: "我会从 project transcript 生成 human inputs。",
      session_title: "Cursor CLI human input test",
      session_agent: "cursor-cli",
      session_model: "composer-2.5",
      start_time: "2026-06-17T12:10:00.000Z",
      end_time: "2026-06-17T12:10:00.000Z",
      time_precision: "exact",
    });
  });

  test("does not duplicate no-timestamp transcript sessions on later store mtime", async () => {
    const cursorHome = join(tmpDir, "cursor-home");
    process.env.CURSOR_HOME = cursorHome;

    const convId = "conversation-no-timestamp";
    const convDir = join(cursorHome, "chats", "project-hash", convId);
    await mkdir(convDir, { recursive: true });
    createCursorCliStoreDb(join(convDir, "store.db"), [
      {
        role: "user",
        content: [{ type: "text", text: "<user_query>\nwho are you\n</user_query>" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "我是 Composer。" }],
      },
    ]);

    const transcriptDir = join(cursorHome, "projects", "Users-test-repo", "agent-transcripts", convId);
    await mkdir(transcriptDir, { recursive: true });
    const transcriptPath = join(transcriptDir, `${convId}.jsonl`);
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          role: "user",
          message: { content: [{ type: "text", text: "<user_query>\nwho are you\n</user_query>" }] },
        }),
        JSON.stringify({
          role: "assistant",
          message: { content: [{ type: "text", text: "我是 Composer。" }] },
        }),
      ].join("\n")
    );

    await utimes(transcriptPath, new Date("2026-06-17T07:05:00.000Z"), new Date("2026-06-17T07:05:00.000Z"));
    await utimes(join(convDir, "store.db"), new Date("2026-06-18T09:26:00.000Z"), new Date("2026-06-18T09:26:00.000Z"));

    expect(collectCursorCliSessions("2026-06-17")).toHaveLength(1);
    expect(collectCursorCliSessions("2026-06-18")).toHaveLength(0);
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
    expect(daily.sessions).toHaveLength(0);
    expect(daily.human_inputs).toHaveLength(0);
    expect(daily.totals.cost).toEqual({});
    expect(daily.usage_breakdown).toHaveLength(0);
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
    expect(session?.human_inputs?.map((input) => input.assistant_message)).toEqual([
      "好的。",
      "收到。",
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

  test("attributes Codex token usage to every model used in one session", async () => {
    const codexHome = join(tmpDir, "codex");
    const sessionsDir = join(codexHome, "sessions", "codex-multi-model");
    await mkdir(sessionsDir, { recursive: true });
    process.env.CODEX_HOME = codexHome;

    const rolloutPath = join(sessionsDir, "rollout.jsonl");
    const events = [
      {
        type: "turn_context",
        timestamp: "2026-06-17T02:00:00.000Z",
        payload: { model: "gpt-5.6-sol" },
      },
      {
        type: "response_item",
        timestamp: "2026-06-17T02:00:01.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Use Sol for the initial analysis." }],
        },
      },
      {
        type: "event_msg",
        timestamp: "2026-06-17T02:00:02.000Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 20,
              output_tokens: 10,
            },
          },
        },
      },
      {
        type: "turn_context",
        timestamp: "2026-06-17T02:05:00.000Z",
        payload: { model: "gpt-5.6-terra" },
      },
      {
        type: "response_item",
        timestamp: "2026-06-17T02:05:01.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Switch to Terra for the implementation." }],
        },
      },
      {
        type: "event_msg",
        timestamp: "2026-06-17T02:05:02.000Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 200,
              cached_input_tokens: 50,
              output_tokens: 20,
            },
          },
        },
      },
    ];
    await writeFile(rolloutPath, events.map((event) => JSON.stringify(event)).join("\n"), "utf-8");

    const db = createCodexStateDb(codexHome);
    try {
      insertCodexThread(db, {
        id: "codex-multi-model",
        rolloutPath,
        createdAt: Math.floor(new Date("2026-06-17T01:59:00.000Z").getTime() / 1000),
        model: "gpt-5.6-terra",
      });
    } finally {
      db.close();
    }

    const [session] = collectCodexSessions("2026-06-17");

    expect(Object.keys(session?.model_usage ?? {}).sort()).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
    ]);
    expect(session?.model_usage["gpt-5.6-sol"]).toMatchObject({
      api_calls: 1,
      input_tokens: 80,
      cache_read_input_tokens: 20,
      output_tokens: 10,
    });
    expect(session?.model_usage["gpt-5.6-terra"]).toMatchObject({
      api_calls: 1,
      input_tokens: 150,
      cache_read_input_tokens: 50,
      output_tokens: 20,
    });
    expect(session?.usage_breakdown.map((bucket) => bucket.model).sort()).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
    ]);
    expect(session?.human_inputs?.map((input) => input.session_model)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
    ]);
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
    expect(daily.sessions).toHaveLength(0);
    expect(daily.totals.cost).toEqual({});
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

  test("uses daily incremental input estimate for Cursor human-input attribution", () => {
    const windows = buildCursorAttributionWindows(
      [
        {
          session_id: "cursor-long-session",
          agent: "cursor-gui",
          time_range: {start: "2026-07-20T02:00:00.000Z", display: "10:00 - 18:00"},
          human_inputs: [
            {
              content: "1234567890123456789012345678901234567890",
              start_time: "2026-08-03T02:00:00.000Z",
              end_time: "2026-08-03T02:05:00.000Z",
            },
          ],
        },
      ],
      "2026-08-03"
    );

    const bySession = aggregateCursorUsageBySession(
      [
        {
          timestamp: "2026-08-03T02:02:00.000Z",
          model: "gpt-5.5-medium",
          tokenUsage: {
            inputTokens: 100_000,
            outputTokens: 25,
            cacheReadTokens: 400_000,
            cacheWriteTokens: 10_000,
          },
          chargedCents: 123,
        },
      ],
      "2026-08-03",
      windows
    );

    expect(bySession["cursor-long-session"]?.modelUsage["gpt-5.5-medium"]).toMatchObject({
      api_calls: 1,
      input_tokens: 10,
      output_tokens: 25,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cost: 1.23,
      token_source: "dashboard API cost + daily incremental token estimate",
    });
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
      repos_touched: [{ repo: "cawcut/skill-cawplan", files: 2, added: 3, deleted: 4 }],
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
      repos_touched: [{ repo: "cawcut/skill-cawplan", files: 2, added: 3, deleted: 4 }],
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
