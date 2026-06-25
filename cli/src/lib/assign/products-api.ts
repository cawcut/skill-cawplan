import {input, search, select} from "@inquirer/prompts";
import {listProducts} from "../../commands/products.js";
import {cawplanRequest} from "../http.js";
import {extractList} from "../ai-session/helpers.js";
import type {ProductChoice, ProductListItem} from "../ai-session/types.js";
import {repoNameFromGitHubUrl} from "./matching.js";
import type {ProductRepoMapping, ProductRepoSelection} from "./types.js";

export async function listProductRepoMappings(): Promise<ProductRepoMapping[]> {
    const result = await cawplanRequest({
        method: "GET",
        path: "/api/v1/public/openapi/ai-session-usage/product-repo",
    });
    return extractList<ProductRepoMapping>(result).filter((m) => m.product_id && m.repo_name);
}

export async function createProductRepoMapping(opts: {
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

export function toProductChoices(result: unknown): ProductChoice[] {
    return extractList<ProductListItem>(result)
        .filter((p) => p.unique_id && p.name)
        .map((p) => ({
            product_id: String(p.unique_id),
            product_name: String(p.name),
        }))
        .sort((a, b) => a.product_name.localeCompare(b.product_name));
}

export async function listProductsForSelector(): Promise<ProductChoice[]> {
    return toProductChoices(await listProducts({pageSize: "100"}));
}

export async function searchProduct(products: ProductChoice[], message: string): Promise<ProductChoice> {
    return search<ProductChoice>({
        message,
        source: (term) => {
            const needle = (term ?? "").trim().toLowerCase();
            const filtered = needle
                ? products.filter((p) => p.product_name.toLowerCase().includes(needle))
                : products;
            return [
                ...filtered.slice(0, 10).map((p) => ({
                    name: p.product_name,
                    value: p,
                    description: p.product_id,
                })),
            ];
        },
        pageSize: 10,
    });
}

export async function promptProductRepoSelection(
    sessionLabel: string,
    product: ProductChoice,
    productMappings: ProductRepoMapping[]
): Promise<ProductRepoSelection> {
    return select<ProductRepoSelection>({
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
}

export async function promptGitHubRepoUrl(sessionLabel: string): Promise<string> {
    return input({
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
}
