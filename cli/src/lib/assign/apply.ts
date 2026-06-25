import {repoKeys} from "./matching.js";
import type {DailyApiJson} from "../collect/types.js";
import type {DailySession, ProductRepoMapping} from "./types.js";

function updateReposForSelectedMapping(
    repos: DailyApiJson["repos"] | undefined,
    originalProject: string,
    mapping: ProductRepoMapping
): number {
    if (!Array.isArray(repos)) return 0;
    const originalKeys = new Set(repoKeys(originalProject));
    const selectedKeys = new Set(repoKeys(mapping.repo_name));
    let updated = 0;
    for (const repo of repos) {
        const keys = repoKeys(repo.repo_name ?? repo.repo);
        const matched = keys.some((key) => originalKeys.has(key) || selectedKeys.has(key));
        if (!matched) continue;
        repo.repo_name = mapping.repo_name;
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
    if (mapping.repo_name) {
        session.project = mapping.repo_name;
        updateReposForSelectedMapping(daily.repos, originalProject, mapping);
        const updatedSessionRepos = updateReposForSelectedMapping(session.repos_touched, originalProject, mapping);
        if (updatedSessionRepos === 0 && session.repos_touched.length === 1) {
            session.repos_touched[0].repo_name = mapping.repo_name;
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
