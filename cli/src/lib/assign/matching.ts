import type {RepoTouched} from "../collect/types.js";

export interface ProductRepoMapping {
    product_id?: string;
    product_name?: string;
    repo_name?: string;
    repo_url?: string;
}

export interface SessionRepoMatchInput {
    project?: string;
    repos_touched?: RepoTouched[];
}

export {
    shortRepoName,
    repoKeys,
    repoNameFromGitHubUrl,
    sessionRepoCandidateKeys,
    findMappingForSession,
} from "./matching-core.js";
