import {describe, expect, test} from "vitest";
import {testPointReviewHtml} from "../src/lib/testpoint-review/testpoint-review-html.js";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";

describe("testPointReviewHtml AI Modified/Added labels (design §3.2/§3.7, plan step 18)", () => {
    test("renders no AI label when ai_status is 'none'", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});

        const html = testPointReviewHtml(state, "tok");

        expect(html).not.toContain("AI Modified");
        expect(html).not.toContain("AI Added");
    });

    test("renders the 'AI Modified' label for a modified test point, with the original available to expand", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.test_points[0].ai_status = "modified";
        state.test_points[0].current = {title: "AI revised title", group: "登录校验", tags: ["正向"], priority: "HIGH"};

        const html = testPointReviewHtml(state, "tok");

        expect(html).toContain("AI Modified");
        expect(html).toContain("AI revised title");
        expect(html).toContain(state.test_points[0].original.title);
    });

    test("renders the 'AI Added' label for an AI-added test point", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.test_points[0].status = "added";
        state.test_points[0].ai_status = "added";
        state.test_points[0].source = "ai";

        const html = testPointReviewHtml(state, "tok");

        expect(html).toContain("AI Added");
        expect(html).not.toContain('<span class="status-label">Added</span>');
        expect(html).toContain("font-family: inherit;");
        expect(html).not.toContain("font: inherit;");
    });

    test("never renders an Accept/Reject affordance (design §3.1/§3.7 — no suggestion-card interaction in v2)", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.test_points[0].ai_status = "modified";

        const html = testPointReviewHtml(state, "tok");

        expect(html.toLowerCase()).not.toContain("accept");
        expect(html.toLowerCase()).not.toContain("reject");
    });
});
