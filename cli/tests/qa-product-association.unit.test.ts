import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, test} from "vitest";
import {buildQaDailyJson} from "../src/lib/collect/aggregators/qa-daily.js";
import {SessionData} from "../src/lib/collect/types.js";

function baseSession(overrides: Partial<SessionData>): SessionData {
    return {
        schema: "2.0",
        date: "2026-08-20",
        agent: "claude-code",
        session_id: "00000000-0000-0000-0000-000000000000",
        session_name: "untitled",
        project: "p",
        cwd: "/tmp",
        time_range: {display: "unknown", timezone: "UTC"},
        model_usage: {},
        usage_breakdown: [],
        files_changed: 0,
        repos_touched: [],
        message_stats: {user: 0, assistant: 0, tool_calls: 0},
        human_inputs: [{category: "direction", content: "hello"}],
        ...overrides,
    };
}

const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");

// Product association (S4.1, design §3.5): tier 1 is the structured stdout
// receipt's product_id, tier 2 is a requirement URL found in the
// conversation, tier 3 leaves product_id unset for manual web assignment.
describe("product association (S4.1)", () => {
    let tmpProjectDir: string | undefined;

    afterEach(() => {
        if (tmpProjectDir) rmSync(tmpProjectDir, {recursive: true, force: true});
        tmpProjectDir = undefined;
    });

    function stageClaudeCodeSession(sessionId: string, date: string, events: unknown[]): void {
        tmpProjectDir = mkdtempSync(join(CLAUDE_PROJECTS_DIR, "qa-product-association-test-"));
        const jsonlPath = join(tmpProjectDir, `${sessionId}.jsonl`);
        const withTimestamp = events.map((e) => ({timestamp: `${date}T00:00:00.000Z`, ...(e as object)}));
        writeFileSync(jsonlPath, withTimestamp.map((e) => JSON.stringify(e)).join("\n"), "utf-8");
    }

    const PRODUCT_FROM_STDOUT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const PRODUCT_FROM_URL = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const REQUIREMENT_1 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const REQUIREMENT_2 = "dddddddd-dddd-dddd-dddd-dddddddddddd";

    test("tier 1: stdout receipt's product_id wins even when a different one appears in a URL", () => {
        const sessionId = "11111111-1111-1111-1111-111111111111";
        stageClaudeCodeSession(sessionId, "2026-08-20", [
            {type: "assistant", attributionSkill: "cawplan-testpoint-generate"},
            {
                type: "user",
                toolUseResult: {
                    stdout: JSON.stringify({
                        command: "testpoints archive",
                        outcome: "SUCCESS",
                        meta: {product_id: PRODUCT_FROM_STDOUT, requirement_id: REQUIREMENT_1, dry_run: false},
                        api: {data: {test_points: [{id: "tp-1"}]}},
                    }),
                },
            },
            {
                type: "assistant",
                message: {
                    content: [
                        {
                            type: "text",
                            text: `See /product/${PRODUCT_FROM_URL}/qa-insights/test-suites/requirements/${REQUIREMENT_2}`,
                        },
                    ],
                },
            },
        ]);
        const session = baseSession({session_id: sessionId});
        const result = buildQaDailyJson([session], "2026-08-20", "tester");
        expect(result.sessions).toHaveLength(1);
        expect(result.sessions[0]?.product_id).toBe(PRODUCT_FROM_STDOUT);
    });

    test("tier 2: falls back to the requirement URL when no stdout receipt carries product_id or requirement_id", () => {
        const sessionId = "22222222-2222-2222-2222-222222222222";
        stageClaudeCodeSession(sessionId, "2026-08-20", [
            {type: "assistant", attributionSkill: "cawplan-testpoint-generate"},
            {
                type: "assistant",
                message: {
                    content: [
                        {
                            type: "text",
                            text: `See /product/${PRODUCT_FROM_URL}/qa-insights/test-suites/requirements/${REQUIREMENT_2}`,
                        },
                    ],
                },
            },
        ]);
        const session = baseSession({session_id: sessionId});
        const result = buildQaDailyJson([session], "2026-08-20", "tester");
        expect(result.sessions).toHaveLength(1);
        expect(result.sessions[0]?.product_id).toBe(PRODUCT_FROM_URL);
        expect(result.sessions[0]?.requirement_ids).toEqual([REQUIREMENT_2]);
    });

    test("tier 3: leaves product_id unset when neither source is present", () => {
        const sessionId = "33333333-3333-3333-3333-333333333333";
        stageClaudeCodeSession(sessionId, "2026-08-20", [
            {type: "assistant", attributionSkill: "cawplan-testpoint-generate"},
        ]);
        const session = baseSession({session_id: sessionId});
        const result = buildQaDailyJson([session], "2026-08-20", "tester");
        expect(result.sessions).toHaveLength(1);
        expect(result.sessions[0]?.product_id).toBeUndefined();
    });

    test("requirements create adds api.data.id to the daily requirement_ids", () => {
        const sessionId = "44444444-4444-4444-4444-444444444444";
        stageClaudeCodeSession(sessionId, "2026-08-20", [
            {
                type: "user",
                toolUseResult: {
                    stdout: JSON.stringify({
                        command: "requirements create",
                        outcome: "SUCCESS",
                        meta: {product_id: PRODUCT_FROM_STDOUT, dry_run: false},
                        api: {data: {id: REQUIREMENT_1}},
                    }),
                },
            },
        ]);

        const session = baseSession({session_id: sessionId});
        const result = buildQaDailyJson([session], "2026-08-20", "tester");
        expect(result.sessions[0]?.requirement_ids).toEqual([REQUIREMENT_1]);
    });

    test("Codex falls back to an explicit requirement URL in human inputs", () => {
        const session = baseSession({
            agent: "codex",
            human_inputs: [{
                category: "direction",
                content: `Generate test points for /product/${PRODUCT_FROM_URL}/qa-insights/test-suites/requirements/${REQUIREMENT_2}`,
            }],
        });

        const result = buildQaDailyJson([session], "2026-08-20", "tester");
        expect(result.sessions[0]?.requirement_ids).toEqual([REQUIREMENT_2]);
    });
});
