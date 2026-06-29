import {execFileSync} from "node:child_process";
import {Command} from "commander";
import {confirm} from "@inquirer/prompts";
import {openBrowser} from "../lib/oauth.js";
import {getPortalBase} from "../lib/products.js";
import {
    createProductRepoMapping,
    listProductLinesForSelector,
    listProductRepoMappings,
    listProductsForSelector,
    selectProduct,
    selectProductLine,
    withProductLineCounts,
} from "../lib/assign/products-api.js";
import {repoNameFromGitHubUrl} from "../lib/assign/matching.js";

function gitOutput(args: string[], cwd?: string): string {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

function normalizeGitHubRemoteUrl(remoteUrl: string): string {
    const raw = remoteUrl.trim();
    const ssh = raw.match(/^git@github\.com:([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/);
    if (ssh) return `https://github.com/${ssh[1]}/${ssh[2]}`;

    const https = raw.match(/^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/);
    if (https) return `https://github.com/${https[1]}/${https[2]}`;

    throw new Error(`origin must be a GitHub repository URL, got: ${remoteUrl}`);
}

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

async function promptCreateProduct(productLineName: string, productLineId: string): Promise<void> {
    const url = productCreateUrl(productLineId);
    const shouldOpen = await confirm({
        message: `No product exists under "${productLineName}". Create one now?`,
        default: true,
    });
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

export function registerInitCommand(program: Command): void {
    program
        .command("init")
        .description("Initialize current git repository product mapping for AI daily reports")
        .action(async () => {
            try {
                assertInteractiveTerminal();

                const repoRoot = gitOutput(["rev-parse", "--show-toplevel"]);
                const origin = gitOutput(["remote", "get-url", "origin"], repoRoot);
                const repoUrl = normalizeGitHubRemoteUrl(origin);
                const repoName = repoNameFromGitHubUrl(repoUrl);

                console.log(`Repository: ${repoUrl}`);

                const mappings = await listProductRepoMappings();
                const existing = mappings.find((mapping) => {
                    return mapping.repo_url === repoUrl;
                });
                if (existing) {
                    console.log(`Current repository is already mapped to product [${existing.product_name}].`);
                    return;
                }

                const [productLinesWithoutCounts, allProducts] = await Promise.all([
                    listProductLinesForSelector(),
                    listProductsForSelector(),
                ]);
                const productLines = withProductLineCounts(productLinesWithoutCounts, allProducts);
                if (productLines.length === 0) {
                    throw new Error("No CawPlan Teams returned.");
                }
                const productLine = await selectProductLine(
                    productLines,
                    `Select CawPlan Team for ${repoName}`
                );

                const products = allProducts.filter((product) => product.product_line_id === productLine.product_line_id);
                if (products.length === 0) {
                    await promptCreateProduct(productLine.product_line_name, productLine.product_line_id);
                    return;
                }
                const product = await selectProduct(
                    products,
                    `Select CawPlan product under ${productLine.product_line_name} for ${repoName}`
                );

                const ok = await confirm({
                    message: `Create mapping: ${product.product_name} -> ${repoUrl}?`,
                    default: true,
                });
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
            } catch (e) {
                console.error(`Error: ${(e as Error).message}`);
                process.exit(1);
            }
        });
}
