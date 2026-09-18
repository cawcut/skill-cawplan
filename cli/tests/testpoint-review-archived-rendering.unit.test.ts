import {describe, expect, test} from "vitest";
import {testPointReviewHtml} from "../src/lib/testpoint-review/testpoint-review-html.js";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";
import {createReviewStateFromInput} from "../src/lib/testpoint-review/create-review.js";

describe("testPointReviewHtml archived test points (design §4.1, plan step 19)", () => {
    test("an archived test point disappears from the page entirely — not shown, not locked", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        const archivedTitle = state.test_points[0].current.title;
        state.test_points[0].archived = true;

        const html = testPointReviewHtml(state, "tok");

        expect(html).not.toContain(archivedTitle);
    });

    test("shows an 'Already saved to CawPlan: N' hint once something is archived", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.test_points[0].archived = true;

        const html = testPointReviewHtml(state, "tok");

        expect(html).toContain("Already saved to CawPlan: 1");
    });

    test("incremental input hides all archived N rows and renders only new M drafts", () => {
        const state = createReviewStateFromInput({
            productId: "prod_1",
            requirementId: "req_1",
            testPoints: [
                {id: "saved-1", title: "已存 1", archived: true},
                {id: "saved-2", title: "已存 2", archived: true},
                {title: "新增 1"},
                {title: "新增 2"},
            ],
        });

        const html = testPointReviewHtml(state, "tok");

        expect(html).not.toContain("已存 1");
        expect(html).not.toContain("已存 2");
        expect(html).toContain("新增 1");
        expect(html).toContain("新增 2");
        expect(html).toContain("Already saved to CawPlan: 2");
        expect(html).toContain(">2 total<");
    });

    test("shows no 'Already saved' hint when nothing is archived yet", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});

        const html = testPointReviewHtml(state, "tok");

        expect(html).not.toContain("Already saved to CawPlan");
    });

    test("the total count in the header excludes archived rows", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.test_points[0].archived = true;

        const html = testPointReviewHtml(state, "tok");

        expect(html).toContain(">2 total<");
    });

    test("renders a Save to CawPlan button", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});

        const html = testPointReviewHtml(state, "tok");

        expect(html).toContain("Save to CawPlan");
        expect(html).toContain('id="save-cawplan-btn"');
    });

    test("Save to CawPlan button is disabled while the review is locked for AI optimization", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.review_status = "pending_optimize";

        const html = testPointReviewHtml(state, "tok");

        expect(html).toMatch(/id="save-cawplan-btn" disabled/);
    });

    test("Save to CawPlan button is disabled when every test point is already archived", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        for (const tp of state.test_points) tp.archived = true;

        const html = testPointReviewHtml(state, "tok");

        expect(html).toMatch(/id="save-cawplan-btn" disabled/);
    });
});
