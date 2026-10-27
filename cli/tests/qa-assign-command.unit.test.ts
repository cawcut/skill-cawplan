import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {Command} from "commander";
import {registerSessionCommand} from "../src/commands/session.js";
import * as qaWebServer from "../src/lib/qa-assign/qa-web-server.js";
import {
    readQaExcludedSessions,
    writeQaDailyReport,
    writeQaExcludedSessions,
} from "../src/lib/qa-assign/qa-report-io.js";
import type {QaDailyApiJson} from "../src/lib/collect/qa-types.js";

function sampleDaily(): QaDailyApiJson {
    return {
        schema: "qa-session.1",
        date: "2026-08-20",
        author: "tester",
        generated_at: "2026-08-20T00:00:00.000Z",
        include_conversation: false,
        totals: {
            sessions: 1,
            agents: ["claude-code"],
            messages: {user: 1, assistant: 1, tool_calls: 0},
            cost: {USD: 0},
        },
        usage_breakdown: [],
        model_usage: {},
        sessions: [{
            session_id: "11111111-1111-1111-1111-111111111111",
            agent: "claude-code",
            ticket_ids: [],
            ticket_display_ids: [],
            requirement_ids: [],
            skill_layers: [],
            testpoint: {added: 0, modified: 0, deleted: 0},
            testcase: {added: 0, modified: 0, deleted: 0},
        }],
        human_inputs: [],
    };
}

describe("session qa-assign command", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "qa-assign-cmd-test-"));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        rmSync(tmpDir, {recursive: true, force: true});
    });

    test("opens QA assignment from an existing daily file and excluded sidecar", async () => {
        const dailyPath = join(tmpDir, "qa-daily-2026-08-20.json");
        const daily = sampleDaily();
        writeQaDailyReport(dailyPath, daily);
        writeQaExcludedSessions(dailyPath, [{
            session_id: "22222222-2222-2222-2222-222222222222",
            agent: "cursor-gui",
            reason: "qa-commit-only",
        }]);

        const start = vi.spyOn(qaWebServer, "startQaAssignmentWebServer").mockResolvedValue(undefined);

        const program = new Command();
        program.exitOverride();
        registerSessionCommand(program);
        await program.parseAsync(
            ["node", "cawplan", "session", "qa-assign", "--file", dailyPath],
            {from: "node"},
        );

        expect(start).toHaveBeenCalledTimes(1);
        expect(start).toHaveBeenCalledWith({
            file: dailyPath,
            daily,
            excludedSessions: readQaExcludedSessions(dailyPath),
        });
    });
});
