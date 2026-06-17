export interface ModelUsageEntry {
  api_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost: number | "unknown";
  currency: string;
  token_source?: string;
  note?: string;
  agents?: string[];
}

export interface UsageBucket extends ModelUsageEntry {
  model: string;
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
  files: number;
  added: number;
  deleted: number;
}

export interface MessageStats {
  user: number;
  assistant: number;
  tool_calls: number;
}

export interface SessionData {
  schema: "2.0";
  date: string;
  agent: string;
  session_id: string;
  session_name: string;
  project: string;
  cwd: string;
  time_range: {
    display: string;
    timezone: string;
    start_local?: string;
  };
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
}

export interface ApiSessionData {
  agent: string;
  source: string;
  agent_display: string;
  session_id: string;
  session_name: string;
  time_range: string;
  project: string;
  message_stats: MessageStats;
  files_changed: number;
  files_added: number;
  files_deleted: number;
  models: string[];
  total_tokens: number;
  session_cost: number;
  cost_basis: string;
  token_source: string;
  repos_touched: string[];
  repos_touched_detail: RepoTouched[];
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
  sessions: ApiSessionData[];
  repos: RepoTouched[];
  human_inputs: HumanInput[];
}

export interface HumanInput {
  category: "decision" | "direction" | "correction" | "planning";
  content: string;
  session_title?: string;
  session_agent?: string;
  session_time?: string;
  session_model?: string;
  project?: string;
  files_changed?: number;
  lines_added?: number;
  lines_deleted?: number;
  start_time?: string;
  end_time?: string;
}

export interface CollectOptions {
  date: string; // YYYY-MM-DD
  agents?: Array<"claude-code" | "cursor" | "cursor-gui" | "codex">;
  outputPath?: string;
}
