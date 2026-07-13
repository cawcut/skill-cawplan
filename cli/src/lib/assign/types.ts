import type {DailyApiJson} from "../collect/types.js";

export interface ProductRepoMapping {
    product_id?: string;
    product_name?: string;
    repo_name?: string;
    repo_url?: string;
    unique_id?: string;
}

export interface ProductRepoSelection extends ProductRepoMapping {
    create_from_url?: boolean;
}

export type DailySession = DailyApiJson["sessions"][number];

export interface AssignmentReport {
    file: string;
    daily: DailyApiJson;
}

export interface WebAssignment {
    file?: string;
    session_id?: string;
    product_id?: string;
    product_line_id?: string;
    product_name?: string;
    repo_name?: string;
    repo_url?: string;
    create_mapping?: boolean;
    ticket_display_ids?: string[];
}
