export type AiSessionAgent = "claude-code" | "cursor" | "codex";

export interface ProductChoice {
    product_id: string;
    product_name: string;
}

export interface ProductListItem {
    unique_id?: string;
    name?: string;
}

export interface AiSessionReportItem {
    date?: string;
    reporter_key?: string;
    user_id?: string;
}

export interface UserListItem {
    unique_id?: string;
    user_id?: string;
    email?: string;
}
