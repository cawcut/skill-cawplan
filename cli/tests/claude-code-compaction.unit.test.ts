import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import {
  findCompactionOriginUuid,
  sessionContainsUuid,
  mergeCompactionContinuations,
  type CollectedClaudeSession,
} from "../src/lib/collect/agents/claude-code.js";
import type { SessionData, UsageBucket } from "../src/lib/collect/types.js";

const dirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cawplan-compact-tests-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeJsonl(path: string, events: Record<string, unknown>[]): void {
  writeFileSync(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

function bucket(overrides: Partial<UsageBucket> = {}): UsageBucket {
  return {
    model: "claude-sonnet-5",
    speed: "standard",
    service_tier: "standard",
    effort: "default",
    api_calls: 1,
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cost: 1,
    currency: "$",
    ...overrides,
  };
}

function session(overrides: Partial<SessionData> = {}): SessionData {
  return {
    schema: "2.0",
    date: "2026-07-23",
    agent: "claude-code",
    session_id: "s1",
    session_name: "Some work",
    project: "cawcut",
    cwd: "/repo",
    time_range: { display: "09:00 - 10:00", timezone: "Asia/Shanghai", start: "2026-07-23T01:00:00.000Z" },
    model_usage: {},
    usage_breakdown: [bucket()],
    files_changed: 1,
    repos_touched: [],
    message_stats: { user: 1, assistant: 1, tool_calls: 0 },
    session_cost: 1,
    total_tokens: 150,
    ...overrides,
  };
}

describe("findCompactionOriginUuid / sessionContainsUuid", () => {
  test("returns the logicalParentUuid from a compact_boundary event", () => {
    const dir = makeDir();
    const path = join(dir, "child.jsonl");
    writeJsonl(path, [
      { type: "custom-title", customTitle: "Work" },
      { type: "system", subtype: "compact_boundary", logicalParentUuid: "parent-uuid-123" },
      { type: "user", message: { role: "user", content: "continue" } },
    ]);
    expect(findCompactionOriginUuid(path)).toBe("parent-uuid-123");
  });

  test("returns null for a session with no compact_boundary", () => {
    const dir = makeDir();
    const path = join(dir, "root.jsonl");
    writeJsonl(path, [
      { type: "custom-title", customTitle: "Work" },
      { type: "user", message: { role: "user", content: "hi" } },
    ]);
    expect(findCompactionOriginUuid(path)).toBeNull();
  });

  test("sessionContainsUuid finds a message uuid inside a file", () => {
    const dir = makeDir();
    const path = join(dir, "root.jsonl");
    writeJsonl(path, [
      { type: "user", uuid: "parent-uuid-123", message: { role: "user", content: "hi" } },
    ]);
    expect(sessionContainsUuid(path, "parent-uuid-123")).toBe(true);
    expect(sessionContainsUuid(path, "some-other-uuid")).toBe(false);
  });
});

describe("mergeCompactionContinuations", () => {
  test("merges two sibling continuations when their shared origin's parent file is absent from today's collection", () => {
    const dir = makeDir();
    const childA = join(dir, "child-a.jsonl");
    const childB = join(dir, "child-b.jsonl");
    writeJsonl(childA, [{ type: "system", subtype: "compact_boundary", logicalParentUuid: "origin-uuid" }]);
    writeJsonl(childB, [{ type: "system", subtype: "compact_boundary", logicalParentUuid: "origin-uuid" }]);

    // session_cost/total_tokens are intentionally omitted here, matching what
    // collectClaudeCodeSession() actually returns — those fields only exist
    // once the daily aggregator derives them from usage_breakdown.
    const collected: CollectedClaudeSession[] = [
      {
        jsonlPath: childA,
        sessionId: "child-a",
        session: session({
          session_id: "child-a",
          session_name: "Workflow execution API response",
          time_range: { display: "10:11 - 18:06", timezone: "Asia/Shanghai", start: "2026-07-23T02:11:00.000Z" },
          session_cost: undefined,
          total_tokens: undefined,
          files_changed: 0,
          usage_breakdown: [bucket({ cost: 4.01, input_tokens: 400 })],
        }),
      },
      {
        jsonlPath: childB,
        sessionId: "child-b",
        session: session({
          session_id: "child-b",
          session_name: "Workflow execution API response",
          time_range: { display: "10:11 - 18:15", timezone: "Asia/Shanghai", start: "2026-07-23T02:11:00.000Z" },
          session_cost: undefined,
          total_tokens: undefined,
          files_changed: 2,
          usage_breakdown: [bucket({ cost: 6.94, input_tokens: 800 })],
        }),
      },
    ];

    const merged = mergeCompactionContinuations(collected);
    expect(merged).toHaveLength(1);
    // session_cost/total_tokens/models/cost_basis/token_source stay unset so the
    // daily aggregator derives them from the merged usage_breakdown, exactly like
    // an unmerged session — setting them here would short-circuit that derivation.
    expect(merged[0].session_cost).toBeUndefined();
    expect(merged[0].total_tokens).toBeUndefined();
    const totalCost = merged[0].usage_breakdown.reduce((s, b) => s + b.cost, 0);
    expect(totalCost).toBeCloseTo(10.95, 4);
    const totalInputTokens = merged[0].usage_breakdown.reduce((s, b) => s + b.input_tokens, 0);
    expect(totalInputTokens).toBe(1200);
    // files_changed is summed directly from each member's own count — it can't
    // be derived from the (always-empty at this stage) file_changes array.
    expect(merged[0].files_changed).toBe(2);
    expect(merged[0].time_range.display).toBe("10:11 - 18:15");
  });

  test("merges continuations into the parent session when the parent is present in today's collection", () => {
    const dir = makeDir();
    const parentPath = join(dir, "parent.jsonl");
    const childPath = join(dir, "child.jsonl");
    writeJsonl(parentPath, [
      { type: "user", uuid: "origin-uuid", message: { role: "user", content: "hi" } },
    ]);
    writeJsonl(childPath, [{ type: "system", subtype: "compact_boundary", logicalParentUuid: "origin-uuid" }]);

    const collected: CollectedClaudeSession[] = [
      {
        jsonlPath: parentPath,
        sessionId: "parent",
        session: session({
          session_id: "parent",
          session_name: "CawPlan Plan & Billing",
          usage_breakdown: [bucket({ cost: 54.58 })],
        }),
      },
      {
        jsonlPath: childPath,
        sessionId: "child",
        session: session({
          session_id: "child",
          session_name: "CawPlan Plan & Billing",
          usage_breakdown: [bucket({ cost: 36.32 })],
        }),
      },
    ];

    const merged = mergeCompactionContinuations(collected);
    expect(merged).toHaveLength(1);
    expect(merged[0].session_id).toBe("parent");
    expect(merged[0].session_cost).toBeUndefined();
    const totalCost = merged[0].usage_breakdown.reduce((s, b) => s + b.cost, 0);
    expect(totalCost).toBeCloseTo(90.9, 4);
  });

  test("a session with its own external origin can still be the parent for a later fork", () => {
    // Reproduces the real-world shape: a long-lived session (grandparent) that
    // itself continues from an even older, uncollected ancestor, and later
    // self-compacts again, forking two more sessions from that later point.
    const dir = makeDir();
    const grandparentPath = join(dir, "grandparent.jsonl");
    const childAPath = join(dir, "child-a.jsonl");
    const childBPath = join(dir, "child-b.jsonl");
    writeJsonl(grandparentPath, [
      { type: "system", subtype: "compact_boundary", logicalParentUuid: "ancient-uuid-not-collected-today" },
      { type: "user", message: { role: "user", content: "keep going" } },
      { type: "user", uuid: "fork-point-uuid", message: { role: "user", content: "more work" } },
    ]);
    writeJsonl(childAPath, [{ type: "system", subtype: "compact_boundary", logicalParentUuid: "fork-point-uuid" }]);
    writeJsonl(childBPath, [{ type: "system", subtype: "compact_boundary", logicalParentUuid: "fork-point-uuid" }]);

    const collected: CollectedClaudeSession[] = [
      {
        jsonlPath: grandparentPath,
        sessionId: "grandparent",
        session: session({ session_id: "grandparent", usage_breakdown: [bucket({ cost: 1 })] }),
      },
      {
        jsonlPath: childAPath,
        sessionId: "child-a",
        session: session({ session_id: "child-a", usage_breakdown: [bucket({ cost: 2 })] }),
      },
      {
        jsonlPath: childBPath,
        sessionId: "child-b",
        session: session({ session_id: "child-b", usage_breakdown: [bucket({ cost: 3 })] }),
      },
    ];

    const merged = mergeCompactionContinuations(collected);
    expect(merged).toHaveLength(1);
    expect(merged[0].session_id).toBe("grandparent");
    const totalCost = merged[0].usage_breakdown.reduce((s, b) => s + b.cost, 0);
    expect(totalCost).toBeCloseTo(6, 4);
  });

  test("drops exact-duplicate human_inputs carried over by compaction's preserved segment", () => {
    // Compaction seeds the new file with a copy of the preserved segment from
    // the file it continues from, so both members legitimately re-parse the
    // same turn as their own human_input — this should collapse to one.
    const dir = makeDir();
    const childA = join(dir, "child-a.jsonl");
    const childB = join(dir, "child-b.jsonl");
    writeJsonl(childA, [{ type: "system", subtype: "compact_boundary", logicalParentUuid: "origin-uuid" }]);
    writeJsonl(childB, [{ type: "system", subtype: "compact_boundary", logicalParentUuid: "origin-uuid" }]);

    const collected: CollectedClaudeSession[] = [
      {
        jsonlPath: childA,
        sessionId: "child-a",
        session: session({
          session_id: "child-a",
          human_inputs: [
            { category: "direction", content: "shared preserved turn", start_time: "2026-07-23T01:00:00.000Z" },
            { category: "direction", content: "only in child-a", start_time: "2026-07-23T01:05:00.000Z" },
          ],
        }),
      },
      {
        jsonlPath: childB,
        sessionId: "child-b",
        session: session({
          session_id: "child-b",
          human_inputs: [
            { category: "direction", content: "shared preserved turn", start_time: "2026-07-23T01:00:00.000Z" },
            { category: "direction", content: "only in child-b", start_time: "2026-07-23T02:00:00.000Z" },
          ],
        }),
      },
    ];

    const merged = mergeCompactionContinuations(collected);
    expect(merged).toHaveLength(1);
    const contents = merged[0].human_inputs?.map((h) => h.content);
    expect(contents).toEqual(["shared preserved turn", "only in child-a", "only in child-b"]);
  });

  test("leaves unrelated sessions unmerged", () => {
    const dir = makeDir();
    const pathA = join(dir, "a.jsonl");
    const pathB = join(dir, "b.jsonl");
    writeJsonl(pathA, [{ type: "user", message: { role: "user", content: "hi" } }]);
    writeJsonl(pathB, [{ type: "user", message: { role: "user", content: "hi" } }]);

    const collected: CollectedClaudeSession[] = [
      { jsonlPath: pathA, sessionId: "a", session: session({ session_id: "a" }) },
      { jsonlPath: pathB, sessionId: "b", session: session({ session_id: "b" }) },
    ];

    const merged = mergeCompactionContinuations(collected);
    expect(merged).toHaveLength(2);
  });
});
