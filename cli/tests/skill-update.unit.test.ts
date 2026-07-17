import {describe, expect, test} from "vitest";
import {buildNpxArgs, buildSkillsAddArgs} from "../src/lib/skill-update.js";

describe("buildSkillsAddArgs", () => {
    test("always builds the documented npx skills add invocation", () => {
        expect(buildSkillsAddArgs()).toEqual([
            "skills",
            "add",
            "Ubiquiti-UID/flow-cawplan-skill",
            "-a",
            "cursor",
            "claude-code",
            "codex",
            "-g",
            "-y",
        ]);
    });
});

describe("buildNpxArgs", () => {
    test("prefixes --yes so npx never blocks on its own install prompt", () => {
        const args = buildNpxArgs();
        expect(args[0]).toBe("--yes");
        expect(args.slice(1)).toEqual(buildSkillsAddArgs());
    });
});
