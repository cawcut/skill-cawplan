import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { runTestPointsArchive } from "./qa-insights.js";
import { createFixtureReviewState } from "../lib/testpoint-review/fixtures.js";
import {
  createReviewStateFromInput,
  reviewStartCounts,
  type CreateReviewInputTestPoint,
} from "../lib/testpoint-review/create-review.js";
import { applyAiOptimization, type RawAiOptimizeOutput } from "../lib/testpoint-review/optimize-apply.js";
import {
  checkUnresolvedFeedback,
  markTestPointsArchived,
  testPointsPendingArchive,
  toArchiveSubmissionItem,
} from "../lib/testpoint-review/archive-submission.js";
import { loadReviewState, saveReviewState } from "../lib/testpoint-review/store.js";
import {
  defaultReconcileTestPoints,
  requestOptimize,
  startTestPointReviewWebServer,
} from "../lib/testpoint-review/testpoint-review-web-server.js";
import type { QAInsightsWriteEnvelope } from "../lib/qa-insights/types.js";

export function registerTestPointReviewCommand(program: Command): void {
  const qa = program.commands.find((cmd) => cmd.name() === "qa-insights") ?? program.command("qa-insights");

  const testpointReview = qa
    .command("testpoint-review")
    .description("Test point review page (local, independent of qa-insights)");

  testpointReview
    .command("start")
    .description(
      "Create a review session and save it locally. Pass --test-points-file/--test-points with the " +
        "already-synthesized test points (e.g. cawplan-testpoint-generate's Step 5 output) to seed real " +
        "content; omit both to fall back to fixture sample data for manually testing the review page itself.",
    )
    .requiredOption("--product-id <id>", "Product unique_id")
    .requiredOption("--requirement-id <id>", "Requirement id")
    .option("--lang <lang>", "Language the AI is currently using (zh or en)", "zh")
    .option(
      "--test-points-file <path>",
      "JSON array: new drafts use {title, group?, tags?, priority?}; existing CawPlan rows use " +
        "{id, title, group?, tags?, priority?, archived:true}",
    )
    .option("--test-points <json>", "Same shape as --test-points-file, inline as a JSON string")
    .option("--requirement-file <path>", "JSON file with the five-field requirement snapshot")
    .option("--requirement <json>", "Same shape as --requirement-file, inline as a JSON string")
    .action(
      async (opts: {
        productId: string;
        requirementId: string;
        lang: string;
        testPointsFile?: string;
        testPoints?: string;
        requirementFile?: string;
        requirement?: string;
      }) => {
        if (opts.testPointsFile && opts.testPoints) {
          throw new Error("pass either --test-points-file or --test-points, not both");
        }
        if (opts.requirementFile && opts.requirement) {
          throw new Error("pass either --requirement-file or --requirement, not both");
        }

        const language = opts.lang === "en" ? "en" : "zh";
        const rawTestPoints = opts.testPointsFile
          ? await readFile(opts.testPointsFile, "utf8")
          : opts.testPoints;

        if (!rawTestPoints) {
          const state = createFixtureReviewState({
            productId: opts.productId,
            requirementId: opts.requirementId,
            language,
          });
          const filePath = saveReviewState(state);
          console.log(
            JSON.stringify({ review_id: state.review_id, file: filePath, ...reviewStartCounts(state) }, null, 2),
          );
          return;
        }

        let testPoints: CreateReviewInputTestPoint[];
        try {
          testPoints = JSON.parse(rawTestPoints) as CreateReviewInputTestPoint[];
        } catch (err) {
          throw new Error(`--test-points/--test-points-file is not valid JSON — ${(err as Error).message}`);
        }

        const rawRequirement = opts.requirementFile
          ? await readFile(opts.requirementFile, "utf8")
          : opts.requirement;
        let requirement: Record<string, unknown> | undefined;
        if (rawRequirement) {
          try {
            requirement = JSON.parse(rawRequirement) as Record<string, unknown>;
          } catch (err) {
            throw new Error(`--requirement/--requirement-file is not valid JSON — ${(err as Error).message}`);
          }
        }

        const state = createReviewStateFromInput({
          productId: opts.productId,
          requirementId: opts.requirementId,
          language,
          testPoints,
          requirement,
        });
        const filePath = saveReviewState(state);
        console.log(
          JSON.stringify({ review_id: state.review_id, file: filePath, ...reviewStartCounts(state) }, null, 2),
        );
      },
    );

  testpointReview
    .command("open")
    .description("Open the test point review page for an existing review session")
    .requiredOption("--review-id <id>", "Review id (from `testpoint-review start`)")
    .option("--no-browser", "Serve the page and print its URL without opening a browser")
    .action(async (opts: { reviewId: string; browser: boolean }) => {
      await startTestPointReviewWebServer(opts.reviewId, {}, { launchBrowser: opts.browser });
    });

  testpointReview
    .command("show")
    .description("Print the current persisted review state for AI optimization")
    .requiredOption("--review-id <id>", "Review id")
    .action((opts: { reviewId: string }) => {
      console.log(JSON.stringify(loadReviewState(opts.reviewId), null, 2));
    });

  testpointReview
    .command("request-optimize")
    .description(
      "Lock the whole review for AI optimization (design §3.1/§8.2), same effect as clicking " +
        "\"Ask AI to Optimize\" on the page. For Chat-only revision flows (SQA replies to open questions " +
        "or gives natural-language edits in Chat, no page open) — saves state, sets `pending_optimize`, " +
        "and lets the host Agent proceed straight to reasoning + `apply-optimization` without a browser.",
    )
    .requiredOption("--review-id <id>", "Review id")
    .action((opts: { reviewId: string }) => {
      const state = loadReviewState(opts.reviewId);
      const { alreadyLocked, lockedIds } = requestOptimize(state);
      console.log(
        JSON.stringify(
          { review_id: state.review_id, review_status: state.review_status, already_locked: alreadyLocked, locked_ids: lockedIds },
          null,
          2,
        ),
      );
    });

  testpointReview
    .command("apply-optimization")
    .description(
      "Merge AI-produced test point changes into the next review round (design §3.4/§3.7, §8.5 validation). " +
        "Called by the host Agent after it reads a `pending_optimize` review and reasons out the next round's content. " +
        "The operation is atomic: invalid output leaves the pending review unchanged.",
    )
    .requiredOption("--review-id <id>", "Review id")
    .option("--output-file <path>", "JSON file with the AI's { modified, added } output")
    .option("--output <json>", "JSON string with the AI's { modified, added } output")
    .addHelpText(
      "after",
      `\nOutput shape:\n  {"modified":[{"id":"tp_001","fields":{"title":"...","group":"...","tags":["..."],"priority":"HIGH"}}],"added":[{"title":"...","group":"...","tags":["..."],"priority":"HIGH"}]}\n\n` +
        "Every item needs title, group, tags, and priority. `current` is Review State data, not an apply-output field.",
    )
    .action(async (opts: { reviewId: string; outputFile?: string; output?: string }) => {
      if (opts.outputFile && opts.output) {
        throw new Error("pass either --output-file or --output, not both");
      }
      const raw = opts.outputFile ? await readFile(opts.outputFile, "utf8") : opts.output;
      if (!raw) {
        throw new Error("--output-file or --output is required");
      }

      let parsed: RawAiOptimizeOutput;
      try {
        parsed = JSON.parse(raw) as RawAiOptimizeOutput;
      } catch (err) {
        throw new Error(`input is not valid JSON — ${(err as Error).message}`);
      }

      const state = loadReviewState(opts.reviewId);
      const { reviewState, skippedCount } = applyAiOptimization(state, parsed);
      saveReviewState(reviewState);

      console.log(
        JSON.stringify(
          { review_id: reviewState.review_id, round: reviewState.round, skipped_count: skippedCount },
          null,
          2,
        ),
      );
    });

  testpointReview
    .command("save")
    .description(
      "Save the currently visible, not-yet-archived test points to CawPlan (design §4/§4.1). " +
        "Repeatable — already-archived rows are skipped on subsequent calls.",
    )
    .requiredOption("--review-id <id>", "Review id")
    .requiredOption("--product-id <id>", "CawPlan product unique_id")
    .requiredOption("--requirement-id <id>", "CawPlan requirement id")
    .option("--dry-run", "Build and print the archive body without submitting")
    .action(
      async (opts: {
        reviewId: string;
        productId: string;
        requirementId: string;
        dryRun?: boolean;
      }) => {
        const state = loadReviewState(opts.reviewId);

        const feedback = checkUnresolvedFeedback(state);
        if (feedback.hasUnresolvedFeedback) {
          throw new Error(
            `${feedback.commentedTestPointCount} test point(s) have unresolved comments and ` +
              `${feedback.globalCommentCount} unresolved overall feedback item(s). Process them with Ask AI before saving.`,
          );
        }

        const pending = testPointsPendingArchive(state);
        if (pending.length === 0) {
          console.log(JSON.stringify({ review_id: state.review_id, archived_count: 0, outcome: "NOOP" }, null, 2));
          return;
        }

        const body = { test_points: pending.map(toArchiveSubmissionItem) };
        const batchSize = pending.length;

        if (opts.dryRun) {
          console.log(JSON.stringify({ review_id: state.review_id, post_body: body }, null, 2));
          return;
        }

        let envelope: QAInsightsWriteEnvelope | undefined;
        await runTestPointsArchive(opts.productId, opts.requirementId, { body: JSON.stringify(body) }, {
          emit: (e) => {
            envelope = e;
          },
        });
        if (!envelope) {
          throw new Error("testpoints archive did not produce an envelope");
        }

        if (envelope.outcome === "FAILURE") {
          // Definitive failure — nothing was written, reconcile would be pointless (SKILL.md §9).
          console.log(JSON.stringify({ review_id: state.review_id, archived_count: 0, envelope }, null, 2));
          process.exitCode = 1;
          return;
        }

        if (envelope.outcome !== "SUCCESS") {
          // UNKNOWN — transport failure or post-write 5xx, result indeterminate. Reconcile before
          // reporting failure so a retry doesn't double-submit a batch that actually landed
          // (same rule saveToCawPlan applies on the page's save route, SKILL.md §9/§10).
          const reconcileEnvelope = await defaultReconcileTestPoints(
            opts.productId,
            opts.requirementId,
            state.count_before,
            batchSize,
          );

          if (reconcileEnvelope.reconcile?.decision !== "count_matched") {
            console.log(
              JSON.stringify(
                { review_id: state.review_id, archived_count: 0, envelope, reconcile: reconcileEnvelope },
                null,
                2,
              ),
            );
            process.exitCode = 1;
            return;
          }

          const { reviewState: reconciledState, archivedCount } = markTestPointsArchived(
            state,
            pending.map((tp) => tp.id),
          );
          reconciledState.count_before += batchSize;
          saveReviewState(reconciledState);

          console.log(
            JSON.stringify(
              { review_id: reconciledState.review_id, archived_count: archivedCount, outcome: "RECONCILED" },
              null,
              2,
            ),
          );
          return;
        }

        const { reviewState: nextState, archivedCount } = markTestPointsArchived(
          state,
          pending.map((tp) => tp.id),
        );
        nextState.count_before += batchSize;
        saveReviewState(nextState);

        console.log(
          JSON.stringify({ review_id: nextState.review_id, archived_count: archivedCount, envelope }, null, 2),
        );
      },
    );
}
