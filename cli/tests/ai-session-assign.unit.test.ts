import {describe, expect, test} from "vitest";
import {readMatchingBrowserModule} from "../src/lib/assign/matching-browser";
import {autoAssignAllFromMappings} from "../src/lib/assign/auto-assign";
import {
    canonicalRepoNameFromMapping,
    findMappingForSession,
    repoKeys,
    repoNameFromGitHubUrl,
    sessionRepoCandidateKeys,
} from "../src/lib/assign/matching";

const mappings = [
    {
        product_id: "prod-cawplan",
        product_name: "CawPlan",
        repo_name: "skill-cawplan",
        repo_url: "https://github.com/cawcut/skill-cawplan",
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
        expect(repoKeys("cawcut/skill-cawplan")).toEqual([
            "cawcut/skill-cawplan",
            "skill-cawplan",
        ]);
    });

    test("repoNameFromGitHubUrl returns short repo name without .git suffix", () => {
        expect(repoNameFromGitHubUrl("https://github.com/cawcut/skill-cawplan.git")).toBe(
            "skill-cawplan"
        );
    });

    test("findMappingForSession matches session.project short name", () => {
        const mapping = findMappingForSession(
            {project: "skill-cawplan", repos_touched: []},
            mappings
        );
        expect(mapping?.product_id).toBe("prod-cawplan");
        expect(mapping?.repo_name).toBe("skill-cawplan");
    });

    test("findMappingForSession matches repos_touched when project is unrelated", () => {
        const mapping = findMappingForSession(
            {
                project: "support-F58B-1780495021764",
                repos_touched: [
                    {
                        repo: "cawcut/skill-cawplan",
                        files: 1,
                        added: 0,
                        deleted: 0,
                    },
                ],
            },
            mappings
        );
        expect(mapping?.repo_name).toBe("skill-cawplan");
    });

    test("sessionRepoCandidateKeys merges project and repos_touched keys", () => {
        const keys = sessionRepoCandidateKeys({
            project: "uid.core-product",
            repos_touched: [{repo: "cawcut/skill-cawplan", files: 1, added: 0, deleted: 0}],
        });
        expect(keys.has("uid.core-product")).toBe(true);
        expect(keys.has("skill-cawplan")).toBe(true);
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
            {project: "skill-cawplan", repos_touched: []},
            [
                {
                    product_id: "prod-cawplan",
                    product_name: "CawPlan",
                    repo_url: "https://github.com/cawcut/skill-cawplan",
                },
            ]
        );
        expect(mapping?.product_id).toBe("prod-cawplan");
    });

    test("canonicalRepoNameFromMapping prefers repo_url over customized repo_name", () => {
        expect(
            canonicalRepoNameFromMapping({
                repo_name: "Custom Display Label",
                repo_url: "https://github.com/cawcut/skill-cawplan",
            })
        ).toBe("skill-cawplan");
    });

    test("findMappingForSession matches session.project against customized repo_name via repo_url", () => {
        const mapping = findMappingForSession(
            {project: "skill-cawplan", repos_touched: []},
            [
                {
                    product_id: "prod-cawplan",
                    product_name: "CawPlan",
                    repo_name: "Custom Display Label",
                    repo_url: "https://github.com/cawcut/skill-cawplan",
                },
            ]
        );
        expect(mapping?.product_id).toBe("prod-cawplan");
    });

    test("findMappingForSession warns when multiple mappings match", () => {
        const warnings: string[] = [];
        const mapping = findMappingForSession(
            {project: "skill-cawplan", repos_touched: []},
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

    test("auto assignment fills product when folder name differs from git repo name", () => {
        const daily = {
            schema: "2.0" as const,
            date: "2026-06-24",
            author: "tester",
            generated_at: "2026-06-24T00:00:00.000Z",
            include_conversation: false,
            totals: {
                sessions: 1,
                agents: ["cursor-cli"],
                messages: {user: 1, assistant: 1, tool_calls: 0},
                files_changed: 0,
                cost: {"$": 0},
            },
            usage_breakdown: [],
            model_usage: {},
            sessions: [{
                schema: "2.0" as const,
                date: "2026-06-24",
                agent: "cursor-cli",
                session_id: "s1",
                session_name: "One",
                project: "local-folder-name",
                // A synthetic path, not process.cwd(): normalizeSessionRepoContext also
                // consults ~/.cawplan/config.json's real local_mapping entries (keyed by
                // directory prefix) before the mocked git-remote resolver below even runs.
                // On a real dev machine that file can have a mapping whose dir is a prefix
                // of this repo's own checkout (e.g. the parent folder mapped to some
                // product from actual day-to-day CLI use) — process.cwd() would match it
                // and short-circuit this test's product_id to that real product before the
                // resolver logic under test ever executes. This test is specifically about
                // "folder name differs from git repo name", not about local_mapping state,
                // so use a path no local machine's config could plausibly have a prefix for.
                cwd: "/nonexistent/cawplan-test-fixture/local-folder-name",
                time_range: {display: "", timezone: "UTC", start: "2026-06-24T09:00:00.000Z"},
                model_usage: {},
                usage_breakdown: [],
                files_changed: 0,
                files_added: 0,
                files_deleted: 0,
                repos_touched: [],
                message_stats: {user: 1, assistant: 1, tool_calls: 0},
            }],
            repos: [],
            human_inputs: [],
        };

        // Mock the git remote resolver instead of relying on the real checkout's
        // origin remote — this test is specifically about "folder name differs
        // from git repo name", not about whatever repo this suite happens to run in.
        const updated = autoAssignAllFromMappings(daily, mappings, () => "cawcut/skill-cawplan");

        expect(updated).toBe(1);
        expect(daily.sessions[0]?.project).toBe("skill-cawplan");
        expect(daily.sessions[0]?.product_id).toBe("prod-cawplan");
    });

});
