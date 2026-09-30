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
});
