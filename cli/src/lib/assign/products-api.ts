import {confirm, input, search, select} from "@inquirer/prompts";
import {listCawplanProducts} from "../product-catalog.js";
import {cawplanRequest} from "../http.js";
import {extractList} from "../ai-session/helpers.js";
import type {ProductChoice, ProductListItem} from "../ai-session/types.js";
import {repoNameFromGitHubUrl} from "./matching.js";
import type {ProductRepoMapping, ProductRepoSelection} from "./types.js";

const PRODUCT_PAGE_SIZE = 1000;
const PRODUCT_LINE_PAGE_SIZE = 100;
const TTY_CANCEL_MESSAGE = "TTY selection cancelled.";

type PromptContext = {signal: AbortSignal};
type KeyHelp = [key: string, action: string];

export interface ProductLineChoice {
    product_line_id: string;
    product_line_name: string;
    product_count?: number;
}

function ttyKeysHelpTip(keys: KeyHelp[]): string {
    return [...keys, ["Esc", "exit"], ["j/J", "up"], ["k/K", "down"]]
        .map(([key, action]) => `${key} ${action}`)
        .join(" • ");
}

async function withTtyShortcuts<T>(
    prompt: (context: PromptContext) => Promise<T>,
    opts: {navigationKeys?: boolean} = {}
): Promise<T> {
    const inputStream = process.stdin as typeof process.stdin & {
        emit: (eventName: string | symbol, ...args: unknown[]) => boolean;
    };
    const originalEmit = inputStream.emit;
    const controller = new AbortController();

    if (inputStream.isTTY) {
        inputStream.emit = function emitWithTtyShortcuts(eventName: string | symbol, ...args: unknown[]): boolean {
            if (eventName === "keypress") {
                const key = args[1] as {name?: string; shift?: boolean; sequence?: string} | undefined;
                if (key?.name === "escape") {
                    controller.abort(new Error(TTY_CANCEL_MESSAGE));
                    return true;
                }
                if (opts.navigationKeys && key?.name === "j") {
                    args[0] = undefined;
                    args[1] = {...key, name: "up", sequence: "\u001B[A"};
                } else if (opts.navigationKeys && key?.name === "k") {
                    args[0] = undefined;
                    args[1] = {...key, name: "down", sequence: "\u001B[B"};
                }
            }
            return originalEmit.call(this, eventName, ...args);
        };
    }

    try {
        return await prompt({signal: controller.signal});
    } catch (err) {
        if ((err as Error).name === "AbortPromptError") {
            throw new Error(TTY_CANCEL_MESSAGE);
        }
        throw err;
    } finally {
        inputStream.emit = originalEmit;
    }
}

export async function listProductRepoMappings(): Promise<ProductRepoMapping[]> {
    const result = await cawplanRequest({
        method: "GET",
        path: "/api/v1/public/openapi/ai-session-usage/product-repo",
    });
    return extractList<ProductRepoMapping>(result).filter((mapping) => mapping.product_id);
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
            product_line_id: p.product_line_id
                ? String(p.product_line_id)
                : p.product_line?.unique_id
                    ? String(p.product_line.unique_id)
                    : p.product_line?.id
                        ? String(p.product_line.id)
                        : undefined,
        }))
        .sort((a, b) => a.product_name.localeCompare(b.product_name));
}

export function toProductLineChoices(result: unknown): ProductLineChoice[] {
    return extractList<ProductListItem>(result)
        .filter((p) => p.unique_id && p.name)
        .map((p) => ({
            product_line_id: String(p.unique_id),
            product_line_name: String(p.name),
        }))
        .sort((a, b) => a.product_line_name.localeCompare(b.product_line_name));
}

export async function listProductLinesForSelector(): Promise<ProductLineChoice[]> {
    const lines: ProductLineChoice[] = [];
    for (let pageNum = 1; ; pageNum++) {
        const result = await cawplanRequest({
            method: "GET",
            path: "/api/v1/public/openapi/product_lines",
            query: {
                page_size: String(PRODUCT_LINE_PAGE_SIZE),
                page_num: String(pageNum),
            },
        });
        const page = toProductLineChoices(result);
        lines.push(...page);
        if (page.length < PRODUCT_LINE_PAGE_SIZE) break;
    }
    const deduped = new Map(lines.map((line) => [line.product_line_id, line]));
    return [...deduped.values()].sort((a, b) => a.product_line_name.localeCompare(b.product_line_name));
}

export async function listProductsForSelector(search?: string, opts: {productLineId?: string} = {}): Promise<ProductChoice[]> {
    const needle = search?.trim();
    const products = toProductChoices(
        await listCawplanProducts({
            search: needle || undefined,
            productLineId: opts.productLineId,
            pageSize: String(PRODUCT_PAGE_SIZE),
            pageNum: "1",
        })
    );
    const deduped = new Map(products.map((product) => [product.product_id, product]));
    return [...deduped.values()].sort((a, b) => a.product_name.localeCompare(b.product_name));
}

export function withProductLineCounts(
    productLines: ProductLineChoice[],
    products: ProductChoice[]
): ProductLineChoice[] {
    const counts = new Map<string, number>();
    for (const product of products) {
        if (!product.product_line_id) continue;
        counts.set(product.product_line_id, (counts.get(product.product_line_id) ?? 0) + 1);
    }
    return productLines.map((line) => ({
        ...line,
        product_count: counts.get(line.product_line_id) ?? 0,
    }));
}

export async function selectProductLine(productLines: ProductLineChoice[], message: string): Promise<ProductLineChoice> {
    return withTtyShortcuts((context) => select<ProductLineChoice>({
        message,
        choices: productLines.map((line) => ({
            name: line.product_count == null
                ? line.product_line_name
                : `${line.product_line_name} (${line.product_count})`,
            value: line,
            description: line.product_line_id,
        })),
        pageSize: 15,
        theme: {
            style: {
                keysHelpTip: ttyKeysHelpTip,
            },
        },
    }, context), {navigationKeys: true});
}

export async function selectProduct(products: ProductChoice[], message: string): Promise<ProductChoice> {
    return withTtyShortcuts((context) => select<ProductChoice>({
        message,
        choices: products.map((product) => ({
            name: product.product_name,
            value: product,
            description: product.product_id,
        })),
        pageSize: 15,
        theme: {
            style: {
                keysHelpTip: ttyKeysHelpTip,
            },
        },
    }, context), {navigationKeys: true});
}

export async function promptConfirm(message: string, defaultValue = true): Promise<boolean> {
    return withTtyShortcuts((context) => confirm({
        message,
        default: defaultValue,
    }, context));
}

export async function searchProduct(
    products: ProductChoice[],
    message: string,
    opts: {productLineId?: string} = {}
): Promise<ProductChoice> {
    return withTtyShortcuts((context) => search<ProductChoice>({
        message,
        source: async (term) => {
            const needle = (term ?? "").trim();
            const source = needle
                ? products.filter((product) => product.product_name.toLowerCase().includes(needle.toLowerCase()))
                : products;
            return source.slice(0, 10).map((product) => ({
                name: product.product_name,
                value: product,
                description: product.product_id,
            }));
        },
        pageSize: 10,
        theme: {
            style: {
                keysHelpTip: ttyKeysHelpTip,
            },
        },
    }, context));
}

export async function promptProductRepoSelection(
    sessionLabel: string,
    product: ProductChoice,
    productMappings: ProductRepoMapping[]
): Promise<ProductRepoSelection> {
    return withTtyShortcuts((context) => select<ProductRepoSelection>({
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
        theme: {
            style: {
                keysHelpTip: ttyKeysHelpTip,
            },
        },
    }, context), {navigationKeys: true});
}

export async function promptGitHubRepoUrl(sessionLabel: string): Promise<string> {
    return withTtyShortcuts((context) => input({
        message: `GitHub repository URL for session "${sessionLabel}"`,
        validate: (value) => {
            try {
                repoNameFromGitHubUrl(value);
                return true;
            } catch (e) {
                return (e as Error).message;
            }
        },
    }, context));
}
