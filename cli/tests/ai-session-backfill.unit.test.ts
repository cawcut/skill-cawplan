import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { registerAiSessionCommand } from "../src/commands/ai-session";
import { writeCredentials } from "../src/lib/credentials";

let originalFetch: typeof fetch;
let originalCwd: string;
let originalBaseUrl: string | undefined;
let originalCredentialsPath: string | undefined;
let tmpDir: string;

function unsignedJwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "",
  ].join(".");
}

function dailyReport(date: string) {
  return {
    schema: "2.0",
    date,
    author: "xin.li",
    generated_at: `${date}T00:00:00.000Z`,
    include_conversation: false,
    totals: {
      sessions: 1,
      agents: ["cursor-gui"],
      messages: { user: 1, assistant: 1, tool_calls: 0 },
      files_changed: 0,
      cost: { "$": 0.01 },
    },
    usage_breakdown: [],
    model_usage: {},
    sessions: [
      {
        schema: "2.0",
        date,
        agent: "cursor-gui",
        source: "gui",
        session_id: `session-${date}`,
        session_name: `Session ${date}`,
        session_title: `Session ${date}`,
        project: "owner/repo",
        product_id: "product-1",
        product_name: "Product 1",
        cwd: "/tmp/repo",
        time_range: {
          display: "09:00 - 10:00",
          timezone: "UTC",
          start: `${date}T09:00:00.000Z`,
        },
        model_usage: {},
        usage_breakdown: [],
        files_changed: 0,
        files_added: 0,
        files_deleted: 0,
        repos_touched: [],
        message_stats: { user: 1, assistant: 1, tool_calls: 0 },
      },
    ],
    repos: [],
    human_inputs: [],
  };
}

async function runAiSessionReport(file: string) {
  const program = new Command();
  program.exitOverride();
  registerAiSessionCommand(program);
  await program.parseAsync(["node", "cawplan", "ai-session", "report", "--file", file], { from: "node" });
}

async function runAiSessionBackfill(dateFrom: string, dateTo: string, args: string[] = []) {
  const program = new Command();
  program.exitOverride();
  registerAiSessionCommand(program);
  await program.parseAsync(["node", "cawplan", "ai-session", "backfill", "--from", dateFrom, "--to", dateTo, ...args], { from: "node" });
}

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  originalCwd = process.cwd();
  originalBaseUrl = process.env.CAWPLAN_BASE_URL;
  originalCredentialsPath = process.env.CAWPLAN_CREDENTIALS_PATH;

  tmpDir = await mkdtemp(join(tmpdir(), "cawplan-backfill-test-"));
  process.chdir(tmpDir);
  process.env.CAWPLAN_BASE_URL = "https://api.test";
  process.env.CAWPLAN_CREDENTIALS_PATH = join(tmpDir, "credentials.json");

  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-02T12:00:00.000Z"));

  await writeCredentials({
    accessToken: unsignedJwt({ user_id: "user-1", email: "xin.li@example.test" }),
    expire: 4102444800,
  });
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  process.chdir(originalCwd);
  vi.useRealTimers();

  if (originalBaseUrl === undefined) delete process.env.CAWPLAN_BASE_URL;
  else process.env.CAWPLAN_BASE_URL = originalBaseUrl;

  if (originalCredentialsPath === undefined) delete process.env.CAWPLAN_CREDENTIALS_PATH;
  else process.env.CAWPLAN_CREDENTIALS_PATH = originalCredentialsPath;

  await rm(tmpDir, { recursive: true, force: true });
});

describe("ai-session report and backfill", () => {
  test("report only uploads the specified daily report", async () => {
    await writeFile("ai-daily-2026-06-01.json", JSON.stringify(dailyReport("2026-06-01"), null, 2));
    await writeFile("ai-daily-2026-06-02.json", JSON.stringify(dailyReport("2026-06-02"), null, 2));

    const uploadedDates: string[] = [];
    const reportQueryResponses: unknown[] = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      const method = init?.method ?? "GET";

      if (method === "POST" && url.pathname === "/api/v1/public/openapi/ai-session-usage/reports") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { date?: string };
        uploadedDates.push(String(body.date));
        return new Response(JSON.stringify({ code: "SUCCESS", data: { date: body.date } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "GET" && url.pathname === "/api/v1/public/openapi/ai-session-usage/reports") {
        const response = {
          code: "SUCCESS",
          data: {
            items: [
              {
                date: "2026-06-02",
                user_id: "user-1",
              },
            ],
            total: 1,
          },
        };
        reportQueryResponses.push(response);
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "GET" && url.pathname === "/api/v1/public/openapi/ai-session-usage/product-repo") {
        return new Response(JSON.stringify({ code: "SUCCESS", data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ message: `unexpected ${method} ${url.pathname}` }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    };

    await runAiSessionReport("ai-daily-2026-06-02.json");

    expect(reportQueryResponses).toHaveLength(0);
    expect(uploadedDates).toEqual(["2026-06-02"]);
  });

  test("backfills missing local reports when reports query only returns items[0]", async () => {
    await writeFile("ai-daily-2026-06-01.json", JSON.stringify(dailyReport("2026-06-01"), null, 2));
    await writeFile("ai-daily-2026-06-02.json", JSON.stringify(dailyReport("2026-06-02"), null, 2));

    const uploadedDates: string[] = [];
    const reportQueryResponses: unknown[] = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      const method = init?.method ?? "GET";

      if (method === "POST" && url.pathname === "/api/v1/public/openapi/ai-session-usage/reports") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { date?: string };
        uploadedDates.push(String(body.date));
        return new Response(JSON.stringify({ code: "SUCCESS", data: { date: body.date } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "GET" && url.pathname === "/api/v1/public/openapi/ai-session-usage/reports") {
        const response = {
          code: "SUCCESS",
          data: {
            items: [
              {
                date: "2026-06-02",
                user_id: "user-1",
              },
            ],
            total: 1,
          },
        };
        reportQueryResponses.push(response);
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "GET" && url.pathname === "/api/v1/public/openapi/ai-session-usage/product-repo") {
        return new Response(JSON.stringify({ code: "SUCCESS", data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ message: `unexpected ${method} ${url.pathname}` }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    };

    await runAiSessionBackfill("2026-06-01", "2026-06-02");

    expect(reportQueryResponses).toHaveLength(1);
    expect(uploadedDates).toEqual(["2026-06-01"]);
  });

  test("backfill dry-run only lists missing reports", async () => {
    await writeFile("ai-daily-2026-06-01.json", JSON.stringify(dailyReport("2026-06-01"), null, 2));
    await writeFile("ai-daily-2026-06-02.json", JSON.stringify(dailyReport("2026-06-02"), null, 2));

    const uploadedDates: string[] = [];
    const reportQueryResponses: unknown[] = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      const method = init?.method ?? "GET";

      if (method === "POST" && url.pathname === "/api/v1/public/openapi/ai-session-usage/reports") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { date?: string };
        uploadedDates.push(String(body.date));
        return new Response(JSON.stringify({ code: "SUCCESS", data: { date: body.date } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "GET" && url.pathname === "/api/v1/public/openapi/ai-session-usage/reports") {
        const response = {
          code: "SUCCESS",
          data: {
            items: [
              {
                date: "2026-06-02",
                user_id: "user-1",
              },
            ],
            total: 1,
          },
        };
        reportQueryResponses.push(response);
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ message: `unexpected ${method} ${url.pathname}` }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    };

    await runAiSessionBackfill("2026-06-01", "2026-06-02", ["--dry-run"]);

    expect(reportQueryResponses).toHaveLength(1);
    expect(uploadedDates).toEqual([]);
  });
});
