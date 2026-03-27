import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { prmRequest } from "../prm-tool";

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  process.env.PRM_API_KEY = "test-key";
  delete process.env.PRM_BEARER_TOKEN;
  delete process.env.PRM_BASE_URL;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("prm-tool (unit)", () => {
  test("builds request with default base url and query", async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.init = init;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await prmRequest({
      method: "GET",
      path: "/api/v1/public/openapi/products",
      query: { page_size: "10", page_num: "1" },
    });

    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/products?page_size=10&page_num=1"
    );
    expect(captured.init?.method).toBe("GET");
    expect((captured.init?.headers as Record<string, string>)?.Authorization).toBe(
      "test-key"
    );
  });

  test("rejects full URL in path", async () => {
    await expect(
      prmRequest({
        method: "GET",
        path: "https://example.com/api",
      })
    ).rejects.toThrow("path must be relative");
  });

  test("uses bearer token when provided", async () => {
    delete process.env.PRM_API_KEY;
    process.env.PRM_BEARER_TOKEN = "test-bearer";
    let captured: { init?: RequestInit } = {};
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.init = init;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await prmRequest({
      method: "GET",
      path: "/api/v1/public/openapi/products",
    });

    expect((captured.init?.headers as Record<string, string>)?.Authorization).toBe(
      "Bearer test-bearer"
    );
  });

  test("throws API error on non-2xx", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ code: "NOT_FOUND" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });

    await expect(
      prmRequest({
        method: "GET",
        path: "/api/v1/public/openapi/products",
      })
    ).rejects.toThrow("API error 404");
  });
});
