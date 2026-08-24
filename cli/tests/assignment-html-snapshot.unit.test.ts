import {createHash} from "node:crypto";
import {describe, expect, test} from "vitest";
import {assignmentHtml} from "../src/lib/assign/assignment-html.js";

const CODING_HTML_SNAPSHOT_SHA256 = "d306af670217ad7ebd5cdff152a1eb980fce8f7112b2ff76d97b91176070a7a7";

describe("assignmentHtml batch-1 shared snippet stability", () => {
    test("uses shared browser snippets for escapeHtml and ticket helpers", () => {
        const html = assignmentHtml();
        expect(html).toContain("function escapeHtml(value)");
        expect(html).toContain("function ticketDisplayIdFromInput(value)");
        expect(html).toContain("function ticketDetailUrl(ticket)");
        expect(html).toContain("function humanInputsHtml(report, session)");
        expect(html).toContain("return CAWPLAN_PORTAL_BASE + '/issue/' + encodeURIComponent(ticket);");
    });

    test("default portal base normalization unchanged", () => {
        const html = assignmentHtml("https://example.cawplan.test/");
        expect(html).toContain('const CAWPLAN_PORTAL_BASE = "https://example.cawplan.test";');
    });

    test("matches frozen coding HTML snapshot hash", () => {
        const html = assignmentHtml();
        const hash = createHash("sha256").update(html).digest("hex");
        expect(hash).toBe(CODING_HTML_SNAPSHOT_SHA256);
    });
});
