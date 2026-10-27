import {describe, expect, test} from "vitest";
import {
    allRoleSkills,
    detectRoles,
    loadSkillRolesConfig,
    parseRoleList,
    skillsForRoles,
    skillsToPrune,
} from "../src/lib/skill-roles.js";

const config = loadSkillRolesConfig();

describe("skillsForRoles", () => {
    test("owner gets every role skill and no optional skill", () => {
        const owner = skillsForRoles(config, ["owner"]);
        expect(owner).toEqual(allRoleSkills(config));
        for (const optional of config.optional) expect(owner).not.toContain(optional);
    });

    test("non-viewer roles include the common skills", () => {
        const rd = skillsForRoles(config, ["rd"]);
        for (const common of config.common) expect(rd).toContain(common);
        expect(rd).toContain("cawplan-coding-commit");
        expect(rd).not.toContain("cawplan-testpoint-generate");
    });

    test("viewer gets only read-oriented skills, not the common write skills", () => {
        const viewer = skillsForRoles(config, ["viewer"]);
        expect(viewer).not.toContain("cawplan-ticket-create");
        expect(viewer).toContain("cawplan-ticket-context");
        expect(viewer).toContain("cawplan-plan-track");
    });

    test("multiple roles are unioned without duplicates", () => {
        const skills = skillsForRoles(config, ["pm", "qa"]);
        expect(skills.filter((s) => s === "cawplan-risk-assessment")).toHaveLength(1);
        expect(skills).toContain("cawplan-plan-create");
        expect(skills).toContain("cawplan-defect-ticket");
    });

    test("every mapped skill exists in the repo skill list shape", () => {
        for (const skill of allRoleSkills(config)) expect(skill).toMatch(/^cawplan-[a-z0-9-]+$/);
    });
});

describe("parseRoleList", () => {
    test("normalizes case, whitespace, and duplicates", () => {
        expect(parseRoleList(" PM, qa,pm ", config)).toEqual(["pm", "qa"]);
    });

    test("rejects unknown roles", () => {
        expect(() => parseRoleList("pm,dev", config)).toThrow(/Unknown role\(s\): dev/);
    });
});

describe("detectRoles", () => {
    test("unions member roles across products and reports the products", () => {
        const products = [
            {name: "A", members: {product_managers: [{user_id: "me"}], rds: [{user_id: "other"}]}},
            {name: "B", members: {rds: [{user_id: "me"}], viewers: [{user_id: "me"}]}},
            {name: "C", members: {qas: [{user_id: "other"}]}},
            {name: "D"},
        ];
        expect(detectRoles(config, "me", products)).toEqual([
            {role: "pm", products: ["A"]},
            {role: "rd", products: ["B"]},
            {role: "viewer", products: ["B"]},
        ]);
    });

    test("returns nothing when the user is not a member anywhere", () => {
        expect(detectRoles(config, "me", [{name: "A", members: {owners: [{user_id: "x"}]}}])).toEqual([]);
    });
});

describe("skillsToPrune", () => {
    test("prunes installed repo skills outside the target, keeping optional ones", () => {
        expect(skillsToPrune(
            ["cawplan-a", "cawplan-b", "cawplan-optional-example"],
            ["cawplan-a"],
            ["cawplan-optional-example"],
        )).toEqual(["cawplan-b"]);
    });
});
