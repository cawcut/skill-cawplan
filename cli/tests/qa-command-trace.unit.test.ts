import {existsSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {describe, expect, test} from "vitest";
import {tracesFromBashCommand} from "../src/lib/collect/qa-trace-extract.js";

// S3.2 判据 2: qa-insights Bash command -> QaCommandTrace. Real session
// fcc914fb per 方案 §0.7 线索 2. Depends on this machine's local session
// file, so it's a no-op skip when that file isn't present.
const QA_DIR = join(homedir(), ".claude/projects/-Users-zhenling-zeng-ui-com-Documents-skill-claud");
const SESSION_PATH = join(QA_DIR, "fcc914fb-041a-4ce6-8c2d-f79910c13d0d.jsonl");

describe.skipIf(!existsSync(SESSION_PATH))("tracesFromBashCommand (S3.2)", () => {
    test("parses all 3 qa-insights commands from the real session", () => {
        const traces = tracesFromBashCommand(SESSION_PATH);
        expect(traces).toHaveLength(3);
        expect(traces.map((t) => t.command)).toEqual(["module-tree get", "requirements create", "testpoints archive"]);
    });

    test("extracts the (product_id, requirement_id) pair from testpoints archive", () => {
        const traces = tracesFromBashCommand(SESSION_PATH);
        const archive = traces.find((t) => t.command === "testpoints archive");
        expect(archive).toEqual({
            command: "testpoints archive",
            productId: "019cfa00-8fa1-7000-824d-a9f0ce0b4060",
            requirementId: "01a01dce-e771-7401-89bb-92840869c64b",
            skillLayer: "cawplan-testpoint-generate",
        });
    });

    test("requirements create infers cawplan-requirement-analyze with a single product_id", () => {
        const traces = tracesFromBashCommand(SESSION_PATH);
        const create = traces.find((t) => t.command === "requirements create");
        expect(create).toEqual({
            command: "requirements create",
            productId: "019cfa00-8fa1-7000-824d-a9f0ce0b4060",
            skillLayer: "cawplan-requirement-analyze",
        });
    });

    test("module-tree commands have no inferred skillLayer", () => {
        const traces = tracesFromBashCommand(SESSION_PATH);
        const moduleTree = traces.find((t) => t.command === "module-tree get");
        expect(moduleTree?.skillLayer).toBeUndefined();
    });
});
