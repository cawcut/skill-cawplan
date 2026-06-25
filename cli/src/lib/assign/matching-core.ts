export function shortRepoName(value?: string): string {
    const raw = (value ?? "").trim();
    if (!raw) return "";
    const parts = raw.replace(/\.git$/, "").split(/[/:]/).filter(Boolean);
    return parts[parts.length - 1] ?? raw;
}

export function repoKeys(value?: string): string[] {
    const raw = (value ?? "").trim();
    const short = shortRepoName(raw);
    return [...new Set([raw, short].filter(Boolean).map((v) => v.toLowerCase()))];
}

export function repoNameFromGitHubUrl(repoURL: string): string {
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
            return repo.replace(/\.git$/i, "");
        }
    } catch {
        // Fall through to the consistent error below.
    }

    throw new Error(`Invalid GitHub repository URL: ${repoURL}`);
}

export interface SessionRepoCandidateInput {
    project?: string;
    repos_touched?: Array<{repo?: string; repo_name?: string; repo_url?: string}>;
}

export function sessionRepoCandidateKeys(session: SessionRepoCandidateInput): Set<string> {
    const keys = new Set<string>();
    for (const key of repoKeys(session.project)) keys.add(key);
    for (const repo of session.repos_touched ?? []) {
        for (const value of [repo.repo_name, repo.repo, repo.repo_url]) {
            for (const key of repoKeys(value)) keys.add(key);
        }
    }
    return keys;
}

export interface ProductRepoMappingCore {
    product_id?: string;
    product_name?: string;
    repo_name?: string;
    repo_url?: string;
}

export function findMappingForSession(
    session: SessionRepoCandidateInput,
    mappings: ProductRepoMappingCore[]
): ProductRepoMappingCore | undefined {
    const keys = sessionRepoCandidateKeys(session);
    if (keys.size === 0) return undefined;
    return mappings.find((mapping) =>
        mapping.repo_name &&
        repoKeys(mapping.repo_name).some((key) => keys.has(key))
    );
}
