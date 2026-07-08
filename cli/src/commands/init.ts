import {Command} from "commander";
import {resolve} from "node:path";
import {openBrowser} from "../lib/oauth.js";
import {getPortalBase} from "../lib/products.js";
import {
    batchCreateProductRepoMappings,
    createProductRepoMapping,
    listProductLinesForSelector,
    listProductRepoMappings,
    listProductsForSelector,
    promptConfirm,
    selectProduct,
    selectProductLine,
    withProductLineCounts,
} from "../lib/assign/products-api.js";
import type {ProductChoice} from "../lib/ai-session/types.js";
import {repoNameFromGitHubUrl} from "../lib/assign/matching.js";
import {discoverSubdirRepos, gitOutput, normalizeGitHubRemoteUrl} from "../lib/init/discover-subdir-repos.js";
import {formatColumnGrid} from "../lib/init/format-columns.js";
import {upsertLocalProductMapping} from "../lib/user-config.js";

function assertInteractiveTerminal(): void {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error("cawplan init requires an interactive terminal");
    }
}

function productCreateUrl(productLineId: string): string {
    const portalBase = getPortalBase().replace(/\/$/, "");
    const params = new URLSearchParams({productLine: productLineId});
    return `${portalBase}/product/add?${params.toString()}`;
}

function sameGitHubRepoUrl(a?: string, b?: string): boolean {
    if (!a || !b) return false;
    try {
        return normalizeGitHubRemoteUrl(a) === normalizeGitHubRemoteUrl(b);
    } catch {
        return a.trim() === b.trim();
    }
}

async function saveLocalProductMapping(dir: string, product: ProductChoice): Promise<void> {
    const absDir = resolve(dir);
    await upsertLocalProductMapping(absDir, product.product_id);
    console.log(`Saved local mapping: ${absDir} -> ${product.product_name} (${product.product_id})`);
}

async function promptCreateProduct(productLineName: string, productLineId: string): Promise<void> {
    const url = productCreateUrl(productLineId);
    const shouldOpen = await promptConfirm(`No product exists under "${productLineName}". Create one now?`);
    if (!shouldOpen) {
        console.log("Cancelled.");
        return;
    }

    console.error(`Opening product creation page:\n  ${url}`);
    try {
        await openBrowser(url);
    } catch {
        console.error("Could not open the browser automatically; please open the URL manually.");
    }
}

async function selectProductInteractively(contextLabel: string): Promise<ProductChoice | null> {
    const [productLinesWithoutCounts, allProducts] = await Promise.all([
        listProductLinesForSelector(),
        listProductsForSelector(),
    ]);
    const productLines = withProductLineCounts(productLinesWithoutCounts, allProducts);
    if (productLines.length === 0) {
        throw new Error("No CawPlan Teams returned.");
    }
    const productLine = productLines.length === 1
        ? productLines[0]
        : await selectProductLine(productLines, `Select CawPlan Team for ${contextLabel}`);

    const products = allProducts.filter((product) => product.product_line_id === productLine.product_line_id);
    if (products.length === 0) {
        await promptCreateProduct(productLine.product_line_name, productLine.product_line_id);
        return null;
    }

    return selectProduct(products, `Select CawPlan product under ${productLine.product_line_name} for ${contextLabel}`);
}

async function runSingleRepoInit(repoRoot: string): Promise<void> {
    const origin = gitOutput(["remote", "get-url", "origin"], repoRoot);
    const repoUrl = normalizeGitHubRemoteUrl(origin);
    const repoName = repoNameFromGitHubUrl(repoUrl);

    console.log(`Repository: ${repoUrl}`);

    const mappings = await listProductRepoMappings();
    const existing = mappings.find((mapping) => sameGitHubRepoUrl(mapping.repo_url, repoUrl));
    if (existing) {
        console.log(`Current repository is already mapped to product [${existing.product_name}].`);
        return;
    }

    const product = await selectProductInteractively(repoName);
    if (!product) return;

    const ok = await promptConfirm(`Create mapping: ${product.product_name} -> ${repoUrl}?`);
    if (!ok) {
        console.log("Cancelled.");
        return;
    }

    const mapping = await createProductRepoMapping({
        productId: product.product_id,
        repoUrl,
        repoName,
    });

    console.log(`Created mapping: ${mapping.product_name} -> ${mapping.repo_url}`);
}

function printRepoList(header: string, lines: string[]): void {
    console.log(header);
    for (const line of lines) {
        console.log(`    ${line}`);
    }
}

async function runMultiRepoInit(cwd: string): Promise<void> {
    const absCwd = resolve(cwd);
    const mappings = await listProductRepoMappings();
    const {mapped, pending, skipped} = discoverSubdirRepos(absCwd, mappings);
    const total = mapped.length + pending.length + skipped.length;

    if (total === 0) {
        console.log(`No git repositories found in subdirectories of ${absCwd}.`);
    }

    console.log(`Scanned ${total} subdirectories:`);
    if (mapped.length > 0) {
        printRepoList(`  ✓ already mapped (${mapped.length}):`, mapped.map((r) => `${r.name} -> ${r.productName}`));
    }
    if (skipped.length > 0) {
        printRepoList(`  ⚠ skipped (${skipped.length}):`, skipped.map((r) => `${r.name} (${r.reason})`));
    }
    if (pending.length > 0) {
        console.log(`  pending (${pending.length}):`);
        const terminalWidth = process.stdout.columns || 80;
        for (const line of formatColumnGrid(pending.map((r) => r.name), terminalWidth - 4)) {
            console.log(`    ${line}`);
        }
    }

    const mappedProducts = new Map(
        mapped
            .filter((repo) => repo.productId)
            .map((repo) => [repo.productId, repo.productName])
    );
    const product = pending.length === 0 && mappedProducts.size === 1
        ? {
            product_id: [...mappedProducts.keys()][0] ?? "",
            product_name: [...mappedProducts.values()][0] ?? [...mappedProducts.keys()][0] ?? "",
        }
        : await selectProductInteractively(pending.length > 0 ? `${pending.length} subdirectories` : absCwd);
    if (!product) return;

    if (pending.length > 0) {
        const ok = await promptConfirm(`Create ${pending.length} mappings under ${product.product_name}?`);
        if (!ok) {
            console.log("Cancelled.");
            return;
        }

        try {
            const {created, existing} = await batchCreateProductRepoMappings({
                productId: product.product_id,
                repoUrls: pending.map((r) => r.repoUrl),
            });
            if (created.length > 0) {
                printRepoList(`  + created (${created.length}):`, created.map((m) => `${m.repo_name} -> ${m.product_name}`));
            }
            if (existing.length > 0) {
                printRepoList(`  = already existing (${existing.length}):`, existing.map((m) => `${m.repo_name} -> ${m.product_name}`));
            }
        } catch (e) {
            console.log(`  ✗ batch creation failed: ${(e as Error).message}`);
            process.exitCode = 1;
            return;
        }
    }

    await saveLocalProductMapping(absCwd, product);
}

export function registerInitCommand(program: Command): void {
    program
        .command("init")
        .description("Initialize product mapping for the current git repository or workspace directory")
        .action(async () => {
            try {
                assertInteractiveTerminal();

                let repoRoot: string;
                try {
                    repoRoot = gitOutput(["rev-parse", "--show-toplevel"]);
                } catch {
                    await runMultiRepoInit(process.cwd());
                    return;
                }

                await runSingleRepoInit(repoRoot);
            } catch (e) {
                console.error(`Error: ${(e as Error).message}`);
                process.exit(1);
            }
        });
}
