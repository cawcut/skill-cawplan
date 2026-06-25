import type {DailyApiJson} from "../collect/types.js";
import {applyProductRepoMappingToProject} from "./apply.js";
import {findMappingForSession} from "./matching.js";
import {
    createProductRepoMapping,
    listProductRepoMappings,
    listProductsForSelector,
    promptGitHubRepoUrl,
    promptProductRepoSelection,
    searchProduct,
} from "./products-api.js";
import {writeDailyReport} from "./report-io.js";
import type {ProductRepoMapping, ProductRepoSelection} from "./types.js";

function autoAssignAllFromMappings(daily: DailyApiJson, mappings: ProductRepoMapping[]): number {
    let matched = 0;
    for (const [index, session] of daily.sessions.entries()) {
        if (session.product_id) continue;
        const mapping = findMappingForSession(session, mappings);
        if (!mapping?.repo_name || !mapping.product_id) continue;
        const sessionLabel = session.session_name ?? session.session_title ?? session.session_id ?? `session ${index + 1}`;
        matched += applyProductRepoMappingToProject(daily, session, mapping);
        console.error(
            `Auto-assigned session "${sessionLabel}" to ${mapping.product_name ?? mapping.product_id} / ${mapping.repo_name}`
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
    const canPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY);
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

        const product = await searchProduct(
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
        console.error(
            `To complete selector-based assignment, run: cawplan ai-session collect --date ${daily.date}`
        );
    }

    return matched;
}
