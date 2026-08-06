import { describe, expect, test, vi } from "vitest";
import {
  buildEnvelope,
  printEnvelope,
  exitCodeForOutcome,
} from "../src/lib/qa-insights/envelope";
import type { QAInsightsOutcome } from "../src/lib/qa-insights/types";

const meta = { product_id: "019fb1ff-d547-741f-bfa2-405386d04d5b", dry_run: false };

describe("Phase 1a exit codes — SUCCESS / RECONCILED / NOOP → 0", () => {
  test("SUCCESS → 0", () => {
    expect(exitCodeForOutcome("SUCCESS")).toBe(0);
  });
  test("RECONCILED → 0", () => {
    expect(exitCodeForOutcome("RECONCILED")).toBe(0);
  });
  test("NOOP → 0", () => {
    expect(exitCodeForOutcome("NOOP")).toBe(0);
  });
});

describe("Phase 1a exit codes — FAILURE / UNKNOWN → 1", () => {
  test("FAILURE → 1", () => {
    expect(exitCodeForOutcome("FAILURE")).toBe(1);
  });
  test("UNKNOWN → 1", () => {
    expect(exitCodeForOutcome("UNKNOWN")).toBe(1);
  });
  test("validation failures surface as FAILURE → 1", () => {
    expect(exitCodeForOutcome("FAILURE")).toBe(1);
  });
});

/*
 * Phase 1a collapsed the exit codes to 0/1. Skills read the `outcome` field;
 * asserting that no outcome maps to 2 or 3 keeps the removed tiers from
 * creeping back in.
 */
describe("Phase 1a exit codes — only 0 and 1 exist (no tiering)", () => {
  const all: QAInsightsOutcome[] = ["SUCCESS", "RECONCILED", "NOOP", "FAILURE", "UNKNOWN"];

  test("every outcome maps to 0 or 1", () => {
    expect(all.map(exitCodeForOutcome).every((code) => code === 0 || code === 1)).toBe(true);
  });
  test("no outcome maps to the removed exit 2", () => {
    expect(all.map(exitCodeForOutcome)).not.toContain(2);
  });
  test("no outcome maps to the removed exit 3", () => {
    expect(all.map(exitCodeForOutcome)).not.toContain(3);
  });
  test("UNKNOWN and FAILURE are indistinguishable by exit code — outcome field is authoritative", () => {
    expect(exitCodeForOutcome("UNKNOWN")).toBe(exitCodeForOutcome("FAILURE"));
  });
});

describe("buildEnvelope — required fields always present", () => {
  test("outcome, command and meta are always emitted", () => {
    const env = buildEnvelope({ outcome: "SUCCESS", command: "requirements create", meta });
    expect(env).toMatchObject({ outcome: "SUCCESS", command: "requirements create", meta });
  });
  test("absent optional sections are omitted, not set to undefined", () => {
    const env = buildEnvelope({ outcome: "SUCCESS", command: "x", meta });
    expect(Object.keys(env).sort()).toEqual(["command", "meta", "outcome"]);
  });
  test("api section is included when supplied", () => {
    const env = buildEnvelope({
      outcome: "SUCCESS",
      command: "x",
      meta,
      api: { code: "SUCCESS", msg: "success", data: { id: "r-1" } },
    });
    expect(env.api?.code).toBe("SUCCESS");
  });
  test("reconcile section is included when supplied", () => {
    const env = buildEnvelope({
      outcome: "RECONCILED",
      command: "requirements reconcile",
      meta,
      reconcile: {
        strategy: "five_field_strong_match",
        decision: "strong_match_single",
        matched_requirement_ids: ["r-1"],
      },
    });
    expect(env.reconcile?.matched_requirement_ids).toEqual(["r-1"]);
  });
  test("patch_body is included for update commands", () => {
    const env = buildEnvelope({ outcome: "SUCCESS", command: "requirements update", meta, patch_body: { summary: "x" } });
    expect(env.patch_body).toEqual({ summary: "x" });
  });
  test("post_body is included for dry-run previews", () => {
    const env = buildEnvelope({
      outcome: "SUCCESS",
      command: "requirements create",
      meta: { ...meta, dry_run: true },
      post_body: { summary: "x" },
    });
    expect(env.post_body).toEqual({ summary: "x" });
    expect(env.meta.dry_run).toBe(true);
  });
  test("error section is included on failures", () => {
    const env = buildEnvelope({
      outcome: "FAILURE",
      command: "requirements create",
      meta,
      error: { type: "validation", message: "bad body" },
    });
    expect(env.error?.type).toBe("validation");
  });
});

describe("printEnvelope — stdout is a single parseable JSON object", () => {
  function capture(fn: () => void): string {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      fn();
      return spy.mock.calls.map((args) => args.join(" ")).join("\n");
    } finally {
      spy.mockRestore();
    }
  }

  test("output parses as JSON", () => {
    const env = buildEnvelope({ outcome: "SUCCESS", command: "requirements create", meta });
    expect(() => JSON.parse(capture(() => printEnvelope(env)))).not.toThrow();
  });
  test("parsed output carries outcome, command and meta", () => {
    const env = buildEnvelope({ outcome: "NOOP", command: "requirements update", meta });
    const parsed = JSON.parse(capture(() => printEnvelope(env)));
    expect(parsed).toMatchObject({ outcome: "NOOP", command: "requirements update" });
    expect(parsed.meta.product_id).toBe(meta.product_id);
  });
  test("exactly one console.log call is made (single object on stdout)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      printEnvelope(buildEnvelope({ outcome: "SUCCESS", command: "x", meta }));
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
  test("UNKNOWN outcome round-trips so the skill can trigger reconcile", () => {
    const env = buildEnvelope({
      outcome: "UNKNOWN",
      command: "testpoints archive",
      meta,
      error: { type: "transport", message: "fetch failed — reconcile before retrying" },
    });
    const parsed = JSON.parse(capture(() => printEnvelope(env)));
    expect(parsed.outcome).toBe("UNKNOWN");
    expect(parsed.error.message).toMatch(/reconcile/);
  });
});
