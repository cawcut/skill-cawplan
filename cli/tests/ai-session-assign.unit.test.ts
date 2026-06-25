import {describe, expect, test} from "vitest";
import {readMatchingBrowserModule} from "../src/lib/assign/matching-browser";
import {
    findMappingForSession,
    repoKeys,
    repoNameFromGitHubUrl,
    sessionRepoCandidateKeys,
} from "../src/lib/assign/matching";

const mappings = [
    {
        product_id: "prod-cawplan",
        product_name: "CawPlan",
        repo_name: "flow-cawplan-skill",
        repo_url: "https://github.com/Ubiquiti-UID/flow-cawplan-skill",
    },
    {
        product_id: "prod-core",
        product_name: "CawPlan",
        repo_name: "uid.core-product",
        repo_url: "https://github.com/Ubiquiti-UID/uid.core-product",
    },
];

describe("assignment repo matching", () => {
    test("repoKeys includes full path and short repo name", () => {
        expect(repoKeys("Ubiquiti-UID/flow-cawplan-skill")).toEqual([
            "ubiquiti-uid/flow-cawplan-skill",
            "flow-cawplan-skill",
        ]);
    });

    test("repoNameFromGitHubUrl returns short repo name without .git suffix", () => {
        expect(repoNameFromGitHubUrl("https://github.com/Ubiquiti-UID/flow-cawplan-skill.git")).toBe(
            "flow-cawplan-skill"
        );
    });

    test("findMappingForSession matches session.project short name", () => {
        const mapping = findMappingForSession(
            {project: "flow-cawplan-skill", repos_touched: []},
            mappings
        );
        expect(mapping?.product_id).toBe("prod-cawplan");
        expect(mapping?.repo_name).toBe("flow-cawplan-skill");
    });

    test("findMappingForSession matches repos_touched when project is unrelated", () => {
        const mapping = findMappingForSession(
            {
                project: "support-F58B-1780495021764",
                repos_touched: [
                    {
                        repo: "Ubiquiti-UID/flow-cawplan-skill",
                        files: 1,
                        added: 0,
                        deleted: 0,
                    },
                ],
            },
            mappings
        );
        expect(mapping?.repo_name).toBe("flow-cawplan-skill");
    });

    test("sessionRepoCandidateKeys merges project and repos_touched keys", () => {
        const keys = sessionRepoCandidateKeys({
            project: "uid.core-product",
            repos_touched: [{repo: "Ubiquiti-UID/flow-cawplan-skill", files: 1, added: 0, deleted: 0}],
        });
        expect(keys.has("uid.core-product")).toBe(true);
        expect(keys.has("flow-cawplan-skill")).toBe(true);
        expect(findMappingForSession({project: "uid.core-product", repos_touched: []}, mappings)?.repo_name).toBe(
            "uid.core-product"
        );
    });

    test("findMappingForSession returns undefined when nothing matches", () => {
        expect(
            findMappingForSession({project: "unknown-repo", repos_touched: []}, mappings)
        ).toBeUndefined();
    });

    test("findMappingForSession matches mapping.repo_url when repo_name differs", () => {
        const mapping = findMappingForSession(
            {project: "flow-cawplan-skill", repos_touched: []},
            [
                {
                    product_id: "prod-cawplan",
                    product_name: "CawPlan",
                    repo_url: "https://github.com/Ubiquiti-UID/flow-cawplan-skill",
                },
            ]
        );
        expect(mapping?.product_id).toBe("prod-cawplan");
    });

    test("findMappingForSession warns when multiple mappings match", () => {
        const warnings: string[] = [];
        const mapping = findMappingForSession(
            {project: "flow-cawplan-skill", repos_touched: []},
            [
                mappings[0],
                {...mappings[0], product_id: "prod-dup"},
            ],
            {warn: (message) => warnings.push(message)}
        );
        expect(mapping?.product_id).toBe("prod-cawplan");
        expect(warnings.some((message) => message.includes("Ambiguous"))).toBe(true);
    });

    test("readMatchingBrowserModule serves compiled matching-core exports", () => {
        const source = readMatchingBrowserModule();
        expect(source).toContain("export function findMappingForSession");
        expect(source).toContain("export function repoNameFromGitHubUrl");
        expect(source).toContain("repo.repo_url");
    });
});
