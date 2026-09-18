import {describe, expect, test} from "vitest";
import {testPointReviewHtml} from "../src/lib/testpoint-review/testpoint-review-html.js";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";

describe("testPointReviewHtml stale-optimize banner (design §8.1)", () => {
    function hintSpan(html: string): string {
        const match = html.match(/<span class="optimize-hint[^"]*" id="optimize-hint">[^<]*<\/span>/);
        if (!match) throw new Error("optimize-hint span not found in rendered html");
        return match[0];
    }

    test("shows no stale hint while not locked", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.review_status = "reviewing";

        const html = testPointReviewHtml(state, "tok");

        expect(hintSpan(html)).not.toContain("optimize-hint-stale");
        expect(hintSpan(html)).not.toContain("may not have completed");
    });

    test("shows the normal locked hint (not stale) when just requested", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.review_status = "pending_optimize";
        state.optimize_requested_at = new Date().toISOString();

        const html = testPointReviewHtml(state, "tok");

        expect(hintSpan(html)).toContain("this review is locked until the AI responds");
        expect(hintSpan(html)).not.toContain("optimize-hint-stale");
    });

    test("shows the stale/manual-recovery hint once past the timeout threshold", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.review_status = "pending_optimize";
        state.optimize_requested_at = new Date(Date.now() - 11 * 60 * 1000).toISOString();

        const html = testPointReviewHtml(state, "tok");

        expect(hintSpan(html)).toContain("optimize-hint-stale");
        expect(hintSpan(html)).toContain("may not have completed");
        expect(hintSpan(html)).toContain("continue optimizing");
    });

    test("does not show stale hint just under the threshold", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.review_status = "optimizing";
        state.optimize_requested_at = new Date(Date.now() - 9 * 60 * 1000).toISOString();

        const html = testPointReviewHtml(state, "tok");

        expect(hintSpan(html)).not.toContain("optimize-hint-stale");
    });

    test("no stale hint when optimize_requested_at is missing even if locked", () => {
        const state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.review_status = "pending_optimize";
        state.optimize_requested_at = undefined;

        const html = testPointReviewHtml(state, "tok");

        expect(hintSpan(html)).not.toContain("optimize-hint-stale");
    });
});
