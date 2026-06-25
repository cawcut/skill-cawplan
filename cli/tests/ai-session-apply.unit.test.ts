import {describe, expect, test} from "vitest";
import {applyProductRepoMappingToProject} from "../src/lib/assign/apply";
import type {DailyApiJson} from "../src/lib/collect/types";

function dailyWithSessions(sessions: DailyApiJson["sessions"]): DailyApiJson {
    return {
        schema: "2.0",
        date: "2026-06-24",
        author: "tester",
        generated_at: "2026-06-24T00:00:00.000Z",
        include_conversation: false,
        totals: {sessions: sessions.length, agents: [], messages: {user: 0, assistant: 0, tool_calls: 0}, files_changed: 0, cost: {"$": 0}},
        usage_breakdown: [],
        model_usage: {},
        sessions,
        repos: [],
        human_inputs: [],
    };
}

describe("applyProductRepoMappingToProject", () => {
    test("propagates mapping to sessions sharing the same project key", () => {
        const daily = dailyWithSessions([
            {
                schema: "2.0",
                date: "2026-06-24",
                agent: "cursor-gui",
                source: "gui",
                session_id: "s1",
                session_name: "One",
                session_title: "One",
                project: "flow-cawplan-skill",
                cwd: "/tmp",
                time_range: {display: "", timezone: "UTC", start: "2026-06-24T09:00:00.000Z"},
                model_usage: {},
                usage_breakdown: [],
                files_changed: 0,
                files_added: 0,
                files_deleted: 0,
                repos_touched: [],
                message_stats: {user: 1, assistant: 1, tool_calls: 0},
            },
            {
                schema: "2.0",
                date: "2026-06-24",
                agent: "cursor-gui",
                source: "gui",
                session_id: "s2",
                session_name: "Two",
                session_title: "Two",
                project: "Ubiquiti-UID/flow-cawplan-skill",
                cwd: "/tmp",
                time_range: {display: "", timezone: "UTC", start: "2026-06-24T10:00:00.000Z"},
                model_usage: {},
                usage_breakdown: [],
                files_changed: 0,
                files_added: 0,
                files_deleted: 0,
                repos_touched: [],
                message_stats: {user: 1, assistant: 1, tool_calls: 0},
            },
        ]);

        const updated = applyProductRepoMappingToProject(daily, daily.sessions[0], {
            product_id: "prod-cawplan",
            product_name: "CawPlan",
            repo_name: "flow-cawplan-skill",
            repo_url: "https://github.com/Ubiquiti-UID/flow-cawplan-skill",
        });

        expect(updated).toBe(2);
        expect(daily.sessions[0].product_id).toBe("prod-cawplan");
        expect(daily.sessions[1].product_id).toBe("prod-cawplan");
    });

    test("applies product-only mapping without repo fields", () => {
        const daily = dailyWithSessions([
            {
                schema: "2.0",
                date: "2026-06-24",
                agent: "cursor-gui",
                source: "gui",
                session_id: "s1",
                session_name: "One",
                session_title: "One",
                project: "support-ticket",
                cwd: "/tmp",
                time_range: {display: "", timezone: "UTC", start: "2026-06-24T09:00:00.000Z"},
                model_usage: {},
                usage_breakdown: [],
                files_changed: 0,
                files_added: 0,
                files_deleted: 0,
                repos_touched: [],
                message_stats: {user: 1, assistant: 1, tool_calls: 0},
            },
        ]);

        applyProductRepoMappingToProject(daily, daily.sessions[0], {
            product_id: "prod-support",
            product_name: "Support",
        });

        expect(daily.sessions[0].product_id).toBe("prod-support");
        expect(daily.sessions[0].project).toBe("support-ticket");
    });
});
