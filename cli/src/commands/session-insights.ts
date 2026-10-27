import type {Command} from "commander";
import {cawplanRequest} from "../lib/http.js";
import {buildQueryFromFlags} from "../lib/cache.js";
import {
    addDateOptions,
    addDatePageOptions,
    DATE_KEYS,
    DATE_PAGE_KEYS,
    dateParams,
    pageParams,
    requireCurrentUserId,
} from "../lib/ai-session/helpers.js";

function addOptionalFilters(query: Record<string, string>, opts: Record<string, unknown>, keys: string[]): Record<string, string> {
    for (const key of keys) {
        const value = opts[key];
        if (value !== undefined && value !== null && String(value).trim()) {
            query[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] = String(value);
        }
    }
    return query;
}

function addHumanInputLogOptions(cmd: Command): Command {
    return addDatePageOptions(cmd)
        .option("--member <name>", "Filter by member")
        .option("--product <name>", "Filter by product")
        .option("--category <name>", "Filter by category")
        .option("--topic <name>", "Filter by topic")
        .option("--model <name>", "Filter by model")
        .option("--provider <name>", "Filter by model provider")
        .option("--repo-id <id>", "Filter by repository mapping unique_id")
        .option("--q <text>", "Search text")
        .option("--needs-review", "Only show prompts flagged for review");
}

export function registerAiSessionInsightsCommands(session: Command): void {
    session.command("policy")
        .description("Show AI session usage runtime policy")
        .action(async () => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/policy`,
            });
            console.log(JSON.stringify(result, null, 2));
        });

    session.command("overview")
        .description("Workspace-level cost, token, and member overview")
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/overview`,
                query: buildQueryFromFlags(dateParams(opts), ["date", "date_from", "date_to"]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    session.command("trend")
        .description("Daily cost/token trend over a date range")
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/trend`,
                query: buildQueryFromFlags(dateParams(opts), ["date", "date_from", "date_to"]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    session.command("by-member")
        .description("Cost and token breakdown by team member")
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/by-member`,
                query: buildQueryFromFlags(dateParams(opts), ["date", "date_from", "date_to"]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    session.command("by-product")
        .description("Cost and token breakdown by product (requires product-repo mapping)")
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/by-product`,
                query: buildQueryFromFlags(dateParams(opts), ["date", "date_from", "date_to"]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    session.command("get <entry_id>")
        .description("Retrieve a single uploaded session entry")
        .option("--product-id <id>", "Filter by product unique_id")
        .action(async (entryId: string, opts) => {
            const query = buildQueryFromFlags(
                addOptionalFilters({}, opts, ["productId"]),
                ["product_id"]
            );
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/user/session/${entryId}`,
                query,
            });
            console.log(JSON.stringify(result, null, 2));
        });

    session.command("my-sessions")
        .description("Your own session list and overview")
        .option("--user-id <id>", "User unique_id override; defaults to current credentials user_id")
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date")
        .action(async (opts) => {
            const userId = opts.userId ? String(opts.userId) : await requireCurrentUserId();
            const query = buildQueryFromFlags(dateParams(opts), [...DATE_KEYS]);
            const [overview, sessions] = await Promise.all([
                cawplanRequest({
                    method: "GET",
                    path: `/api/v1/public/openapi/ai-session-usage/user/${userId}/overview`,
                    query,
                }),
                cawplanRequest({
                    method: "GET",
                    path: `/api/v1/public/openapi/ai-session-usage/user/${userId}/sessions`,
                    query,
                }),
            ]);
            console.log(JSON.stringify({overview, sessions}, null, 2));
        });

    session.command("user-products")
        .description("List products assigned to a user")
        .option("--user-id <id>", "User unique_id override; defaults to current credentials user_id")
        .action(async (opts) => {
            const userId = opts.userId ? String(opts.userId) : await requireCurrentUserId();
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/user/${userId}/products`,
            });
            console.log(JSON.stringify(result, null, 2));
        });

    session.command("user-repos")
        .description("List repository mappings assigned to a user")
        .option("--user-id <id>", "User unique_id override; defaults to current credentials user_id")
        .action(async (opts) => {
            const userId = opts.userId ? String(opts.userId) : await requireCurrentUserId();
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/user/${userId}/repos`,
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDateOptions(session.command("user-products-usage")
        .description("User usage aggregated by product"))
        .option("--user-id <id>", "User unique_id override; defaults to current credentials user_id")
        .option("--product-id <id>", "Filter by product unique_id")
        .action(async (opts) => {
            const userId = opts.userId ? String(opts.userId) : await requireCurrentUserId();
            const query = buildQueryFromFlags(
                addOptionalFilters(dateParams(opts), opts, ["productId"]),
                [...DATE_KEYS, "product_id"]
            );
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/user/${userId}/products-usage`,
                query,
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDateOptions(session.command("user-activity")
        .description("User daily activity heatmap"))
        .option("--user-id <id>", "User unique_id override; defaults to current credentials user_id")
        .option("--product-id <id>", "Filter by product unique_id")
        .option("--metric <name>", "Activity metric")
        .action(async (opts) => {
            const userId = opts.userId ? String(opts.userId) : await requireCurrentUserId();
            const query = buildQueryFromFlags(
                addOptionalFilters(dateParams(opts), opts, ["productId", "metric"]),
                [...DATE_KEYS, "product_id", "metric"]
            );
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/user/${userId}/activity`,
                query,
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(session.command("user-trend")
        .description("Daily cost/token trend for a user"))
        .option("--user-id <id>", "User unique_id override; defaults to current credentials user_id")
        .option("--product-id <id>", "Filter by product unique_id")
        .action(async (opts) => {
            const userId = opts.userId ? String(opts.userId) : await requireCurrentUserId();
            const query = buildQueryFromFlags(
                addOptionalFilters({...dateParams(opts), ...pageParams(opts)}, opts, ["productId"]),
                [...DATE_PAGE_KEYS, "product_id"]
            );
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/user/${userId}/trend`,
                query,
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(session.command("user-by-model")
        .description("Cost and token breakdown by model for a user"))
        .option("--user-id <id>", "User unique_id override; defaults to current credentials user_id")
        .option("--product-id <id>", "Filter by product unique_id")
        .action(async (opts) => {
            const userId = opts.userId ? String(opts.userId) : await requireCurrentUserId();
            const query = buildQueryFromFlags(
                addOptionalFilters({...dateParams(opts), ...pageParams(opts)}, opts, ["productId"]),
                [...DATE_PAGE_KEYS, "product_id"]
            );
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/user/${userId}/by-model`,
                query,
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(session.command("by-model")
        .description("Cost and token breakdown by model"))
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/by-model`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(session.command("by-model-dimension")
        .description("Cost breakdown by model + dimension (input/output/cache)"))
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/by-model-dimension`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(session.command("by-agent")
        .description("Cost breakdown by coding agent (Claude Code, Cursor, etc.)"))
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/by-agent`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(session.command("by-project")
        .description("Cost breakdown by git project/repository"))
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/by-project`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    session.command("dates")
        .description("List all dates that have session data")
        .action(async () => {
            const result = await cawplanRequest({method: "GET", path: `/api/v1/public/openapi/ai-session-usage/dates`});
            console.log(JSON.stringify(result, null, 2));
        });

    session.command("members")
        .description("List all members who have session data")
        .action(async () => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/members`,
            });
            console.log(JSON.stringify(result, null, 2));
        });

    session.command("member-detail")
        .description("Full detail for a specific member")
        .requiredOption("--member <name>", "Member name (git username)")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/member-detail`,
                query: {member: opts.member},
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDateOptions(session.command("human-input-summary")
        .description("Workspace prompt quality summary: categories, topics, quality distribution"))
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/human-input-summary`,
                query: buildQueryFromFlags(dateParams(opts), [...DATE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDateOptions(session.command("human-inputs")
        .description("Paginated list of individual prompts with filtering"))
        .option("--member <name>", "Filter by member")
        .option("--product <name>", "Filter by product")
        .option("--category <name>", "Filter by category")
        .option("--topic <name>", "Filter by topic")
        .option("--q <text>", "Full-text search")
        .option("--needs-review", "Only show prompts flagged for review")
        .option("--limit <n>", "Max results (default 25)", parseInt)
        .option("--offset <n>", "Pagination offset", parseInt)
        .action(async (opts) => {
            const query: Record<string, string> = {...dateParams(opts)};
            if (opts.member) query.member = opts.member;
            if (opts.product) query.product = opts.product;
            if (opts.category) query.category = opts.category;
            if (opts.topic) query.topic = opts.topic;
            if (opts.q) query.q = opts.q;
            if (opts.needsReview) query.needs_review = "true";
            if (opts.limit != null) query.limit = String(opts.limit);
            if (opts.offset != null) query.offset = String(opts.offset);
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/human-inputs`,
                query,
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addHumanInputLogOptions(session.command("human-input-logs")
        .description("Paginated list of human collaboration logs"))
        .action(async (opts) => {
            const query = buildQueryFromFlags(
                addOptionalFilters({...dateParams(opts), ...pageParams(opts)}, opts, [
                    "member",
                    "product",
                    "category",
                    "topic",
                    "model",
                    "provider",
                    "repoId",
                ]),
                [...DATE_PAGE_KEYS, "member", "product", "category", "topic", "model", "provider", "repo_id", "search", "needs_review"]
            ) ?? {};
            if (opts.q) query.search = String(opts.q);
            if (opts.needsReview) query.needs_review = "true";
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/human-input-logs`,
                query,
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDateOptions(session.command("human-input-quality")
        .description("Prompt quality score distribution across the workspace"))
        .option("--limit <n>", "Max samples (default 100)", parseInt)
        .action(async (opts) => {
            const query: Record<string, string> = {...dateParams(opts)};
            if (opts.limit != null) query.limit = String(opts.limit);
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/human-input-quality`,
                query,
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(session.command("human-input-by-product")
        .description("Prompt count and quality breakdown by product"))
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/human-input-by-product`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDateOptions(session.command("product-overview")
        .description("Cost and token overview scoped to a specific product"))
        .requiredOption("--product-id <id>", "Product unique_id")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/product/${opts.productId}/overview`,
                query: buildQueryFromFlags(dateParams(opts), [...DATE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(session.command("product-trend")
        .description("Daily cost/token trend for a specific product"))
        .requiredOption("--product-id <id>", "Product unique_id")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/product/${opts.productId}/trend`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(session.command("product-by-member")
        .description("Per-member cost breakdown for a specific product"))
        .requiredOption("--product-id <id>", "Product unique_id")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/product/${opts.productId}/by-member`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(session.command("product-by-model")
        .description("Per-model cost breakdown for a specific product"))
        .requiredOption("--product-id <id>", "Product unique_id")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/product/${opts.productId}/by-model`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDateOptions(session.command("product-sessions")
        .description("Session list scoped to a specific product"))
        .requiredOption("--product-id <id>", "Product unique_id")
        .option("--user-id <id>", "Filter by user unique_id")
        .option("--repo-id <id>", "Filter by repository mapping unique_id")
        .option("--q <text>", "Search text")
        .option("--include-human-input-time-range", "Include human input time range per session")
        .action(async (opts) => {
            const query = buildQueryFromFlags(
                addOptionalFilters(dateParams(opts), opts, ["userId", "repoId"]),
                [...DATE_KEYS, "user_id", "repo_id", "search", "include_human_input_time_range"]
            ) ?? {};
            if (opts.q) query.search = String(opts.q);
            if (opts.includeHumanInputTimeRange) query.include_human_input_time_range = "true";
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/product/${opts.productId}/sessions`,
                query,
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDateOptions(session.command("product-human-inputs")
        .description("Prompt quality summary for a specific product"))
        .requiredOption("--product-id <id>", "Product unique_id")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/product/${opts.productId}/human-input-summary`,
                query: buildQueryFromFlags(dateParams(opts), [...DATE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addHumanInputLogOptions(session.command("product-human-input-logs")
        .description("Human collaboration logs scoped to a product"))
        .requiredOption("--product-id <id>", "Product unique_id")
        .option("--user-id <id>", "Filter by user unique_id")
        .action(async (opts) => {
            const query = buildQueryFromFlags(
                addOptionalFilters({...dateParams(opts), ...pageParams(opts)}, opts, [
                    "userId",
                    "category",
                    "topic",
                    "model",
                    "provider",
                    "repoId",
                ]),
                [...DATE_PAGE_KEYS, "user_id", "category", "topic", "model", "provider", "repo_id", "search", "needs_review"]
            ) ?? {};
            if (opts.q) query.search = String(opts.q);
            if (opts.needsReview) query.needs_review = "true";
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/product/${opts.productId}/human-input-logs`,
                query,
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDateOptions(session.command("user-human-inputs")
        .description("Prompt quality summary for a specific user"))
        .option("--user-id <id>", "User unique_id override; defaults to current credentials user_id")
        .action(async (opts) => {
            const userId = opts.userId ? String(opts.userId) : await requireCurrentUserId();
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/user/${userId}/human-input-summary`,
                query: buildQueryFromFlags(dateParams(opts), [...DATE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addHumanInputLogOptions(session.command("user-human-input-logs")
        .description("Human collaboration logs scoped to a user"))
        .option("--user-id <id>", "User unique_id override; defaults to current credentials user_id")
        .option("--product-id <id>", "Filter by product unique_id")
        .action(async (opts) => {
            const userId = opts.userId ? String(opts.userId) : await requireCurrentUserId();
            const query = buildQueryFromFlags(
                addOptionalFilters({...dateParams(opts), ...pageParams(opts)}, opts, [
                    "productId",
                    "category",
                    "topic",
                    "model",
                    "provider",
                    "repoId",
                ]),
                [...DATE_PAGE_KEYS, "product_id", "category", "topic", "model", "provider", "repo_id", "search", "needs_review"]
            ) ?? {};
            if (opts.q) query.search = String(opts.q);
            if (opts.needsReview) query.needs_review = "true";
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/user/${userId}/human-input-logs`,
                query,
            });
            console.log(JSON.stringify(result, null, 2));
        });

    session.command("conversation")
        .description("Retrieve a single session's full conversation by entry_id")
        .requiredOption("--entry-id <id>", "Session entry_id")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/conversation`,
                query: {entry_id: opts.entryId},
            });
            console.log(JSON.stringify(result, null, 2));
        });
}
