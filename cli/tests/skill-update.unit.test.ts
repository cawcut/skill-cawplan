import {describe, expect, test} from "vitest";
import {
    buildNpxArgs,
    buildSkillsAddArgs,
    buildSkillsRemoveArgs,
    parseInstalledSkills,
} from "../src/lib/skill-update.js";

describe("buildSkillsAddArgs", () => {
    test("always builds the documented npx skills add invocation", () => {
        expect(buildSkillsAddArgs()).toEqual([
            "skills",
            "add",
            "cawcut/skill-cawplan",
            "-a",
            "cursor",
            "claude-code",
            "codex",
            "-g",
            "-y",
        ]);
    });

    test("limits the install to the given skills", () => {
        expect(buildSkillsAddArgs(["cawplan-my-work", "cawplan-ticket-context"])).toEqual([
            "skills",
            "add",
            "cawcut/skill-cawplan",
            "-a",
            "cursor",
            "claude-code",
            "codex",
            "-s",
            "cawplan-my-work",
            "cawplan-ticket-context",
            "-g",
            "-y",
        ]);
    });
});

describe("buildSkillsRemoveArgs", () => {
    test("removes the named global skills without prompting", () => {
        expect(buildSkillsRemoveArgs(["cawplan-qa-commit"])).toEqual([
            "skills",
            "remove",
            "cawplan-qa-commit",
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

describe("parseInstalledSkills", () => {
    test("keeps only skills installed from the CawPlan repo", () => {
        const stdout = JSON.stringify([
            {name: "cawplan-my-work", source: "cawcut/skill-cawplan"},
            {name: "cawplan-qa-commit", source: "git@github.com:cawcut/skill-cawplan.git"},
            {name: "cawplan-tickets-review", source: null},
            {name: "other-skill", source: "vercel-labs/agent-skills"},
        ]);
        expect(parseInstalledSkills(stdout)).toEqual(["cawplan-my-work", "cawplan-qa-commit"]);
    });
});
