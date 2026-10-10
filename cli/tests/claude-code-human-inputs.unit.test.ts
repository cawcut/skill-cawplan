import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import { collectClaudeCodeSession } from "../src/lib/collect/agents/claude-code.js";

const dirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cawplan-human-input-tests-"));
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

describe("collectClaudeCodeSession human_inputs", () => {
  test("keeps every text block in a multi-text-block user turn, not just the first", () => {
    const dir = makeDir();
    const path = join(dir, "session.jsonl");
    writeJsonl(path, [
      {
        type: "user",
        timestamp: "2026-07-23T01:00:00.000Z",
        cwd: "/repo",
        message: {
          role: "user",
          content: [
            { type: "text", text: "<ide_selection>some editor context</ide_selection>" },
            { type: "text", text: "please look at https://app.cawplan.com/issue/CAWP-23092" },
          ],
        },
      },
    ]);

    const result = collectClaudeCodeSession(path, "cawcut", "s1", "2026-07-23");
    const contents = result.human_inputs?.map((h) => h.content) ?? [];
    expect(contents.some((c) => c.includes("CAWP-23092"))).toBe(true);
  });

  test("excludes harness-injected user turns (task notifications, meta wakeups)", () => {
    const dir = makeDir();
    const path = join(dir, "session.jsonl");
    const user = (ts: string, text: string, extra: Record<string, unknown> = {}) => ({
      type: "user",
      timestamp: ts,
      cwd: "/repo",
      message: { role: "user", content: [{ type: "text", text }] },
      ...extra,
    });
    writeJsonl(path, [
      user("2026-09-07T01:00:00.000Z", "fix the slack table rendering", { origin: { kind: "human" } }),
      user(
        "2026-09-07T01:05:00.000Z",
        "<task-notification>\n<task-id>b1</task-id>\n<summary>Background command completed</summary>\n</task-notification>",
        { origin: { kind: "task-notification" } },
      ),
      user(
        "2026-09-07T01:10:00.000Z",
        "Re-check `gh pr checks 203 -R Ubiquiti-UID/uid.config-eventhook` and report final CI status to the user.",
        { isMeta: true },
      ),
      // Older Claude Code builds wrote task notifications without `origin`.
      user(
        "2026-09-07T01:15:00.000Z",
        "<task-notification>\n<task-id>b2</task-id>\n<summary>Wait for the Build stage</summary>\n</task-notification>",
      ),
      user("2026-09-07T01:20:00.000Z", "push and open a PR"),
    ]);

    const result = collectClaudeCodeSession(path, "cawcut", "s1", "2026-09-07");
    expect(result.human_inputs?.map((h) => h.content)).toEqual([
      "fix the slack table rendering",
      "push and open a PR",
    ]);
  });
});
