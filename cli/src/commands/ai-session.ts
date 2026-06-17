import {readFileSync, writeFileSync} from "node:fs";
import {Command} from "commander";
import {cawplanRequest} from "../lib/http.js";
import {buildQueryFromFlags} from "../lib/cache.js";
import {collect} from "../lib/collect/index.js";
import { renderDailyApiJson } from "../lib/collect/render.js";

type AiSessionAgent = "claude-code" | "cursor" | "cursor-gui" | "codex";

function dateParams(opts: { date?: string; from?: string; to?: string }): Record<string, string> {
    const q: Record<string, string> = {};
    if (opts.date) q.date = opts.date;
    if (opts.from) q.date_from = opts.from;
    if (opts.to) q.date_to = opts.to;
    return q;
}

function pageParams(opts: { pageNum?: number; pageSize?: number }): Record<string, string> {
    const q: Record<string, string> = {};
    if (opts.pageNum != null) q.page_num = String(opts.pageNum);
    if (opts.pageSize != null) q.page_size = String(opts.pageSize);
    return q;
}

function addDatePageOptions(cmd: Command): Command {
    return cmd
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date")
        .option("--page-num <n>", "Page number", parseInt)
        .option("--page-size <n>", "Page size", parseInt);
}

function addDateOptions(cmd: Command): Command {
    return cmd
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date");
}

const DATE_PAGE_KEYS = ["date", "date_from", "date_to", "page_num", "page_size"] as const;
const DATE_KEYS = ["date", "date_from", "date_to"] as const;

async function collectAiSessions(opts: {
    date: string;
    agents?: AiSessionAgent[];
    outputPath: string;
}): Promise<Record<string, unknown>> {
    return collect({
        date: opts.date,
        agents: opts.agents,
        outputPath: opts.outputPath,
    }) as unknown as Record<string, unknown>;
}

export function registerAiSessionCommand(program: Command): void {
    const ai = program.command("ai-session").description("AI coding session usage");

    // ── Collect ──────────────────────────────────────────────────────────────────

    ai.command("collect")
        .description("Collect AI coding session data from local agents and write ai-daily-<date>.json")
        .option("--date <YYYY-MM-DD>", "Date to collect (default: today)")
        .option(
            "--agent <name>",
            "Agent(s) to collect from: claude-code, cursor, cursor-gui, codex (repeatable)",
            (val: string, prev: string[]) => [...prev, val],
            [] as string[]
        )
        .option("--output <path>", "Output file path (default: ./ai-daily-<date>.json)")
        .action(async (opts) => {
            const date = opts.date ?? new Date().toISOString().slice(0, 10);
            const outputPath: string = opts.output ?? `ai-daily-${date}.json`;
            const agents =
                opts.agent && opts.agent.length > 0
                    ? (opts.agent as AiSessionAgent[])
                    : undefined;

            console.error(`Collecting AI session data for ${date}...`);
            try {
                const daily = await collectAiSessions({
                    date,
                    agents,
                    outputPath,
                });
                console.error(
                    `Collected ${
                        (daily.totals as { sessions?: number })?.sessions ?? 0
                    } sessions from agents: ${
                        ((daily.totals as { agents?: string[] })?.agents ?? []).join(", ") || "none"
                    }`
                );
                console.error(`Output written to ${outputPath}`);
                console.log(JSON.stringify(daily, null, 2));
            } catch (e) {
                console.error(`Error: ${(e as Error).message}`);
                process.exit(1);
            }
        });

    // ── Commit ──────────────────────────────────────────────────────────────────

    ai.command("report")
        .description(
            "Upload a daily AI coding session report. Provide --file, or use --date to auto-collect."
        )
        .option("--file <path>", "Path to daily.json; must contain 'author' and 'date' fields")
        .option("--date <YYYY-MM-DD>", "Date to auto-collect and upload (default: today if no --file)")
        .action(async (opts) => {
            let payload: Record<string, unknown> = {};

            if (opts.file) {
                // Load from file as before
                try {
                    payload = JSON.parse(readFileSync(opts.file, "utf-8")) as Record<string, unknown>;
                } catch (e) {
                    console.error(`Error: cannot read ${opts.file}: ${(e as Error).message}`);
                    process.exit(1);
                }
            } else {
                // Auto-collect for the given date (or today)
                const date = opts.date ?? new Date().toISOString().slice(0, 10);
                console.error(`Auto-collecting AI session data for ${date}...`);
                try {
                    payload = await collectAiSessions({
                        date,
                        outputPath: `ai-daily-${date}.json`,
                    });
                } catch (e) {
                    console.error(`Error during collection: ${(e as Error).message}`);
                    process.exit(1);
                }
            }

            if (!payload.author || !payload.date) {
                console.error("Error: daily.json must contain 'author' and 'date' fields");
                process.exit(1);
            }

            const result = await cawplanRequest({
                method: "POST",
                path: `/api/v1/public/openapi/ai-session-usage/reports`,
                body: payload,
            });
            console.log(JSON.stringify(result, null, 2));
        });


    // ── Render ───────────────────────────────────────────────────────────────────

    ai.command("render")
        .description("Render ai-daily JSON with summaries into enriched daily.api.json")
        .option("--input <path>", "Input ai-daily file path", "ai-daily.json")
        .option("--summaries <dir>", "Directory for per-session summaries", "summaries")
        .option("--output <path>", "Output file path", "daily.api.json")
        .action((opts) => {
            const inputPath = String(opts.input ?? "ai-daily.json");
            const summariesDir = String(opts.summaries ?? "summaries");
            const outputPath = String(opts.output ?? "daily.api.json");

            try {
                const daily = JSON.parse(readFileSync(inputPath, "utf-8")) as import("../lib/collect/types.js").DailyApiJson;
                const rendered = renderDailyApiJson(daily, summariesDir);
                writeFileSync(outputPath, JSON.stringify(rendered, null, 2), "utf-8");
                console.error(`Rendered report written to ${outputPath}`);
                console.log(JSON.stringify(rendered, null, 2));
            } catch (e) {
                console.error(`Error: ${(e as Error).message}`);
                process.exit(1);
            }
        });

    // ── Insights ─────────────────────────────────────────────────────────────────

    ai.command("overview")
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

    ai.command("trend")
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

    ai.command("by-member")
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

    ai.command("by-product")
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

    ai.command("my-sessions")
        .description("Your own session list and overview")
        .requiredOption("--user-id <id>", "Your user unique_id (from: cawplan users query --email <you>)")
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date")
        .action(async (opts) => {
            const query = buildQueryFromFlags(dateParams(opts), [...DATE_KEYS]);
            const [overview, sessions] = await Promise.all([
                cawplanRequest({
                    method: "GET",
                    path: `/api/v1/public/openapi/ai-session-usage/user/${opts.userId}/overview`,
                    query
                }),
                cawplanRequest({
                    method: "GET",
                    path: `/api/v1/public/openapi/ai-session-usage/user/${opts.userId}/sessions`,
                    query
                }),
            ]);
            console.log(JSON.stringify({overview, sessions}, null, 2));
        });

    // ── Workspace breakdown dimensions ──────────────────────────────────────────

    addDatePageOptions(ai.command("by-model")
        .description("Cost and token breakdown by AI model"))
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/by-model`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(ai.command("by-model-dimension")
        .description("Cost breakdown by model + dimension (input/output/cache)"))
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/by-model-dimension`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(ai.command("by-agent")
        .description("Cost breakdown by AI coding agent (Claude Code, Cursor, etc.)"))
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/by-agent`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(ai.command("by-project")
        .description("Cost breakdown by git project/repository"))
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/by-project`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    // ── Utility ──────────────────────────────────────────────────────────────────

    ai.command("dates")
        .description("List all dates that have session data")
        .action(async () => {
            const result = await cawplanRequest({method: "GET", path: `/api/v1/public/openapi/ai-session-usage/dates`});
            console.log(JSON.stringify(result, null, 2));
        });

    ai.command("members")
        .description("List all members who have session data")
        .action(async () => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/members`
            });
            console.log(JSON.stringify(result, null, 2));
        });

    ai.command("member-detail")
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

    // ── Human Input (Prompt) analysis ────────────────────────────────────────────

    addDateOptions(ai.command("human-input-summary")
        .description("Workspace prompt quality summary: categories, topics, quality distribution"))
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/human-input-summary`,
                query: buildQueryFromFlags(dateParams(opts), [...DATE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDateOptions(ai.command("human-inputs")
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

    addDateOptions(ai.command("human-input-quality")
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

    addDatePageOptions(ai.command("human-input-by-product")
        .description("Prompt count and quality breakdown by product"))
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/human-input-by-product`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    // ── Product-scoped views ──────────────────────────────────────────────────────

    addDateOptions(ai.command("product-overview")
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

    addDatePageOptions(ai.command("product-trend")
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

    addDatePageOptions(ai.command("product-by-member")
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

    addDatePageOptions(ai.command("product-by-model")
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

    addDateOptions(ai.command("product-human-inputs")
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

    // ── User-scoped views ─────────────────────────────────────────────────────────

    addDateOptions(ai.command("user-human-inputs")
        .description("Prompt quality summary for a specific user"))
        .requiredOption("--user-id <id>", "User unique_id")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/user/${opts.userId}/human-input-summary`,
                query: buildQueryFromFlags(dateParams(opts), [...DATE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    // ── Conversation drill-down ───────────────────────────────────────────────────

    ai.command("conversation")
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
