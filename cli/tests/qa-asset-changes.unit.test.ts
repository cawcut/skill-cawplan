import {existsSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {describe, expect, test} from "vitest";
import {collectQaAssetChanges} from "../src/lib/collect/qa-asset-changes.js";

const QA_DIR = join(homedir(), ".claude/projects/-Users-zhenling-zeng-ui-com-Documents-skill-claud");

const REAL_SESSION_CASES = [
    {id: "fcc914fb-041a-4ce6-8c2d-f79910c13d0d", expectedTestpointAdded: 6},
    {id: "87a6526b-63fa-42a6-bb6e-c3c497b42485", expectedTestpointAdded: 0},
    {id: "f79fffba-51c6-4ce0-87e8-0d78b732d54f", expectedTestpointAdded: 0},
];

const availableCases = REAL_SESSION_CASES.filter((c) => existsSync(join(QA_DIR, `${c.id}.jsonl`)));

describe.skipIf(availableCases.length === 0)("collectQaAssetChanges (real sessions)", () => {
    test.each(availableCases)("session $id resolves the expected testpoint.added", ({id, expectedTestpointAdded}) => {
        const changes = collectQaAssetChanges(join(QA_DIR, `${id}.jsonl`));
        expect(changes.testpoint.added).toBe(expectedTestpointAdded);
    });

    test("A3-only sessions have all six numbers at zero", () => {
        const changes = collectQaAssetChanges(join(QA_DIR, "87a6526b-63fa-42a6-bb6e-c3c497b42485.jsonl"));
        expect(changes).toEqual({
            testpoint: {added: 0, modified: 0, deleted: 0},
            testcase: {added: 0, modified: 0, deleted: 0},
        });
    });
});
