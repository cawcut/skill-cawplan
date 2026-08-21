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
    INLINE_TICKET_DISPLAY_ID_FROM_INPUT,
    INLINE_TICKET_DETAIL_URL,
} from "../src/lib/assignment-ui/browser-snippets.js";

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
