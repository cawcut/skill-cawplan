import {readFileSync, writeFileSync} from "node:fs";
import {Command} from "commander";
import {input, search, select} from "@inquirer/prompts";
import {cawplanRequest} from "../lib/http.js";
import {buildQueryFromFlags} from "../lib/cache.js";
import {listProducts} from "./products.js";
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

interface ProductChoice {
    product_id: string;
    product_name: string;
}

interface ProductRepoMapping {
    product_id?: string;
    product_name?: string;
    repo_name?: string;
    repo_url?: string;
    unique_id?: string;
}

interface ProductListItem {
    unique_id?: string;
    name?: string;
}

interface ProductRepoSelection extends ProductRepoMapping {
    create_from_url?: boolean;
}

type DailySession = DailyApiJson["sessions"][number];

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
    const raw = repoURL.trim();
    if (!raw) throw new Error("GitHub repository URL is required");

    try {
        const url = new URL(raw);
        const isGitHubHost = url.hostname.toLowerCase() === "github.com";
        const parts = url.pathname.replace(/^\//, "").split("/");
        const owner = parts[0] ?? "";
        const repo = parts[1] ?? "";
        const hasRepoPath = parts.length === 2 && owner && repo;
        const validOwner = /^[A-Za-z0-9-]+$/.test(owner);
        const validRepo = /^[A-Za-z0-9._-]+$/.test(repo);

        if (url.protocol === "https:" && isGitHubHost && hasRepoPath && validOwner && validRepo) {
            return repo;
        }
    } catch {
        // Fall through to the consistent error below.
    }

    throw new Error(`Invalid GitHub repository URL: ${repoURL}`);
}

async function listProductRepoMappings(): Promise<ProductRepoMapping[]> {
    const result = await cawplanRequest({
        method: "GET",
        path: "/api/v1/public/openapi/ai-session-usage/product-repo",
    });
    return extractList<ProductRepoMapping>(result).filter((m) => m.product_id && m.repo_name);
}

async function createProductRepoMapping(opts: {
    productId: string;
    repoUrl: string;
    repoName?: string;
}): Promise<ProductRepoMapping> {
    const repoName = opts.repoName?.trim() || repoNameFromGitHubUrl(opts.repoUrl);
    const repoUrl = opts.repoUrl.trim();
    const result = await cawplanRequest({
        method: "POST",
        path: "/api/v1/public/openapi/ai-session-usage/product-repo",
        body: {
            product_id: opts.productId,
            repo_name: repoName,
            repo_url: repoUrl,
        },
    });
    const created = ((result as {data?: unknown}).data ?? result) as ProductRepoMapping;
    return {
        ...created,
        product_id: created.product_id ?? opts.productId,
        repo_name: created.repo_name ?? repoName,
        repo_url: created.repo_url ?? repoUrl,
    };
}

function toProductChoices(result: unknown): ProductChoice[] {
    return extractList<ProductListItem>(result)
        .filter((p) => p.unique_id && p.name)
        .map((p) => ({
            product_id: String(p.unique_id),
            product_name: String(p.name),
        }))
        .sort((a, b) => a.product_name.localeCompare(b.product_name));
}

async function listProductsForSelector(): Promise<ProductChoice[]> {
    return toProductChoices(await listProducts({pageSize: "100"}));
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

function findMappingForProductRepo(
    productId: string,
    repoName: string,
    mappings: ProductRepoMapping[]
): ProductRepoMapping | undefined {
    const keys = new Set(repoKeys(repoName));
    return mappings.find((mapping) =>
        mapping.product_id === productId &&
        repoKeys(mapping.repo_name).some((key) => keys.has(key))
    );
}

function readDailyReport(path: string): DailyApiJson {
    try {
        const daily = JSON.parse(readFileSync(path, "utf-8")) as DailyApiJson;
        if (!daily?.author || !daily.date || !Array.isArray(daily.sessions)) {
            throw new Error("daily report must contain author, date, and sessions");
        }
        return daily;
    } catch (e) {
        throw new Error(`cannot read ${path}: ${(e as Error).message}`);
    }
}

function findSessionById(daily: DailyApiJson, sessionId: string): DailySession {
    const session = daily.sessions.find((s) => s.session_id === sessionId);
    if (!session) throw new Error(`session not found: ${sessionId}`);
    return session;
}

function findProductById(products: ProductChoice[], productId: string): ProductChoice {
    const product = products.find((p) => p.product_id === productId);
    if (!product) throw new Error(`product not found: ${productId}`);
    return product;
}

function updateReposForSelectedMapping(
    repos: DailyApiJson["repos"] | undefined,
    originalProject: string,
    mapping: ProductRepoMapping
): number {
    if (!Array.isArray(repos)) return 0;
    const originalKeys = new Set(repoKeys(originalProject));
    const selectedKeys = new Set(repoKeys(mapping.repo_name));
    let updated = 0;
    for (const repo of repos) {
        const keys = repoKeys(repo.repo_name ?? repo.repo);
        const matched = keys.some((key) => originalKeys.has(key) || selectedKeys.has(key));
        if (!matched) continue;
        repo.repo_name = mapping.repo_name;
        repo.repo_url = mapping.repo_url;
        repo.product_id = mapping.product_id;
        repo.product_name = mapping.product_name;
        updated++;
    }
    return updated;
}

function applyProductRepoMapping(
    daily: DailyApiJson,
    session: DailySession,
    mapping: ProductRepoMapping
): void {
    if (!mapping.product_id) throw new Error("product_id is required");

    const originalProject = (session.project ?? "").trim();
    if (mapping.repo_name) {
        session.project = mapping.repo_name;
        updateReposForSelectedMapping(daily.repos, originalProject, mapping);
        const updatedSessionRepos = updateReposForSelectedMapping(session.repos_touched, originalProject, mapping);
        if (updatedSessionRepos === 0 && session.repos_touched.length === 1) {
            session.repos_touched[0].repo_name = mapping.repo_name;
            session.repos_touched[0].repo_url = mapping.repo_url;
            session.repos_touched[0].product_id = mapping.product_id;
            session.repos_touched[0].product_name = mapping.product_name;
        }
    }
    session.product_id = mapping.product_id;
    session.product_name = mapping.product_name;
}

async function assignProjectsFromCloudMappings(daily: DailyApiJson): Promise<number> {

    const sessions = daily.sessions;
    if (!Array.isArray(sessions) || sessions.length === 0) {
        console.error("No sessions found in the collected report; skipping product assignment.");
        return 0;
    }

    let matched = 0;
    let skippedInteractiveSelection = 0;
    const mappings = await listProductRepoMappings();

    const canPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const products = canPrompt ? await listProductsForSelector() : [];
    if (canPrompt && products.length === 0) throw new Error("No products returned from cawplan products list");

    for (const [index, session] of sessions.entries()) {
        const originalProject = (session.project ?? "").trim();
        const sessionLabel = session.session_name ?? session.session_title ?? session.session_id ?? `session ${index + 1}`;
        const inferredMapping = findMappingForProject(originalProject, mappings);
        if (inferredMapping?.repo_name && inferredMapping.product_id) {
            applyProductRepoMapping(daily, session, inferredMapping);
            matched++;
            console.error(`Auto-assigned session "${sessionLabel}" to ${inferredMapping.product_name ?? inferredMapping.product_id} / ${inferredMapping.repo_name}`);
            continue;
        }

        if (!canPrompt) {
            skippedInteractiveSelection++;
            continue;
        }

        const product = await searchProduct(
            products,
            `Select product for session "${sessionLabel}"${originalProject ? ` (project: ${originalProject})` : ""}`
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
                    name: "No repository; link one",
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
            mapping = {
                ...(await createProductRepoMapping({
                    productId: product.product_id,
                    repoUrl: repoURL,
                })),
                product_name: product.product_name,
            };
            mappings.push(mapping);
        }
        if (!mapping.product_id) continue;

        applyProductRepoMapping(daily, session, mapping);
        matched++;
    }

    if (skippedInteractiveSelection > 0) {
        console.error(
            `Skipped product/repository selection for ${skippedInteractiveSelection} session(s) because collect is running without an interactive TTY.`
        );
        console.error(
            `To complete selector-based assignment, run: cawplan ai-session collect --date ${daily.date}`
        );
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

    // ── Product assignment ───────────────────────────────────────────────────────

    ai.command("products")
        .description("List CawPlan products for report assignment")
        .option("--q <text>", "Filter products by name")
        .action(async (opts) => {
            try {
                const needle = String(opts.q ?? "").trim().toLowerCase();
                const products = toProductChoices(await listProducts({search: String(opts.q ?? ""), pageSize: "100"}))
                    .filter((product) => !needle || product.product_name.toLowerCase().includes(needle));
                console.log(JSON.stringify({products}, null, 2));
            } catch (e) {
                console.error(`Error: ${(e as Error).message}`);
                process.exit(1);
            }
        });

    const productRepos = ai.command("product-repos")
        .description("List product-repository mappings for report assignment")
        .option("--product-id <id>", "Filter mappings by product unique_id")
        .option("--q <text>", "Filter mappings by repo name or URL")
        .action(async (opts) => {
            try {
                const needle = String(opts.q ?? "").trim().toLowerCase();
                const mappings = (await listProductRepoMappings())
                    .filter((mapping) => !opts.productId || mapping.product_id === opts.productId)
                    .filter((mapping) => {
                        if (!needle) return true;
                        return [mapping.repo_name, mapping.repo_url, mapping.product_name]
                            .filter(Boolean)
                            .some((value) => String(value).toLowerCase().includes(needle));
                    })
                    .sort((a, b) =>
                        `${a.product_name ?? ""}/${a.repo_name ?? ""}`.localeCompare(
                            `${b.product_name ?? ""}/${b.repo_name ?? ""}`
                        )
                    );
                console.log(JSON.stringify({mappings}, null, 2));
            } catch (e) {
                console.error(`Error: ${(e as Error).message}`);
                process.exit(1);
            }
        });

    productRepos
        .command("create")
        .description("Create a product-repository mapping for report assignment")
        .requiredOption("--product-id <id>", "Product unique_id")
        .requiredOption("--repo-url <url>", "GitHub repository URL")
        .option("--repo-name <name>", "Repository name; inferred from --repo-url when omitted")
        .action(async (opts) => {
            try {
                const mapping = await createProductRepoMapping({
                    productId: String(opts.productId),
                    repoUrl: String(opts.repoUrl),
                    repoName: opts.repoName ? String(opts.repoName) : undefined,
                });
                console.log(JSON.stringify({mapping}, null, 2));
            } catch (e) {
                console.error(`Error: ${(e as Error).message}`);
                process.exit(1);
            }
        });

    ai.command("assign")
        .description("Assign a report session to a product and optional repository without interactive prompts")
        .requiredOption("--file <path>", "Path to ai-daily JSON file")
        .requiredOption("--session-id <id>", "Session ID to assign")
        .requiredOption("--product-id <id>", "Product unique_id")
        .option("--repo-name <name>", "Existing product-repo repo_name to assign")
        .option("--repo-url <url>", "GitHub repository URL to create and assign")
        .option("--create-mapping", "Create product-repo mapping from --repo-url before assigning")
        .action(async (opts) => {
            try {
                const daily = readDailyReport(String(opts.file));
                const session = findSessionById(daily, String(opts.sessionId));
                const products = await listProductsForSelector();
                const product = findProductById(products, String(opts.productId));
                const mappings = await listProductRepoMappings();

                let mapping: ProductRepoMapping = {
                    product_id: product.product_id,
                    product_name: product.product_name,
                };
                let createdMapping = false;

                if (opts.repoUrl) {
                    if (!opts.createMapping) {
                        throw new Error("--repo-url requires --create-mapping so mapping creation is explicit");
                    }
                    mapping = {
                        ...(await createProductRepoMapping({
                            productId: product.product_id,
                            repoUrl: String(opts.repoUrl),
                        })),
                        product_name: product.product_name,
                    };
                    createdMapping = true;
                } else if (opts.repoName) {
                    const existing = findMappingForProductRepo(product.product_id, String(opts.repoName), mappings);
                    if (!existing) {
                        throw new Error(`product-repo mapping not found for product ${product.product_id} and repo ${opts.repoName}`);
                    }
                    mapping = existing;
                }

                applyProductRepoMapping(daily, session, mapping);
                writeFileSync(String(opts.file), JSON.stringify(daily, null, 2), "utf-8");
                console.log(JSON.stringify({
                    file: String(opts.file),
                    session_id: session.session_id,
                    session_name: session.session_name,
                    product_id: session.product_id,
                    product_name: session.product_name,
                    repo_name: mapping.repo_name,
                    repo_url: mapping.repo_url,
                    created_mapping: createdMapping,
                }, null, 2));
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
