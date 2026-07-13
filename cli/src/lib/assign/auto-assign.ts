import type {DailyApiJson} from "../collect/types.js";
import {normalizeSessionRepoContext} from "../collect/index.js";
import {applyProductRepoMappingToProject} from "./apply.js";
import {findMappingForSession} from "./matching.js";
import {
    createProductRepoMapping,
    listProductRepoMappings,
    listProductsForSelector,
    promptGitHubRepoUrl,
    promptProductRepoSelection,
    selectProduct,
} from "./products-api.js";
import {writeDailyReport} from "./report-io.js";
import type {ProductRepoMapping, ProductRepoSelection} from "./types.js";

export function autoAssignAllFromMappings(daily: DailyApiJson, mappings: ProductRepoMapping[]): number {
    normalizeSessionRepoContext(daily.sessions);

    let matched = 0;
    for (const [index, session] of daily.sessions.entries()) {
        if (session.product_id) continue;
        const mapping = findMappingForSession(session, mappings, {
            warn: (message) => console.error(`Warning: ${message}`),
        });
        if (!mapping?.product_id) continue;
        const sessionLabel = session.session_name ?? session.session_title ?? session.session_id ?? `session ${index + 1}`;
        matched += applyProductRepoMappingToProject(daily, session, mapping);
        const repoLabel = mapping.repo_name ?? mapping.repo_url ?? "product only";
        console.error(
            `Auto-assigned session "${sessionLabel}" to ${mapping.product_name ?? mapping.product_id} / ${repoLabel}`
        );
    }
    return matched;
}

export async function autoAssignProjectsFromCloudMappings(daily: DailyApiJson): Promise<number> {
    const mappings = await listProductRepoMappings();
    return autoAssignAllFromMappings(daily, mappings);
}

async function assignRemainingProjectsInteractively(
    daily: DailyApiJson,
    mappings: ProductRepoMapping[]
): Promise<{matched: number; skipped: number}> {
    let matched = 0;
    // The collection process no longer triggers tty
    // const canPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const canPrompt = Boolean(false);
    if (!canPrompt) {
        return {
            matched,
            skipped: daily.sessions.filter((session) => !session.product_id).length,
        };
    }

    const products = await listProductsForSelector();
    if (products.length === 0) throw new Error("No products returned from cawplan products list");

    for (const [index, session] of daily.sessions.entries()) {
        if (session.product_id) continue;

        const originalProject = (session.project ?? "").trim();
        const sessionLabel = session.session_name ?? session.session_title ?? session.session_id ?? `session ${index + 1}`;

        const product = await selectProduct(
            products,
            `Select product for session "${sessionLabel}"${originalProject ? ` (project: ${originalProject})` : ""}`
        );
        if (!product.product_id) continue;

        const productMappings = mappings
            .filter((m) => m.product_id === product.product_id && m.repo_name)
            .sort((a, b) => String(a.repo_name).localeCompare(String(b.repo_name)));
        let mapping: ProductRepoSelection = await promptProductRepoSelection(sessionLabel, product, productMappings);
        if (mapping.create_from_url) {
            const repoURL = await promptGitHubRepoUrl(sessionLabel);
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

        matched += applyProductRepoMappingToProject(daily, session, mapping);
    }

    return {matched, skipped: 0};
}

export async function assignProjectsFromCloudMappings(daily: DailyApiJson, outputPath?: string): Promise<number> {
    const sessions = daily.sessions;
    if (!Array.isArray(sessions) || sessions.length === 0) {
        console.error("No sessions found in the collected report; skipping product assignment.");
        if (outputPath) writeDailyReport(outputPath, daily);
        return 0;
    }

    const mappings = await listProductRepoMappings();
    let matched = autoAssignAllFromMappings(daily, mappings);
    if (outputPath) writeDailyReport(outputPath, daily);

    const {matched: interactiveMatched, skipped} = await assignRemainingProjectsInteractively(daily, mappings);
    matched += interactiveMatched;
    if (outputPath) writeDailyReport(outputPath, daily);

    if (skipped > 0) {
        console.error(
            `Skipped product/repository selection for ${skipped} session(s) because collect is running without an interactive TTY.`
        );
        const fileHint = outputPath ?? `ai-daily-${daily.date}.json`;
        console.error(`To complete assignment, run: cawplan session assign --file ${fileHint} --web`);
    }

    return matched;
}
