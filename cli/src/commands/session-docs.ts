import type {Command} from "commander";
import {cawplanRequest} from "../lib/http.js";
import {resolveApiPath} from "../lib/products.js";
import {readDailyReport} from "../lib/assign/report-io.js";
import {extractList} from "../lib/ai-session/helpers.js";
import {
    collectDocCandidates,
    gitNewnessOnDisk,
    planDocs,
    selectDocCandidates,
    statFileOnDisk,
    summarizePlan,
    type DatasetRef,
    type ModuleNode,
    type PlanDeps,
    type TicketInfo,
} from "../lib/ai-session/docs-plan.js";

function flattenModules(nodes: ModuleNode[] | undefined, out: ModuleNode[]): void {
    for (const node of nodes ?? []) {
        out.push(node);
        flattenModules((node as {children?: ModuleNode[]}).children, out);
    }
}

export function liveDocsPlanDeps(): PlanDeps {
    return {
        async fetchTickets(uniqueIds: string[]): Promise<TicketInfo[]> {
            const result = await cawplanRequest({
                method: "POST",
                path: resolveApiPath("/api/v1/public/openapi/tickets/search"),
                query: {page_size: String(Math.max(uniqueIds.length, 20))},
                body: {unique_ids: uniqueIds},
            });
            return extractList<TicketInfo>(result).filter((t) => t.unique_id);
        },
        async fetchModuleNodes(productId: string): Promise<ModuleNode[]> {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/product/${encodeURIComponent(productId)}/module-tree`,
                query: {expand: "knowledge"},
            });
            const nodes = (result as {data?: {nodes?: ModuleNode[]}})?.data?.nodes;
            const flat: ModuleNode[] = [];
            flattenModules(nodes, flat);
            return flat;
        },
        async fetchDatasets(productId: string): Promise<DatasetRef[]> {
            const result = await cawplanRequest({
                method: "GET",
                path: "/api/v1/public/openapi/knowledge/datasets",
                query: {product_id: productId},
            });
            const data = (result as {data?: {datasets?: {id?: string; name?: string}[]}})?.data;
            return (data?.datasets ?? []).filter((d): d is DatasetRef => Boolean(d.id));
        },
        statFile: statFileOnDisk,
    };
}

export function registerSessionDocsCommands(session: Command): void {
    const docs = session.command("docs")
        .description("Markdown documents a coding session wrote (technical notes, test cases, ...) and where they would go in Knowledge");

    docs.command("plan")
        .description(
            "Read-only. Lists the NEW markdown documents each session in an ai-daily report wrote (new per git, " +
            "else per the report; code files are ignored), newest and largest first, and, from the " +
            "session's linked tickets, the product, module and dataset each would be uploaded to. Prints " +
            "JSON; a ready item carries the exact `knowledge documents upload` command. Nothing is uploaded.",
        )
        .requiredOption("--file <path>", "ai-daily-<date>.json produced by `session collect`")
        .option("--include-edited", "Also list markdown files the session edited, not only the ones it wrote")
        .action(async (opts: {file: string; includeEdited?: boolean}) => {
            try {
                const report = readDailyReport(opts.file);
                const candidates = selectDocCandidates(collectDocCandidates(report), {
                    includeEdited: Boolean(opts.includeEdited),
                    gitNewness: gitNewnessOnDisk,
                });
                const items = await planDocs(candidates, report.sessions, liveDocsPlanDeps());
                console.log(JSON.stringify({
                    date: report.date,
                    author: report.author,
                    summary: summarizePlan(items),
                    items,
                }, null, 2));
            } catch (e) {
                console.error(`Error: ${(e as Error).message}`);
                process.exit(1);
            }
        });
}
