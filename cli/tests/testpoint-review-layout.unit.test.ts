import {describe, expect, test} from "vitest";
import {testPointReviewHtml} from "../src/lib/testpoint-review/testpoint-review-html.js";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";

describe("test point review layout", () => {
    test("keeps the add, optimize, and save actions in one action bar", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});

        const html = testPointReviewHtml(state, "tok");

        expect(html).toMatch(
            /<section class="review-actions"[\s\S]*id="add-tp-toggle"[\s\S]*id="optimize-btn"[\s\S]*id="save-cawplan-btn"[\s\S]*<\/section>/,
        );
    });

    test("puts Ask AI and Save feedback below the action bar", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});

        const html = testPointReviewHtml(state, "tok");

        expect(html).toMatch(
            /<\/section>\s*<div class="action-notices"[\s\S]*id="optimize-hint"[\s\S]*id="save-cawplan-hint"[\s\S]*<\/div>/,
        );
        expect(html).toContain("background: var(--amber-soft)");
        expect(html).toContain("width: fit-content");
        expect(html).toContain("align-items: flex-end");
    });

    test("uses a compact overall-feedback panel with its guidance in a tooltip", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});

        const html = testPointReviewHtml(state, "tok");

        expect(html).toContain('title="Feedback not tied to a specific test point; the AI uses it when optimizing."');
        expect(html).not.toContain("General feedback not tied to a specific test point");
    });

    test("uses a MEDIUM-priority selector when adding a test point", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});

        const html = testPointReviewHtml(state, "tok");

        expect(html).toContain('<select class="add-tp-input" id="add-tp-priority">');
        expect(html).toContain('<option value="MEDIUM" selected>MEDIUM</option>');
    });

    test("uses the same priority selector for existing test points and selects the current value", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.test_points[0].current.priority = "LOW";

        const html = testPointReviewHtml(state, "tok");

        expect(html).toContain(
            '<select class="add-tp-input priority-select" data-field="priority" data-editable="true" aria-label="Priority">',
        );
        expect(html).toContain('<option value="LOW" selected>LOW</option>');
        expect(html).not.toContain('<span class="field" data-field="priority"');
        expect(html).toContain('saveField(row, "priority", el)');
    });

    test("gives the priority selector a roomy, borderless text-style presentation", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});

        const html = testPointReviewHtml(state, "tok");

        expect(html).toContain("th:nth-child(4) { width: 120px; }");
        expect(html).toMatch(/\.priority-select \{[\s\S]*width: 100px;[\s\S]*border-color: transparent;[\s\S]*background-color: transparent;/);
        expect(html).toMatch(/\.priority-select:hover, \.priority-select:focus \{[\s\S]*background-color: var\(--line-soft\);[\s\S]*background-image:/);
    });

    test("shows the Chat fallback after Ask AI to Optimize", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});

        const html = testPointReviewHtml(state, "tok");

        expect(html).toContain(
            "Optimization requested. This review is locked while AI is working. If Chat does not respond, send “Continue optimization” in Chat.",
        );
        expect(html).toContain("No changes to optimize. Make a change first.");
    });

    test("does not offer a Save override for unprocessed feedback", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});

        const html = testPointReviewHtml(state, "tok");

        expect(html).toContain("Comments, Overall Feedback, or answered Questions must be processed by Ask AI before saving.");
        expect(html).not.toContain("Save anyway");
    });
});
