import {readFileSync, writeFileSync} from "node:fs";
import {Command} from "commander";
import {input, search, select} from "@inquirer/prompts";
import {cawplanRequest} from "../lib/http.js";
import {buildQueryFromFlags} from "../lib/cache.js";
import {collect} from "../lib/collect/index.js";
import {renderDailyApiJson} from "../lib/collect/render.js";
import type {DailyApiJson} from "../lib/collect/types.js";

type AiSessionAgent = "claude-code" | "cursor" | "codex";

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

interface ProductRepoMapping {
    product_id?: string;
    product_name?: string;
    repo_name?: string;
    repo_url?: string;
}

interface ProductChoice {
    product_id: string;
    product_name: string;
}

interface ProductListItem {
    unique_id?: string;
    name?: string;
}

interface ProductRepoSelection extends ProductRepoMapping {
    create_from_url?: boolean;
}

function extractList<T>(payload: unknown): T[] {
    if (Array.isArray(payload)) return payload as T[];
    const p = payload as Record<string, unknown> | undefined;
    if (Array.isArray(p?.data)) return p.data as T[];
    const inner = p?.data as Record<string, unknown> | undefined;
    if (Array.isArray(inner?.list)) return inner.list as T[];
    if (Array.isArray(inner?.data)) return inner.data as T[];
    return [];
}

function shortRepoName(value?: string): string {
    const raw = (value ?? "").trim();
    if (!raw) return "";
    const parts = raw.replace(/\.git$/, "").split(/[/:]/).filter(Boolean);
    return parts[parts.length - 1] ?? raw;
}

function repoKeys(value?: string): string[] {
    const raw = (value ?? "").trim();
    const short = shortRepoName(raw);
    return [...new Set([raw, short].filter(Boolean).map((v) => v.toLowerCase()))];
}

function repoNameFromGitHubUrl(repoURL: string): string {
    const repoName = shortRepoName(repoURL);
    if (!repoName || repoName === "github.com") {
        throw new Error(`Invalid GitHub repository URL: ${repoURL}`);
    }
    return repoName;
}

async function listProductRepoMappings(): Promise<ProductRepoMapping[]> {
    const result = await cawplanRequest({
        method: "GET",
        path: "/api/v1/public/openapi/ai-session-usage/product-repo",
    });
    return extractList<ProductRepoMapping>(result).filter((m) => m.product_id && m.repo_name);
}

async function listProductsForSelector(): Promise<ProductChoice[]> {
    const result = await cawplanRequest({
        method: "GET",
        path: "/api/v1/public/openapi/products",
        query: {page_size: "100"},
    });
    return extractList<ProductListItem>(result)
        .filter((p) => p.unique_id && p.name)
        .map((p) => ({
            product_id: String(p.unique_id),
            product_name: String(p.name),
        }))
        .sort((a, b) => a.product_name.localeCompare(b.product_name));
}

async function createProductRepoMapping(product: ProductChoice, repoURL: string): Promise<ProductRepoMapping> {
    const repoName = repoNameFromGitHubUrl(repoURL);
    const result = await cawplanRequest({
        method: "POST",
        path: "/api/v1/public/openapi/ai-session-usage/product-repo",
        body: {
            product_id: product.product_id,
            repo_name: repoName,
            repo_url: repoURL.trim(),
        },
    });
    const created = ((result as {data?: unknown}).data ?? result) as ProductRepoMapping;
    return {
        ...created,
        product_id: created.product_id ?? product.product_id,
        product_name: created.product_name ?? product.product_name,
        repo_name: created.repo_name ?? repoName,
        repo_url: created.repo_url ?? repoURL.trim(),
    };
}

async function searchProduct(products: ProductChoice[], message: string): Promise<ProductChoice> {
    return search<ProductChoice>({
        message,
        source: (term) => {
            const needle = (term ?? "").trim().toLowerCase();
            const filtered = needle
                ? products.filter((p) =>
                    p.product_name.toLowerCase().includes(needle)
                )
                : products;
            return [
                ...filtered.slice(0, 10).map((p) => ({
                    name: p.product_name,
                    value: p,
                    description: p.product_id,
                })),
                {
                    name: "No product",
                    value: {product_id: "", product_name: ""},
                },
            ];
        },
        pageSize: 10,
    });
}

function findMappingForProject(project: string, mappings: ProductRepoMapping[]): ProductRepoMapping | undefined {
    const keys = new Set(repoKeys(project));
    return mappings.find((mapping) => repoKeys(mapping.repo_name).some((key) => keys.has(key)));
}

function updateReposForSelectedMapping(
    repos: DailyApiJson["repos"] | undefined,
    originalProject: string,
    mapping: ProductRepoMapping
): void {
    if (!Array.isArray(repos)) return;
    const originalKeys = new Set(repoKeys(originalProject));
    const selectedKeys = new Set(repoKeys(mapping.repo_name));
    for (const repo of repos) {
        const keys = repoKeys(repo.repo_name ?? repo.repo);
        const matched = keys.some((key) => originalKeys.has(key) || selectedKeys.has(key));
        if (!matched) continue;
        repo.repo_name = mapping.repo_name;
        repo.repo_url = mapping.repo_url;
        repo.product_id = mapping.product_id;
        repo.product_name = mapping.product_name;
    }
}

async function assignProjectsFromCloudMappings(daily: DailyApiJson): Promise<number> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error("--assign-product requires an interactive TTY");
    }

    const mappings = await listProductRepoMappings();
    const products = await listProductsForSelector();
    if (products.length === 0) throw new Error("No products returned from cawplan products list");

    const sessions = daily.sessions;
    if (!Array.isArray(sessions) || sessions.length === 0) {
        console.error("No sessions found in the collected report; skipping product assignment.");
        return 0;
    }

    const repos = daily.repos;

    let matched = 0;
    for (const [index, session] of sessions.entries()) {
        const originalProject = (session.project ?? "").trim();
        const sessionLabel = session.session_name ?? session.session_title ?? session.session_id ?? `session ${index + 1}`;
        const inferredMapping = findMappingForProject(originalProject, mappings);
        if (inferredMapping?.repo_name && inferredMapping.product_id) {
            session.project = inferredMapping.repo_name;
            session.product_id = inferredMapping.product_id;
            session.product_name = inferredMapping.product_name;
            matched++;
            updateReposForSelectedMapping(repos, originalProject, inferredMapping);
            console.error(`Auto-assigned session "${sessionLabel}" to ${inferredMapping.product_name ?? inferredMapping.product_id} / ${inferredMapping.repo_name}`);
            continue;
        }

        const product = await searchProduct(
            products,
            `Search product for session "${sessionLabel}"${originalProject ? ` (project: ${originalProject})` : ""}`
        );
        if (!product.product_id) continue;

        const productMappings = mappings
            .filter((m) => m.product_id === product.product_id && m.repo_name)
            .sort((a, b) => String(a.repo_name).localeCompare(String(b.repo_name)));
        let mapping = await select<ProductRepoSelection>({
            message: `Select repository for session "${sessionLabel}"`,
            choices: [
                ...productMappings.map((m) => ({
                    name: String(m.repo_name),
                    value: m,
                    description: m.repo_url ?? m.product_name ?? m.product_id,
                })),
                {
                    name: "Create mapping from GitHub URL",
                    value: {
                        product_id: product.product_id,
                        product_name: product.product_name,
                        create_from_url: true,
                    },
                },
                {
                    name: "No repository; assign product only",
                    value: {
                        product_id: product.product_id,
                        product_name: product.product_name,
                    },
                },
            ],
            pageSize: 15,
        });
        if (mapping.create_from_url) {
            const repoURL = await input({
                message: `GitHub repository URL for session "${sessionLabel}"`,
                validate: (value) => {
                    try {
                        repoNameFromGitHubUrl(value);
                        return true;
                    } catch (e) {
                        return (e as Error).message;
                    }
                },
            });
            mapping = await createProductRepoMapping(product, repoURL);
            mappings.push(mapping);
        }
        if (!mapping.product_id) continue;

        if (mapping.repo_name) {
            session.project = mapping.repo_name;
            updateReposForSelectedMapping(repos, originalProject, mapping);
        }
        session.product_id = mapping.product_id;
        session.product_name = mapping.product_name;
        matched++;
    }

    return matched;
}

export function registerAiSessionCommand(program: Command): void {
    const ai = program.command("ai-session").description("AI coding session usage");

    // ── Collect ──────────────────────────────────────────────────────────────────

    ai.command("collect")
        .description("Collect AI coding session data from local agents and write ai-daily-<date>.json")
        .option("--date <YYYY-MM-DD>", "Date to collect (default: today)")
        .option(
            "--agent <name>",
            "Agent(s) to collect from: claude-code, cursor, codex (repeatable)",
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
                const daily = await collect({
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

                // manually specify the product and repo
                const matched = await assignProjectsFromCloudMappings(daily);
                writeFileSync(outputPath, JSON.stringify(daily, null, 2), "utf-8");
                console.error(`Product/project assignment written for ${matched} sessions.`);

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
            "Upload a daily AI coding session report. Provide --file"
        )
        .requiredOption("--file <path>", "Path to daily.json; must contain 'author' and 'date' fields")
        .action(async (opts) => {
            let payload: DailyApiJson | undefined;

            try {
                payload = JSON.parse(readFileSync(opts.file, "utf-8")) as DailyApiJson;
            } catch (e) {
                console.error(`Error: cannot read ${opts.file}: ${(e as Error).message}`);
                process.exit(1);
            }

            if (!payload?.author || !payload.date) {
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
                const daily = JSON.parse(readFileSync(inputPath, "utf-8")) as DailyApiJson;
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
