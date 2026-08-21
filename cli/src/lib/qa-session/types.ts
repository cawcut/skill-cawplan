/** Summary row from GET /qa-session-usage/reports (list only; backfill uses date + user_id). */
export interface QaSessionReportItem {
    report_id?: string;
    date?: string;
    reporter_key?: string;
    user_id?: string;
    schema_version?: string;
    session_count?: number;
    total_tokens?: number;
    total_cost_usd?: number;
    uploaded_at?: string;
    has_payload?: boolean;
    decrypt_error?: boolean;
}
