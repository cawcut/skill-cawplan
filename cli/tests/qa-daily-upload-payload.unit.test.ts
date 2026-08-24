import {describe, expect, test} from "vitest";
import type {QaDailyApiJson, QaSessionData} from "../src/lib/collect/qa-types.js";
import type {SessionData} from "../src/lib/collect/types.js";
import {buildQaDailyJson, toQaUploadPayload} from "../src/lib/collect/aggregators/qa-daily.js";

function minimalSession(overrides: Partial<SessionData> = {}): SessionData {
    return {
        schema: "2.0",
        date: "2026-08-20",
        agent: "claude-code",
        session_id: "sess-1",
        session_name: "Test session",
        project: "proj",
        cwd: "/tmp",
        time_range: {
            display: "14:09 - 14:12",
            timezone: "Asia/Shanghai",
            start: "2026-08-20T06:09:21.460Z",
        },
        model_usage: {},
        usage_breakdown: [],
        files_changed: 0,
        repos_touched: [],
        message_stats: {user: 1, assistant: 1, tool_calls: 0},
        human_inputs: [{content: "analyze requirement", session_id: "sess-1"}],
        ...overrides,
    };
}

function minimalDaily(session: QaSessionData): QaDailyApiJson {
    return {
        schema: "qa-session.1",
        date: "2026-08-20",
        author: "tester",
        generated_at: "2026-08-20T00:00:00.000Z",
        include_conversation: false,
        totals: {
            sessions: 1,
            agents: [session.agent],
            messages: {user: 1, assistant: 1, tool_calls: 0},
            cost: {$: 0},
        },
        usage_breakdown: [],
        model_usage: {},
        sessions: [session],
        human_inputs: [],
    };
}

describe("QA daily display_time_range", () => {
    test("buildQaDailyJson copies time_range start/display into display_time_range", () => {
        const daily = buildQaDailyJson([minimalSession()], "2026-08-20", "tester");
        expect(daily.sessions[0]?.display_time_range).toEqual({
            start: "2026-08-20T06:09:21.460Z",
            display: "14:09 - 14:12",
        });
    });

    test("toQaUploadPayload omits display_time_range from serialized upload body", () => {
        const session: QaSessionData = {
            session_id: "sess-1",
            agent: "claude-code",
            ticket_ids: [],
            ticket_display_ids: [],
            requirement_ids: [],
            skill_layers: [],
            testpoint: {added: 0, modified: 0, deleted: 0},
            testcase: {added: 0, modified: 0, deleted: 0},
            display_time_range: {start: "2026-08-20T06:09:21.460Z", display: "14:09 - 14:12"},
        };
        const upload = toQaUploadPayload(minimalDaily(session));
        const serialized = JSON.stringify(upload);
        expect(serialized).not.toContain("display_time_range");
        expect(upload.sessions[0]).not.toHaveProperty("display_time_range");
        expect(upload.sessions[0]?.session_id).toBe("sess-1");
    });
});
