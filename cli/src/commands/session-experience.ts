import type {Command} from "commander";
import {cawplanRequest} from "../lib/http.js";
import {
    buildExperienceEditBody,
    EXPERIENCE_DISABLED_CODE,
    EXPERIENCE_KINDS,
    EXPERIENCE_STATUSES,
    experiencePath,
    recallExperience,
    resolveRecallTarget,
    type ExperienceEditOptions,
} from "../lib/ai-session/experience.js";

function printResult(result: unknown): void {
    console.log(JSON.stringify(result, null, 2));
    const code = (result as {code?: string} | undefined)?.code;
    if (code === EXPERIENCE_DISABLED_CODE) {
        console.error("Coding experience is turned off for this workspace. A workspace admin can turn it on in Settings > Coding Insights.");
    }
}

function addEditOptions(cmd: Command): Command {
    return cmd
        .option("--kind <kind>", `Experience kind: ${EXPERIENCE_KINDS.join("|")}`)
        .option("--title <text>", "Experience title")
        .option("--content <text>", "Experience content")
        .option("--evidence <text>", "Supporting excerpts and observed outcome")
        .option("--applies-to <json>", "JSON object {files, modules, keywords, limits}");
}

export async function runRecall(opts: {q: string; productId?: string; repoId?: string; topK?: number; cwd?: string}): Promise<unknown> {
    const target = await resolveRecallTarget({productId: opts.productId, repoId: opts.repoId, cwd: opts.cwd ?? process.cwd()});
    const scope = target.repoId ? `repo ${target.repoId}` : "whole product";
    const from = target.resolvedFrom === "git" ? ` (resolved from git remote ${target.repo})` : "";
    console.error(`Recalling experience for product ${target.productId}, ${scope}${from}`);
    if (target.matchedByNameOnly) {
        console.error("Matched by repository name only: the mapping's owner differs from the git remote's. Pass --product-id if this is the wrong product.");
    }
    return recallExperience(target, opts.q, opts.topK);
}

const PRODUCT_ID_HELP = "Product unique_id; defaults to the product mapped to the current git repository";

// Explicit --product-id wins; otherwise the current git repository's mapped product, like list/recall.
async function experienceProductId(opts: {productId?: string}): Promise<string> {
    const target = await resolveRecallTarget({productId: opts.productId, cwd: process.cwd()});
    if (target.matchedByNameOnly) {
        console.error(`Using product ${target.productId}, matched by repository name only (the mapping's owner differs from the git remote's). Pass --product-id if this is the wrong product.`);
    }
    return target.productId;
}

// Registered from index.ts after `session` exists; the lookup keeps the subcommands under it.
export function registerSessionExperienceCommands(program: Command): void {
    const session = program.commands.find((cmd) => cmd.name() === "session") ?? program.command("session");
    session.command("recall")
        .description("Recall confirmed coding experience for the current repository's product")
        .requiredOption("--q <text>", "What you are about to do or the problem you hit, in natural language")
        .option("--product-id <id>", PRODUCT_ID_HELP)
        .option("--repo-id <id>", "Repository mapping unique_id; limits results to this repo plus product-wide experience")
        .option("--top-k <n>", "Maximum results (1-10, default 5)", parseInt)
        .action(async (opts) => {
            printResult(await runRecall(opts));
        });

    const experiences = session.command("experiences")
        .description("Review coding experience candidates (product owners/admins)");

    experiences.command("list")
        .description("List experience candidates and confirmed experience for a product")
        .option("--product-id <id>", PRODUCT_ID_HELP)
        .option("--status <status>", `Filter by status: ${EXPERIENCE_STATUSES.join("|")}`)
        .option("--kind <kind>", `Filter by kind: ${EXPERIENCE_KINDS.join("|")}`)
        .option("--repo-id <id>", "Filter by repository mapping unique_id")
        .option("--q <text>", "Search titles")
        .option("--page-num <n>", "Page number", parseInt)
        .option("--page-size <n>", "Page size", parseInt)
        .action(async (opts) => {
            const productId = await experienceProductId(opts);
            const query: Record<string, string> = {};
            if (opts.status) query.status = String(opts.status);
            if (opts.kind) query.kind = String(opts.kind);
            if (opts.repoId) query.repo_id = String(opts.repoId);
            if (opts.q) query.search = String(opts.q);
            if (opts.pageNum != null) query.page_num = String(opts.pageNum);
            if (opts.pageSize != null) query.page_size = String(opts.pageSize);
            printResult(await cawplanRequest({method: "GET", path: experiencePath(productId), query}));
        });

    experiences.command("get <unique_id>")
        .description("Get one experience with its evidence and source sessions")
        .option("--product-id <id>", PRODUCT_ID_HELP)
        .action(async (uniqueId: string, opts) => {
            printResult(await cawplanRequest({method: "GET", path: experiencePath(await experienceProductId(opts), `/${encodeURIComponent(uniqueId)}`)}));
        });

    addEditOptions(experiences.command("confirm <unique_id>")
        .description("Confirm a pending experience (optionally editing it) and publish it to knowledge")
        .option("--product-id <id>", PRODUCT_ID_HELP))
        .action(async (uniqueId: string, opts: ExperienceEditOptions & {productId?: string}) => {
            // The endpoint always parses a JSON body: confirming without edits sends {}.
            const body = buildExperienceEditBody(opts) ?? {};
            printResult(await cawplanRequest({
                method: "POST",
                path: experiencePath(await experienceProductId(opts), `/${encodeURIComponent(uniqueId)}/confirm`),
                body,
            }));
        });

    addEditOptions(experiences.command("edit <unique_id>")
        .description("Edit a confirmed experience and republish it")
        .option("--product-id <id>", PRODUCT_ID_HELP))
        .action(async (uniqueId: string, opts: ExperienceEditOptions & {productId?: string}) => {
            const body = buildExperienceEditBody(opts);
            if (!body) throw new Error("Give at least one of --kind, --title, --content, --evidence, --applies-to");
            printResult(await cawplanRequest({
                method: "PATCH",
                path: experiencePath(await experienceProductId(opts), `/${encodeURIComponent(uniqueId)}`),
                body,
            }));
        });

    experiences.command("reject <unique_id>")
        .description("Reject a pending experience")
        .option("--product-id <id>", PRODUCT_ID_HELP)
        .option("--note <text>", "Why it was rejected")
        .action(async (uniqueId: string, opts) => {
            printResult(await cawplanRequest({
                method: "POST",
                path: experiencePath(await experienceProductId(opts), `/${encodeURIComponent(uniqueId)}/reject`),
                body: opts.note ? {review_note: String(opts.note)} : {},
            }));
        });

    const postAction = (action: "retire" | "publish") => async (uniqueId: string, opts: {productId?: string}) => {
        printResult(await cawplanRequest({
            method: "POST",
            path: experiencePath(await experienceProductId(opts), `/${encodeURIComponent(uniqueId)}/${action}`),
        }));
    };

    experiences.command("retire <unique_id>")
        .description("Retire a confirmed experience and withdraw its knowledge document")
        .option("--product-id <id>", PRODUCT_ID_HELP)
        .action(postAction("retire"));

    experiences.command("publish <unique_id>")
        .description("Retry publishing a confirmed experience whose publish failed")
        .option("--product-id <id>", PRODUCT_ID_HELP)
        .action(postAction("publish"));
}
