import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {
    applyQaWebAssignments,
    normalizeTicketDisplayIds,
    QaAssignmentValidationError,
    validateQaAssignments,
} from "../src/lib/qa-assign/qa-apply.js";
import {readQaDailyReport, writeQaDailyReport} from "../src/lib/qa-assign/qa-report-io.js";
import {dispatchQaAssignRequest} from "../src/lib/qa-assign/qa-web-server.js";
import type {QaDailyApiJson} from "../src/lib/collect/qa-types.js";
import type {QaAssignmentReport} from "../src/lib/qa-assign/types.js";

vi.mock("../src/lib/ai-session/ticket-context.js", () => ({
    resolveTicketContexts: vi.fn(async (refs: string[]) => refs.map((ref) => ({
        ticket_display_id: ref,
        ticket_id: `ticket-${ref}`,
        product_id: "prod-1",
    }))),
    ticketContextIsResolved: vi.fn((context: {ticket_id?: string; ticket_display_id?: string}) =>
        Boolean(context.ticket_id && context.ticket_display_id && context.ticket_id !== context.ticket_display_id)),
}));

const PRODUCT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PRODUCT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function sampleDaily(overrides: Partial<QaDailyApiJson> = {}): QaDailyApiJson {
    return {
        schema: "qa-session.1",
        date: "2026-08-20",
        author: "tester",
        generated_at: "2026-08-20T00:00:00.000Z",
        include_conversation: false,
        totals: {
            sessions: 1,
            agents: ["claude-code"],
            messages: {user: 1, assistant: 1, tool_calls: 0},
            cost: {USD: 0},
        },
        usage_breakdown: [],
        model_usage: {},
        sessions: [{
            session_id: "11111111-1111-1111-1111-111111111111",
            agent: "claude-code",
            session_title: "QA session",
            product_id: PRODUCT_A,
            ticket_ids: [],
            ticket_display_ids: [],
            requirement_ids: ["req-1"],
            skill_layers: ["cawplan-testpoint-generate"],
            models: ["claude-sonnet-5"],
            testpoint: {added: 2, modified: 0, deleted: 0},
            testcase: {added: 0, modified: 0, deleted: 0},
        }],
        human_inputs: [{
            content: "hello",
            session_id: "11111111-1111-1111-1111-111111111111",
        }],
        ...overrides,
    };
}

describe("validateQaAssignments", () => {
    test("rejects two different products for the same session", () => {
        expect(() => validateQaAssignments([
            {session_id: "11111111-1111-1111-1111-111111111111", product_id: PRODUCT_A},
            {session_id: "11111111-1111-1111-1111-111111111111", product_id: PRODUCT_B},
        ])).toThrow(QaAssignmentValidationError);
    });
});

describe("applyQaWebAssignments", () => {
    test("updates product_id and resolves ticket display IDs", async () => {
        const daily = sampleDaily();
        await applyQaWebAssignments(daily, [{
            session_id: "11111111-1111-1111-1111-111111111111",
            product_id: PRODUCT_B,
            ticket_display_ids: ["CWP-100"],
        }]);
        expect(daily.sessions[0]?.product_id).toBe(PRODUCT_B);
        expect(daily.sessions[0]?.ticket_display_ids).toEqual(["CWP-100"]);
        expect(daily.sessions[0]?.ticket_ids).toEqual(["ticket-CWP-100"]);
    });

    test("rejects clearing product_id", async () => {
        const daily = sampleDaily();
        await expect(applyQaWebAssignments(daily, [{
            session_id: "11111111-1111-1111-1111-111111111111",
        }])).rejects.toThrow("product_id is required");
        expect(daily.sessions[0]?.product_id).toBe(PRODUCT_A);
    });

    test("adds manually supplemented sessions with full QA session shape", async () => {
        const daily = sampleDaily({sessions: [], totals: {...sampleDaily().totals, sessions: 0, agents: []}});
        await applyQaWebAssignments(daily, [{
            session_id: "22222222-2222-2222-2222-222222222222",
            product_id: PRODUCT_A,
            manually_added: true,
        }], [{
            session_id: "22222222-2222-2222-2222-222222222222",
            agent: "cursor-gui",
            title: "Commit-only session",
            reason: "qa-commit-only",
        }]);
        expect(daily.sessions).toHaveLength(1);
        expect(Object.keys(daily.sessions[0]!).sort()).toEqual([
            "agent",
            "models",
            "product_id",
            "requirement_ids",
            "session_id",
            "session_title",
            "skill_layers",
            "testcase",
            "testpoint",
            "ticket_display_ids",
            "ticket_ids",
        ].sort());
        expect(JSON.stringify(daily)).not.toContain("\"category\"");
        expect(JSON.stringify(daily)).not.toContain("\"topic\"");
    });
});

describe("normalizeTicketDisplayIds", () => {
    test("extracts display IDs from issue URLs", () => {
        expect(normalizeTicketDisplayIds(["https://app.cawplan.com/issue/CWP-42"])).toEqual(["CWP-42"]);
    });
});

describe("dispatchQaAssignRequest", () => {
    let tempDir: string;
    let reportPath: string;
    let report: QaAssignmentReport;
    const token = "test-token";

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), "qa-web-server-test-"));
        reportPath = join(tempDir, "qa-daily-2026-08-20.json");
        writeFileSync(reportPath, JSON.stringify(sampleDaily(), null, 2), "utf-8");
        report = {
            file: reportPath,
            daily: sampleDaily(),
            excludedSessions: [{
                session_id: "22222222-2222-2222-2222-222222222222",
                agent: "cursor-gui",
                title: "Missed session",
                reason: "qa-commit-only",
            }],
        };
    });

    afterEach(() => {
        if (tempDir) rmSync(tempDir, {recursive: true, force: true});
    });

    test("returns bootstrap payload with products and excluded sessions", async () => {
        const result = await dispatchQaAssignRequest(
            {method: "GET", url: `/qa-assign/bootstrap?token=${token}`},
            "",
            report,
            token,
            {
                listProducts: async () => ([
                    {product_id: PRODUCT_A, product_name: "Product A"},
                    {product_id: PRODUCT_B, product_name: "Product B"},
                ]),
                readReport: readQaDailyReport,
            },
        );
        expect(result.status).toBe(200);
        const body = result.body as {daily: QaDailyApiJson; products: unknown[]; excludedSessions: unknown[]};
        expect(body.daily.sessions).toHaveLength(1);
        expect(body.products).toHaveLength(2);
        expect(body.excludedSessions).toHaveLength(1);
    });

    test("persists a valid assignment payload", async () => {
        const result = await dispatchQaAssignRequest(
            {method: "POST", url: `/qa-assign/save?token=${token}`},
            JSON.stringify({
                assignments: [{
                    session_id: "11111111-1111-1111-1111-111111111111",
                    product_id: PRODUCT_B,
                    ticket_display_ids: ["CWP-9"],
                }],
            }),
            report,
            token,
            {readReport: readQaDailyReport, writeReport: writeQaDailyReport},
        );
        expect(result.status).toBe(200);
        const saved = readQaDailyReport(reportPath);
        expect(saved.sessions[0]?.product_id).toBe(PRODUCT_B);
        expect(saved.sessions[0]?.ticket_display_ids).toEqual(["CWP-9"]);
    });

    test("rejects one session mapped to two products", async () => {
        const result = await dispatchQaAssignRequest(
            {method: "POST", url: `/qa-assign/save?token=${token}`},
            JSON.stringify({
                assignments: [
                    {session_id: "11111111-1111-1111-1111-111111111111", product_id: PRODUCT_A},
                    {session_id: "11111111-1111-1111-1111-111111111111", product_id: PRODUCT_B},
                ],
            }),
            report,
            token,
            {readReport: readQaDailyReport, writeReport: writeQaDailyReport},
        );
        expect(result.status).toBe(400);
        expect((result.body as {error?: string}).error).toContain("more than one product");
    });

    test("rejects saving with an empty product_id", async () => {
        const result = await dispatchQaAssignRequest(
            {method: "POST", url: `/qa-assign/save?token=${token}`},
            JSON.stringify({
                assignments: [{
                    session_id: "11111111-1111-1111-1111-111111111111",
                }],
            }),
            report,
            token,
            {readReport: readQaDailyReport, writeReport: writeQaDailyReport},
        );
        expect(result.status).toBe(400);
        expect((result.body as {error?: string}).error).toContain("product_id is required");
        const saved = readQaDailyReport(reportPath);
        expect(saved.sessions[0]?.product_id).toBe(PRODUCT_A);
    });

    test("preserves QA report root keys after write-back", async () => {
        await dispatchQaAssignRequest(
            {method: "POST", url: `/qa-assign/save?token=${token}`},
            JSON.stringify({
                assignments: [{
                    session_id: "11111111-1111-1111-1111-111111111111",
                    product_id: PRODUCT_B,
                }],
            }),
            report,
            token,
            {readReport: readQaDailyReport, writeReport: writeQaDailyReport},
        );
        const saved = readQaDailyReport(reportPath);
        expect(Object.keys(saved).sort()).toEqual([
            "author",
            "date",
            "generated_at",
            "human_inputs",
            "include_conversation",
            "model_usage",
            "schema",
            "sessions",
            "totals",
            "usage_breakdown",
        ].sort());
        expect(JSON.stringify(saved)).not.toContain("\"category\"");
        expect(JSON.stringify(saved)).not.toContain("\"topic\"");
    });
});
