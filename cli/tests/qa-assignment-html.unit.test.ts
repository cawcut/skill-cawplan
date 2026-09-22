import {readFileSync} from "node:fs";
import {describe, expect, test} from "vitest";
import type {QaDailyApiJson} from "../src/lib/collect/qa-types.js";
import type {QaExcludedSession} from "../src/lib/collect/aggregators/qa-daily.js";
import {
    qaAssignmentHtml,
    renderExcludedSessionCandidatesHtml,
    renderQaSessionRowHtml,
    sessionDateTimeText,
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
            models: index === 0 ? ["claude-sonnet-5"] : [],
            testpoint: {added: index === 0 ? 6 : 0, modified: 0, deleted: 0},
            testcase: {added: 0, modified: 0, deleted: 0},
            display_time_range: {
                start: "2026-08-20T06:09:21.460Z",
                display: "14:09 - 14:12",
            },
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
    test("table headers follow column order without Skill layers", () => {
        const html = qaAssignmentHtml({bootstrap: bootstrapFixture()});
        expect(html).not.toContain("<th>Skill layers</th>");
        const headerMatch = html.match(/<thead>[\s\S]*?<\/thead>/);
        expect(headerMatch).not.toBeNull();
        const headers = [...headerMatch![0].matchAll(/<th>([\s\S]*?)<\/th>/g)]
            .map((m) => m[1]!.replace(/<[^>]+>/g, "").trim());
        expect(headers).toEqual([
            "Session ID",
            "Title",
            "Input",
            "Agent",
            "Models",
            "Test Points",
            "Product *",
            "Tickets",
            "Date / Time",
        ]);
    });

    test("readonly preview omits Tickets column with nine headers", () => {
        const html = qaAssignmentHtml({
            readonlyPreview: true,
            bootstrap: bootstrapFixture(),
        });
        expect(html).not.toContain("<th>Tickets</th>");
        expect(html).not.toContain("<th>Skill layers</th>");
        const headerMatch = html.match(/<thead>[\s\S]*?<\/thead>/);
        const headers = [...headerMatch![0].matchAll(/<th>([^<]+)<\/th>/g)].map((m) => m[1]);
        expect(headers).toEqual([
            "Session ID",
            "Title",
            "Input",
            "Agent",
            "Models",
            "Test Points",
            "Product",
            "Date / Time",
        ]);
    });

    test("readonly loading state uses colspan 8", () => {
        const html = qaAssignmentHtml({readonlyPreview: true});
        expect(html).toContain('colspan="8"');
    });

    test("sessionDateTimeText formats start like coding and falls back to em dash", () => {
        const daily = mockDailyFixture();
        const withStart = daily.sessions[0]!;
        expect(sessionDateTimeText(withStart)).toMatch(/^Aug 20, /);
        expect(sessionDateTimeText({...withStart, display_time_range: {display: "14:09 - 14:12"}})).toBe("14:09 - 14:12");
        expect(sessionDateTimeText({...withStart, display_time_range: undefined})).toBe("—");
    });

    test("server-side row cells match header order", () => {
        const daily = mockDailyFixture();
        const session = daily.sessions[0]!;
        const row = renderQaSessionRowHtml(session, MOCK_PRODUCTS, {
            interactive: true,
            daily,
        });
        expect(row).not.toContain("skills-cell");
        expect(row).toMatch(
            /<td class="sid-cell">[\s\S]*<td class="title-cell">[\s\S]*<td class="input-cell">[\s\S]*<td class="agent-cell">[\s\S]*<td class="num-cell">[\s\S]*<td class="product-cell">[\s\S]*<td class="tickets-cell">[\s\S]*<td class="dt-cell">/,
        );
        expect(row).toContain('class="dt-cell"');
    });

    test("includes searchable product input with datalist and coding-style lookup", () => {
        const html = qaAssignmentHtml({bootstrap: bootstrapFixture()});
        expect(html).toContain('id="product-list"');
        expect(html).toContain('class="product"');
        expect(html).toContain('list="product-list"');
        expect(html).toContain('placeholder="Search product"');
        expect(html).toContain('<th>Product <span class="required">*</span></th>');
        expect(html).toContain('aria-label="Product for session" required');
        expect(html).toContain('value="Demo Product"');
        expect(html).toContain('<option value="Demo Product"></option>');
        expect(html).toContain("normalizeProducts");
        expect(html).toContain("validateSingleProductPerSession");
        expect(html).toContain('const valid = Boolean(product);');
        expect(html).toContain('throw new Error("Product is required for every session.");');
        expect(html).not.toContain('class="product-select"');
        expect(html).not.toContain("repoPickerHtml");
        expect(html).not.toContain("refreshRepoOptionsForProduct");
        expect(repoKeywordCount(html)).toBe(0);
    });

    test("server-side row renderer mirrors default product selection", () => {
        const session = loadDailyFixture().sessions[0]!;
        const row = renderQaSessionRowHtml(session, MOCK_PRODUCTS, {interactive: true});
        expect(row).toContain('class="product"');
        expect(row).toContain('value="Demo Product"');
        expect(row).not.toContain("<select");
    });
});

describe("qaAssignmentHtml segment 3 — supplement excluded sessions entry point hidden", () => {
    test("does not render the supplement panel entry point on the confirmation page", () => {
        const html = qaAssignmentHtml({bootstrap: bootstrapFixture()});
        expect(html).not.toContain('id="qa-supplement-panel"');
        expect(html).not.toContain("Add excluded sessions (optional)");
        expect(html).not.toContain('placeholder="session_id"');
        expect(html).not.toContain("type=\"text\" placeholder=\"Session ID");
    });

    test("supplement candidate HTML helper still exposes session metadata (server-side helper retained)", () => {
        const list = renderExcludedSessionCandidatesHtml(sampleExcluded());
        expect(list).toContain("aaaa1111-1111-1111-1111-111111111111");
        expect(list).toContain("qa-commit-only");
        expect(list).toContain("Add session");
    });

    test("addExcludedSession row-building logic remains available client-side even though the panel is hidden", () => {
        const html = qaAssignmentHtml({bootstrap: bootstrapFixture()});
        expect(html).toContain("emptyAssetChange");
        expect(html).toContain("ticket_display_ids: []");
        expect(html).toContain('class="product"');
        expect(html).toContain('class="ticket-picker"');
        expect(html).toContain("wireTicketPicker");
        expect(html).toContain("selectedTicketDisplayIds");
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

describe("qaAssignmentHtml - submit effect", () => {
    test("contains Saved check-mark text and return-to-agent guidance", () => {
        const html = qaAssignmentHtml({bootstrap: bootstrapFixture()});
        expect(html).toContain("Saved ✓");
        expect(html).toContain("Saved ✓ Return to agent");
        expect(html).toContain("Return to your agent to review and confirm upload.");
    });

    test("closes page after save like coding assignment page", () => {
        const html = qaAssignmentHtml({bootstrap: bootstrapFixture()});
        expect(html).toContain("function closePage()");
        expect(html).toContain("setTimeout(closePage, 150)");
        expect(html).toContain('api("/qa-assign/close", {method: "POST"}).finally(closePage)');
    });

    test("does not use alert for save confirmation", () => {
        expect(qaAssignmentHtml({bootstrap: bootstrapFixture()})).not.toContain("alert('Saved");
    });

    test("contains btn-saved CSS class", () => {
        expect(qaAssignmentHtml({bootstrap: bootstrapFixture()})).toContain(".btn-saved");
    });
});
