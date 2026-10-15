import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { collectVscodeSessions, parseWorkspaceYaml } from "../src/lib/collect/agents/vscode.js";
import { buildDailyApiJson } from "../src/lib/collect/aggregators/daily.js";

// Local noon keeps every event on the same local calendar day in any timezone.
const DAY = "2026-10-13";
const NOON = new Date(`${DAY}T12:00:00`).getTime();
const iso = (offsetSec: number) => new Date(NOON + offsetSec * 1000).toISOString();

function event(type: string, offsetSec: number, data: Record<string, unknown>): string {
  return JSON.stringify({ type, data, id: `${type}-${offsetSec}`, timestamp: iso(offsetSec), parentId: null });
}

describe("vscode (Copilot agent host) collector", () => {
  let home = "";
  let prevHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cawplan-copilot-home-"));
    prevHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = home;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.COPILOT_HOME;
    else process.env.COPILOT_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  function writeSession(
    id: string,
    opts: { clientName?: string; createdOffsetSec?: number; updatedOffsetSec?: number; events: string[] }
  ): void {
    const dir = join(home, "session-state", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "workspace.yaml"),
      [
        `id: ${id}`,
        "cwd: /work/repo-a",
        "git_root: /work/repo-a",
        "repository: org/repo-a",
        `client_name: ${opts.clientName ?? "vscode-agent-host"}`,
        "name: Fix the login bug",
        `created_at: ${iso(opts.createdOffsetSec ?? 0)}`,
        `updated_at: ${iso(opts.updatedOffsetSec ?? 60)}`,
      ].join("\n")
    );
    writeFileSync(join(dir, "events.jsonl"), opts.events.join("\n") + "\n");
  }

  const turnEvents = [
    event("session.start", 0, { selectedModel: "auto" }),
    event("session.auto_mode_resolved", 1, { chosenModel: "model-routed" }),
    event("user.message", 5, { content: "please fix the login bug", transformedContent: "<wrapped>please fix</wrapped>" }),
    event("hook.start", 6, {}),
    event("assistant.message", 10, { model: "model-actual", content: "Looking at it.", toolRequests: [{ name: "view" }] }),
    event("tool.execution_start", 11, { toolName: "view" }),
    event("assistant.message", 20, { model: "model-actual", content: "Fixed.", toolRequests: [] }),
  ];

  test("collects a VS Code session with human input, model, counts and time range", () => {
    writeSession("sess-1", { events: turnEvents });

    const sessions = collectVscodeSessions(DAY);

    expect(sessions).toHaveLength(1);
    const s = sessions[0]!;
    expect(s.agent).toBe("vscode");
    expect(s.session_id).toBe("sess-1");
    expect(s.session_name).toBe("Fix the login bug");
    expect(s.project).toBe("repo-a");
    expect(s.cwd).toBe("/work/repo-a");
    expect(s.message_stats).toEqual({ user: 1, assistant: 2, tool_calls: 1 });
    // The concrete model on the assistant message beats the router's pick and "auto".
    expect(Object.keys(s.model_usage)).toEqual(["model-actual"]);
    expect(s.cost_basis).toBe("unknown");
    expect(s.usage_breakdown[0]).toMatchObject({ model: "model-actual", input_tokens: 0, agents: ["vscode"] });
    expect(s.human_inputs).toHaveLength(1);
    expect(s.human_inputs![0]).toMatchObject({
      content: "please fix the login bug",
      session_agent: "vscode",
      session_model: "model-actual",
      start_time: iso(5),
      end_time: iso(20),
      time_precision: "exact",
    });
    expect(s.human_inputs![0]!.assistant_message).toBe("Looking at it.\n\nFixed.");
  });

  test("falls back to the auto-routed model when no assistant message names one", () => {
    writeSession("sess-auto", {
      events: [
        event("session.start", 0, { selectedModel: "auto" }),
        event("session.auto_mode_resolved", 1, { chosenModel: "model-routed" }),
        event("user.message", 5, { content: "hello" }),
      ],
    });

    const [s] = collectVscodeSessions(DAY);
    expect(Object.keys(s!.model_usage)).toEqual(["model-routed"]);
  });

  test("skips sessions that did not come from VS Code", () => {
    writeSession("sess-cli", { clientName: "copilot-cli", events: turnEvents });
    expect(collectVscodeSessions(DAY)).toEqual([]);
  });

  test("skips sessions with no activity on the target date", () => {
    writeSession("sess-old", { events: turnEvents });
    expect(collectVscodeSessions("2026-10-12")).toEqual([]);
    expect(collectVscodeSessions("2026-10-14")).toEqual([]);
  });

  test("ignores malformed lines and non-session directories", () => {
    writeSession("sess-bad", { events: ["{not json", ...turnEvents, ""] });
    mkdirSync(join(home, "session-state", ".session-operation-locks"), { recursive: true });
    mkdirSync(join(home, "session-state", "no-workspace-yaml"), { recursive: true });

    const sessions = collectVscodeSessions(DAY);
    expect(sessions.map((s) => s.session_id)).toEqual(["sess-bad"]);
  });

  test("keeps harness blocks out of user.message human inputs", () => {
    const reminder = "<system-reminder>\nYou are operating in a git worktree.\n</system-reminder>";
    const notification = "<task-notification>\n<task-id>b1</task-id>\n</task-notification>";
    writeSession("sess-injected", {
      events: [
        event("user.message", 5, { content: `${reminder}\nfix the login bug` }),
        event("assistant.message", 10, { model: "m", content: "On it." }),
        event("user.message", 15, { content: `run the tests\n${notification}\nthen push` }),
        event("assistant.message", 20, { model: "m", content: "Pushed." }),
        event("user.message", 25, { content: `${reminder}\n${notification}` }),
        event("assistant.message", 30, { model: "m", content: "Noted the reminder." }),
      ],
    });

    const [s] = collectVscodeSessions(DAY);

    expect(s!.human_inputs!.map((h) => [h.content, h.assistant_message])).toEqual([
      ["fix the login bug", "On it."],
      // The reply to the dropped turn does not land on this input.
      ["run the tests\n\nthen push", "Pushed."],
    ]);
  });

  test("returns nothing when Copilot has no session-state directory", () => {
    expect(collectVscodeSessions(DAY)).toEqual([]);
  });

  test("daily report keeps VS Code sessions even though Copilot records no tokens", () => {
    writeSession("sess-1", { events: turnEvents });
    const sessions = collectVscodeSessions(DAY);

    const daily = buildDailyApiJson(sessions, DAY, "tester");

    expect(daily.totals.agents).toEqual(["vscode"]);
    expect(daily.sessions.map((s) => s.session_id)).toEqual(["sess-1"]);
    expect(daily.human_inputs).toHaveLength(1);
  });
});

describe("parseWorkspaceYaml", () => {
  test("parses flat key: value lines and strips quotes", () => {
    expect(parseWorkspaceYaml('id: abc\nname: "Quoted: name"\nbranch: fix/x\n\nbad line')).toEqual({
      id: "abc",
      name: "Quoted: name",
      branch: "fix/x",
    });
  });
});
