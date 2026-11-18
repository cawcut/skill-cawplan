import {cawplanRequest} from "../http.js";
import {gitRemoteRepo} from "../collect/git.js";
import {listProductRepoMappings} from "../assign/products-api.js";
import {mappingRepoKeys, repoKeys} from "../assign/matching-core.js";
import type {ProductRepoMapping} from "../assign/types.js";

export const EXPERIENCE_DISABLED_CODE = "E_U_CORE_PRM_EXPERIENCE_DISABLED";
export const EXPERIENCE_KINDS = ["pitfall", "fix_recipe", "convention", "decision"] as const;
export const EXPERIENCE_STATUSES = ["pending", "confirmed", "rejected", "retired"] as const;

export function experiencePath(productId: string, suffix = ""): string {
    return `/api/v1/public/openapi/ai-session-usage/product/${encodeURIComponent(productId)}/experiences${suffix}`;
}

export interface RecallTarget {
    productId: string;
    repoId?: string;
    repo?: string;
    resolvedFrom: "flag" | "git";
    /** The mapping matched on the repository name only; its owner differs from the git remote's. */
    matchedByNameOnly?: boolean;
}

/**
 * The lowercased "owner/repo" of a repository URL (https or ssh) or "owner/repo" string; "" when
 * the value names no owner.
 */
export function qualifiedRepoId(value?: string): string {
    const raw = (value ?? "").trim().replace(/\/+$/, "").replace(/\.git$/i, "");
    if (!raw) return "";
    const match =
        raw.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\/([^/\s]+)\/([^/\s]+)$/i) ??
        raw.match(/^[^@\s/]+@[^:\s/]+:([^/\s]+)\/([^/\s]+)$/) ??
        raw.match(/^([^/:\s]+)\/([^/:\s]+)$/);
    return match ? `${match[1]}/${match[2]}`.toLowerCase() : "";
}

function mappingQualifiedRepoId(mapping: ProductRepoMapping): string {
    return qualifiedRepoId(mapping.repo_url) || qualifiedRepoId(mapping.repo_name);
}

/**
 * Pick the product for a git repo from product-repo mappings, refusing to guess: no match or
 * matches on more than one product are errors that ask for an explicit --product-id.
 *
 * Mappings with the remote's exact owner/repo win (plus mappings that carry no owner and match by
 * name), so a same-named repository of another owner neither takes over nor makes the match
 * ambiguous. Only when no mapping has that owner/repo does the repository name alone decide:
 * mappings keep the owner they were created with, and a transferred repository (GitHub redirects
 * the old owner) would otherwise never resolve. Such a match is flagged matchedByNameOnly.
 */
export function resolveRecallTargetFromMappings(repo: string, mappings: ProductRepoMapping[]): RecallTarget {
    const local = qualifiedRepoId(repo);
    const keys = new Set(repoKeys(repo));
    const byName = (mapping: ProductRepoMapping) => [...mappingRepoKeys(mapping)].some((key) => keys.has(key));
    const candidates = keys.size === 0 ? [] : mappings.filter((mapping) => mapping.product_id);
    const exact = local ? candidates.filter((mapping) => mappingQualifiedRepoId(mapping) === local) : [];
    let matches: ProductRepoMapping[];
    let matchedByNameOnly = false;
    if (exact.length > 0) {
        matches = [...exact, ...candidates.filter((mapping) => !mappingQualifiedRepoId(mapping) && byName(mapping))];
    } else {
        matches = candidates.filter(byName);
        matchedByNameOnly = local !== "" && matches.some((mapping) => mappingQualifiedRepoId(mapping) !== "");
    }
    if (matches.length === 0) {
        throw new Error(`No CawPlan product is mapped to repository "${repo}". Pass --product-id.`);
    }
    const productIds = [...new Set(matches.map((mapping) => mapping.product_id as string))];
    if (productIds.length > 1) {
        const labels = matches.map((mapping) => `${mapping.product_name ?? mapping.product_id} (${mapping.product_id})`);
        throw new Error(`Repository "${repo}" is mapped to more than one product: ${[...new Set(labels)].join(", ")}. Pass --product-id.`);
    }
    return {
        productId: productIds[0],
        repoId: matches.length === 1 ? matches[0].unique_id : undefined,
        repo,
        resolvedFrom: "git",
        ...(matchedByNameOnly ? {matchedByNameOnly} : {}),
    };
}

export async function resolveRecallTarget(opts: {productId?: string; repoId?: string; cwd: string}): Promise<RecallTarget> {
    if (opts.productId) {
        return {productId: opts.productId, repoId: opts.repoId, resolvedFrom: "flag"};
    }
    const repo = gitRemoteRepo(opts.cwd);
    if (!repo || repo === opts.cwd) {
        throw new Error("The current directory has no git origin remote to map to a CawPlan product. Pass --product-id.");
    }
    const target = resolveRecallTargetFromMappings(repo, await listProductRepoMappings());
    return opts.repoId ? {...target, repoId: opts.repoId} : target;
}

export async function recallExperience(target: RecallTarget, q: string, topK?: number): Promise<unknown> {
    const query: Record<string, string> = {q};
    if (target.repoId) query.repo_id = target.repoId;
    if (topK != null) query.top_k = String(topK);
    return cawplanRequest({method: "GET", path: experiencePath(target.productId, "/recall"), query});
}

export interface ExperienceEditOptions {
    kind?: string;
    title?: string;
    content?: string;
    evidence?: string;
    appliesTo?: string;
}

/** Build the confirm/edit body from CLI flags; undefined when no field was given. */
export function buildExperienceEditBody(opts: ExperienceEditOptions): Record<string, unknown> | undefined {
    const body: Record<string, unknown> = {};
    if (opts.kind !== undefined) {
        if (!(EXPERIENCE_KINDS as readonly string[]).includes(opts.kind)) {
            throw new Error(`--kind must be one of ${EXPERIENCE_KINDS.join(", ")}`);
        }
        body.kind = opts.kind;
    }
    if (opts.title !== undefined) body.title = opts.title;
    if (opts.content !== undefined) body.content = opts.content;
    if (opts.evidence !== undefined) body.evidence = opts.evidence;
    if (opts.appliesTo !== undefined) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(opts.appliesTo);
        } catch {
            throw new Error("--applies-to must be a JSON object, e.g. '{\"files\":[\"a.go\"],\"limits\":\"...\"}'");
        }
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("--applies-to must be a JSON object");
        }
        body.applies_to = parsed;
    }
    return Object.keys(body).length > 0 ? body : undefined;
}
