import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterEach, describe, expect, test, vi} from "vitest";
import {buildQaDailyJson} from "../src/lib/collect/aggregators/qa-daily.js";
import * as paths from "../src/lib/collect/paths.js";
import type {SessionData} from "../src/lib/collect/types.js";

/**
 * Reproduces the reported bug: a Cursor GUI QA session (bbd213ac-...) was
 * missing requirement_ids, testpoint.added, and product_id — all three were
 * only ever wired to the Claude Code JSONL trace source. This asserts they
 * now come from the same vscdb receipt as skill_layers, in one pass.
 */
function guiSession(overrides: Partial<SessionData> = {}): SessionData {
    return {
        schema: "2.0",
        date: "2026-08-27",
        agent: "cursor-gui",
        session_id: "bbd213ac-1bcc-4d21-8d54-8180a6cc68f1",
        session_name: "Requirement test points",
        project: "proj",
        cwd: "/tmp",
        time_range: {display: "15:19 - 15:26", timezone: "Asia/Shanghai"},
        model_usage: {},
        usage_breakdown: [],
        files_changed: 0,
        repos_touched: [],
        message_stats: {user: 2, assistant: 6, tool_calls: 6},
        human_inputs: [{content: "生成测试点", session_id: "bbd213ac-1bcc-4d21-8d54-8180a6cc68f1"}],
        ...overrides,
    };
}

describe("buildQaDailyJson (Cursor GUI end-to-end field resolution)", () => {
    const tempRoots: string[] = [];

    afterEach(() => {
        vi.restoreAllMocks();
        for (const root of tempRoots.splice(0)) {
            rmSync(root, {recursive: true, force: true});
        }
    });

    function stageDb(composerId: string): void {
        const root = mkdtempSync(join(tmpdir(), "qa-daily-gui-"));
        tempRoots.push(root);
        const dbPath = join(root, "state.vscdb");
        const db = new DatabaseSync(dbPath);
        db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)");
        db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
            `bubbleId:${composerId}:27aaf017-c800-45d9-bee5-5aebb3df64d3`,
            JSON.stringify({
                toolFormerData: {
                    name: "run_terminal_command_v2",
                    additionalData: {status: "success", startedAtMs: 1000},
                    result: JSON.stringify({
                        output: JSON.stringify({
                            outcome: "SUCCESS",
                            command: "testpoints archive",
                            meta: {
                                product_id: "019cfa00-8fa1-7000-824d-a9f0ce0b4060",
                                requirement_id: "01a04204-90fc-7cf7-925d-f2213e09f522",
                                dry_run: false,
                            },
                            api: {code: "SUCCESS", data: {test_points: [{id: "tp1"}, {id: "tp2"}]}},
                        }),
                    }),
                },
            })
        );
        db.close();
        vi.spyOn(paths, "cursorStateDbCandidates").mockReturnValue([dbPath]);
    }

    test("product_id, requirement_ids, testpoint.added, and skill_layers all resolve from the same GUI archive receipt", () => {
        const sessionId = "bbd213ac-1bcc-4d21-8d54-8180a6cc68f1";
        stageDb(sessionId);

        const daily = buildQaDailyJson([guiSession()], "2026-08-27", "tester");
        expect(daily.sessions).toHaveLength(1);
        const session = daily.sessions[0]!;

        expect(session.product_id).toBe("019cfa00-8fa1-7000-824d-a9f0ce0b4060");
        expect(session.requirement_ids).toEqual(["01a04204-90fc-7cf7-925d-f2213e09f522"]);
        expect(session.testpoint.added).toBe(2);
        expect(session.skill_layers).toEqual(["cawplan-testpoint-generate"]);
    });

    test("cursor-gui session with no matching vscdb rows still gets empty fields (tier 3, manual fill)", () => {
        vi.spyOn(paths, "cursorStateDbCandidates").mockReturnValue(["/nonexistent/state.vscdb"]);

        const daily = buildQaDailyJson([guiSession({session_id: "no-vscdb-data"})], "2026-08-27", "tester");
        const session = daily.sessions[0]!;

        expect(session.product_id).toBeUndefined();
        expect(session.requirement_ids).toEqual([]);
        expect(session.testpoint).toEqual({added: 0, modified: 0, deleted: 0});
        expect(session.skill_layers).toEqual([]);
    });
});
