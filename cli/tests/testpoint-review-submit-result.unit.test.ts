import {describe, expect, test} from "vitest";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";
import {testPointReviewHtml} from "../src/lib/testpoint-review/testpoint-review-html.js";

describe("testPointReviewHtml final-submit result handling", () => {
    const html = testPointReviewHtml(createFixtureReviewState({productId: "prod_1", requirementId: "req_1"}), "tok");

    test("an unknown result locks the page instead of re-enabling submit", () => {
        expect(html).toContain("function holdLocked(");
        expect(html).toContain("unknownResult");
        expect(html).toContain("if (!canRecover()) return;");
    });

    test("only a definite validation-type failure can be retried; others hold", () => {
        expect(html).toContain('["validation", "auth", "not_found", "feature_disabled"]');
        expect(html).toContain("SUBMIT_TEXT.unconfirmed");
    });

    test("success starts a countdown only for explicit success outcomes", () => {
        expect(html).toContain('data.outcome !== "SUCCESS" && data.outcome !== "RECONCILED"');
        expect(html).toContain("startCloseCountdown(hint);");
    });

    test("save_in_progress holds the page instead of leaving a stuck Saving hint", () => {
        expect(html).toContain("SUBMIT_TEXT.saveBusy");
    });
});
