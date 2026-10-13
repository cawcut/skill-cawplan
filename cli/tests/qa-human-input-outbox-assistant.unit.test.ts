import {afterEach, beforeEach, expect, test, vi} from "vitest";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {mergeQaHumanInputOutbox} from "../src/lib/collect/qa-human-input-outbox.js";
import type {SessionData} from "../src/lib/collect/types.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "qa-hi-assistant-")); });
afterEach(() => rmSync(dir, {recursive: true, force: true}));

const ts = (s: string) => `2026-10-13T02:${s}Z`;
const notification = (taskId: string, at: string) => ({
  type: "user", timestamp: ts(at), origin: {kind: "task-notification"},
  message: {content: `<task-notification>\n<task-id>${taskId}</task-id>\n</task-notification>`},
});
const openTool = (id: string, at: string) => ({
  type: "assistant", timestamp: ts(at),
  message: {content: [{type: "tool_use", id, name: "Bash", input: {run_in_background: true, command: "cawplan qa-insights testpoint-review open --review-id rv_1"}}]},
});
const openResult = (id: string, taskId: string, at: string) => ({
  type: "user", timestamp: ts(at), toolUseResult: {backgroundTaskId: taskId},
  message: {content: [{type: "tool_result", tool_use_id: id}]},
});
const text = (t: string, at: string) => ({type: "assistant", timestamp: ts(at), message: {content: [{type: "text", text: t}]}});

function outboxEvent(id: string, at: string, sessionId: string) {
  return {
    schema: "cawplan.qa-human-input-event/1", event_id: `hie_${id}`, event_type: "testpoint_review_submit",
    action: "optimize", occurred_at: ts(at), local_date: "2026-10-13", timezone: "Asia/Shanghai",
    session_refs: [{agent: "claude-code", session_id: sessionId, source: "CLAUDE_CODE_SESSION_ID"}],
    review_id: "rv_1", round: 1, product_id: "p", requirement_id: "r", state_updated_at: ts(at),
    units: [{unit_id: `hiu_${id}`, kind: "comment", content: `comment ${id}`}],
  };
}

function session(id: string): SessionData {
  return {
    schema: "2.0", date: "2026-10-13", agent: "claude-code", session_id: id, session_name: id, project: "p",
    cwd: "/tmp", time_range: {display: "", timezone: "UTC"}, model_usage: {}, usage_breakdown: [],
    files_changed: 0, repos_touched: [], message_stats: {user: 0, assistant: 0, tool_calls: 0}, human_inputs: [],
  };
}

test("pairs each Review submit with its own assistant reply, never inventing one", () => {
  const jsonl = join(dir, "s1.jsonl");
  const events = [
    openTool("t1", "01:00.000"), openResult("t1", "k1", "01:00.100"),
    notification("k1", "01:31.727"),
    text("正在优化，请稍候…", "01:39.984"),
    text("存疑清单 A", "02:11.304"),
    openTool("t2", "08:00.000"), openResult("t2", "k2", "08:00.100"),
    notification("k2", "08:33.735"),
    text("存疑清单 B", "09:02.648"),
    // third submit: anchor exists but no assistant text before the next review notification
    openTool("t3", "10:00.000"), openResult("t3", "k3", "10:00.100"),
    notification("k3", "10:06.370"),
    notification("k3", "10:40.838"),
    text("已保存", "10:47.399"),
  ];
  writeFileSync(jsonl, events.map((e) => JSON.stringify(e)).join("\n"));
  const outbox = [outboxEvent("a", "01:31.578", "s1"), outboxEvent("b", "08:33.559", "s1"), outboxEvent("c", "10:06.150", "s1")];
  writeFileSync(join(dir, "2026-10-13.jsonl"), outbox.map((e) => JSON.stringify(e)).join("\n"));

  const sessions = [session("s1")];
  mergeQaHumanInputOutbox(sessions, "2026-10-13", {dir, warn: vi.fn(), findClaudeJsonlPath: () => jsonl});

  const replies = sessions[0].human_inputs!.map((h) => h.assistant_message);
  expect(replies[0]).toBe("正在优化，请稍候…\n\n存疑清单 A");
  expect(replies[1]).toBe("存疑清单 B");
  // Window for c ends at the next Review notification (k3 again) -> no text -> no reply.
  expect(replies[2]).toBeUndefined();
});

test("leaves assistant_message unset when the JSONL cannot be found", () => {
  writeFileSync(join(dir, "2026-10-13.jsonl"), JSON.stringify(outboxEvent("a", "01:31.578", "s1")));
  const sessions = [session("s1")];
  mergeQaHumanInputOutbox(sessions, "2026-10-13", {dir, warn: vi.fn(), findClaudeJsonlPath: () => undefined});
  expect(sessions[0].human_inputs![0].assistant_message).toBeUndefined();
});

test("Codex: pairs Review submits via TESTPOINT_REVIEW_EVENT anchors and stops at human turns", () => {
  const jsonl = join(dir, "codex.jsonl");
  const msg = (role: string, t: string, at: string) => ({
    type: "response_item", timestamp: ts(at),
    payload: {type: "message", role, content: [{type: role === "user" ? "input_text" : "output_text", text: t}]},
  });
  const anchor = (action: string, at: string) => ({
    type: "event_msg", timestamp: ts(at),
    payload: {type: "item_completed", item: {aggregated_output: `TESTPOINT_REVIEW_EVENT ${action}\r\n`}},
  });
  const events = [
    anchor("optimize_requested", "05:44.486"),
    // later response_item re-read of the same output is not an anchor
    {type: "response_item", timestamp: ts("05:44.487"), payload: {type: "custom_tool_call_output", output: "TESTPOINT_REVIEW_EVENT optimize_requested"}},
    msg("assistant", "正在优化，请稍候…", "05:46.473"),
    msg("assistant", "Review 页面 A", "06:25.722"),
    anchor("save_completed", "21:41.569"),
    msg("user", "Save to CawPlan", "22:05.284"),
    msg("assistant", "已保存", "22:37.914"),
  ];
  writeFileSync(jsonl, events.map((e) => JSON.stringify(e)).join("\n"));
  const codexEvent = (id: string, at: string) => ({
    ...outboxEvent(id, at, "c1"),
    session_refs: [{agent: "codex", session_id: "c1", source: "CODEX_SESSION_ID"}],
  });
  writeFileSync(join(dir, "2026-10-13.jsonl"),
    [codexEvent("a", "05:44.406"), codexEvent("b", "21:40.272")].map((e) => JSON.stringify(e)).join("\n"));

  const s = {...session("c1"), agent: "codex"};
  mergeQaHumanInputOutbox([s], "2026-10-13", {dir, warn: vi.fn(), findCodexRolloutPath: () => jsonl});
  expect(s.human_inputs![0].assistant_message).toBe("正在优化，请稍候…\n\nReview 页面 A");
  // The reply after the user's typed "Save to CawPlan" belongs to that chat turn, not the page Save.
  expect(s.human_inputs![1].assistant_message).toBeUndefined();
});
