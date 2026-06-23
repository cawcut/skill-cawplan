import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { afterEach, describe, expect, test, vi } from "vitest";
import { localDateString } from "../src/lib/collect/date-utils.js";
import {
  collectGuiSessions,
  matchUserBubble,
  normalizeBubbleMatchText,
  parseGuiSessionTranscript,
  shouldSkipTranscriptDateFilter,
} from "../src/lib/collect/agents/cursor-gui.js";
import * as paths from "../src/lib/collect/paths.js";

const NO_TS_USER =
  '{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\\nhello\\n</user_query>"}]}}';
const NO_TS_ASSISTANT =
  '{"role":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}}';
const WITH_TS_USER =
  '{"role":"user","message":{"content":[{"type":"text","text":"<timestamp>Monday, Jun 22, 2026, 11:09 AM (UTC+8)</timestamp>\\n<user_query>\\nhello\\n</user_query>"}]}}';

describe("cursor-gui mtime fallback", () => {
  let tempRoot = "";

  afterEach(() => {
    vi.restoreAllMocks();
    tempRoot = "";
  });

  function writeTranscript(
    project: string,
    sessionId: string,
    lines: string[],
    mtime: Date
  ): string {
    tempRoot = mkdtempSync(join(tmpdir(), "cawplan-cursor-gui-"));
    const jsonl = join(
      tempRoot,
      project,
      "agent-transcripts",
      sessionId,
      `${sessionId}.jsonl`
    );
    mkdirSync(join(tempRoot, project, "agent-transcripts", sessionId), { recursive: true });
    writeFileSync(jsonl, lines.join("\n"), "utf-8");
    const atime = new Date(mtime.getTime() - 1000);
    utimesSync(jsonl, atime, mtime);
    vi.spyOn(paths, "cursorProjectsDir").mockReturnValue(tempRoot);
    return jsonl;
  }

  test("shouldSkipTranscriptDateFilter uses mtime when transcript has no timestamps", () => {
    const mtime = new Date("2026-06-23T15:00:00");
    const jsonl = writeTranscript("proj-a", "sess-1", [NO_TS_USER, NO_TS_ASSISTANT], mtime);
    const lines = [NO_TS_USER, NO_TS_ASSISTANT];
    const filterDate = localDateString(mtime);

    expect(shouldSkipTranscriptDateFilter(filterDate, lines, jsonl)).toBe(true);
    expect(shouldSkipTranscriptDateFilter("2026-06-22", lines, jsonl)).toBe(false);
  });

  test("shouldSkipTranscriptDateFilter prefers lastUpdatedAtMs over mtime for cross-day sessions", () => {
    const mtime = new Date("2026-06-23T15:00:00");
    const jsonl = writeTranscript("proj-a", "sess-2", [NO_TS_USER, NO_TS_ASSISTANT], mtime);
    const lines = [NO_TS_USER, NO_TS_ASSISTANT];
    const lastUpdatedAtMs = new Date("2026-06-22T23:30:00").getTime();

    expect(
      shouldSkipTranscriptDateFilter("2026-06-22", lines, jsonl, lastUpdatedAtMs)
    ).toBe(true);
    expect(
      shouldSkipTranscriptDateFilter("2026-06-23", lines, jsonl, lastUpdatedAtMs)
    ).toBe(false);
  });

  test("shouldSkipTranscriptDateFilter does not apply when user turns have timestamp tags", () => {
    const mtime = new Date("2026-06-23T15:00:00");
    const jsonl = writeTranscript("proj-a", "sess-3", [WITH_TS_USER], mtime);
    const lines = [WITH_TS_USER];

    expect(shouldSkipTranscriptDateFilter("2026-06-22", lines, jsonl)).toBe(false);
    expect(shouldSkipTranscriptDateFilter("2026-06-23", lines, jsonl)).toBe(false);
  });

  test("shouldSkipTranscriptDateFilter ignores timestamp mentions in assistant text", () => {
    const mtime = new Date("2026-06-23T15:00:00");
    const assistantQuotesTs =
      '{"role":"assistant","message":{"content":[{"type":"text","text":"example: <timestamp>Monday, Jun 22, 2026</timestamp>"}]}}';
    const jsonl = writeTranscript(
      "proj-a",
      "sess-4",
      [NO_TS_USER, assistantQuotesTs],
      mtime
    );
    const lines = [NO_TS_USER, assistantQuotesTs];
    const filterDate = localDateString(mtime);

    expect(shouldSkipTranscriptDateFilter(filterDate, lines, jsonl)).toBe(true);
  });

  test("collectGuiSessions leaves human input times unset when no state db bubbles", () => {
    const mtime = new Date("2026-06-23T15:00:00");
    const jsonl = writeTranscript(
      "proj-a",
      "sess-5",
      [NO_TS_USER, NO_TS_ASSISTANT],
      mtime
    );
    void jsonl;
    vi.spyOn(paths, "cursorStateDbCandidates").mockReturnValue(["/nonexistent/state.vscdb"]);
    const sessions = collectGuiSessions(localDateString(mtime));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.message_stats.user).toBe(1);
    const human = sessions[0]?.human_inputs?.[0];
    expect(human?.content).toContain("hello");
    expect(human?.start_time).toBeUndefined();
    expect(human?.session_time).toBeUndefined();
    expect(human?.end_time).toBeUndefined();
  });

  test("matchUserBubble pairs transcript content with bubble text", () => {
    const used = new Set<number>();
    const bubbles = [
      {
        createdAt: new Date("2026-06-23T06:00:00.000Z"),
        text: "hello",
        normalized: normalizeBubbleMatchText("hello"),
      },
      {
        createdAt: new Date("2026-06-23T06:10:00.000Z"),
        text: "second prompt",
        normalized: normalizeBubbleMatchText("second prompt"),
      },
    ];
    const first = matchUserBubble("hello", bubbles, used);
    expect(first?.createdAt.toISOString()).toBe("2026-06-23T06:00:00.000Z");
    const second = matchUserBubble("second prompt", bubbles, used);
    expect(second?.createdAt.toISOString()).toBe("2026-06-23T06:10:00.000Z");
  });

  test("parseGuiSessionTranscript splits cross-day session by bubble createdAt", () => {
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new Database(":memory:");
    db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)");

    const sessionId = "cross-day-sess";
    const mondayUser =
      '{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\\nmonday task\\n</user_query>"}]}}';
    const tuesdayUser =
      '{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\\ntuesday task\\n</user_query>"}]}}';
    const assistant =
      '{"role":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}';

    const mtime = new Date("2026-06-23T15:00:00");
    const jsonl = writeTranscript(
      "proj-a",
      sessionId,
      [mondayUser, assistant, tuesdayUser, assistant],
      mtime
    );
    void jsonl;

    const insert = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");
    insert.run(
      `bubbleId:${sessionId}:u1`,
      JSON.stringify({ type: 1, text: "monday task", createdAt: "2026-06-22T14:00:00.000Z" })
    );
    insert.run(
      `bubbleId:${sessionId}:u2`,
      JSON.stringify({ type: 1, text: "tuesday task", createdAt: "2026-06-23T06:00:00.000Z" })
    );
    insert.run(
      `bubbleId:${sessionId}:a1`,
      JSON.stringify({ type: 2, text: "ok", createdAt: "2026-06-22T14:05:00.000Z" })
    );
    insert.run(
      `bubbleId:${sessionId}:a2`,
      JSON.stringify({ type: 2, text: "ok", createdAt: "2026-06-23T06:05:00.000Z" })
    );

    const monday = parseGuiSessionTranscript(sessionId, "2026-06-22", { db });
    const tuesday = parseGuiSessionTranscript(sessionId, "2026-06-23", { db });

    expect(monday.messageStats.user).toBe(1);
    expect(monday.humanInputs[0]?.content).toBe("monday task");
    expect(monday.humanInputs[0]?.start_time).toBe("2026-06-22T14:00:00.000Z");
    expect(monday.activityStart?.toISOString()).toBe("2026-06-22T14:00:00.000Z");

    expect(tuesday.messageStats.user).toBe(1);
    expect(tuesday.humanInputs[0]?.content).toBe("tuesday task");
    expect(tuesday.humanInputs[0]?.start_time).toBe("2026-06-23T06:00:00.000Z");
    expect(tuesday.activityStart?.toISOString()).toBe("2026-06-23T06:00:00.000Z");

    db.close();
  });
});
