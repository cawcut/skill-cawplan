import {describe, expect, test} from "vitest";
import {assignmentHtml} from "../src/lib/assign/assignment-html";

describe("assignmentHtml - badge CSS", () => {
    test("contains base badge style", () => {
        expect(assignmentHtml()).toContain(".badge {");
    });

    test("contains category badge styles", () => {
        const html = assignmentHtml();
        expect(html).toContain(".badge-cat-decision");
        expect(html).toContain(".badge-cat-direction");
        expect(html).toContain(".badge-cat-correction");
        expect(html).toContain(".badge-cat-planning");
    });

    test("contains topic badge styles", () => {
        const html = assignmentHtml();
        expect(html).toContain(".badge-topic-bug");
        expect(html).toContain(".badge-topic-other");
    });

    test("humanInputsHtml builds badge elements", () => {
        const html = assignmentHtml();
        expect(html).toContain("badge-cat-");
        expect(html).toContain("badge-topic-");
    });
});

describe("assignmentHtml - stats panel", () => {
    test("contains stats-bar element", () => {
        expect(assignmentHtml()).toContain('id="stats-bar"');
    });

    test("contains stats-bar CSS", () => {
        expect(assignmentHtml()).toContain("#stats-bar {");
    });

    test("contains renderStats function", () => {
        expect(assignmentHtml()).toContain("renderStats()");
    });
});

describe("assignmentHtml - needs review filter", () => {
    test("contains filter-unassigned button", () => {
        expect(assignmentHtml()).toContain('id="filter-unassigned"');
    });

    test("contains showAssignedSessions state variable", () => {
        expect(assignmentHtml()).toContain("showAssignedSessions");
    });

    test("contains filter-bar CSS", () => {
        expect(assignmentHtml()).toContain(".filter-bar {");
    });

    test("rowEntries hides assigned sessions by default", () => {
        const html = assignmentHtml();
        expect(html).toContain("function shouldShowSession(session)");
        expect(html).toContain("function sessionHasProduct(session)");
        expect(html).toContain("!showAssignedSessions && sessionHasProduct(session)");
    });
});

describe("assignmentHtml - submit effect", () => {
    test("contains Saved check-mark text", () => {
        expect(assignmentHtml()).toContain("Saved ✓");
    });

    test("does not use alert for save confirmation", () => {
        expect(assignmentHtml()).not.toContain("alert('Saved");
    });

    test("contains btn-saved CSS class", () => {
        expect(assignmentHtml()).toContain(".btn-saved");
    });

    test("contains status-error CSS class", () => {
        expect(assignmentHtml()).toContain(".status-error");
    });
});
