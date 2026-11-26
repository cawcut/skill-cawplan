import {describe, expect, it} from "vitest";
import type {DailyApiJson} from "../src/lib/collect/types.js";
import {
    collectDocCandidates,
    isDocPath,
    selectDocCandidates,
    planDocs,
    type PlanDeps,
    type TicketInfo,
} from "../src/lib/ai-session/docs-plan.js";

function report(sessions: unknown[], humanInputs: unknown[] = []): DailyApiJson {
    return {schema: "2.0", date: "2026-11-25", author: "a", generated_at: "", include_conversation: false, sessions, human_inputs: humanInputs} as unknown as DailyApiJson;
}

const session = (over: Record<string, unknown> = {}) => ({
    session_id: "s1", session_name: "Session one", project: "p", cwd: "/work/p", product_id: "prod1",
    ticket_ids: ["t1"], ticket_display_ids: ["CWP-1"], ...over,
});

const change = (path: string, added: number, deleted = 0) => ({path, added, deleted});

function deps(over: Partial<PlanDeps> = {}): PlanDeps {
    const tickets: TicketInfo[] = [{unique_id: "t1", display_id: "CWP-1", product_id: "prod1", module_id: "m1", module_name: "Knowledge"}];
    return {
        fetchTickets: async () => tickets,
        fetchModuleNodes: async () => [{id: "m1", knowledge: [{id: "d1", name: "Docs"}]}],
        fetchDatasets: async () => [{id: "d9", name: "Other"}],
        statFile: () => ({size: 100}),
        ...over,
    };
}

describe("isDocPath", () => {
    it("keeps markdown documents and drops agent config, boilerplate and tool directories", () => {
        expect(isDocPath("issues/NOTE.md")).toBe(true);
        expect(isDocPath("docs/Test Cases.MARKDOWN")).toBe(true);
        expect(isDocPath("CLAUDE.md")).toBe(false);
        expect(isDocPath("sub/README.md")).toBe(false);
        expect(isDocPath(".claude/plans/x.md")).toBe(false);
        expect(isDocPath("node_modules/p/x.md")).toBe(false);
        expect(isDocPath("src/main.go")).toBe(false);
    });
});

describe("collectDocCandidates", () => {
    it("lists markdown the session wrote, not the ones it edited, and sums repeated writes", () => {
        const r = report([session({
            human_inputs: [
                {file_changes: [change("docs/a.md", 40), change("docs/b.md", 5, 3), change("CLAUDE.md", 2)]},
                {file_changes: [change("docs/a.md", 10)]},
            ],
        })]);
        const got = selectDocCandidates(collectDocCandidates(r));
        expect(got.map((c) => c.path)).toEqual(["docs/a.md"]);
        expect(got[0]).toMatchObject({added: 50, created: true, abs_path: "/work/p/docs/a.md"});
        expect(selectDocCandidates(collectDocCandidates(r), {includeEdited: true}).map((c) => c.path)).toEqual(["docs/a.md", "docs/b.md"]);
    });

    it("falls back to the report-level inputs only for a session without its own changes", () => {
        const r = report(
            [session(), session({session_id: "s2", human_inputs: [{file_changes: [change("x.md", 9)]}]})],
            [
                {session_id: "s1", file_changes: [change("one.md", 7)]},
                {session_id: "s2", file_changes: [change("x.md", 9)]},
            ],
        );
        const got = selectDocCandidates(collectDocCandidates(r));
        expect(got.map((c) => `${c.session_id}:${c.path}:${c.added}`)).toEqual(["s2:x.md:9", "s1:one.md:7"]);
    });
});

describe("selectDocCandidates", () => {
    const r = report([session({
        human_inputs: [{file_changes: [change("new.md", 10), change("old.md", 30), change("rewritten.md", 20, 5)]}],
    })]);
    const git = (verdicts: Record<string, "new" | "existing" | "unknown">) => (abs: string) => verdicts[abs.split("/").pop()!] ?? "unknown";

    it("lets git decide: existing files are edits, new ones are kept even when rewritten", () => {
        const got = selectDocCandidates(collectDocCandidates(r), {gitNewness: git({"new.md": "new", "old.md": "existing", "rewritten.md": "new"})});
        expect(got.map((c) => c.path)).toEqual(["rewritten.md", "new.md"]);
    });

    it("falls back to the report's hint when git cannot tell, and puts new before edited", () => {
        const got = selectDocCandidates(collectDocCandidates(r), {includeEdited: true, gitNewness: git({"old.md": "existing"})});
        // new.md: hint says created; old.md: git says existing; rewritten.md: git unknown, hint says edited
        expect(got.map((c) => `${c.path}:${c.created}`)).toEqual(["new.md:true", "old.md:false", "rewritten.md:false"]);
    });
});

describe("planDocs", () => {
    const cand = (over: Record<string, unknown> = {}) => collectDocCandidates(report([session({
        ...over, human_inputs: [{file_changes: [change("docs/a.md", 40)]}],
    })]));

    it("is ready when the ticket has a module and one dataset already holds documents under it", async () => {
        const [item] = await planDocs(cand(), [session()] as never, deps());
        expect(item).toMatchObject({status: "ready", product_id: "prod1", module_id: "m1", dataset_id: "d1"});
        expect(item.upload_command).toBe('cawplan knowledge documents upload --dataset d1 --module m1 --file "/work/p/docs/a.md"');
    });

    it("tells the user to add a module when no ticket has one", async () => {
        const [item] = await planDocs(cand(), [session()] as never, deps({
            fetchTickets: async () => [{unique_id: "t1", display_id: "CWP-1", product_id: "prod1", module_id: null}],
        }));
        expect(item.status).toBe("ticket_no_module");
        expect(item.hint).toContain("tickets update");
        expect(item.hint).toContain("CWP-1");
    });

    it("reports a session without tickets, a missing file and a product mismatch", async () => {
        expect((await planDocs(cand({ticket_ids: []}), [session({ticket_ids: []})] as never, deps()))[0].status).toBe("no_ticket");
        expect((await planDocs(cand(), [session()] as never, deps({statFile: () => undefined})))[0].status).toBe("file_missing");
        expect((await planDocs(cand(), [session({product_id: "other"})] as never, deps()))[0].status).toBe("product_mismatch");
    });

    it("asks to choose when tickets point to different modules or datasets are ambiguous", async () => {
        const two: TicketInfo[] = [
            {unique_id: "t1", product_id: "prod1", module_id: "m1"},
            {unique_id: "t2", product_id: "prod1", module_id: "m2"},
        ];
        expect((await planDocs(cand({ticket_ids: ["t1", "t2"]}), [session()] as never, deps({fetchTickets: async () => two})))[0].status).toBe("choose_ticket");

        const many = await planDocs(cand(), [session()] as never, deps({
            fetchModuleNodes: async () => [{id: "m1", knowledge: [{id: "d1"}, {id: "d2"}]}],
        }));
        expect(many[0].status).toBe("choose_dataset");
        expect(many[0].dataset_options?.map((d) => d.id)).toEqual(["d1", "d2"]);
    });

    it("offers the product's datasets when none holds documents under the module yet, or reports none", async () => {
        const empty = await planDocs(cand(), [session()] as never, deps({fetchModuleNodes: async () => [{id: "m1", knowledge: []}]}));
        expect(empty[0]).toMatchObject({status: "choose_dataset"});
        expect(empty[0].dataset_options?.map((d) => d.id)).toEqual(["d9"]);

        const none = await planDocs(cand(), [session()] as never, deps({
            fetchModuleNodes: async () => [{id: "m1", knowledge: []}],
            fetchDatasets: async () => [],
        }));
        expect(none[0].status).toBe("no_dataset");
    });
});
