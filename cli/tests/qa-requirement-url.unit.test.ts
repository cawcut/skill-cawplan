import {existsSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {describe, expect, test} from "vitest";
import {requirementIdsFromJsonl, requirementRefsFromText} from "../src/lib/collect/qa-requirement-url.js";

const QA_DIR = join(homedir(), ".claude/projects/-Users-zhenling-zeng-ui-com-Documents-skill-claud");

const REAL_SESSION_CASES = [
    {id: "fcc914fb-041a-4ce6-8c2d-f79910c13d0d", expectedRequirementId: "01a01dce-e771-7401-89bb-92840869c64b"},
    {id: "87a6526b-63fa-42a6-bb6e-c3c497b42485", expectedRequirementId: "019ff96a-f34c-7bf2-a5f6-bd7e19386716"},
    {id: "f79fffba-51c6-4ce0-87e8-0d78b732d54f", expectedRequirementId: "01a01dce-e771-7401-89bb-92840869c64b"},
];

const availableCases = REAL_SESSION_CASES.filter((c) => existsSync(join(QA_DIR, `${c.id}.jsonl`)));

describe.skipIf(availableCases.length === 0)("requirementIdsFromJsonl (real sessions)", () => {
    test.each(availableCases)("session $id resolves exactly one requirement_id", ({id, expectedRequirementId}) => {
        const ids = requirementIdsFromJsonl(join(QA_DIR, `${id}.jsonl`));
        expect(ids).toEqual([expectedRequirementId]);
    });
});

describe("requirementRefsFromText", () => {
    test("extracts a single (product_id, requirement_id) pair from a URL", () => {
        const text = "Requirement link: /product/019cfa00-8fa1-7000-824d-a9f0ce0b4060/qa-insights/test-suites/requirements/01a01dce-e771-7401-89bb-92840869c64b";
        expect(requirementRefsFromText(text)).toEqual([
            {productId: "019cfa00-8fa1-7000-824d-a9f0ce0b4060", requirementId: "01a01dce-e771-7401-89bb-92840869c64b"},
        ]);
    });

    test("deduplicates repeated URLs within the same text", () => {
        const url = "/product/019cfa00-8fa1-7000-824d-a9f0ce0b4060/qa-insights/test-suites/requirements/01a01dce-e771-7401-89bb-92840869c64b";
        const text = `First mention: ${url}\nSecond mention: ${url}`;
        expect(requirementRefsFromText(text)).toHaveLength(1);
    });

    test("returns an empty array when no requirement URL is present", () => {
        expect(requirementRefsFromText("just a normal reply with no links")).toEqual([]);
    });
});
