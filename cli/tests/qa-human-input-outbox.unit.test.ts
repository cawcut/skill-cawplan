import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {
  cleanupQaHumanInputOutbox,
  mergeQaHumanInputOutbox,
  readQaHumanInputOutbox,
} from "../src/lib/collect/qa-human-input-outbox.js";
import type {SessionData} from "../src/lib/collect/types.js";
import type {TestPointReviewHumanInputEvent} from "../src/lib/testpoint-review/human-input-event.js";
import {buildQaDailyPayload} from "../src/lib/collect/aggregators/qa-daily.js";

function session(agent: string, id: string, inputs: SessionData["human_inputs"] = []): SessionData {
  return {
    schema: "2.0",
    date: "2026-09-24",
    agent,
    session_id: id,
    session_name: id,
    project: "p",
    cwd: "/tmp",
    time_range: {display: "", timezone: "UTC"},
    model_usage: {},
    usage_breakdown: [],
    files_changed: 0,
    repos_touched: [],
    message_stats: {user: 0, assistant: 0, tool_calls: 0},
    human_inputs: inputs,
  };
}

function event(overrides: Partial<TestPointReviewHumanInputEvent> = {}): TestPointReviewHumanInputEvent {
  return {
    schema: "cawplan.qa-human-input-event/1",
    event_id: "hie_1",
    event_type: "testpoint_review_submit",
    action: "optimize",
    occurred_at: "2026-09-24T08:00:00.000Z",
    local_date: "2026-09-24",
    timezone: "Asia/Shanghai",
    session_refs: [{agent: "codex", session_id: "s1", source: "CODEX_SESSION_ID"}],
    review_id: "rv_1",
    round: 1,
    product_id: "p",
    requirement_id: "r",
    state_updated_at: "2026-09-24T07:59:00.000Z",
    units: [{unit_id: "hiu_1", kind: "edit", content: "edit one"}],
    ...overrides,
  };
}

describe("QA Human Input outbox reader, merge, and retention", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qa-human-input-reader-"));
  });

  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test("skips malformed/wrong-date rows, deduplicates events and shared units, and keeps one input per event", () => {
    const second = event({
      event_id: "hie_2",
      action: "save",
      occurred_at: "2026-09-24T09:00:00.000Z",
      units: [
        {unit_id: "hiu_1", kind: "edit", content: "duplicate edit"},
        {unit_id: "hiu_2", kind: "add", content: "add two"},
      ],
    });
    writeFileSync(join(dir, "2026-09-24.jsonl"), [
      "{broken",
      JSON.stringify(event({local_date: "2026-09-23", event_id: "hie_wrong"})),
      JSON.stringify(event()),
      JSON.stringify(event()),
      JSON.stringify(second),
    ].join("\n"));
    const warn = vi.fn();
    const sessions = [session("codex", "s1")];

    mergeQaHumanInputOutbox(sessions, "2026-09-24", {dir, warn});

    expect(warn).toHaveBeenCalledTimes(2);
    expect(sessions[0].human_inputs).toHaveLength(2);
    expect(sessions[0].human_inputs?.[0]).toMatchObject({
      content: "edit one",
      session_id: "s1",
      start_time: "2026-09-24T08:00:00.000Z",
      time_precision: "exact",
    });
    expect(sessions[0].human_inputs?.[1].content).toBe("add two");
    expect(sessions[0].human_inputs?.[1].assistant_message).toBeUndefined();
  });

  test("uses exact unique agent/session matching and preserves chronological order with transcript inputs", () => {
    writeFileSync(join(dir, "2026-09-24.jsonl"), JSON.stringify(event()));
    const original = {category: "direction" as const, content: "later", start_time: "2026-09-24T10:00:00.000Z"};
    const sessions = [session("codex", "s1", [original]), session("claude-code", "s1")];
    mergeQaHumanInputOutbox(sessions, "2026-09-24", {dir, warn: vi.fn()});
    expect(sessions[0].human_inputs?.map((input) => input.content)).toEqual(["edit one", "later"]);
    expect(sessions[1].human_inputs).toEqual([]);
  });

  test("skips zero-match and ambiguous events without consuming units", () => {
    writeFileSync(join(dir, "2026-09-24.jsonl"), [
      JSON.stringify(event({event_id: "hie_ambiguous", session_refs: [
        {agent: "codex", session_id: "s1", source: "CODEX_SESSION_ID"},
        {agent: "claude-code", session_id: "c1", source: "CLAUDE_CODE_SESSION_ID"},
      ]})),
      JSON.stringify(event({event_id: "hie_unique", occurred_at: "2026-09-24T09:00:00.000Z"})),
    ].join("\n"));
    const sessions = [session("codex", "s1"), session("claude-code", "c1")];
    const warn = vi.fn();
    mergeQaHumanInputOutbox(sessions, "2026-09-24", {dir, warn});
    expect(warn).toHaveBeenCalledOnce();
    expect(sessions[0].human_inputs?.map((input) => input.content)).toEqual(["edit one"]);
  });

  test("reads only the requested date file", () => {
    writeFileSync(join(dir, "2026-09-23.jsonl"), JSON.stringify(event({local_date: "2026-09-23"})));
    expect(readQaHumanInputOutbox("2026-09-24", {dir})).toEqual([]);
  });

  test("merged events pass QA filtering while outbox metadata stays out of serialized upload inputs", () => {
    writeFileSync(join(dir, "2026-09-24.jsonl"), JSON.stringify(event()));
    const sessions = [session("codex", "s1")];
    mergeQaHumanInputOutbox(sessions, "2026-09-24", {dir, warn: vi.fn()});
    const {daily, excludedSessions} = buildQaDailyPayload(sessions, "2026-09-24", "qa@example.com");
    expect(excludedSessions).toEqual([]);
    expect(daily.sessions.map((entry) => entry.session_id)).toEqual(["s1"]);
    const serialized = JSON.parse(JSON.stringify(daily.human_inputs[0]));
    expect(serialized).toEqual({
      content: "edit one",
      session_id: "s1",
      start_time: "2026-09-24T08:00:00.000Z",
      end_time: "2026-09-24T08:00:00.000Z",
    });
    expect(JSON.stringify(serialized)).not.toMatch(/hie_|hiu_|review_id|round|action|product_id|requirement_id/);
  });

  test("retention deletes only valid regular date files strictly older than the cutoff", () => {
    for (const name of ["2026-08-25.jsonl", "2026-08-26.jsonl", "2026-02-30.jsonl", "notes.txt"]) {
      writeFileSync(join(dir, name), "x");
    }
    mkdirSync(join(dir, "2026-08-24.jsonl"));
    symlinkSync(join(dir, "2026-08-25.jsonl"), join(dir, "2026-08-23.jsonl"));
    cleanupQaHumanInputOutbox({dir, now: new Date(2026, 8, 24), warn: vi.fn()});
    expect(readdirSync(dir).sort()).toEqual([
      "2026-02-30.jsonl",
      "2026-08-23.jsonl",
      "2026-08-24.jsonl",
      "2026-08-26.jsonl",
      "notes.txt",
    ]);
  });
});
