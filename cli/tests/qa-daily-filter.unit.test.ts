import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";

import {join} from "node:path";
import {afterEach, describe, expect, test} from "vitest";
import {filterQaSessions} from "../src/lib/collect/aggregators/qa-daily.js";
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
        ...overrides,
    };
}

// S4.x collect-all + two noise filters. Staged JSONL is only needed when a test
// expects non-empty skill_layers from Claude Code trace extraction.
const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");

describe("filterQaSessions (collect-all + noise filters)", () => {
    let tmpProjectDir: string | undefined;

    afterEach(() => {
        if (tmpProjectDir) rmSync(tmpProjectDir, {recursive: true, force: true});
        tmpProjectDir = undefined;
    });

    function stageClaudeCodeSession(sessionId: string, date: string, events: unknown[]): void {
        tmpProjectDir = mkdtempSync(join(CLAUDE_PROJECTS_DIR, "qa-daily-filter-test-"));
        const jsonlPath = join(tmpProjectDir, `${sessionId}.jsonl`);
        const withTimestamp = events.map((e) => ({timestamp: `${date}T00:00:00.000Z`, ...(e as object)}));
        writeFileSync(jsonlPath, withTimestamp.map((e) => JSON.stringify(e)).join("\n"), "utf-8");
    }

    test("session with no QA skill trace is included with empty skill_layers", () => {
        const session = baseSession({
            session_id: "11111111-1111-1111-1111-111111111111",
            human_inputs: [{category: "direction", content: "hello"}],
        });
        const result = filterQaSessions([session], "2026-08-20");
        expect(result.excluded).toHaveLength(0);
        expect(result.included).toHaveLength(1);
        expect(result.included[0]?.skillLayers).toEqual([]);
    });

    test("cursor-gui session without trace adapter is included with empty skill_layers", () => {
        const session = baseSession({
            agent: "cursor-gui",
            session_id: "55555555-5555-5555-5555-555555555555",
            human_inputs: [{category: "direction", content: "discuss test scope"}],
        });
        const result = filterQaSessions([session], "2026-08-20");
        expect(result.excluded).toHaveLength(0);
        expect(result.included).toHaveLength(1);
        expect(result.included[0]?.skillLayers).toEqual([]);
    });

    test("layer 2: qa-commit-only session is excluded even with a skill trace", () => {
        const sessionId = "22222222-2222-2222-2222-222222222222";
        stageClaudeCodeSession(sessionId, "2026-08-20", [
            {type: "assistant", attributionSkill: "cawplan-testpoint-generate"},
        ]);
        const session = baseSession({
            session_id: sessionId,
            human_inputs: [{category: "direction", content: "cawplan-qa-commit please"}],
        });
        const result = filterQaSessions([session], "2026-08-20");
        expect(result.included).toHaveLength(0);
        expect(result.excluded[0]?.reason).toBe("qa-commit-only");
    });

    test("layer 3: session with a skill trace but no human_input is excluded as no-human-input", () => {
        const sessionId = "33333333-3333-3333-3333-333333333333";
        stageClaudeCodeSession(sessionId, "2026-08-20", [
            {type: "assistant", attributionSkill: "cawplan-requirement-analyze"},
        ]);
        const session = baseSession({session_id: sessionId, human_inputs: []});
        const result = filterQaSessions([session], "2026-08-20");
        expect(result.included).toHaveLength(0);
        expect(result.excluded[0]?.reason).toBe("no-human-input");
    });

    test("session with skill trace and human_input is included with its skill_layers", () => {
        const sessionId = "44444444-4444-4444-4444-444444444444";
        stageClaudeCodeSession(sessionId, "2026-08-20", [
            {type: "assistant", attributionSkill: "cawplan-testcase-generate"},
        ]);
        const session = baseSession({
            session_id: sessionId,
            human_inputs: [{category: "direction", content: "generate test cases"}],
        });
        const result = filterQaSessions([session], "2026-08-20");
        expect(result.excluded).toHaveLength(0);
        expect(result.included).toHaveLength(1);
        expect(result.included[0]?.skillLayers).toEqual(["cawplan-testcase-generate"]);
    });
});
