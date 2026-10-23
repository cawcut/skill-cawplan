import {beforeEach, expect, test, vi} from "vitest";
import {uploadQaDailyReport} from "../src/lib/qa-session/reports-api.js";
import {cawplanRequest} from "../src/lib/http.js";
import type {QaDailyApiJson} from "../src/lib/collect/qa-types.js";

vi.mock("../src/lib/http.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("../src/lib/http.js")>(),
    cawplanRequest: vi.fn(async () => ({code: "SUCCESS"})),
}));

function daily(): QaDailyApiJson {
    return {
        schema: "qa-session.1", date: "2026-10-22", author: "tester",
        generated_at: "2026-10-22T00:00:00Z", include_conversation: false,
        totals: {sessions: 1, agents: ["codex"], messages: {user: 1, assistant: 0, tool_calls: 0}, cost: {}},
        usage_breakdown: [], model_usage: {},
        sessions: [{session_id: "one", agent: "codex", ticket_ids: [], ticket_display_ids: [],
            requirement_ids: [], skill_layers: [], models: [],
            testpoint: {added: 0, modified: 0, deleted: 0}, testcase: {added: 0, modified: 0, deleted: 0},
            review_stats: {messages: {user: 1, assistant: 0, tool_calls: 0}, usage_breakdown: []}}],
        human_inputs: [{session_id: "one", content: "QA input"}],
    };
}

beforeEach(() => vi.clearAllMocks());

test("all ignored sessions skip upload without any cloud request", async () => {
    const report = daily();
    report.sessions[0]!.ignored = true;
    expect(await uploadQaDailyReport(report)).toEqual({skipped: true, message: "No QA sessions to upload."});
    expect(cawplanRequest).not.toHaveBeenCalled();
});

test("upload uses active sessions and strips all review metadata", async () => {
    const report = daily();
    report.sessions.push({...report.sessions[0]!, session_id: "ignored", ignored: true});
    report.human_inputs.push({session_id: "ignored", content: "excluded input"});
    await uploadQaDailyReport(report);
    const request = vi.mocked(cawplanRequest).mock.calls[0]![0];
    const payload = request.body as QaDailyApiJson;
    expect(payload.sessions.map((session) => session.session_id)).toEqual(["one"]);
    expect(payload.human_inputs).toEqual([{session_id: "one", content: "QA input"}]);
    expect(JSON.stringify(payload)).not.toMatch(/review_stats|ignored/);
});
