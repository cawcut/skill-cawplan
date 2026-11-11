import { describe, expect, it } from "vitest";
import { normalizePath } from "../src/lib/http.js";

describe("normalizePath", () => {
  it("accepts /api/v1 paths and adds a missing leading slash", () => {
    expect(normalizePath("/api/v1/public/openapi/product/abc")).toBe("/api/v1/public/openapi/product/abc");
    expect(normalizePath("api/v1/x")).toBe("/api/v1/x");
  });

  it.each([
    "/other/path",
    "/api/v1/../admin",
    "/api/v1/%2e%2e/admin",
    "/api/v1/%2E%2E/admin",
    "/api/v1/a/./b",
    "/api/v1/a%2Fb",
    "/api/v1/a%5Cb",
    "/api/v1/a\\b",
    "/api/v1/a?x=1",
    "/api/v1/a#frag",
    "/api/v1//a",
    "/api/v1/a%zz",
    "/api/v1/a\nb",
    "https://evil.example/api/v1/a",
  ])("rejects %s", (path) => {
    expect(() => normalizePath(path)).toThrow();
  });
});
