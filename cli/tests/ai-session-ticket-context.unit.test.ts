import {describe, expect, test} from "vitest";
import {
    applyHumanInputTicketRefsToSessions,
    extractTicketRefsFromHumanInputs,
    normalizeSessionTicketIdsToUniqueIds,
    ticketContextIsResolved,
    ticketDisplayIdFromRef,
} from "../src/lib/ai-session/ticket-context";
import type {DailyApiJson, SessionData} from "../src/lib/collect/types";

function dailyReport(): DailyApiJson {
    return {
        schema: "2.0",
        date: "2026-07-09",
        author: "tester@example.com",
        generated_at: "2026-07-09T00:00:00.000Z",
        include_conversation: false,
        totals: {
            sessions: 2,
            agents: ["codex"],
            messages: {user: 2, assistant: 2, tool_calls: 0},
            files_changed: 1,
            cost: {"$": 0},
        },
        usage_breakdown: [],
        model_usage: {},
        repos: [],
        sessions: [
            {
                schema: "2.0",
                date: "2026-07-09",
                agent: "codex",
                session_id: "s1",
                session_name: "One",
                project: "repo",
                cwd: "/tmp/repo",
                time_range: {display: "", timezone: "UTC"},
                model_usage: {},
                usage_breakdown: [],
                files_changed: 1,
                repos_touched: [],
                message_stats: {user: 1, assistant: 1, tool_calls: 0},
                human_inputs: [
                    {category: "direction", content: "Build ticket context", session_id: "s1"},
                ],
            },
            {
                schema: "2.0",
                date: "2026-07-09",
                agent: "codex",
                session_id: "s2",
                session_name: "Two",
                project: "repo",
                cwd: "/tmp/repo",
                time_range: {display: "", timezone: "UTC"},
                model_usage: {},
                usage_breakdown: [],
                files_changed: 0,
                repos_touched: [],
                message_stats: {user: 1, assistant: 1, tool_calls: 0},
            },
        ],
        human_inputs: [
            {category: "direction", content: "Build ticket context", session_id: "s1"},
            {category: "planning", content: "Plan unrelated work", session_id: "s2"},
        ],
    };
}

describe("ai-session ticket context", () => {
    test("extracts ticket display IDs from CawPlan issue URL refs", () => {
        expect(ticketDisplayIdFromRef("https://app.cawplan.com/issue/CWP-14471"))
            .toBe("CWP-14471");
    });

    test("extracts ticket display IDs from product issue URL refs", () => {
        expect(ticketDisplayIdFromRef("https://core-web-product.uid.dev.ui.com/issue/CAW-04560"))
            .toBe("CAW-04560");
    });

    test("extracts ticket refs from human input fields and text", () => {
        const refs = extractTicketRefsFromHumanInputs([
            {
                category: "direction",
                content: "Continue ticket_display_id: CWP-14471 and https://app.cawplan.com/issue/CAW-04560",
                ticket_id: "ticket-14471",
                session_id: "s1",
            },
            {
                category: "planning",
                content: "Plain display ID CAW-04561 should also link",
                ticket_display_ids: ["CAW-04562"],
                session_id: "s1",
            },
        ]);

        expect(new Set(refs)).toEqual(new Set(["ticket-14471", "CWP-14471", "CAW-04560", "CAW-04561", "CAW-04562"]));
    });

    test("does not treat fallback display ID contexts as resolved tickets", () => {
        expect(ticketContextIsResolved({
            ticket_id: "CWP-14471",
            ticket_display_id: "CWP-14471",
            url: "https://app.cawplan.com/issue/CWP-14471",
        })).toBe(false);
        expect(ticketContextIsResolved({
            ticket_id: "ticket-14471",
            ticket_display_id: "CWP-14471",
        })).toBe(true);
    });

    test("applies human input ticket refs to only the session that mentioned them", async () => {
        const sessions: SessionData[] = [{
            schema: "2.0",
            date: "2026-07-09",
            agent: "codex",
            session_id: "s1",
            session_name: "One",
            project: "repo",
            cwd: "/tmp/repo",
            time_range: {display: "", timezone: "UTC", start: "2026-07-09T10:00:00.000Z"},
            model_usage: {},
            usage_breakdown: [],
            files_changed: 1,
            repos_touched: [],
            message_stats: {user: 1, assistant: 1, tool_calls: 0},
            human_inputs: [
                {
                    category: "direction",
                    content: "Implement ticket work",
                    session_id: "s1",
                    start_time: "2026-07-09T10:01:00.000Z",
                    end_time: "2026-07-09T10:05:00.000Z",
                },
            ],
        }, {
            schema: "2.0",
            date: "2026-07-09",
            agent: "codex",
            session_id: "s2",
            session_name: "Two",
            project: "repo",
            cwd: "/tmp/repo",
            time_range: {display: "", timezone: "UTC", start: "2026-07-09T11:00:00.000Z"},
            model_usage: {},
            usage_breakdown: [],
            files_changed: 1,
            repos_touched: [],
            message_stats: {user: 1, assistant: 1, tool_calls: 0},
            human_inputs: [
                {
                    category: "direction",
                    content: "Unrelated work",
                    session_id: "s2",
                },
            ],
        }];

        sessions[0]!.human_inputs![0]!.content = "Implement ticket_display_id: CWP-14471";

        const applied = await applyHumanInputTicketRefsToSessions(sessions, async () => [{
            ticket_id: "ticket-14471",
            ticket_display_id: "CWP-14471",
            title: "Ticket context",
        }]);

        expect(applied).toBe(1);
        expect(sessions[0]?.ticket_ids).toEqual(["ticket-14471"]);
        expect(sessions[0]?.ticket_display_ids).toEqual(["CWP-14471"]);
        expect(sessions[1]?.ticket_ids).toBeUndefined();
        expect("ticket_ids" in sessions[0]!.human_inputs![0]!).toBe(false);
    });

    test("keeps human input ticket refs from a different product for web review", async () => {
        const sessions = dailyReport().sessions;
        sessions[0]!.product_id = "product-a";
        sessions[0]!.human_inputs = [{
            category: "direction",
            content: "Implement ticket_display_id: CWP-14471",
            session_id: "s1",
        }];

        const applied = await applyHumanInputTicketRefsToSessions(sessions, async () => [{
            ticket_id: "ticket-14471",
            ticket_display_id: "CWP-14471",
            product_id: "product-b",
        }]);

        expect(applied).toBe(1);
        expect(sessions[0]?.ticket_ids).toEqual(["ticket-14471"]);
        expect(sessions[0]?.ticket_display_ids).toEqual(["CWP-14471"]);
    });

    test("skips human input ticket refs that were not found in cloud", async () => {
        const sessions = dailyReport().sessions;
        sessions[0]!.human_inputs = [{
            category: "direction",
            content: "Implement ticket_display_id: CWP-00000",
            session_id: "s1",
        }];

        const applied = await applyHumanInputTicketRefsToSessions(sessions, async () => [{
            ticket_id: "CWP-00000",
            ticket_display_id: "CWP-00000",
            url: "https://app.cawplan.com/issue/CWP-00000",
        }]);

        expect(applied).toBe(0);
        expect(sessions[0]?.ticket_ids).toBeUndefined();
        expect(sessions[0]?.ticket_display_ids).toBeUndefined();
    });

    test("does not use stored context when human inputs have no ticket refs", async () => {
        const sessions: SessionData[] = [{
            schema: "2.0",
            date: "2026-07-09",
            agent: "codex",
            session_id: "s1",
            session_name: "One",
            project: "repo",
            cwd: "/tmp/repo",
            time_range: {display: "", timezone: "UTC", start: "2026-07-09T10:00:00.000Z"},
            model_usage: {},
            usage_breakdown: [],
            files_changed: 1,
            repos_touched: [],
            message_stats: {user: 1, assistant: 1, tool_calls: 0},
            human_inputs: [
                {
                    category: "direction",
                    content: "Continue CWP-14471 today",
                    session_id: "s1",
                    start_time: "2026-07-09T10:01:00.000Z",
                    end_time: "2026-07-09T10:05:00.000Z",
                },
            ],
        }];

        sessions[0]!.human_inputs![0]!.content = "Continue regular work today";

        const applied = await applyHumanInputTicketRefsToSessions(sessions, async () => {
            throw new Error("resolver should not run");
        });

        expect(applied).toBe(0);
        expect(sessions[0]?.ticket_ids).toBeUndefined();
        expect("ticket_contexts" in sessions[0]!).toBe(false);
        expect("ticket_ids" in sessions[0]!.human_inputs![0]!).toBe(false);
    });

    test("normalizes display ticket IDs to unique ticket IDs", async () => {
        const sessions = dailyReport().sessions;
        sessions[0]!.ticket_ids = ["CWP-14472", "ticket-existing"];
        sessions[1]!.ticket_ids = ["CWP-14472"];

        const normalized = await normalizeSessionTicketIdsToUniqueIds(sessions, async () => [{
            ticket_id: "ticket-14472",
            ticket_display_id: "CWP-14472",
        }]);

        expect(normalized).toBe(2);
        expect(sessions[0]?.ticket_ids).toEqual(["ticket-14472", "ticket-existing"]);
        expect(sessions[0]?.ticket_display_ids).toEqual(["CWP-14472"]);
        expect(sessions[1]?.ticket_ids).toEqual(["ticket-14472"]);
        expect(sessions[1]?.ticket_display_ids).toEqual(["CWP-14472"]);
    });

    test("drops unresolved display ticket IDs during normalization", async () => {
        const sessions = dailyReport().sessions;
        sessions[0]!.ticket_ids = ["CWP-14472", "ticket-existing"];

        const normalized = await normalizeSessionTicketIdsToUniqueIds(sessions, async () => []);

        expect(normalized).toBe(1);
        expect(sessions[0]?.ticket_ids).toEqual(["ticket-existing"]);
    });

    test("drops display ticket IDs resolved to a different product", async () => {
        const sessions = dailyReport().sessions;
        sessions[0]!.product_id = "product-a";
        sessions[0]!.ticket_ids = ["CWP-14472", "ticket-existing"];

        const normalized = await normalizeSessionTicketIdsToUniqueIds(sessions, async () => [{
            ticket_id: "ticket-14472",
            ticket_display_id: "CWP-14472",
            product_id: "product-b",
        }]);

        expect(normalized).toBe(1);
        expect(sessions[0]?.ticket_ids).toEqual(["ticket-existing"]);
        expect(sessions[0]?.ticket_display_ids).toBeUndefined();
    });
});
