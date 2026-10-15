import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test, vi } from "vitest";
import { isInjectedHumanInput, stripHarnessBlocks } from "../src/lib/collect/human-input-filter.js";
import { collectCursorAgentTranscripts } from "../src/lib/collect/agents/cursor-agent-transcripts.js";
import * as paths from "../src/lib/collect/paths.js";

const REMINDER = "<system-reminder>\nYou are operating in a git worktree.\n</system-reminder>";
const NOTIFICATION = "<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>";

describe("stripHarnessBlocks", () => {
  test("keeps typed text around blocks wherever they sit", () => {
    expect(stripHarnessBlocks(`${REMINDER}\n\nfix the bug`)).toBe("fix the bug");
    expect(stripHarnessBlocks(`run tests\n${NOTIFICATION}\nthen push`)).toBe("run tests\n\nthen push");
    expect(stripHarnessBlocks(`${REMINDER}\n${NOTIFICATION}`)).toBe("");
  });

  test("leaves an unclosed tag alone", () => {
    expect(stripHarnessBlocks("why does <system-reminder> show up in my report?")).toBe(
      "why does <system-reminder> show up in my report?"
    );
  });
});

describe("isInjectedHumanInput", () => {
  test.each([
    ["Cursor context block", "<user_info>\nOS Version: darwin\n</user_info>"],
    ["Cursor rules after other context", "<git_status>clean</git_status>\n<rules>\n- be terse\n</rules>"],
    ["Codex environment context", "<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>"],
    ["AGENTS.md instructions", "# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>…</INSTRUCTIONS>"],
    ["slash command wrapper", "<command-message>review is running…</command-message>\n<command-name>/review</command-name>"],
    ["skill body", "Base directory for this skill: /skills/x\n\n# X"],
    ["compaction summary", "This session is being continued from a previous conversation."],
    ["memory compressor prompt", "You are a memory relevance compressor utility.\nDo not use any tools."],
    ["Cursor task-result follow-up", "Briefly inform the user about the task result and perform any follow-up actions (if needed)."],
  ])("drops %s", (_name, text) => {
    expect(isInjectedHumanInput(text)).toBe(true);
  });

  test.each([
    ["inline tag mention", "what should go inside <rules> for this repo?"],
    ["quoted compressor prompt", 'why does "You are a memory relevance compressor utility." show up in Coding Insights?'],
    ["quoted follow-up prompt", "Cursor keeps sending 'Briefly inform the user about the task result', can we filter it?"],
    ["plain request", "fix the login bug"],
  ])("keeps %s", (_name, text) => {
    expect(isInjectedHumanInput(text)).toBe(false);
  });
});

describe("collectCursorAgentTranscripts human_inputs", () => {
  let root = "";

  afterEach(() => {
    vi.restoreAllMocks();
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  test("keeps harness blocks and injected prompts out of human inputs", () => {
    root = mkdtempSync(join(tmpdir(), "cawplan-cursor-transcripts-"));
    const sessionId = "sess-injected";
    const dir = join(root, "Users-dev-repo", "agent-transcripts", sessionId);
    mkdirSync(dir, { recursive: true });
    const user = (ts: string, text: string) =>
      JSON.stringify({
        role: "user",
        message: { content: [{ type: "text", text: `<timestamp>${ts}</timestamp>\n<user_query>\n${text}\n</user_query>` }] },
      });
    const assistant = JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: "ok" }] } });
    writeFileSync(
      join(dir, `${sessionId}.jsonl`),
      [
        user("Monday, Sep 7, 2026, 3:19 PM (UTC+8)", `${REMINDER}\ncompare the two release branches`),
        assistant,
        user("Monday, Sep 7, 2026, 3:30 PM (UTC+8)", `rerun the build\n${NOTIFICATION}\nthen tag it`),
        assistant,
        user("Monday, Sep 7, 2026, 3:40 PM (UTC+8)", `${REMINDER}\n${NOTIFICATION}`),
        assistant,
        user(
          "Monday, Sep 7, 2026, 3:47 PM (UTC+8)",
          "Briefly inform the user about the task result and perform any follow-up actions (if needed)."
        ),
        assistant,
      ].join("\n")
    );
    vi.spyOn(paths, "cursorProjectsDir").mockReturnValue(root);

    const [session] = collectCursorAgentTranscripts("2026-09-07");

    expect(session?.human_inputs?.map((h) => h.content)).toEqual([
      "compare the two release branches",
      "rerun the build\n\nthen tag it",
    ]);
  });
});
