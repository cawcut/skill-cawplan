import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { runCli } from "../cli";

let originalExit: typeof process.exit;
let originalFetch: typeof fetch;
let originalCachePath: string | undefined;

beforeEach(() => {
  originalExit = process.exit;
  process.exit = ((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  }) as typeof process.exit;
  originalFetch = globalThis.fetch;
  process.env.PRM_API_KEY = "test-key";
  delete process.env.PRM_BASE_URL;
  originalCachePath = process.env.PRM_CACHE_PATH;
  process.env.PRM_CACHE_PATH = "/tmp/prm-cache-test.json";
});

afterEach(() => {
  process.exit = originalExit;
  globalThis.fetch = originalFetch;
  if (originalCachePath !== undefined) {
    process.env.PRM_CACHE_PATH = originalCachePath;
  } else {
    delete process.env.PRM_CACHE_PATH;
  }
});

describe("cli (unit)", () => {
  test("cache clear removes cache file", async () => {
    process.env.PRM_CACHE_PATH = "/tmp/prm-cache-test.json";
    const fs = await import("fs");
    fs.writeFileSync(process.env.PRM_CACHE_PATH, JSON.stringify({ version: 1, entries: {} }));
    await runCli(["cache", "clear"]);
    expect(fs.existsSync(process.env.PRM_CACHE_PATH)).toBe(false);
  });

  test("products list maps to list products endpoint", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = input.toString();
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli(["products", "list", "--search", "UniFi Access"]);
    expect(capturedUrl).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/products?search=UniFi+Access"
    );
  });

  test("product-lines list maps to list product lines endpoint", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = input.toString();
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli(["product-lines", "list", "--page_size", "10", "--page_num", "1"]);
    expect(capturedUrl).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/product_lines?page_size=10&page_num=1"
    );
  });

  test("product-lines detail maps to product line detail endpoint", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = input.toString();
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli(["product-lines", "detail", "unifi"]);
    expect(capturedUrl).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/product_lines/unifi"
    );
  });

  test("users query supports keyword search", async () => {
    let captured: { url?: string; body?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.body = init?.body ? String(init.body) : undefined;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "users",
      "query",
      "--keyword",
      "john",
      "--page_num",
      "1",
      "--page_size",
      "20",
    ]);

    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/users/query"
    );
    expect(captured.body).toBe(
      JSON.stringify({ keyword: "john", page_num: "1", page_size: "20" })
    );
  });

  test("todos user maps to todos endpoint with filters", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = input.toString();
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "todos",
      "user",
      "user-123",
      "--ticket_status",
      "IN_PROGRESS,NOT_STARTED",
      "--issue_status",
      "INVESTIGATING",
    ]);

    expect(capturedUrl).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/todos/users/user-123?ticket_status=IN_PROGRESS%2CNOT_STARTED&issue_status=INVESTIGATING"
    );
  });

  test("tickets list requires --type", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      await expect(
        runCli(["tickets", "list", "unifi-access", "version-001"])
      ).rejects.toThrow("exit:1");
    } finally {
      console.error = originalError;
    }
  });

  test("tickets search maps to openapi search endpoint with body", async () => {
    let captured: { url?: string; method?: string; body?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.method = init?.method;
      captured.body = init?.body ? String(init.body) : undefined;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "tickets",
      "search",
      "--time_range",
      "3m",
      "--status",
      "IN_PROGRESS,NOT_STARTED",
      "--product_ids",
      "unifi-access",
      "--type",
      "FEATURE",
      "--search",
      "dashboard",
    ]);

    expect(captured.method).toBe("POST");
    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/core-product/api/v1/public/openapi/tickets/search?time_range=3m"
    );
    expect(JSON.parse(captured.body || "{}")).toEqual({
      status: ["IN_PROGRESS", "NOT_STARTED"],
      product_ids: ["unifi-access"],
      type: ["FEATURE"],
      search: "dashboard",
    });
  });

  test("tickets search requires time_range or start/end", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      await expect(runCli(["tickets", "search"])).rejects.toThrow("exit:1");
    } finally {
      console.error = originalError;
    }
  });

  test("tickets search supports start_date and end_date", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = input.toString();
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "tickets",
      "search",
      "--start_date",
      "2026-01-01",
      "--end_date",
      "2026-01-31",
    ]);

    expect(capturedUrl).toBe(
      "https://core-api-gw.uid.alpha.ui.com/core-product/api/v1/public/openapi/tickets/search?start_date=2026-01-01&end_date=2026-01-31"
    );
  });

  test("api passthrough uses method and path", async () => {
    let captured: { url?: string; method?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.method = init?.method;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "api",
      "POST",
      "/api/v1/public/openapi/users/query",
      "--body",
      "{\"email\":\"john.doe@ui.com\"}",
    ]);

    expect(captured.method).toBe("POST");
    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/users/query"
    );
  });

  test("activities query maps to activity endpoint with body", async () => {
    let captured: { url?: string; body?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.body = init?.body ? String(init.body) : undefined;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "activities",
      "query",
      "--time_range",
      "1m",
      "--user_id",
      "user-123",
      "--activity_types",
      "VERSION,RELEASE",
    ]);

    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/core-product/api/v1/public/openapi/activities/query?time_range=1m"
    );
    expect(captured.body).toBe(
      JSON.stringify({ user_id: "user-123", activity_types: ["VERSION", "RELEASE"] })
    );
  });

  test("critical search maps to openapi search endpoint with body", async () => {
    let captured: { url?: string; method?: string; body?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.method = init?.method;
      captured.body = init?.body ? String(init.body) : undefined;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "critical",
      "search",
      "--time_range",
      "1m",
      "--status",
      "OPEN,IN_PROGRESS",
      "--product_ids",
      "unifi-access",
      "--search",
      "connection",
    ]);

    expect(captured.method).toBe("POST");
    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/core-product/api/v1/public/openapi/critical_issues/search?time_range=1m"
    );
    expect(captured.body).toBe(
      JSON.stringify({
        status: ["OPEN", "IN_PROGRESS"],
        product_ids: ["unifi-access"],
        search: "connection",
      })
    );
  });

  test("critical search avoids double core-product when base url includes it", async () => {
    process.env.PRM_BASE_URL = "https://core-api-gw.uid.alpha.ui.com/core-product/";
    let captured: { url?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL) => {
      captured.url = input.toString();
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "critical",
      "search",
      "--time_range",
      "1m",
    ]);

    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/core-product/api/v1/public/openapi/critical_issues/search?time_range=1m"
    );
  });

  test("critical search requires time_range, days, or start/end", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      await expect(runCli(["critical", "search"])).rejects.toThrow("exit:1");
    } finally {
      console.error = originalError;
    }
  });

  test("critical search supports days query", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = input.toString();
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "critical",
      "search",
      "--days",
      "6m",
    ]);

    expect(capturedUrl).toBe(
      "https://core-api-gw.uid.alpha.ui.com/core-product/api/v1/public/openapi/critical_issues/search?days=6m"
    );
  });

  test("critical line maps to product line critical issues endpoint", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = input.toString();
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "critical",
      "line",
      "unifi",
      "--time_range",
      "1m",
      "--status",
      "OPEN,IN_PROGRESS",
    ]);

    expect(capturedUrl).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/product_line/unifi/critical_issues?time_range=1m&status=OPEN%2CIN_PROGRESS"
    );
  });

  test("tickets create maps to public ticket POST with body", async () => {
    let captured: { url?: string; method?: string; body?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.method = init?.method;
      captured.body = init?.body ? String(init.body) : undefined;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "tickets",
      "create",
      "unifi-access",
      "--version_id",
      "version-001",
      "--description",
      "Fix login crash",
      "--type",
      "BUGFIX",
      "--priority",
      "HIGH",
      "--assignees",
      "user-1,user-2",
      "--parent_id",
      "parent-uid",
      "--label_ids",
      "lbl-1,lbl-2",
      "--due_date",
      "2026-06-30",
    ]);

    expect(captured.method).toBe("POST");
    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/product/unifi-access/tickets"
    );
    expect(JSON.parse(captured.body || "{}")).toEqual({
      description: "Fix login crash",
      type: "BUGFIX",
      version_id: "version-001",
      priority: "HIGH",
      parent_id: "parent-uid",
      due_date: "2026-06-30",
      assignee_ids: ["user-1", "user-2"],
      label_ids: ["lbl-1", "lbl-2"],
    });
  });

  test("tickets create backlog omits version_id and hits product-level route", async () => {
    let captured: { url?: string; method?: string; body?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.method = init?.method;
      captured.body = init?.body ? String(init.body) : undefined;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "tickets",
      "create",
      "unifi-access",
      "--backlog",
      "--description",
      "Investigate flaky test",
      "--priority",
      "MEDIUM",
      "--status",
      "NOT_STARTED",
    ]);

    expect(captured.method).toBe("POST");
    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/product/unifi-access/tickets"
    );
    expect(JSON.parse(captured.body || "{}")).toEqual({
      description: "Investigate flaky test",
      priority: "MEDIUM",
      status: "NOT_STARTED",
    });
  });

  test("tickets create omits priority/status when unset (backend defaults them)", async () => {
    let captured: { url?: string; method?: string; body?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.method = init?.method;
      captured.body = init?.body ? String(init.body) : undefined;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    // An adapter that only carries a "todo" intent can omit priority/status;
    // the backend defaults them (MEDIUM + product-line default status).
    await runCli([
      "tickets",
      "create",
      "unifi-access",
      "--backlog",
      "--description",
      "Adapter-created issue",
    ]);

    expect(captured.method).toBe("POST");
    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/product/unifi-access/tickets"
    );
    expect(JSON.parse(captured.body || "{}")).toEqual({
      description: "Adapter-created issue",
    });
  });

  test("tickets create requires --description", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      await expect(
        runCli(["tickets", "create", "unifi-access"])
      ).rejects.toThrow("exit:1");
    } finally {
      console.error = originalError;
    }
  });

  test("tickets update maps to public ticket PUT with sparse body", async () => {
    let captured: { url?: string; method?: string; body?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.method = init?.method;
      captured.body = init?.body ? String(init.body) : undefined;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "tickets",
      "update",
      "unifi-access",
      "version-001",
      "ticket-uid",
      "--status",
      "IN_PROGRESS",
      "--progress_comment",
      "Investigation done",
      "--assignees",
      "user-1",
    ]);

    expect(captured.method).toBe("PUT");
    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/product/unifi-access/versions/version-001/tickets/ticket-uid"
    );
    expect(JSON.parse(captured.body || "{}")).toEqual({
      status: "IN_PROGRESS",
      progress_comment: "Investigation done",
      assignee_ids: ["user-1"],
    });
  });

  test("tickets update requires at least one updatable flag", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      await expect(
        runCli(["tickets", "update", "unifi-access", "version-001", "ticket-uid"])
      ).rejects.toThrow("exit:1");
    } finally {
      console.error = originalError;
    }
  });

  test("tickets relate create maps to relations POST", async () => {
    let captured: { url?: string; method?: string; body?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.method = init?.method;
      captured.body = init?.body ? String(init.body) : undefined;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "tickets",
      "relate",
      "create",
      "unifi-access",
      "version-001",
      "ticket-uid",
      "--target",
      "other-ticket-uid",
      "--type",
      "BLOCKED_BY",
    ]);

    expect(captured.method).toBe("POST");
    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/product/unifi-access/versions/version-001/tickets/ticket-uid/relations"
    );
    expect(JSON.parse(captured.body || "{}")).toEqual({
      target_ticket_id: "other-ticket-uid",
      relation_type: "BLOCKED_BY",
    });
  });

  test("tickets relate update maps to relation PUT", async () => {
    let captured: { url?: string; method?: string; body?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.method = init?.method;
      captured.body = init?.body ? String(init.body) : undefined;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "tickets",
      "relate",
      "update",
      "unifi-access",
      "version-001",
      "ticket-uid",
      "relation-uid",
      "--type",
      "RELATED",
    ]);

    expect(captured.method).toBe("PUT");
    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/product/unifi-access/versions/version-001/tickets/ticket-uid/relations/relation-uid"
    );
    expect(JSON.parse(captured.body || "{}")).toEqual({ relation_type: "RELATED" });
  });

  test("tickets relate delete maps to relation DELETE", async () => {
    let captured: { url?: string; method?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.method = init?.method;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "tickets",
      "relate",
      "delete",
      "unifi-access",
      "version-001",
      "ticket-uid",
      "relation-uid",
    ]);

    expect(captured.method).toBe("DELETE");
    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/product/unifi-access/versions/version-001/tickets/ticket-uid/relations/relation-uid"
    );
  });

  test("tickets relate list maps to relations GET", async () => {
    let captured: { url?: string; method?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.method = init?.method;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "tickets",
      "relate",
      "list",
      "unifi-access",
      "version-001",
      "ticket-uid",
    ]);

    expect(captured.method).toBe("GET");
    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/product/unifi-access/versions/version-001/tickets/ticket-uid/relations"
    );
  });

  test("tickets relate create requires --target and --type", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      await expect(
        runCli(["tickets", "relate", "create", "unifi-access", "version-001", "ticket-uid"])
      ).rejects.toThrow("exit:1");
    } finally {
      console.error = originalError;
    }
  });

  test("versions create maps to public versions POST with body", async () => {
    let captured: { url?: string; method?: string; body?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.method = init?.method;
      captured.body = init?.body ? String(init.body) : undefined;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "versions",
      "create",
      "unifi-access",
      "--name",
      "1.3.2",
      "--major_id",
      "major-uid",
      "--description",
      "Hotfix",
    ]);

    expect(captured.method).toBe("POST");
    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/product/unifi-access/versions"
    );
    expect(JSON.parse(captured.body || "{}")).toEqual({
      name: "1.3.2",
      major_id: "major-uid",
      description: "Hotfix",
    });
  });

  test("versions create requires --name", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      await expect(
        runCli(["versions", "create", "unifi-access"])
      ).rejects.toThrow("exit:1");
    } finally {
      console.error = originalError;
    }
  });

  test("versions create works without --major_id (server auto-resolves)", async () => {
    let captured: { url?: string; method?: string; body?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.method = init?.method;
      captured.body = init?.body ? String(init.body) : undefined;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli(["versions", "create", "unifi-access", "--name", "5.0.1"]);

    expect(captured.method).toBe("POST");
    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/product/unifi-access/versions"
    );
    expect(JSON.parse(captured.body || "{}")).toEqual({ name: "5.0.1" });
  });

  test("tickets poll maps to poll endpoint without time_range", async () => {
    let captured: { url?: string; method?: string; body?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.method = init?.method;
      captured.body = init?.body ? String(init.body) : undefined;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli([
      "tickets",
      "poll",
      "--status",
      "NOT_STARTED,IN_PROGRESS",
      "--product_line_ids",
      "unifi",
      "--since_updated_at",
      "1779960000",
    ]);

    expect(captured.method).toBe("POST");
    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/core-product/api/v1/public/openapi/tickets/poll"
    );
    expect(JSON.parse(captured.body || "{}")).toEqual({
      status: ["NOT_STARTED", "IN_PROGRESS"],
      product_line_ids: ["unifi"],
      since_updated_at: 1779960000,
    });
  });

  test("tickets poll requires --status", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      await expect(runCli(["tickets", "poll"])).rejects.toThrow("exit:1");
    } finally {
      console.error = originalError;
    }
  });

  test("tickets search by unique_ids does not require time_range", async () => {
    let captured: { url?: string; body?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.body = init?.body ? String(init.body) : undefined;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli(["tickets", "search", "--unique_ids", "tkt-1,tkt-2"]);

    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/core-product/api/v1/public/openapi/tickets/search"
    );
    expect(JSON.parse(captured.body || "{}")).toEqual({
      unique_ids: ["tkt-1", "tkt-2"],
    });
  });

  test("tickets search by parent_ids does not require time_range", async () => {
    let captured: { url?: string; body?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.body = init?.body ? String(init.body) : undefined;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    // parent_ids is a bounded child lookup the backend serves window-free, so
    // --time_range is no longer required when it is set.
    await runCli(["tickets", "search", "--parent_ids", "parent-uid"]);

    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/core-product/api/v1/public/openapi/tickets/search"
    );
    expect(JSON.parse(captured.body || "{}")).toEqual({ parent_ids: ["parent-uid"] });
  });

  test("product-lines statuses maps to ticket_statuses endpoint", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = input.toString();
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli(["product-lines", "statuses", "unifi"]);
    expect(capturedUrl).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/product_lines/unifi/ticket_statuses"
    );
  });

  test("labels list maps to labels endpoint with filters", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = input.toString();
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli(["labels", "list", "--product_id", "unifi-access", "--search", "bug"]);
    expect(capturedUrl).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/labels?search=bug&product_id=unifi-access"
    );
  });

  test("backlog list maps to product-level tickets GET", async () => {
    let captured: { url?: string; method?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.method = init?.method;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli(["backlog", "list", "unifi-access"]);
    expect(captured.method).toBe("GET");
    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/product/unifi-access/tickets"
    );
  });

  test("backlog get maps to product-level ticket detail GET", async () => {
    let captured: { url?: string; method?: string } = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString();
      captured.method = init?.method;
      return new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await runCli(["backlog", "get", "unifi-access", "ticket-uid"]);
    expect(captured.method).toBe("GET");
    expect(captured.url).toBe(
      "https://core-api-gw.uid.alpha.ui.com/api/v1/public/openapi/product/unifi-access/tickets/ticket-uid"
    );
  });

  test("tickets update passes expected_version and surfaces 409 conflict", async () => {
    let captured: { body?: string } = {};
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.body = init?.body ? String(init.body) : undefined;
      return new Response(JSON.stringify({ code: "CONFLICT", msg: "version mismatch" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    };

    const originalError = console.error;
    let capturedError = "";
    console.error = (msg?: unknown) => {
      capturedError = String(msg ?? "");
    };
    try {
      await expect(
        runCli([
          "tickets",
          "update",
          "unifi-access",
          "version-001",
          "ticket-uid",
          "--status",
          "IN_PROGRESS",
          "--expected_version",
          "3",
        ])
      ).rejects.toThrow("exit:1");
      expect(JSON.parse(captured.body || "{}")).toEqual({
        status: "IN_PROGRESS",
        version: 3,
      });
      expect(capturedError).toContain("Conflict");
    } finally {
      console.error = originalError;
    }
  });

  test("critical list warns when a UUID is used as product id", async () => {
    const originalError = console.error;
    let capturedError = "";
    console.error = (msg?: unknown) => {
      capturedError = String(msg ?? "");
    };
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ code: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    try {
      await runCli([
        "critical",
        "list",
        "0199cd57-98ae-75b2-a512-ff0ce8a42f4d",
        "--time_range",
        "1m",
      ]);
      expect(capturedError).toContain("expects a product unique_id");
    } finally {
      console.error = originalError;
    }
  });
});
