import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, test} from "vitest";
import {layersFromAttributionSkill, QA_SKILLS, tracesFromCodexToolOutputs, tracesFromCursorAgentTerminalFiles, tracesFromToolResultStdout} from "../src/lib/collect/qa-trace-extract.js";

// S3.1 判据 1: attributionSkill -> skill_layers[]. Real QA sessions per
// 方案 §0.7 实测表. Depends on this machine's local Claude Code session
// files, so it's a no-op skip when those files aren't present.
const QA_DIR = join(homedir(), ".claude/projects/-Users-zhenling-zeng-ui-com-Documents-skill-claud");

const REAL_SESSION_CASES: Array<{id: string; expected: string[]}> = [
    {id: "fcc914fb-041a-4ce6-8c2d-f79910c13d0d", expected: ["cawplan-requirement-analyze", "cawplan-testpoint-generate"]},
    {id: "87a6526b-63fa-42a6-bb6e-c3c497b42485", expected: ["cawplan-testcase-generate"]},
    {id: "f79fffba-51c6-4ce0-87e8-0d78b732d54f", expected: ["cawplan-testcase-generate"]},
];

const availableCases = REAL_SESSION_CASES.filter((c) => existsSync(join(QA_DIR, `${c.id}.jsonl`)));

describe.skipIf(availableCases.length === 0)("layersFromAttributionSkill (S3.1)", () => {
    test.each(availableCases)("session $id resolves expected skill_layers", ({id, expected}) => {
        const got = layersFromAttributionSkill(join(QA_DIR, `${id}.jsonl`));
        expect(got).toEqual([...expected].sort());
    });

    test("non-QA skill (cawplan-coding-commit) is not in the whitelist", () => {
        expect(QA_SKILLS).not.toContain("cawplan-coding-commit");
    });
});

describe("layersFromAttributionSkill whitelist filtering", () => {
    let tmpDir: string | undefined;

    afterEach(() => {
        if (tmpDir) rmSync(tmpDir, {recursive: true, force: true});
        tmpDir = undefined;
    });

    test("non-QA attributionSkill values are filtered out", () => {
        tmpDir = mkdtempSync(join(tmpdir(), "qa-trace-extract-"));
        const jsonlPath = join(tmpDir, "synthetic.jsonl");
        const lines = [
            {type: "assistant", attributionSkill: "cawplan-coding-commit"},
            {type: "assistant", attributionSkill: "cawplan-testpoint-generate"},
            {type: "user", attributionSkill: "cawplan-requirement-analyze"}, // wrong event type, ignored
        ];
        writeFileSync(jsonlPath, lines.map((l) => JSON.stringify(l)).join("\n"), "utf-8");

        expect(layersFromAttributionSkill(jsonlPath)).toEqual(["cawplan-testpoint-generate"]);
    });
});

describe("tracesFromToolResultStdout Node warning prefix", () => {
    let tmpDir: string | undefined;

    afterEach(() => {
        if (tmpDir) rmSync(tmpDir, {recursive: true, force: true});
        tmpDir = undefined;
    });

    test("parses the JSON receipt even when Node prints an ExperimentalWarning before it", () => {
        tmpDir = mkdtempSync(join(tmpdir(), "qa-trace-extract-"));
        const jsonlPath = join(tmpDir, "synthetic.jsonl");
        const receipt = {
            outcome: "SUCCESS",
            command: "testpoints archive",
            meta: {product_id: "p1", requirement_id: "r1", dry_run: false},
            api: {data: {test_points: [{id: "tp1"}, {id: "tp2"}]}},
        };
        const stdout =
            "(node:12345) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n" +
            "(Use `node --trace-warnings ...` to show where the warning was created)\n" +
            JSON.stringify(receipt);
        const lines = [{type: "user", toolUseResult: {stdout}}];
        writeFileSync(jsonlPath, lines.map((l) => JSON.stringify(l)).join("\n"), "utf-8");

        const traces = tracesFromToolResultStdout(jsonlPath);
        expect(traces).toEqual([
            {
                command: "testpoints archive",
                outcome: "SUCCESS",
                productId: "p1",
                requirementId: "r1",
                dryRun: false,
                landedCount: 2,
                reconcileDecision: undefined,
                batchSize: undefined,
                skillLayer: "cawplan-testpoint-generate",
            },
        ]);
    });

    test("parses an archive receipt embedded in HTML review server output", () => {
        tmpDir = mkdtempSync(join(tmpdir(), "qa-trace-extract-"));
        const jsonlPath = join(tmpDir, "synthetic-html-review.jsonl");
        const receipt = {
            outcome: "SUCCESS",
            command: "testpoints archive",
            meta: {product_id: "p1", requirement_id: "r1", dry_run: false},
            api: {data: {test_points: [{id: "tp1"}, {id: "tp2"}, {id: "tp3"}]}},
        };
        const stdout =
            "Open this URL to review test points: http://127.0.0.1:5000/?token=abc\n" +
            "Waiting... press Ctrl+C to stop the local server.\n" +
            JSON.stringify(receipt) +
            "\nOptimization requested; review is saved and locked. Closing local server.\n\n[exited with code 0]";
        writeFileSync(jsonlPath, JSON.stringify({type: "user", toolUseResult: {stdout}}), "utf-8");

        expect(tracesFromToolResultStdout(jsonlPath)).toMatchObject([
            {command: "testpoints archive", outcome: "SUCCESS", landedCount: 3},
        ]);
    });
});

describe("tracesFromCursorAgentTerminalFiles", () => {
    let tmpDir: string | undefined;
    let originalCursorHome: string | undefined;

    afterEach(() => {
        if (originalCursorHome === undefined) delete process.env.CURSOR_HOME;
        else process.env.CURSOR_HOME = originalCursorHome;
        if (tmpDir) rmSync(tmpDir, {recursive: true, force: true});
        tmpDir = undefined;
    });

    test("reads a page-save receipt from the terminal explicitly read by the Cursor Agent session", () => {
        tmpDir = mkdtempSync(join(tmpdir(), "cursor-agent-terminal-"));
        originalCursorHome = process.env.CURSOR_HOME;
        process.env.CURSOR_HOME = tmpDir;
        const sessionId = "cursor-agent-session";
        const projectDir = join(tmpDir, "projects", "project-a");
        const transcript = join(projectDir, "agent-transcripts", sessionId, `${sessionId}.jsonl`);
        const terminal = join(projectDir, "terminals", "123.txt");
        mkdirSync(join(projectDir, "agent-transcripts", sessionId), {recursive: true});
        mkdirSync(join(projectDir, "terminals"), {recursive: true});
        writeFileSync(
            transcript,
            JSON.stringify({
                role: "assistant",
                message: {content: [{type: "tool_use", name: "Read", input: {path: terminal}}]},
            }),
            "utf8",
        );
        writeFileSync(
            terminal,
            "Open this URL to review test points\n" + JSON.stringify({
                outcome: "SUCCESS",
                command: "testpoints archive",
                meta: {product_id: "p1", requirement_id: "r1", dry_run: false},
                api: {data: {test_points: [{id: "1"}, {id: "2"}]}},
            }) + "\nClosing local server.",
            "utf8",
        );

        expect(tracesFromCursorAgentTerminalFiles(sessionId)).toMatchObject([
            {command: "testpoints archive", outcome: "SUCCESS", landedCount: 2},
        ]);
    });
});

describe("tracesFromCodexToolOutputs", () => {
    test("unwraps a write_stdin result before parsing its terminal archive receipt", () => {
        const receipt = {
            outcome: "SUCCESS",
            command: "testpoints archive",
            meta: {product_id: "p1", requirement_id: "r1", dry_run: false},
            api: {data: {test_points: [{id: "tp1"}]}},
        };
        const codexToolOutput = JSON.stringify({
            exit_code: 0,
            output: `Open this URL to review test points\n${JSON.stringify(receipt)}\nClosing local server.`,
        });

        expect(tracesFromCodexToolOutputs([codexToolOutput])).toMatchObject([
            {command: "testpoints archive", outcome: "SUCCESS", landedCount: 1},
        ]);
    });
});
