import { describe, expect, it } from "vitest";
import { reviewFilePath } from "../src/lib/testpoint-review/store.js";

describe("reviewFilePath", () => {
  it("accepts a well-formed rv_ review id", () => {
    expect(() => reviewFilePath("rv_123e4567-e89b-4d3a-a456-426614174000")).not.toThrow();
  });

  it("rejects path traversal attempts", () => {
    expect(() => reviewFilePath("../../etc/passwd")).toThrow(/invalid review id/);
    expect(() => reviewFilePath("rv_../../etc/passwd")).toThrow(/invalid review id/);
  });

  it("rejects ids missing the rv_ prefix", () => {
    expect(() => reviewFilePath("123e4567-e89b-4d3a-a456-426614174000")).toThrow(/invalid review id/);
  });

  it("rejects ids containing path separators or null bytes", () => {
    expect(() => reviewFilePath("rv_abc/def")).toThrow(/invalid review id/);
    expect(() => reviewFilePath("rv_abc\0def")).toThrow(/invalid review id/);
  });
});
