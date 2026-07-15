import { describe, expect, test } from "vitest";
import { buildDailyApiJson } from "../src/lib/collect/aggregators/daily.js";
import {
  aggregateFileChanges,
  relativizePathToRepo,
  relativizeFileChanges,
} from "../src/lib/collect/aggregators/tool-utils.js";
import type { SessionData } from "../src/lib/collect/types.js";

describe("tool-utils file path helpers", () => {
  test("relativizePathToRepo keeps in-repo absolute paths relative to cwd", () => {
    const repo = "/home/spx/github/uid.core-product";
    expect(
      relativizePathToRepo(
        "/home/spx/github/uid.core-product/internal/service/ai_session_entry_tickets_test.go",
        repo
      )
    ).toBe("internal/service/ai_session_entry_tickets_test.go");
  });

  test("relativizePathToRepo leaves out-of-repo paths unchanged", () => {
    const repo = "/home/spx/github/uid.core-product";
    expect(relativizePathToRepo("/tmp/other/file.go", repo)).toBe("/tmp/other/file.go");
  });

  test("aggregateFileChanges merges duplicate paths", () => {
    expect(
      aggregateFileChanges([
        { path: "src/a.ts", added: 2, deleted: 1 },
        { path: "src/a.ts", added: 3, deleted: 0 },
        { path: "src/b.ts", added: 1, deleted: 0 },
      ])
    ).toEqual([
      { path: "src/a.ts", added: 5, deleted: 1 },
      { path: "src/b.ts", added: 1, deleted: 0 },
    ]);
  });

  test("mergeFileDeltas drops read-only entries with zero added and deleted", () => {
    expect(
      aggregateFileChanges([
        { path: "internal/service/slack.go", added: 0, deleted: 0 },
        { path: "internal/service/slack_thread_sync.go", added: 23, deleted: 15 },
      ])
    ).toEqual([{ path: "internal/service/slack_thread_sync.go", added: 23, deleted: 15 }]);
  });

  test("relativizeFileChanges normalizes paths before merge", () => {
    const repo = "/repo/flow-cawplan-skill";
    expect(
      relativizeFileChanges(
        [
          { path: "/repo/flow-cawplan-skill/cli/src/a.ts", added: 1, deleted: 0 },
          { path: "cli/src/a.ts", added: 2, deleted: 1 },
        ],
        repo
      )
    ).toEqual([{ path: "cli/src/a.ts", added: 3, deleted: 1 }]);
  });
});

describe("buildDailyApiJson session file_changes", () => {
  test("aggregates relativized human input file_changes onto sessions", () => {
    const session: SessionData = {
      schema: "2.0",
      date: "2026-06-17",
      agent: "claude-code",
      session_id: "session-1",
      session_name: "Work",
      project: "uid.core-product",
      cwd: "/home/spx/github/uid.core-product",
      time_range: { display: "10:00 - 10:05", timezone: "Asia/Shanghai" },
      model_usage: {},
      usage_breakdown: [],
      files_changed: 2,
      repos_touched: [],
      message_stats: { user: 2, assistant: 2, tool_calls: 2 },
      human_inputs: [
        {
          category: "direction",
          content: "first change",
          start_time: "2026-06-17T10:00:00+08:00",
          file_changes: [
            {
              path: "/home/spx/github/uid.core-product/internal/service/a.go",
              added: 2,
              deleted: 1,
            },
          ],
        },
        {
          category: "correction",
          content: "second change",
          start_time: "2026-06-17T10:03:00+08:00",
          file_changes: [
            {
              path: "internal/service/a.go",
              added: 3,
              deleted: 0,
            },
            {
              path: "/home/spx/github/uid.core-product/pkg/b.go",
              added: 1,
              deleted: 0,
            },
          ],
        },
      ],
    };

    const daily = buildDailyApiJson([session], "2026-06-17", "xin.li");

    expect(daily.sessions[0]?.file_changes).toEqual([
      { path: "internal/service/a.go", added: 5, deleted: 1 },
      { path: "pkg/b.go", added: 1, deleted: 0 },
    ]);
    expect(daily.human_inputs[0]?.file_changes).toEqual([
      { path: "internal/service/a.go", added: 2, deleted: 1 },
    ]);
  });
});
