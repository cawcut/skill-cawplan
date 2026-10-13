import {createHash} from "node:crypto";
import {describe, expect, test} from "vitest";
import {assignmentHtml} from "../src/lib/assign/assignment-html.js";

const CODING_HTML_SNAPSHOT_SHA256 = "90bfef0bd63dbf5f814155f07082ae53fdfaa9c65f3767f264f3f7f8ff8c5b6d";

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
