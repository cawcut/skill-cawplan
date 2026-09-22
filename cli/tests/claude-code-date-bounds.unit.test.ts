import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { findSessionsByDate } from "../src/lib/collect/agents/claude-code.js";

const dirs: string[] = [];
let originalClaudeHome: string | undefined;

beforeEach(() => {
  originalClaudeHome = process.env.CLAUDE_HOME;
});

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  if (originalClaudeHome === undefined) delete process.env.CLAUDE_HOME;
  else process.env.CLAUDE_HOME = originalClaudeHome;
});

function makeClaudeHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "cawplan-date-bounds-tests-"));
  dirs.push(dir);
  process.env.CLAUDE_HOME = dir;
  return dir;
}

function writeSessionFile(claudeHome: string, sessionId: string, lines: Record<string, unknown>[]): string {
  const projectDir = join(claudeHome, "projects", "-repo");
  mkdirSync(projectDir, { recursive: true });
  const jsonlPath = join(projectDir, `${sessionId}.jsonl`);
  writeFileSync(jsonlPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return jsonlPath;
}

describe("findSessionsByDate — long first line", () => {
  test("finds a cross-day session whose first line exceeds the initial 4KB scan window", () => {
    const claudeHome = makeClaudeHome();

    // First event carries a long command/output field (mimics a hook attachment
    // event), pushing the line well past the original 4096-byte read window.
    const longCommand = "x".repeat(5000);
    const firstEvent = {
      type: "attachment",
      timestamp: "2026-09-18T01:00:00.000Z",
      hook_success: { command: longCommand },
    };
    const lastEvent = { type: "user", timestamp: "2026-09-22T01:00:00.000Z", message: { content: "hi" } };

    const jsonlPath = writeSessionFile(claudeHome, "sess-1", [firstEvent, lastEvent]);
    expect(Buffer.byteLength(JSON.stringify(firstEvent))).toBeGreaterThan(4096);

    // A day strictly between the session's first and last activity — under the
    // old implementation firstDate parsed to null and lastDate (09-22) wrongly
    // became the start of the range, so 09-21/09-18 were silently excluded.
    const midRangeResults = findSessionsByDate("2026-09-21");
    expect(midRangeResults.map((r) => r.jsonlPath)).toContain(jsonlPath);

    const startDateResults = findSessionsByDate("2026-09-18");
    expect(startDateResults.map((r) => r.jsonlPath)).toContain(jsonlPath);
  });
});
