import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { repoNameFromGitHubUrl } from "../assign/matching.js";
import type { ProductRepoMapping } from "../assign/types.js";

export function gitOutput(args: string[], cwd?: string): string {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

export function normalizeGitHubRemoteUrl(remoteUrl: string): string {
    const raw = remoteUrl.trim();
    const ssh = raw.match(/^git@github\.com:([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/);
    if (ssh) return `https://github.com/${ssh[1]}/${ssh[2]}`;

    const https = raw.match(/^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/);
    if (https) return `https://github.com/${https[1]}/${https[2]}`;

    const fullSsh = raw.match(/^ssh:\/\/git@github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/);
    if (fullSsh) return `https://github.com/${fullSsh[1]}/${fullSsh[2]}`;

    throw new Error(`origin must be a GitHub repository URL, got: ${remoteUrl}`);
}

export interface SubdirRepo {
    dir: string;
    name: string;
}

export interface MappedSubdirRepo extends SubdirRepo {
    repoUrl: string;
    repoName: string;
    productId: string;
    productName: string;
}

export interface PendingSubdirRepo extends SubdirRepo {
    repoUrl: string;
    repoName: string;
}

export interface SkippedSubdirRepo extends SubdirRepo {
    reason: string;
}

export interface DiscoverSubdirReposResult {
    mapped: MappedSubdirRepo[];
    pending: PendingSubdirRepo[];
    skipped: SkippedSubdirRepo[];
}

export interface DiscoverSubdirReposDeps {
    listSubdirectories: (dir: string) => SubdirRepo[];
    hasGitEntry: (dir: string) => boolean;
    getOriginUrl: (dir: string) => string;
}

export function defaultDeps(): DiscoverSubdirReposDeps {
    return {
        listSubdirectories: (dir) =>
            readdirSync(dir, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => ({ dir: join(dir, entry.name), name: entry.name })),
        hasGitEntry: (dir) => existsSync(join(dir, ".git")),
        getOriginUrl: (dir) => gitOutput(["remote", "get-url", "origin"], dir),
    };
}

export function discoverSubdirRepos(
    cwd: string,
    existingMappings: ProductRepoMapping[],
    deps: DiscoverSubdirReposDeps = defaultDeps()
): DiscoverSubdirReposResult {
    const mappingByUrl = new Map<string, ProductRepoMapping>();
    for (const mapping of existingMappings) {
        if (!mapping.repo_url) continue;
        try {
            mappingByUrl.set(normalizeGitHubRemoteUrl(mapping.repo_url), mapping);
        } catch {
            mappingByUrl.set(mapping.repo_url, mapping);
        }
    }

    const result: DiscoverSubdirReposResult = { mapped: [], pending: [], skipped: [] };

    for (const candidate of deps.listSubdirectories(cwd)) {
        if (!deps.hasGitEntry(candidate.dir)) continue;

        let origin: string;
        try {
            origin = deps.getOriginUrl(candidate.dir);
        } catch {
            result.skipped.push({ ...candidate, reason: "no GitHub origin" });
            continue;
        }

        let repoUrl: string;
        try {
            repoUrl = normalizeGitHubRemoteUrl(origin);
        } catch {
            result.skipped.push({ ...candidate, reason: "no GitHub origin" });
            continue;
        }

        const repoName = repoNameFromGitHubUrl(repoUrl);
        const existing = mappingByUrl.get(repoUrl);
        if (existing) {
            result.mapped.push({
                ...candidate,
                repoUrl,
                repoName,
                productId: existing.product_id ?? "",
                productName: existing.product_name ?? existing.product_id ?? "",
            });
        } else {
            result.pending.push({ ...candidate, repoUrl, repoName });
        }
    }

    return result;
}
