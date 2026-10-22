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


describe("QA report ignore upload filtering", () => {
    test("filters sessions and human inputs, recomputes usage, and restores without duplicates", () => {
        const bucket = (cost: number) => ({
            model: "test-model", speed: "standard", service_tier: "default", effort: "default",
            api_calls: 1, input_tokens: 10, output_tokens: 20,
            cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost, currency: "$",
        });
        const daily = buildQaDailyJson([
            minimalSession({usage_breakdown: [bucket(2)]}),
            minimalSession({session_id: "sess-2", agent: "codex", usage_breakdown: [bucket(3)],
                human_inputs: [{content: "second session", session_id: "sess-2"}]}),
        ], "2026-08-20", "tester");
        const original = toQaUploadPayload(daily);
        daily.sessions[0]!.ignored = true;
        const beforeUpload = JSON.stringify(daily);
        const upload = toQaUploadPayload(daily);
        expect(upload.sessions.map((session) => session.session_id)).toEqual(["sess-2"]);
        expect(upload.human_inputs.map((input) => input.session_id)).toEqual(["sess-2"]);
        expect(upload.totals.sessions).toBe(1);
        expect(upload.totals.agents).toEqual(["codex"]);
        expect(upload.totals.messages).toEqual({user: 1, assistant: 1, tool_calls: 0});
        expect(upload.totals.cost).toEqual({"$": 3});
        expect(upload.usage_breakdown[0]?.cost).toBe(3);
        expect(upload.model_usage["test-model"]?.cost).toBe(3);
        expect(JSON.stringify(upload)).not.toMatch(/review_stats|ignored|display_time_range/);
        expect(JSON.stringify(daily)).toBe(beforeUpload);
        delete daily.sessions[0]!.ignored;
        expect(toQaUploadPayload(daily)).toEqual(original);
        daily.sessions.forEach((session) => session.ignored = true);
        expect(toQaUploadPayload(daily).sessions).toEqual([]);
        expect(toQaUploadPayload(daily).human_inputs).toEqual([]);
        expect(toQaUploadPayload(daily).totals.messages.user).toBe(0);
        expect(buildQaDailyJson([minimalSession()], daily.date, daily.author).sessions[0]?.ignored).toBeUndefined();
    });

    test("old reports keep existing uploads; ignore requires fresh collection for accurate totals", () => {
        const daily = buildQaDailyJson([minimalSession()], "2026-08-20", "tester");
        delete daily.sessions[0]!.review_stats;
        expect(toQaUploadPayload(daily).totals).toEqual(daily.totals);
        daily.sessions[0]!.ignored = true;
        expect(() => toQaUploadPayload(daily)).toThrow("Re-collect this date");
    });
});
