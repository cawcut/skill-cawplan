import {canonicalRepoNameFromMapping, findMappingForSession, repoKeys} from "./matching.js";
import type {DailyApiJson} from "../collect/types.js";
import type {DailySession, ProductRepoMapping} from "./types.js";

function updateReposForSelectedMapping(
    repos: DailyApiJson["repos"] | undefined,
    originalProject: string,
    mapping: ProductRepoMapping,
    canonicalRepo: string
): number {
    if (!Array.isArray(repos)) return 0;
    const originalKeys = new Set(repoKeys(originalProject));
    const selectedKeys = new Set(repoKeys(canonicalRepo));
    let updated = 0;
    for (const repo of repos) {
        const keys = repoKeys(repo.repo_name ?? repo.repo);
        const matched = keys.some((key) => originalKeys.has(key) || selectedKeys.has(key));
        if (!matched) continue;
        repo.repo_name = canonicalRepo;
        repo.repo_url = mapping.repo_url;
        repo.product_id = mapping.product_id;
        repo.product_name = mapping.product_name;
        updated++;
    }
    return updated;
}

export function applyProductRepoMapping(
    daily: DailyApiJson,
    session: DailySession,
    mapping: ProductRepoMapping
): void {
    if (!mapping.product_id) throw new Error("product_id is required");

    const originalProject = (session.project ?? "").trim();
    const canonicalRepo = canonicalRepoNameFromMapping(mapping);
    if (canonicalRepo) {
        session.project = canonicalRepo;
        updateReposForSelectedMapping(daily.repos, originalProject, mapping, canonicalRepo);
        const updatedSessionRepos = updateReposForSelectedMapping(
            session.repos_touched,
            originalProject,
            mapping,
            canonicalRepo
        );
        if (updatedSessionRepos === 0 && session.repos_touched.length === 1) {
            session.repos_touched[0].repo_name = canonicalRepo;
            session.repos_touched[0].repo_url = mapping.repo_url;
            session.repos_touched[0].product_id = mapping.product_id;
            session.repos_touched[0].product_name = mapping.product_name;
        }
    }
    session.product_id = mapping.product_id;
    session.product_name = mapping.product_name;
}

export function applyProductRepoMappingToProject(
    daily: DailyApiJson,
    session: DailySession,
    mapping: ProductRepoMapping
): number {
    const originalProject = (session.project ?? "").trim();
    const originalKeys = new Set(repoKeys(originalProject));
    let updated = 1;

    applyProductRepoMapping(daily, session, mapping);

    if (!originalKeys.size) return updated;

    for (const candidate of daily.sessions) {
        if (candidate === session || candidate.product_id) continue;

        const candidateKeys = repoKeys(candidate.project);
        const sameProject = candidateKeys.some((key) => originalKeys.has(key));
        if (!sameProject) continue;

        applyProductRepoMapping(daily, candidate, mapping);
        updated++;
    }

    return updated;
}

/**
 * A session may touch several repositories. After the primary mapping is applied,
 * resolve the remaining touched repos on their own so each carries its product.
 */
export function applyMappingsToOtherTouchedRepos(
    daily: DailyApiJson,
    session: DailySession,
    mappings: ProductRepoMapping[],
    warn?: (message: string) => void
): number {
    let updated = 0;
    for (const touched of session.repos_touched ?? []) {
        if (touched.product_id) continue;
        const mapping = findMappingForSession({repos_touched: [touched]}, mappings, {warn}) as
            | ProductRepoMapping
            | undefined;
        if (!mapping?.product_id) continue;
        const canonicalRepo = canonicalRepoNameFromMapping(mapping);
        const keys = new Set(repoKeys(touched.repo_name ?? touched.repo));
        for (const target of [touched, ...(daily.repos ?? []).filter((r) =>
            repoKeys(r.repo_name ?? r.repo).some((key) => keys.has(key)))]) {
            if (canonicalRepo) target.repo_name = canonicalRepo;
            target.repo_url = mapping.repo_url;
            target.product_id = mapping.product_id;
            target.product_name = mapping.product_name;
        }
        updated++;
    }
    return updated;
}
