import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { afterEach, describe, expect, test, vi } from "vitest";
import { localDateString } from "../src/lib/collect/date-utils.js";
import {
  collectGuiSessions,
  decodeCursorProjectDirToCwd,
  matchUserBubble,
  normalizeBubbleMatchText,
  parseGuiSessionTranscript,
  shouldSkipTranscriptDateFilter,
} from "../src/lib/collect/agents/cursor-gui.js";
import { enrichCursorGuiFallbackContext } from "../src/lib/collect/index.js";
import * as paths from "../src/lib/collect/paths.js";
import type { SessionData } from "../src/lib/collect/types.js";

const NO_TS_USER =
  '{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\\nhello\\n</user_query>"}]}}';
const NO_TS_ASSISTANT =
  '{"role":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}}';
const WITH_TS_USER =
  '{"role":"user","message":{"content":[{"type":"text","text":"<timestamp>Monday, Jun 22, 2026, 11:09 AM (UTC+8)</timestamp>\\n<user_query>\\nhello\\n</user_query>"}]}}';

function encodeCursorProjectDir(absPath: string): string {
  return absPath
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean)
    .join("-");
}

function minimalCursorSession(overrides: Partial<SessionData>): SessionData {
  return {
    schema: "2.0",
    date: "2026-06-23",
    agent: "cursor-gui",
    session_id: "session",
    session_name: "session",
    project: "session",
    cwd: "",
    time_range: { display: "unknown", timezone: "UTC" },
    model_usage: {},
    usage_breakdown: [],
    files_changed: 0,
    files_added: 0,
    files_deleted: 0,
    repos_touched: [],
    message_stats: { user: 0, assistant: 0, tool_calls: 0 },
    ...overrides,
  };
}

describe("cursor-gui mtime fallback", () => {
  let tempRoot = "";
  const tempRoots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
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

  test("collectGuiSessions does not full-scan transcripts when db candidates have no day activity", () => {
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const root = mkdtempSync(join(tmpdir(), "cawplan-cursor-gui-"));
    tempRoots.push(root);
    const dbPath = join(root, "state.vscdb");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)");
    db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      "composerData:no-activity-session",
      JSON.stringify({
        composerId: "no-activity-session",
        name: "cross-day no activity",
        createdAt: new Date("2026-06-05T09:00:00.000Z").getTime(),
        lastUpdatedAt: new Date("2026-06-08T09:00:00.000Z").getTime(),
      })
    );
    db.close();
    vi.spyOn(paths, "cursorProjectsDir").mockReturnValue(root);
    vi.spyOn(paths, "cursorStateDbCandidates").mockReturnValue([dbPath]);

    const fallbackJsonl = join(root, "fallback-proj", "agent-transcripts", "fallback", "fallback.jsonl");
    mkdirSync(dirname(fallbackJsonl), { recursive: true });
    const juneSixUser =
      '{"role":"user","message":{"content":[{"type":"text","text":"<timestamp>Saturday, Jun 6, 2026, 10:00 AM (UTC+8)</timestamp>\\n<user_query>\\nshould not be scanned\\n</user_query>"}]}}';
    writeFileSync(fallbackJsonl, [juneSixUser, NO_TS_ASSISTANT].join("\n"), "utf-8");

    expect(collectGuiSessions("2026-06-06")).toEqual([]);
  });

  test("decodeCursorProjectDirToCwd handles encoded email and dotted repo segments", () => {
    const testRoot = mkdtempSync(join(process.cwd(), "tmp-cursor-real-"));
    tempRoots.push(testRoot);
    const realCwd = join(
      testRoot,
      "Users",
      "husky.su@ui.com",
      "Documents",
      "UBNT",
      "unifi.hw.access-fe"
    );
    mkdirSync(realCwd, { recursive: true });

    expect(decodeCursorProjectDirToCwd(encodeCursorProjectDir(realCwd))).toBe(realCwd);
  });

  test("decodeCursorProjectDirToCwd skips opaque numeric project directories", () => {
    expect(decodeCursorProjectDirToCwd("1780652652852")).toBe("");
  });

  test("parseGuiSessionTranscript infers cwd from absolute tool paths without counting read tools", () => {
    const realRepo = join(mkdtempSync(join(tmpdir(), "cawplan-cursor-repo-")), "unifi.hw.access-fe");
    mkdirSync(join(realRepo, ".git"), { recursive: true });
    mkdirSync(join(realRepo, "src"), { recursive: true });
    const editedFile = join(realRepo, "src", "index.ts");
    const readOnlyFile = join(realRepo, "README.md");

    tempRoot = mkdtempSync(join(tmpdir(), "cawplan-cursor-gui-"));
    const sessionId = "absolute-path-sess";
    const jsonl = join(
      tempRoot,
      "Users-husky-su-ui-com-Documents-UBNT-unifi-hw-access-fe",
      "agent-transcripts",
      sessionId,
      `${sessionId}.jsonl`
    );
    mkdirSync(dirname(jsonl), { recursive: true });
    writeFileSync(
      jsonl,
      [
        WITH_TS_USER,
        JSON.stringify({
          role: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "ReadFile", input: { path: readOnlyFile } },
              {
                type: "tool_use",
                name: "Edit",
                input: { target_file: editedFile, old_string: "old", new_string: "new" },
              },
            ],
          },
        }),
      ].join("\n"),
      "utf-8"
    );
    vi.spyOn(paths, "cursorProjectsDir").mockReturnValue(tempRoot);

    const parsed = parseGuiSessionTranscript(sessionId, "2026-06-22");

    expect(parsed.cwd).toBe(realRepo);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0]?.path).toBe(editedFile);
    expect(parsed.repos).toHaveLength(1);
  });

  test("enrichCursorGuiFallbackContext does not spread a single known repo to empty sessions", () => {
    const known = minimalCursorSession({
      session_id: "known",
      project: "uid.core-web-product",
      cwd: "/repo/uid.core-web-product",
      repos_touched: [{ repo: "Ubiquiti-UID/uid.core-web-product", files: 3 }],
      files_changed: 3,
    });
    const unknown = minimalCursorSession({
      session_id: "unknown",
      project: "unknown",
      cwd: "",
      repos_touched: [],
    });

    enrichCursorGuiFallbackContext([known, unknown]);

    expect(unknown.cwd).toBe("");
    expect(unknown.repos_touched).toEqual([]);
    expect(unknown.project).toBe("unknown");
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
