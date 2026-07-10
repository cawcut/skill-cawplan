import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test, vi } from "vitest";
import { localDateString } from "../src/lib/collect/date-utils.js";
import { collectCursorCliSessions } from "../src/lib/collect/agents/cursor-cli.js";
import {
  cwdFromProjectTranscriptPath,
  findProjectAgentTranscriptPath,
  resetChatProjectHashCache,
  resolveChatProjectHashToCwd,
} from "../src/lib/collect/cursor-chat-project.js";
import * as paths from "../src/lib/collect/paths.js";

function encodeCursorProjectDir(absPath: string): string {
  return absPath
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean)
    .join("-");
}

describe("cursor-chat-project", () => {
  let cursorHome = "";
  const cursorHomes: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    resetChatProjectHashCache();
    for (const home of cursorHomes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
    cursorHome = "";
  });

  function setupCursorHome(workspace: string): string {
    cursorHome = mkdtempSync(join(tmpdir(), "cawplan-cursor-home-"));
    cursorHomes.push(cursorHome);
    const projectsRoot = join(cursorHome, "projects");
    const projectDir = encodeCursorProjectDir(workspace);
    mkdirSync(join(projectsRoot, projectDir, "agent-transcripts"), { recursive: true });
    vi.spyOn(paths, "cursorHome").mockReturnValue(cursorHome);
    vi.spyOn(paths, "cursorProjectsDir").mockReturnValue(projectsRoot);
    vi.spyOn(paths, "cursorChatsDir").mockReturnValue(join(cursorHome, "chats"));
    return projectDir;
  }

  test("resolveChatProjectHashToCwd maps md5(workspace) to absolute path", () => {
    const workspace = "/tmp/cawplan/md5workspace";
    mkdirSync(workspace, { recursive: true });
    setupCursorHome(workspace);

    const hash = createHash("md5").update(workspace).digest("hex");
    expect(resolveChatProjectHashToCwd(hash)).toBe(workspace);
    expect(resolveChatProjectHashToCwd("not-a-hash")).toBe("");
  });

  test("findProjectAgentTranscriptPath discovers per-project transcripts", () => {
    const workspace = "/tmp/cawplan/transcriptworkspace";
    mkdirSync(workspace, { recursive: true });
    const projectDir = setupCursorHome(workspace);
    const convId = "conv-1234-5678-9012-345678901234";
    const transcriptPath = join(
      cursorHome,
      "projects",
      projectDir,
      "agent-transcripts",
      convId,
      `${convId}.jsonl`
    );
    mkdirSync(join(transcriptPath, ".."), { recursive: true });
    writeFileSync(transcriptPath, '{"role":"user","message":{"content":[]}}\n');

    expect(findProjectAgentTranscriptPath(convId)).toBe(transcriptPath);
    expect(cwdFromProjectTranscriptPath(transcriptPath)).toBe(workspace);
  });
});

describe("collectCursorCliSessions cwd fallback", () => {
  let cursorHome = "";
  const cursorHomes: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    resetChatProjectHashCache();
    for (const home of cursorHomes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
    cursorHome = "";
  });

  test("fills cwd from chat project md5 when chats transcript is missing", () => {
    const workspace = "/tmp/cawplan/cliworkspace";
    mkdirSync(workspace, { recursive: true });
    cursorHome = mkdtempSync(join(tmpdir(), "cawplan-cursor-cli-home-"));
    cursorHomes.push(cursorHome);

    const projectsRoot = join(cursorHome, "projects");
    const chatsRoot = join(cursorHome, "chats");
    const projectDir = encodeCursorProjectDir(workspace);
    const projectHash = createHash("md5").update(workspace).digest("hex");
    const convId = "b5dc3fbb-27f4-4c7a-bb0c-592f5386eccd";
    const filterDate = "2026-07-10";

    const convPath = join(chatsRoot, projectHash, convId);
    mkdirSync(convPath, { recursive: true });

    const storeDbPath = join(convPath, "store.db");
    const db = new DatabaseSync(storeDbPath);
    db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value BLOB);");
    db.exec("CREATE TABLE blobs (key TEXT PRIMARY KEY, value BLOB);");
    const meta = {
      agentId: convId,
      name: "Empty CWD",
      createdAt: Date.UTC(2026, 6, 10, 2, 13, 56),
      lastUsedModel: "composer-2.5",
    };
    db.prepare("INSERT INTO meta (key, value) VALUES ('0', ?)").run(
      Buffer.from(JSON.stringify(meta), "utf-8").toString("hex")
    );
    db.close();

    const targetDate = new Date(`${filterDate}T12:00:00`);
    utimesSync(storeDbPath, targetDate, targetDate);

    const transcriptPath = join(
      projectsRoot,
      projectDir,
      "agent-transcripts",
      convId,
      `${convId}.jsonl`
    );
    mkdirSync(join(transcriptPath, ".."), { recursive: true });
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        role: "user",
        message: {
          content: [
            {
              type: "text",
              text: `<timestamp>Friday, Jul 10, 2026, 10:13 AM (UTC+8)</timestamp>\n<user_query>\nhello\n</user_query>`,
            },
          ],
        },
      }) + "\n"
    );

    vi.spyOn(paths, "cursorHome").mockReturnValue(cursorHome);
    vi.spyOn(paths, "cursorProjectsDir").mockReturnValue(projectsRoot);
    vi.spyOn(paths, "cursorChatsDir").mockReturnValue(chatsRoot);

    const sessions = collectCursorCliSessions(filterDate);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.cwd).toBe(workspace);
    expect(sessions[0]?.session_id).toBe(convId);
    expect(localDateString(targetDate)).toBe(filterDate);
  });

  test("does not use mtimes when transcript has parseable off-date timestamps", () => {
    const workspace = "/tmp/cawplan/offdateworkspace";
    mkdirSync(workspace, { recursive: true });
    cursorHome = mkdtempSync(join(tmpdir(), "cawplan-cursor-cli-home-"));
    cursorHomes.push(cursorHome);

    const projectsRoot = join(cursorHome, "projects");
    const chatsRoot = join(cursorHome, "chats");
    const projectDir = encodeCursorProjectDir(workspace);
    const projectHash = createHash("md5").update(workspace).digest("hex");
    const convId = "c5dc3fbb-27f4-4c7a-bb0c-592f5386eccd";
    const filterDate = "2026-07-10";

    const convPath = join(chatsRoot, projectHash, convId);
    mkdirSync(convPath, { recursive: true });

    const storeDbPath = join(convPath, "store.db");
    const db = new DatabaseSync(storeDbPath);
    db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value BLOB);");
    db.exec("CREATE TABLE blobs (key TEXT PRIMARY KEY, value BLOB);");
    db.prepare("INSERT INTO meta (key, value) VALUES ('0', ?)").run(
      Buffer.from(JSON.stringify({ agentId: convId, name: "Off Date", lastUsedModel: "composer-2.5" }), "utf-8").toString("hex")
    );
    db.close();

    const targetDate = new Date(`${filterDate}T12:00:00`);
    utimesSync(storeDbPath, targetDate, targetDate);

    const transcriptPath = join(
      projectsRoot,
      projectDir,
      "agent-transcripts",
      convId,
      `${convId}.jsonl`
    );
    mkdirSync(join(transcriptPath, ".."), { recursive: true });
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        role: "user",
        message: {
          content: [
            {
              type: "text",
              text: `<timestamp>Thursday, Jul 9, 2026, 10:13 AM (UTC+8)</timestamp>\n<user_query>\nhello\n</user_query>`,
            },
          ],
        },
      }) + "\n"
    );
    utimesSync(transcriptPath, targetDate, targetDate);

    vi.spyOn(paths, "cursorHome").mockReturnValue(cursorHome);
    vi.spyOn(paths, "cursorProjectsDir").mockReturnValue(projectsRoot);
    vi.spyOn(paths, "cursorChatsDir").mockReturnValue(chatsRoot);

    expect(collectCursorCliSessions(filterDate)).toHaveLength(0);
  });
});
