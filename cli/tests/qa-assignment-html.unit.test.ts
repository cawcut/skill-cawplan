import {readFileSync} from "node:fs";
import {describe, expect, test} from "vitest";
import type {QaDailyApiJson} from "../src/lib/collect/qa-types.js";
import type {QaExcludedSession} from "../src/lib/collect/aggregators/qa-daily.js";
import {
    qaAssignmentHtml,
    renderExcludedSessionCandidatesHtml,
    renderQaSessionRowHtml,
} from "../src/lib/qa-assign/qa-assignment-html.js";
import type {QaAssignmentBootstrap} from "../src/lib/qa-assign/types.js";

const REAL_SESSION_IDS = [
    "fcc914fb-041a-4ce6-8c2d-f79910c13d0d",
    "87a6526b-63fa-42a6-bb6e-c3c497b42485",
    "f79fffba-51c6-4ce0-87e8-0d78b732d54f",
];

const PRODUCT_ID = "019cfa00-8fa1-7000-824d-a9f0ce0b4060";

const MOCK_PRODUCTS = [
    {product_id: PRODUCT_ID, product_name: "Demo Product", product_line_id: "line-1"},
    {product_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", product_name: "Other Product", product_line_id: "line-2"},
];

function mockDailyFixture(): QaDailyApiJson {
    return {
        schema: "qa-session.1",
        date: "2026-08-20",
        author: "tester",
        generated_at: "2026-08-20T00:00:00.000Z",
        include_conversation: false,
        totals: {
            sessions: 3,
            agents: ["claude-code"],
            messages: {user: 1, assistant: 1, tool_calls: 0},
            cost: {USD: 0},
        },
        usage_breakdown: [],
        model_usage: {},
        sessions: REAL_SESSION_IDS.map((sessionId, index) => ({
            session_id: sessionId,
            agent: "claude-code",
            session_title: `Session ${index + 1}`,
            product_id: PRODUCT_ID,
            ticket_ids: [],
            ticket_display_ids: [],
            requirement_ids: ["req-" + index],
            skill_layers: index === 0
                ? ["cawplan-requirement-analyze", "cawplan-testpoint-generate"]
                : ["cawplan-testcase-generate"],
            testpoint: {added: index === 0 ? 6 : 0, modified: 0, deleted: 0},
            testcase: {added: 0, modified: 0, deleted: 0},
        })),
        human_inputs: [
            {
                session_id: REAL_SESSION_IDS[0]!,
                content: "Analyze requirement for login flow",
            },
            {
                session_id: REAL_SESSION_IDS[0]!,
                content: "Generate test points for edge cases",
            },
            {
                session_id: REAL_SESSION_IDS[1]!,
                content: "Expand testcase steps",
            },
        ],
    };
}

function loadDailyFixture(): QaDailyApiJson {
    try {
        return JSON.parse(readFileSync("/tmp/qa-full.json", "utf-8")) as QaDailyApiJson;
    } catch {
        return mockDailyFixture();
    }
}

function bootstrapFixture(overrides: Partial<QaAssignmentBootstrap> = {}): QaAssignmentBootstrap {
    return {
        daily: loadDailyFixture(),
        products: MOCK_PRODUCTS,
        excludedSessions: overrides.excludedSessions ?? sampleExcluded(),
        ...overrides,
    };
}

function sampleExcluded(): QaExcludedSession[] {
    return [{
        session_id: "aaaa1111-1111-1111-1111-111111111111",
        agent: "cursor-gui",
        title: "Commit-only workflow session",
        reason: "qa-commit-only",
    }];
}

function repoKeywordCount(html: string): number {
    const pattern = /repo-cell|repo-picker|repo-trigger|repo-menu|repo-search|select\.repo|product-repo|normalizeSessionRepoContext/gi;
    return (html.match(pattern) ?? []).length;
}

describe("qaAssignmentHtml segment 1 — readonly session table", () => {
    test("renders table with three real session IDs and zero repo keywords", () => {
        const html = qaAssignmentHtml({
            readonlyPreview: true,
            bootstrap: bootstrapFixture(),
        });
        expect(html.length).toBeGreaterThan(0);
        expect(html.toLowerCase()).toContain("<table");
        expect(html).toContain("<th>Input</th>");
        for (const sessionId of REAL_SESSION_IDS) {
            expect(html).toContain(sessionId);
        }
        expect(repoKeywordCount(html)).toBe(0);
        expect(html).not.toContain('id="save"');
        expect(html).not.toContain('class="supplement-add"');
        expect(html).not.toContain('id="qa-supplement-panel"');
    });
});

describe("qaAssignmentHtml session and input columns", () => {
    test("server-side row renderer uses shared human input preview from daily.human_inputs", () => {
        const daily = mockDailyFixture();
        const session = daily.sessions[0]!;
        const row = renderQaSessionRowHtml(session, MOCK_PRODUCTS, {
            interactive: false,
            daily,
        });
        expect(row).toContain('class="input-cell"');
        expect(row).toContain("Analyze requirement for login flow");
        expect(row).toContain("Generate test points for edge cases");
        expect(row).not.toContain("Expand testcase steps");
    });

    test("server-side row renderer shows empty human input placeholder", () => {
        const daily = mockDailyFixture();
        const session = daily.sessions[2]!;
        const row = renderQaSessionRowHtml(session, MOCK_PRODUCTS, {
            interactive: false,
            daily,
        });
        expect(row).toContain('<span class="muted">No human inputs</span>');
    });

    test("server-side title uses qa nullish fallback chain", () => {
        const daily = mockDailyFixture();
        const session = {...daily.sessions[0]!, session_title: ""};
        const row = renderQaSessionRowHtml(session, MOCK_PRODUCTS, {daily});
        expect(row).toContain('<td class="title-cell"></td>');
        expect(row).not.toContain(`<td class="title-cell">${session.session_id}</td>`);
    });

    test("interactive page wires browser resolveSessionTitle and humanInputsHtml", () => {
        const html = qaAssignmentHtml({bootstrap: bootstrapFixture()});
        expect(html).toContain("function resolveSessionTitle(session)");
        expect(html).toContain("return session.session_title ?? session.session_id;");
        expect(html).toContain("function humanInputsHtml(report, session)");
        expect(html).toContain("humanInputsHtml(daily, session)");
        expect(html).not.toContain("session.session_title || session.session_id");
    });
});

describe("qaAssignmentHtml segment 2 — product selection", () => {
    test("includes product dropdown with one option per product and default selection", () => {
        const html = qaAssignmentHtml({bootstrap: bootstrapFixture()});
        expect(html).toContain('class="product-select"');
        expect(html).toContain('value="' + PRODUCT_ID + '" selected');
        expect(html).toContain("Demo Product");
        expect(html).toContain("Other Product");
        expect(html).toContain("validateSingleProductPerSession");
        expect(html).not.toContain("repoPickerHtml");
        expect(html).not.toContain("refreshRepoOptionsForProduct");
        expect(repoKeywordCount(html)).toBe(0);
    });

    test("server-side row renderer mirrors default product selection", () => {
        const session = loadDailyFixture().sessions[0]!;
        const row = renderQaSessionRowHtml(session, MOCK_PRODUCTS, {interactive: true});
        expect(row).toContain('value="' + PRODUCT_ID + '" selected');
        expect((row.match(/<option /g) ?? []).length).toBe(MOCK_PRODUCTS.length + 1);
    });
});

describe("qaAssignmentHtml segment 3 — supplement excluded sessions", () => {
    test("renders supplement panel with candidate list instead of manual session_id input", () => {
        const html = qaAssignmentHtml({bootstrap: bootstrapFixture()});
        expect(html).toContain('id="qa-supplement-panel"');
        expect(html).toContain("supplement-add");
        expect(html).toContain("aaaa1111-1111-1111-1111-111111111111");
        expect(html).not.toContain('placeholder="session_id"');
        expect(html).not.toContain("type=\"text\" placeholder=\"Session ID");
    });

    test("supplement candidate HTML exposes session metadata for one-click add", () => {
        const list = renderExcludedSessionCandidatesHtml(sampleExcluded());
        expect(list).toContain("aaaa1111-1111-1111-1111-111111111111");
        expect(list).toContain("qa-commit-only");
        expect(list).toContain("Add session");
    });

    test("added excluded session uses the same row shape as collected sessions", () => {
        const html = qaAssignmentHtml({bootstrap: bootstrapFixture()});
        expect(html).toContain("emptyAssetChange");
        expect(html).toContain("ticket_display_ids: []");
        expect(html).toContain("product-select");
        expect(html).toContain("ticket-input");
    });
});

describe("qaAssignmentHtml isolation", () => {
    test("does not import coding assignment-html fragments", () => {
        const html = qaAssignmentHtml({bootstrap: bootstrapFixture()});
        expect(html).not.toContain("assignment-html");
        expect(html).not.toContain("findMappingForSession");
        expect(html).not.toContain("repoPickerHtml");
    });
});
