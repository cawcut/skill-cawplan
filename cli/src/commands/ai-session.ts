import {readFileSync, writeFileSync} from "node:fs";
import {Command} from "commander";
import {buildQueryFromFlags} from "../lib/cache.js";
import {cawplanRequest} from "../lib/http.js";
import {collect} from "../lib/collect/index.js";
import {renderDailyApiJson} from "../lib/collect/render.js";
import type {DailyApiJson} from "../lib/collect/types.js";
import {
    addReportQueryOptions,
    dateParams,
    limitOffsetParams,
    parseISODate,
} from "../lib/ai-session/helpers.js";
import {backfillMissingReports} from "../lib/ai-session/backfill.js";
import {uploadDailyReport} from "../lib/ai-session/reports-api.js";
import type {AiSessionAgent} from "../lib/ai-session/types.js";
import {assignProjectsFromCloudMappings} from "../lib/assign/auto-assign.js";
import {
    createProductRepoMapping,
    listProductRepoMappings,
    toProductChoices,
} from "../lib/assign/products-api.js";
import {readDailyReport, writeDailyReport} from "../lib/assign/report-io.js";
import {assertAllSessionsHaveProduct, warnMissingProductAssignment} from "../lib/assign/session-checks.js";
import {
    assignReportsFromTty,
    readDailyReports,
    startAssignmentWebServer,
} from "../lib/assign/web-server.js";
import {listCawplanProducts} from "../lib/product-catalog.js";
import {registerAiSessionInsightsCommands} from "./ai-session-insights.js";

export function registerAiSessionCommand(program: Command): void {
    const ai = program.command("ai-session").description("AI coding session usage");

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
                const daily = await collect({date, agents});
                writeDailyReport(outputPath, daily);
                console.error(
                    `Collected ${
                        (daily.totals as {sessions?: number})?.sessions ?? 0
                    } sessions from agents: ${
                        ((daily.totals as {agents?: string[]})?.agents ?? []).join(", ") || "none"
                    }`
                );

                const matched = await assignProjectsFromCloudMappings(daily, outputPath);
                console.error(`Product/project assignment written for ${matched} sessions.`);
                warnMissingProductAssignment(outputPath, daily);

                console.error(`Output written to ${outputPath}`);
            } catch (e) {
                console.error(`Error: ${(e as Error).message}`);
                process.exit(1);
            }
        });

    ai.command("products")
        .description("List CawPlan products for report assignment")
        .option("--q <text>", "Filter products by name")
        .action(async (opts) => {
            try {
                const needle = String(opts.q ?? "").trim().toLowerCase();
                const products = toProductChoices(await listCawplanProducts({search: String(opts.q ?? ""), pageSize: "100"}))
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
        .description("Assign report sessions to products and optional repositories")
        .option("--file <path>", "Path to ai-daily JSON file")
        .option("--files <path>", "Batch assign ai-daily JSON file paths with --web or --tty (repeatable)", (val: string, prev: string[]) => [...prev, val], [] as string[])
        .option("--tty", "Assign sessions using cloud mappings and interactive selector when available")
        .option("--web", "Assign sessions in a local web page")
        .action(async (opts) => {
            try {
                if (Array.isArray(opts.files) && opts.files.length > 0) {
                    const reports = readDailyReports(opts.files.map(String));
                    if (opts.web) {
                        await startAssignmentWebServer(reports, true);
                        return;
                    }
                    if (opts.tty) {
                        const result = await assignReportsFromTty(reports);
                        console.log(JSON.stringify({
                            files: result.files,
                            assigned_sessions: result.assignedSessions,
                        }, null, 2));
                        return;
                    }
                    throw new Error("--files requires --web or --tty");
                }
                if (!opts.file) throw new Error("--file is required unless --files is set");
                const daily = readDailyReport(String(opts.file));
                if (opts.web) {
                    await startAssignmentWebServer([{file: String(opts.file), daily}]);
                    return;
                }

                if (opts.tty) {
                    const file = String(opts.file);
                    const assignedSessions = await assignProjectsFromCloudMappings(daily, file);
                    assertAllSessionsHaveProduct(daily);
                    console.log(JSON.stringify({
                        file,
                        assigned_sessions: assignedSessions,
                    }, null, 2));
                    return;
                }

                throw new Error("assign requires --web or --tty");
            } catch (e) {
                console.error(`Error: ${(e as Error).message}`);
                process.exit(1);
            }
        });

    ai.command("report")
        .description("Upload a daily AI coding session report. Provide --file")
        .requiredOption("--file <path>", "Path to daily.json; must contain 'author' and 'date' fields")
        .action(async (opts) => {
            let payload: DailyApiJson;
            try {
                payload = readDailyReport(String(opts.file));
            } catch (e) {
                console.error(`Error: ${(e as Error).message}`);
                process.exit(1);
            }

            if (warnMissingProductAssignment(String(opts.file), payload)) {
                process.exit(1);
            }

            const result = await uploadDailyReport(payload);
            console.log(JSON.stringify(result, null, 2));
        });

    ai.command("backfill")
        .description("Collect and upload missing AI daily reports in a date range")
        .requiredOption("--from <YYYY-MM-DD>", "Start date")
        .requiredOption("--to <YYYY-MM-DD>", "End date")
        .option("--dry-run", "Only list missing report dates without collecting or uploading")
        .action(async (opts) => {
            try {
                const dateFrom = String(opts.from);
                const dateTo = String(opts.to);
                parseISODate(dateFrom);
                parseISODate(dateTo);

                const backfill = await backfillMissingReports(dateFrom, dateTo, {
                    dryRun: Boolean(opts.dryRun),
                });
                console.log(JSON.stringify(backfill, null, 2));
            } catch (e) {
                console.error(`Error: ${(e as Error).message}`);
                process.exit(1);
            }
        });

    addReportQueryOptions(ai.command("reports")
        .description("List uploaded AI daily reports"))
        .action(async (opts) => {
            const query = buildQueryFromFlags({
                ...dateParams(opts),
                ...limitOffsetParams(opts),
                ...(opts.userId ? {user_id: String(opts.userId)} : {}),
            }, ["date", "date_from", "date_to", "user_id", "limit", "offset"]);
            const result = await cawplanRequest({
                method: "GET",
                path: "/api/v1/public/openapi/ai-session-usage/reports",
                query,
            });
            console.log(JSON.stringify(result, null, 2));
        });

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

    registerAiSessionInsightsCommands(ai);
}
