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
