import {existsSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, test} from "vitest";
import {layersFromAttributionSkill, QA_SKILLS} from "../src/lib/collect/qa-trace-extract.js";

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
