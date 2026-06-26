import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test, vi } from "vitest";
import { localDateString } from "../src/lib/collect/date-utils.js";
import {
  collectGuiSessions,
  decodeCursorProjectDirToCwd,
  matchUserBubble,
  normalizeBubbleMatchText,
  parseGuiSessionTranscript,
  refineBackdateStartsFromAssistantTimes,
  resolveUserBubbleTimes,
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

  test("parseGuiSessionTranscript excludes no-timestamp prompts without bubble or transcript time", () => {
    const mtime = new Date("2026-06-23T15:00:00");
    const jsonl = writeTranscript("proj-a", "sess-1", [NO_TS_USER, NO_TS_ASSISTANT], mtime);
    void jsonl;

    const parsed = parseGuiSessionTranscript("sess-1", localDateString(mtime));
    expect(parsed.messageStats.user).toBe(0);
    expect(parsed.humanInputs).toHaveLength(0);
  });

  test("collectGuiSessions excludes transcript-only sessions without per-prompt timestamps", () => {
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
    expect(sessions).toEqual([]);
  });

  test("collectGuiSessions does not full-scan transcripts when db candidates have no day activity", () => {
    const root = mkdtempSync(join(tmpdir(), "cawplan-cursor-gui-"));
    tempRoots.push(root);
    const dbPath = join(root, "state.vscdb");
    const db = new DatabaseSync(dbPath);
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

  test("collectGuiSessions uses composer workspaceIdentifier as initial cwd", () => {
    const root = mkdtempSync(join(tmpdir(), "cawplan-cursor-gui-"));
    const workspace = mkdtempSync(join(tmpdir(), "cawplan-workspace-"));
    tempRoots.push(root, workspace);
    const dbPath = join(root, "state.vscdb");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)");
    const sessionId = "workspace-cwd-session";
    db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      `composerData:${sessionId}`,
      JSON.stringify({
        composerId: sessionId,
        name: "workspace cwd",
        createdAt: new Date("2026-06-22T01:00:00.000Z").getTime(),
        lastUpdatedAt: new Date("2026-06-22T02:00:00.000Z").getTime(),
        workspaceIdentifier: {
          id: "opaque-workspace",
          uri: {
            fsPath: workspace,
            path: workspace,
            scheme: "file",
          },
        },
      })
    );
    db.close();

    const jsonl = join(root, "1780652652852", "agent-transcripts", sessionId, `${sessionId}.jsonl`);
    mkdirSync(dirname(jsonl), { recursive: true });
    writeFileSync(jsonl, [WITH_TS_USER, NO_TS_ASSISTANT].join("\n"), "utf-8");
    vi.spyOn(paths, "cursorProjectsDir").mockReturnValue(root);
    vi.spyOn(paths, "cursorStateDbCandidates").mockReturnValue([dbPath]);

    const sessions = collectGuiSessions("2026-06-22");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.cwd).toBe(workspace);
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

  test("matchUserBubble does not assign unmatched content to the next bubble", () => {
    const used = new Set<number>();
    const bubbles = [
      {
        createdAt: new Date("2026-06-23T06:00:00.000Z"),
        text: "first prompt",
        normalized: normalizeBubbleMatchText("first prompt"),
      },
    ];
    expect(matchUserBubble("completely different text", bubbles, used)).toBeNull();
    expect(used.size).toBe(0);
  });

  test("parseGuiSessionTranscript splits cross-day session by bubble createdAt", () => {
    const db = new DatabaseSync(":memory:");
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

    const monday = parseGuiSessionTranscript(sessionId, "2026-06-22", {
      db,
      sessionCreatedAtMs: new Date("2026-06-22T10:00:00.000Z").getTime(),
    });
    const tuesday = parseGuiSessionTranscript(sessionId, "2026-06-23", {
      db,
      sessionCreatedAtMs: new Date("2026-06-22T10:00:00.000Z").getTime(),
    });

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

  test("parseGuiSessionTranscript prefers bubble createdAt over transcript timestamp tags", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)");

    const sessionId = "bubble-overrides-ts";
    const userWithSyntheticTs =
      '{"role":"user","message":{"content":[{"type":"text","text":"<timestamp>Wednesday, Jun 25, 2026, 9:58 AM (UTC+8)</timestamp>\\n<user_query>\\nreal prompt sent later\\n</user_query>"}]}}';
    const assistant =
      '{"role":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}';

    writeTranscript("proj-a", sessionId, [userWithSyntheticTs, assistant], new Date("2026-06-25T15:00:00"));

    db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
      `bubbleId:${sessionId}:u1`,
      JSON.stringify({
        type: 1,
        text: "real prompt sent later",
        createdAt: "2026-06-25T12:14:35.171Z",
      })
    );

    const parsed = parseGuiSessionTranscript(sessionId, "2026-06-25", { db });

    expect(parsed.messageStats.user).toBe(1);
    expect(parsed.humanInputs[0]?.content).toBe("real prompt sent later");
    expect(parsed.humanInputs[0]?.start_time).toBe("2026-06-25T12:14:35.171Z");

    db.close();
  });

  test("parseGuiSessionTranscript backdates resumed-session bubble clusters to session creation day", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)");

    const sessionId = "resume-cluster-sess";
    const sessionCreatedAtMs = new Date("2026-06-23T10:12:16.177Z").getTime();
    const earlyUser =
      '{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\\nYR2 wifi prompt from earlier day\\n</user_query>"}]}}';
    const laterUser =
      '{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\\nafternoon prompt today\\n</user_query>"}]}}';
    const assistant =
      '{"role":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}';

    writeTranscript(
      "proj-a",
      sessionId,
      [earlyUser, assistant, laterUser, assistant],
      new Date("2026-06-25T15:00:00")
    );

    const insert = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");
    for (let i = 0; i < 6; i++) {
      insert.run(
        `bubbleId:${sessionId}:cluster-${i}`,
        JSON.stringify({
          type: 1,
          text: i === 0 ? "YR2 wifi prompt from earlier day" : `cluster filler ${i}`,
          createdAt: `2026-06-25T01:58:08.${200 + i}Z`,
        })
      );
    }
    insert.run(
      `bubbleId:${sessionId}:afternoon`,
      JSON.stringify({
        type: 1,
        text: "afternoon prompt today",
        createdAt: "2026-06-25T12:14:35.171Z",
      })
    );

    const june23 = parseGuiSessionTranscript(sessionId, "2026-06-23", { db, sessionCreatedAtMs });
    const june25 = parseGuiSessionTranscript(sessionId, "2026-06-25", { db, sessionCreatedAtMs });

    expect(june23.humanInputs.some((h) => h.content.includes("YR2 wifi prompt"))).toBe(true);
    expect(june25.humanInputs.some((h) => h.content.includes("YR2 wifi prompt"))).toBe(false);
    expect(june25.humanInputs.some((h) => h.content.includes("afternoon prompt today"))).toBe(true);

    db.close();
  });

  test("resolveUserBubbleTimes keeps mid-session backdated prompts off session creation day", () => {
    const sessionCreatedAtMs = new Date("2026-06-23T10:12:16.177Z").getTime();
    const userBubbles = [
      {
        createdAt: new Date("2026-06-25T01:58:08.197Z"),
        text: "early prompt",
        normalized: normalizeBubbleMatchText("early prompt"),
      },
      {
        createdAt: new Date("2026-06-25T01:58:08.203Z"),
        text: "agent logs from next day",
        normalized: normalizeBubbleMatchText("agent logs from next day"),
      },
      {
        createdAt: new Date("2026-06-25T12:14:35.171Z"),
        text: "afternoon prompt",
        normalized: normalizeBubbleMatchText("afternoon prompt"),
      },
    ];
    const backdate = new Set([0, 1]);
    const pairs = [
      { bubbleIndex: 0, transcriptIndex: 0 },
      { bubbleIndex: 1, transcriptIndex: 28 },
      { bubbleIndex: 2, transcriptIndex: 90 },
    ];
    const resolved = resolveUserBubbleTimes(userBubbles, pairs, backdate, sessionCreatedAtMs);
    const earlyDay = localDateString(resolved.get(0)!);
    const midDay = localDateString(resolved.get(1)!);
    const afternoonDay = localDateString(userBubbles[2].createdAt);
    expect(earlyDay).toBe("2026-06-23");
    expect(midDay).toBe("2026-06-24");
    expect(afternoonDay).toBe("2026-06-25");
  });

  test("resolveUserBubbleTimes resolves backdated bubbles with no transcript match off the resume day", () => {
    const sessionCreatedAtMs = new Date("2026-06-23T10:12:16.177Z").getTime();
    const userBubbles = [
      {
        createdAt: new Date("2026-06-25T01:58:08.197Z"),
        text: "matched early prompt",
        normalized: normalizeBubbleMatchText("matched early prompt"),
      },
      {
        // restamped to the resume day, but never matched to a transcript prompt
        createdAt: new Date("2026-06-25T01:58:08.203Z"),
        text: "unmatched filler",
        normalized: normalizeBubbleMatchText("unmatched filler"),
      },
      {
        createdAt: new Date("2026-06-25T12:14:35.171Z"),
        text: "afternoon prompt",
        normalized: normalizeBubbleMatchText("afternoon prompt"),
      },
    ];
    const backdate = new Set([0, 1]);
    // only bubble 0 matched a transcript prompt; bubble 1 has no pair
    const pairs = [
      { bubbleIndex: 0, transcriptIndex: 0 },
      { bubbleIndex: 2, transcriptIndex: 90 },
    ];

    const resolved = resolveUserBubbleTimes(userBubbles, pairs, backdate, sessionCreatedAtMs);

    // the unmatched backdated bubble must still be resolved (not left on the resume day)
    expect(resolved.has(1)).toBe(true);
    expect(localDateString(resolved.get(1)!) < "2026-06-25").toBe(true);
    // non-backdated bubble keeps its exact recorded timestamp
    expect(resolved.get(2)!.getTime()).toBe(userBubbles[2].createdAt.getTime());
  });

  test("parseGuiSessionTranscript flags backdated inputs approximate and keeps unmatched fillers off the resume day", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)");

    const sessionId = "resume-precision-sess";
    const sessionCreatedAtMs = new Date("2026-06-23T10:12:16.177Z").getTime();
    const earlyUser =
      '{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\\nYR2 wifi prompt from earlier day\\n</user_query>"}]}}';
    const laterUser =
      '{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\\nafternoon prompt today\\n</user_query>"}]}}';
    const assistant =
      '{"role":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}';

    writeTranscript(
      "proj-a",
      sessionId,
      [earlyUser, assistant, laterUser, assistant],
      new Date("2026-06-25T15:00:00")
    );

    const insert = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");
    // dense 6-bubble cluster restamped to the resume day; only bubble 0 matches a transcript prompt,
    // fillers 1..5 have no transcript counterpart
    for (let i = 0; i < 6; i++) {
      insert.run(
        `bubbleId:${sessionId}:cluster-${i}`,
        JSON.stringify({
          type: 1,
          text: i === 0 ? "YR2 wifi prompt from earlier day" : `cluster filler ${i}`,
          createdAt: `2026-06-25T01:58:08.${200 + i}Z`,
        })
      );
    }
    insert.run(
      `bubbleId:${sessionId}:afternoon`,
      JSON.stringify({
        type: 1,
        text: "afternoon prompt today",
        createdAt: "2026-06-25T12:14:35.171Z",
      })
    );

    const june25 = parseGuiSessionTranscript(sessionId, "2026-06-25", { db, sessionCreatedAtMs });

    // unmatched fillers must not leak onto the resume day anymore
    expect(june25.humanInputs.some((h) => h.content.includes("cluster filler"))).toBe(false);
    expect(june25.humanInputs.some((h) => h.content.includes("YR2 wifi prompt"))).toBe(false);

    // the afternoon prompt genuinely happened on the resume day and is exact
    const afternoon = june25.humanInputs.find((h) => h.content.includes("afternoon prompt today"));
    expect(afternoon?.time_precision).toBe("exact");

    // backdated inputs are flagged approximate on their reconstructed day
    const june24 = parseGuiSessionTranscript(sessionId, "2026-06-24", { db, sessionCreatedAtMs });
    const june23 = parseGuiSessionTranscript(sessionId, "2026-06-23", { db, sessionCreatedAtMs });
    const backdatedInputs = [...june23.humanInputs, ...june24.humanInputs];
    expect(backdatedInputs.length).toBeGreaterThan(0);
    expect(backdatedInputs.every((h) => h.time_precision === "approximate")).toBe(true);

    db.close();
  });

  test("refineBackdateStartsFromAssistantTimes uses first assistant bubble after backdated user", () => {
    const sessionCreatedAtMs = new Date("2026-06-23T10:12:16.177Z").getTime();
    const userBubbles = [
      {
        createdAt: new Date("2026-06-25T01:58:08.204Z"),
        text: "合并代码后有冲突， 帮修正",
        normalized: normalizeBubbleMatchText("合并代码后有冲突， 帮修正"),
      },
    ];
    const backdate = new Set([0]);
    const pairs = [{ bubbleIndex: 0, transcriptIndex: 0 }];
    const assistantTimes = [
      new Date("2026-06-24T06:27:12.322Z"),
      new Date("2026-06-24T06:27:55.930Z"),
    ];
    const resolved = resolveUserBubbleTimes(userBubbles, pairs, backdate, sessionCreatedAtMs);
    const interpolated = resolved.get(0)!.toISOString();
    expect(interpolated).not.toBe("2026-06-24T06:27:12.322Z");

    const lines = [
      '{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\\n合并代码后有冲突， 帮修正\\n</user_query>"}]}}',
      '{"role":"assistant","message":{"content":[{"type":"text","text":"checking conflicts"}]}}',
      '{"role":"assistant","message":{"content":[{"type":"text","text":"done"}]}}',
    ];
    refineBackdateStartsFromAssistantTimes(
      lines,
      userBubbles,
      pairs,
      backdate,
      resolved,
      assistantTimes,
      sessionCreatedAtMs
    );

    expect(resolved.get(0)?.toISOString()).toBe("2026-06-24T06:27:12.322Z");
  });

  test("parseGuiSessionTranscript prefers assistant bubble time for backdated user prompts", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)");

    const sessionId = "assistant-infer-sess";
    const sessionCreatedAtMs = new Date("2026-06-23T10:12:16.177Z").getTime();
    const userLine =
      '{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\\n合并代码后有冲突， 帮修正\\n</user_query>"}]}}';
    const assistantLine =
      '{"role":"assistant","message":{"content":[{"type":"text","text":"fixing conflicts"}]}}';
    const assistantDoneLine =
      '{"role":"assistant","message":{"content":[{"type":"text","text":"conflicts resolved"}]}}';

    writeTranscript(
      "proj-a",
      sessionId,
      [userLine, assistantLine, assistantDoneLine],
      new Date("2026-06-25T15:00:00")
    );

    const insert = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");
    for (let i = 0; i < 6; i++) {
      insert.run(
        `bubbleId:${sessionId}:cluster-${i}`,
        JSON.stringify({
          type: 1,
          text: i === 0 ? "合并代码后有冲突， 帮修正" : `cluster filler ${i}`,
          createdAt: `2026-06-25T01:58:08.${200 + i}Z`,
        })
      );
    }
    insert.run(
      `bubbleId:${sessionId}:a1`,
      JSON.stringify({
        type: 2,
        text: "fixing conflicts",
        createdAt: "2026-06-24T06:27:12.322Z",
      })
    );
    insert.run(
      `bubbleId:${sessionId}:a2`,
      JSON.stringify({
        type: 2,
        text: "conflicts resolved",
        createdAt: "2026-06-24T06:27:55.930Z",
      })
    );

    const parsed = parseGuiSessionTranscript(sessionId, "2026-06-24", { db, sessionCreatedAtMs });
    const conflict = parsed.humanInputs.find((h) => h.content.includes("合并代码后有冲突"));
    expect(conflict?.start_time).toBe("2026-06-24T06:27:12.322Z");
    expect(conflict?.time_precision).toBe("approximate");
    expect(conflict?.end_time).not.toBe(conflict?.start_time);

    db.close();
  });
});
