export interface ModelUsageEntry {
    api_calls: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    cost: number;
    currency: string;
    token_source?: string;
    note?: string;
    agents?: string[];
}

export interface UsageBucket extends ModelUsageEntry {
    model: string;
    agent?: string;
    speed: string;
    service_tier: string;
    effort: string;
}

export interface FileChange {
    path: string;
    added: number;
    deleted: number;
    repo: string;
    change_type?: string;
}

export interface RepoTouched {
    repo: string;
    repo_name?: string;
    repo_url?: string;
    product_id?: string;
    product_name?: string;
    files: number;
    added: number;
    deleted: number;
}

export interface MessageStats {
    user: number;
    assistant: number;
    tool_calls: number;
}

export interface AiSessionTicketContext {
    ticket_id: string;
    ticket_display_id?: string;
    product_id?: string;
    version_id?: string;
    title?: string;
    content?: string;
    url?: string;
}

export interface SessionData {
    schema: "2.0";
    date: string;
    agent: string;
    source?: string;
    session_id: string;
    session_name: string;
    /** Legacy title field used by older generated JSON. */
    title?: string;
    /** Preferred session title field in generated JSON. */
    session_title?: string;
    project: string;
    product_id?: string;
    product_name?: string;
    cwd: string;
    time_range: {
        display: string;
        timezone: string;
        start?: string;
    };
    models?: string[];
    total_tokens?: number;
    session_cost?: number;
    cost_basis?: string;
    token_source?: string;
    model_usage: Record<string, ModelUsageEntry>;
    usage_breakdown: UsageBucket[];
    /** Number of files changed in this session (API wire format) */
    files_changed: number;
    /** Lines added across all files */
    files_added?: number;
    /** Lines deleted across all files */
    files_deleted?: number;
    repos_touched: RepoTouched[];
    message_stats: MessageStats;
    human_inputs?: HumanInput[];
    ticket_ids?: string[];
    ticket_display_ids?: string[];
}

export interface DailyApiJson {
    schema: "2.0";
    date: string;
    author: string;
    generated_at: string;
    include_conversation: boolean;
    summary?: string;
    totals: {
        sessions: number;
        agents: string[];
        messages: MessageStats;
        files_changed: number;
        cost: { [currency: string]: number };
    };
    usage_breakdown: UsageBucket[];
    model_usage: Record<string, ModelUsageEntry>;
    sessions: SessionData[];
    repos: RepoTouched[];
    human_inputs: HumanInput[];
}

export interface HumanInput {
  category: "decision" | "direction" | "correction" | "planning";
  content: string;
  ticket_id?: string;
  ticket_ids?: string[];
  ticket_display_id?: string;
  ticket_display_ids?: string[];
  topic?: string;
  topic_source?: string;
  topic_confidence?: number;
  topic_reason?: string;
  raw_block?: string;
  session_id?: string;
  session_title?: string;
  session_agent?: string;
  session_time?: string | null;
  session_model?: string;
  project?: string;
  files_changed?: number;
  lines_added?: number;
  lines_deleted?: number;
  start_time?: string | null;
  end_time?: string | null;
  /**
   * Whether start_time/end_time are real recorded timestamps ("exact") or
   * reconstructed. Approximate times may come from transcript-order interpolation
   * or assistant-bubble inference after a resume restamp; inferred_from_billing
   * means the window was aligned to a Cursor Dashboard API usage burst;
   * inferred_from_attributed_events means start/end were tightened to dashboard
   * event timestamps after cost attribution (exact composer times are kept when
   * attributed events fall within a few minutes of the bubble timestamp).
   */
  time_precision?: "exact" | "approximate" | "inferred_from_billing" | "inferred_from_attributed_events";
  /** Composer bubble order within the session (for billing burst alignment). */
  sequence_index?: number;
  usage_cost?: number;
  api_calls?: number;
}

export interface CollectOptions {
    date: string; // YYYY-MM-DD
    agents?: Array<"claude-code" | "cursor" | "codex">;
    outputPath?: string;
    verbose?: boolean;
}
