import {afterEach, describe, expect, test, vi} from "vitest";
import * as http from "../src/lib/http.js";
import * as git from "../src/lib/collect/git.js";
import * as productsApi from "../src/lib/assign/products-api.js";
import {
    buildExperienceEditBody,
    experiencePath,
    recallExperience,
    resolveRecallTarget,
    qualifiedRepoId,
    resolveRecallTargetFromMappings,
} from "../src/lib/ai-session/experience.js";

const PRODUCT_A = "01983225-e595-71c6-9c88-4235d35fc743";
const PRODUCT_B = "01983f50-20f6-72b4-8486-fdc44f2a4146";

const mappings = [
    {unique_id: "repo-skill", product_id: PRODUCT_A, product_name: "CawPlan", repo_name: "flow-cawplan-skill", repo_url: "https://github.com/cawkit/flow-cawplan-skill"},
    {unique_id: "repo-be", product_id: PRODUCT_A, product_name: "CawPlan", repo_name: "example-backend", repo_url: "https://github.com/cawkit/example-backend"},
    {unique_id: "repo-shared-a", product_id: PRODUCT_A, product_name: "CawPlan", repo_name: "shared-lib"},
    {unique_id: "repo-shared-b", product_id: PRODUCT_B, product_name: "Other", repo_name: "shared-lib"},
];

afterEach(() => {
    vi.restoreAllMocks();
});

describe("resolveRecallTargetFromMappings", () => {
    test("maps owner/repo to its product and repo mapping", () => {
        expect(resolveRecallTargetFromMappings("cawkit/flow-cawplan-skill", mappings)).toEqual({
            productId: PRODUCT_A,
            repoId: "repo-skill",
            repo: "cawkit/flow-cawplan-skill",
            resolvedFrom: "git",
        });
    });

    test("refuses a repository with no mapping", () => {
        expect(() => resolveRecallTargetFromMappings("cawkit/unknown", mappings)).toThrow(/No CawPlan product is mapped/);
    });

    test("refuses a repository mapped to more than one product instead of guessing", () => {
        expect(() => resolveRecallTargetFromMappings("org/shared-lib", mappings)).toThrow(/more than one product/);
    });

    test("an exact owner/repo mapping wins over a same-named repository of another owner", () => {
        const sameName = [
            {unique_id: "repo-a", product_id: PRODUCT_A, repo_name: "widget", repo_url: "https://github.com/org-a/widget"},
            {unique_id: "repo-b", product_id: PRODUCT_B, repo_name: "widget", repo_url: "git@github.com:org-b/widget.git"},
        ];
        const a = resolveRecallTargetFromMappings("org-a/widget", sameName);
        expect(a).toMatchObject({productId: PRODUCT_A, repoId: "repo-a"});
        expect(a.matchedByNameOnly).toBeUndefined();
        expect(resolveRecallTargetFromMappings("org-b/widget", sameName)).toMatchObject({productId: PRODUCT_B, repoId: "repo-b"});
        // No exact mapping and the name points at two products: still refused.
        expect(() => resolveRecallTargetFromMappings("org-c/widget", sameName)).toThrow(/more than one product/);
    });

    test("a transferred repository resolves by name and is flagged", () => {
        // Mappings keep the owner they were created with; the repo moved to cawkit since.
        const old = [{unique_id: "repo-old", product_id: PRODUCT_A, repo_name: "example-backend", repo_url: "https://github.com/Ubiquiti-UID/example-backend"}];
        expect(resolveRecallTargetFromMappings("cawkit/example-backend", old)).toEqual({
            productId: PRODUCT_A,
            repoId: "repo-old",
            repo: "cawkit/example-backend",
            resolvedFrom: "git",
            matchedByNameOnly: true,
        });
    });

    test("an owner/repo repo_name counts as a qualified identity", () => {
        const named = [{unique_id: "repo-n", product_id: PRODUCT_B, repo_name: "org-b/widget"}];
        expect(resolveRecallTargetFromMappings("org-b/widget", named)).toMatchObject({productId: PRODUCT_B, repoId: "repo-n"});
        expect(resolveRecallTargetFromMappings("org-a/widget", named)).toMatchObject({matchedByNameOnly: true});
    });

    test("qualifiedRepoId reads https, ssh and owner/repo forms", () => {
        expect(qualifiedRepoId("https://github.com/Cawkit/Flow-Cawplan-Skill.git")).toBe("cawkit/flow-cawplan-skill");
        expect(qualifiedRepoId("git@github.com:cawkit/example-backend.git")).toBe("cawkit/example-backend");
        expect(qualifiedRepoId("cawkit/example-backend/")).toBe("cawkit/example-backend");
        expect(qualifiedRepoId("shared-lib")).toBe("");
        expect(qualifiedRepoId("/tmp/x")).toBe("");
        expect(qualifiedRepoId("")).toBe("");
    });

    test("falls back to product-wide scope when one product has several mappings for the repo", () => {
        const dup = [...mappings.slice(0, 2), {unique_id: "repo-skill-2", product_id: PRODUCT_A, repo_name: "flow-cawplan-skill"}];
        expect(resolveRecallTargetFromMappings("cawkit/flow-cawplan-skill", dup)).toMatchObject({
            productId: PRODUCT_A,
            repoId: undefined,
        });
    });
});

describe("resolveRecallTarget", () => {
    test("an explicit product id skips git and mapping lookups", async () => {
        const remote = vi.spyOn(git, "gitRemoteRepo");
        const list = vi.spyOn(productsApi, "listProductRepoMappings");
        await expect(resolveRecallTarget({productId: PRODUCT_B, repoId: "r1", cwd: "/tmp/x"})).resolves.toEqual({
            productId: PRODUCT_B,
            repoId: "r1",
            resolvedFrom: "flag",
        });
        expect(remote).not.toHaveBeenCalled();
        expect(list).not.toHaveBeenCalled();
    });

    test("a directory without an origin remote asks for --product-id", async () => {
        vi.spyOn(git, "gitRemoteRepo").mockReturnValue("/tmp/x");
        await expect(resolveRecallTarget({cwd: "/tmp/x"})).rejects.toThrow(/no git origin remote/);
    });

    test("an explicit repo id overrides the mapped one", async () => {
        vi.spyOn(git, "gitRemoteRepo").mockReturnValue("cawkit/example-backend");
        vi.spyOn(productsApi, "listProductRepoMappings").mockResolvedValue(mappings);
        await expect(resolveRecallTarget({repoId: "custom", cwd: "/w"})).resolves.toMatchObject({
            productId: PRODUCT_A,
            repoId: "custom",
        });
    });
});

describe("recallExperience", () => {
    test("calls the public recall route with q, repo_id and top_k", async () => {
        const payload = {code: "SUCCESS", msg: "success", data: {items: [], content_trust: "reviewed_untrusted_data"}};
        const request = vi.spyOn(http, "cawplanRequest").mockResolvedValue(payload);
        const result = await recallExperience({productId: PRODUCT_A, repoId: "repo-be", resolvedFrom: "flag"}, "approval retry loses context", 3);
        expect(result).toEqual(payload);
        expect(request).toHaveBeenCalledWith({
            method: "GET",
            path: `/api/v1/public/openapi/ai-session-usage/product/${PRODUCT_A}/experiences/recall`,
            query: {q: "approval retry loses context", repo_id: "repo-be", top_k: "3"},
        });
    });

    test("omits repo_id for product-wide recall", async () => {
        const request = vi.spyOn(http, "cawplanRequest").mockResolvedValue({code: "SUCCESS"});
        await recallExperience({productId: PRODUCT_A, resolvedFrom: "git"}, "q");
        expect(request.mock.calls[0][0]).toMatchObject({query: {q: "q"}});
    });
});

describe("buildExperienceEditBody", () => {
    test("returns undefined when no field is given", () => {
        expect(buildExperienceEditBody({})).toBeUndefined();
    });

    test("maps flags to the API body", () => {
        expect(buildExperienceEditBody({
            kind: "pitfall",
            title: "t",
            content: "c",
            evidence: "e",
            appliesTo: '{"files":["a.go"],"limits":"only proto"}',
        })).toEqual({kind: "pitfall", title: "t", content: "c", evidence: "e", applies_to: {files: ["a.go"], limits: "only proto"}});
    });

    test("rejects an unknown kind", () => {
        expect(() => buildExperienceEditBody({kind: "tip"})).toThrow(/--kind must be one of/);
    });

    test("rejects applies-to that is not a JSON object", () => {
        expect(() => buildExperienceEditBody({appliesTo: "files=a.go"})).toThrow(/JSON object/);
        expect(() => buildExperienceEditBody({appliesTo: "[1]"})).toThrow(/JSON object/);
    });
});

test("experiencePath encodes the product id", () => {
    expect(experiencePath("a/b", "/recall")).toBe("/api/v1/public/openapi/ai-session-usage/product/a%2Fb/experiences/recall");
});

describe("session experiences commands", () => {
    async function run(args: string[]): Promise<void> {
        const {Command} = await import("commander");
        const {registerSessionExperienceCommands} = await import("../src/commands/session-experience.js");
        const program = new Command();
        program.exitOverride();
        program.command("session");
        registerSessionExperienceCommands(program);
        await program.parseAsync(["node", "cawplan", "session", "experiences", ...args], {from: "node"});
    }

    function mockRequest() {
        vi.spyOn(console, "log").mockImplementation(() => {});
        return vi.spyOn(http, "cawplanRequest").mockResolvedValue({code: "SUCCESS", msg: "success", data: {}});
    }

    test("confirm without edits sends an empty JSON object, not a missing body", async () => {
        const request = mockRequest();
        await run(["confirm", "exp-1", "--product-id", PRODUCT_A]);
        expect(request).toHaveBeenCalledWith({
            method: "POST",
            path: experiencePath(PRODUCT_A, "/exp-1/confirm"),
            body: {},
        });
    });

    test("confirm with edits sends only the edited fields", async () => {
        const request = mockRequest();
        await run(["confirm", "exp-1", "--product-id", PRODUCT_A, "--title", "New title"]);
        expect(request.mock.calls[0][0]).toMatchObject({body: {title: "New title"}});
    });

    test.each([
        [["get", "exp-1"], "GET", "/exp-1"],
        [["confirm", "exp-1"], "POST", "/exp-1/confirm"],
        [["edit", "exp-1", "--title", "t"], "PATCH", "/exp-1"],
        [["reject", "exp-1"], "POST", "/exp-1/reject"],
        [["retire", "exp-1"], "POST", "/exp-1/retire"],
        [["publish", "exp-1"], "POST", "/exp-1/publish"],
    ])("%j resolves the product from the git remote when --product-id is omitted", async (args, method, suffix) => {
        vi.spyOn(git, "gitRemoteRepo").mockReturnValue("cawkit/flow-cawplan-skill");
        vi.spyOn(productsApi, "listProductRepoMappings").mockResolvedValue(mappings);
        const request = mockRequest();
        await run(args as string[]);
        expect(request.mock.calls[0][0]).toMatchObject({method, path: experiencePath(PRODUCT_A, suffix as string)});
    });

    test("an explicit --product-id skips the git lookup", async () => {
        const remote = vi.spyOn(git, "gitRemoteRepo");
        const request = mockRequest();
        await run(["retire", "exp-1", "--product-id", PRODUCT_B]);
        expect(remote).not.toHaveBeenCalled();
        expect(request.mock.calls[0][0]).toMatchObject({path: experiencePath(PRODUCT_B, "/exp-1/retire")});
    });

    test("a repository-name-only match warns before acting on that product", async () => {
        vi.spyOn(git, "gitRemoteRepo").mockReturnValue("someone-else/example-backend");
        vi.spyOn(productsApi, "listProductRepoMappings").mockResolvedValue(mappings);
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const request = mockRequest();
        await run(["reject", "exp-1"]);
        expect(request.mock.calls[0][0]).toMatchObject({path: experiencePath(PRODUCT_A, "/exp-1/reject")});
        expect(errors.mock.calls.flat().join("\n")).toMatch(/matched by repository name only/);
    });
});
