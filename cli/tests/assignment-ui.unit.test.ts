import {describe, expect, test} from "vitest";
import {escapeHtml, normalizePortalBase} from "../src/lib/assignment-ui/format.js";
import {
    normalizeTicketDisplayIdList,
    normalizeTicketDisplayIds,
    normalizeTicketDisplayIdsIfArray,
    parseTicketDisplayIdFromInput,
} from "../src/lib/assignment-ui/ticket-id-parse.js";
import {ticketDetailUrl} from "../src/lib/assignment-ui/ticket-url.js";
import {
    INLINE_ESCAPE_HTML,
    INLINE_HUMAN_INPUT_HELPERS,
    INLINE_HUMAN_INPUTS_HTML,
    INLINE_TICKET_DISPLAY_ID_FROM_INPUT,
    INLINE_TICKET_DETAIL_URL,
} from "../src/lib/assignment-ui/browser-snippets.js";
import {
    humanInputContent,
    humanInputsForSession,
    humanInputsHtml,
    truncateHumanInput,
} from "../src/lib/assignment-ui/human-input-preview.js";
import {resolveSessionTitle} from "../src/lib/assignment-ui/session-display.js";

function runInlineFunction<T extends (...args: never[]) => unknown>(
    snippet: string,
    name: string,
    portalBase?: string,
): T {
    const prelude = portalBase ? `const CAWPLAN_PORTAL_BASE = ${JSON.stringify(portalBase)};` : "";
    return new Function(`${prelude}${snippet}; return ${name};`)() as T;
}

describe("escapeHtml", () => {
    test("escapes HTML metacharacters", () => {
        expect(escapeHtml(`a&b<tag>"'`)).toBe("a&amp;b&lt;tag&gt;&quot;&#39;");
    });

    test("matches browser inline snippet", () => {
        const inline = runInlineFunction<typeof escapeHtml>(INLINE_ESCAPE_HTML, "escapeHtml");
        for (const value of ["plain", `a<b>`, `&"'`, "", null, undefined]) {
            expect(inline(value)).toBe(escapeHtml(value));
        }
    });
});

describe("normalizePortalBase", () => {
    test("removes trailing slash", () => {
        expect(normalizePortalBase("https://app.cawplan.com/")).toBe("https://app.cawplan.com");
        expect(normalizePortalBase("https://app.cawplan.com")).toBe("https://app.cawplan.com");
    });
});

describe("parseTicketDisplayIdFromInput", () => {
    test("extracts display id from issue URL", () => {
        expect(parseTicketDisplayIdFromInput("https://app.cawplan.com/issue/cwp-42")).toBe("CWP-42");
    });

    test("accepts bare display ids", () => {
        expect(parseTicketDisplayIdFromInput("CAWP-18575")).toBe("CAWP-18575");
    });

    test("rejects invalid input", () => {
        expect(parseTicketDisplayIdFromInput("not-a-ticket")).toBe("");
        expect(parseTicketDisplayIdFromInput("")).toBe("");
    });

    test("matches browser inline snippet for common inputs", () => {
        const inline = runInlineFunction<typeof parseTicketDisplayIdFromInput>(
            INLINE_TICKET_DISPLAY_ID_FROM_INPUT,
            "ticketDisplayIdFromInput",
        );
        const samples = [
            "https://app.cawplan.com/issue/CWP-42",
            "CAWP-18575",
            "bad",
            "",
            null,
            undefined,
        ];
        for (const sample of samples) {
            expect(inline(sample)).toBe(parseTicketDisplayIdFromInput(sample));
        }
    });
});

describe("normalizeTicketDisplayIds", () => {
    test("deduplicates and uppercases display ids", () => {
        expect(normalizeTicketDisplayIds(["cwp-1", "CWP-1", "https://app.cawplan.com/issue/CWP-2"]))
            .toEqual(["CWP-1", "CWP-2"]);
    });

    test("returns empty array for non-array input", () => {
        expect(normalizeTicketDisplayIds(undefined)).toEqual([]);
        expect(normalizeTicketDisplayIds("CWP-1")).toEqual([]);
    });
});

describe("normalizeTicketDisplayIdsIfArray", () => {
    test("returns undefined for non-array input", () => {
        expect(normalizeTicketDisplayIdsIfArray(undefined)).toBeUndefined();
        expect(normalizeTicketDisplayIdsIfArray("CWP-1")).toBeUndefined();
    });

    test("normalizes arrays like normalizeTicketDisplayIds", () => {
        const value = ["https://app.cawplan.com/issue/CWP-9"];
        expect(normalizeTicketDisplayIdsIfArray(value)).toEqual(normalizeTicketDisplayIds(value));
    });
});

describe("ticketDetailUrl", () => {
    test("builds portal issue URL", () => {
        expect(ticketDetailUrl("https://app.cawplan.com/", "CWP-1"))
            .toBe("https://app.cawplan.com/issue/CWP-1");
    });

    test("matches browser inline snippet when portal base is already normalized", () => {
        const inline = runInlineFunction<(ticket: string) => string>(
            INLINE_TICKET_DETAIL_URL,
            "ticketDetailUrl",
            "https://example.test",
        );
        expect(inline("CWP-9")).toBe(ticketDetailUrl("https://example.test", "CWP-9"));
    });
});

describe("normalizeTicketDisplayIdList", () => {
    test("filters invalid entries", () => {
        expect(normalizeTicketDisplayIdList(["CWP-1", "nope", ""])).toEqual(["CWP-1"]);
    });
});

describe("resolveSessionTitle", () => {
    test("coding mode prefers session_title, then session_name, then session_id", () => {
        expect(resolveSessionTitle({
            session_title: "Title",
            session_name: "Name",
            session_id: "id-1",
        }, "coding")).toBe("Title");
        expect(resolveSessionTitle({
            session_title: "",
            session_name: "Name",
            session_id: "id-1",
        }, "coding")).toBe("Name");
        expect(resolveSessionTitle({
            session_title: "",
            session_name: "",
            session_id: "id-1",
        }, "coding")).toBe("id-1");
    });

    test("qa mode uses nullish coalescing only", () => {
        expect(resolveSessionTitle({
            session_title: "Title",
            session_id: "id-1",
        }, "qa")).toBe("Title");
        expect(resolveSessionTitle({
            session_title: "",
            session_id: "id-1",
        }, "qa")).toBe("");
        expect(resolveSessionTitle({
            session_id: "id-1",
        }, "qa")).toBe("id-1");
    });
});

describe("human input preview", () => {
    test("humanInputContent reads string and object fields", () => {
        expect(humanInputContent("hello")).toBe("hello");
        expect(humanInputContent({content: "c"})).toBe("c");
        expect(humanInputContent({raw_block: "r"})).toBe("r");
        expect(humanInputContent({topic: "t"})).toBe("t");
        expect(humanInputContent({})).toBe("");
        expect(humanInputContent(null)).toBe(null);
    });

    test("truncateHumanInput caps at 200 characters", () => {
        const long = "x".repeat(201);
        expect(truncateHumanInput(long)).toBe("x".repeat(200) + "...");
        expect(truncateHumanInput("short")).toBe("short");
    });

    test("humanInputsForSession filters by session_id", () => {
        const report = {
            human_inputs: [
                {session_id: "a", content: "one"},
                {session_id: "b", content: "two"},
                {session_id: "a", topic: "three"},
            ],
        };
        expect(humanInputsForSession(report, {session_id: "a"})).toHaveLength(2);
        expect(humanInputsForSession(report, {session_id: "missing"})).toEqual([]);
    });

    test("humanInputsHtml renders up to three list items", () => {
        const report = {
            human_inputs: [
                {session_id: "s1", content: "a"},
                {session_id: "s1", content: "b"},
                {session_id: "s1", content: "c"},
                {session_id: "s1", content: "d"},
            ],
        };
        const html = humanInputsHtml(report, {session_id: "s1"});
        expect(html).toContain('<ol class="human-inputs">');
        expect(html.match(/<li>/g)).toHaveLength(3);
        expect(html).not.toContain("d");
    });

    test("humanInputsHtml shows empty state", () => {
        expect(humanInputsHtml({human_inputs: []}, {session_id: "s1"}))
            .toBe('<span class="muted">No human inputs</span>');
    });

    test("browser inline snippets match shared implementations", () => {
        const inlineContent = runInlineFunction<typeof humanInputContent>(
            INLINE_HUMAN_INPUT_HELPERS,
            "humanInputContent",
        );
        const inlineTruncate = runInlineFunction<typeof truncateHumanInput>(
            INLINE_HUMAN_INPUT_HELPERS,
            "truncateHumanInput",
        );
        const inlineForSession = runInlineFunction<typeof humanInputsForSession>(
            INLINE_HUMAN_INPUT_HELPERS,
            "humanInputsForSession",
        );
        const inlineHtml = runInlineFunction<typeof humanInputsHtml>(
            `${INLINE_ESCAPE_HTML}\n${INLINE_HUMAN_INPUT_HELPERS}\n${INLINE_HUMAN_INPUTS_HTML}`,
            "humanInputsHtml",
        );

        const samples: unknown[] = ["text", {content: "c"}, {raw_block: "r"}, {}, null, 123];
        for (const sample of samples) {
            expect(inlineContent(sample)).toEqual(humanInputContent(sample));
        }

        expect(inlineTruncate("abc")).toBe(truncateHumanInput("abc"));
        expect(inlineTruncate("x".repeat(250))).toBe(truncateHumanInput("x".repeat(250)));

        const report = {
            human_inputs: [
                {session_id: "s1", content: "hello"},
                {session_id: "s2", content: "other"},
            ],
        };
        expect(inlineForSession(report, {session_id: "s1"}))
            .toEqual(humanInputsForSession(report, {session_id: "s1"}));
        expect(inlineHtml(report, {session_id: "s1"}))
            .toBe(humanInputsHtml(report, {session_id: "s1"}));
    });
});
