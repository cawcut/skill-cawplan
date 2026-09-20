/**
 * QA Insights write-command types (Phase 1a).
 *
 * Source of truth: QA_INSIGHTS_WRITE_COMMANDS_IMPLEMENTATION_PLAN.md §3.3.1,
 * narrowed by PHASE1_EXECUTION_PLAN.md (Phase 1a) — no DUPLICATE_BLOCKED outcome,
 * exit codes collapsed to 0/1, testpoint count mid-states merged into count_unexpected.
 *
 * Field shape verified against the live proto API on 2026-08-06 (step 1 field map):
 * the five fields and `summary` sit flat at the top level of `data`, snake_case,
 * and list rows are structurally identical to a single GET.
 */

/**
 * Command outcome. This is what skills consume from stdout JSON — exit codes are
 * only a coarse success/attention split (see envelope.ts).
 */
export type QAInsightsOutcome =
  | "SUCCESS"     // write request definitively succeeded (envelope code === SUCCESS)
  | "RECONCILED"  // no write issued; reconcile determined the prior write already landed
  | "NOOP"        // no write issued; PATCH diff was empty
  | "FAILURE"     // definitive failure
  | "UNKNOWN";    // transport failure or post-write 5xx — result indeterminate

export type QAInsightsErrorType =
  | "transport"
  | "api"
  | "validation"
  | "auth"
  | "not_found"
  | "feature_disabled"
  | "testrail";

export type ReconcileStrategy = "five_field_strong_match" | "testpoint_count";

/** Table A decisions (A1 SKILL.md step 11) plus A2 count-reconcile decisions. */
export type ReconcileDecision =
  // A1 — five-field strong match (Table A)
  | "strong_match_single"
  | "strong_match_multiple"
  | "patch_already_applied"
  | "patch_still_old"
  | "no_match"
  // A2 — testpoint count reconcile
  | "count_matched"
  | "retry_same_batch"
  | "count_unexpected";

/** The five requirement fields. `summary` is deliberately NOT one of them. */
export interface RequirementFiveFields {
  function_description: string;
  entry_trigger: string;
  normal_expectation: string;
  constraints: string;
  /** May be empty/null/（素材未提及） — treated as equivalent when normalized. */
  out_of_scope: string;
}

export const FIVE_FIELD_KEYS = [
  "function_description",
  "entry_trigger",
  "normal_expectation",
  "constraints",
  "out_of_scope",
] as const satisfies readonly (keyof RequirementFiveFields)[];

export type FiveFieldKey = (typeof FIVE_FIELD_KEYS)[number];

/**
 * Last values written to CawPlan. `summary_snapshot` is kept separate from the
 * five fields: summary participates in PATCH diffs but never in strong match.
 */
export interface RequirementSnapshot {
  five_fields: RequirementFiveFields;
  summary_snapshot: string | null;
}

/** A requirement row as returned by GET (single) or list GET — same shape. */
export interface RequirementRow extends Partial<RequirementFiveFields> {
  id: string;
  summary?: string | null;
  module_tree_node_id?: string;
  url?: string | null;
  ticket_id?: string | null;
  /** Read-only echo fields; never sent in a write body. */
  product_id?: string;
  review_status?: string;
  [key: string]: unknown;
}

/**
 * Skill write bodies always mark AI provenance. Injected by body-builders —
 * callers (skills) do not pass this field.
 */
export const IS_AI_GENERATED = true as const;

/** Skill-supplied keys per test-point item (before CLI injects `is_ai_generated` and `category_code`). */
export const TESTPOINT_CALLER_KEYS = ["title", "tags", "group", "priority", "is_edited"] as const;

/** Stable machine categories accepted by the TestPoint API payload. */
export const TESTPOINT_CATEGORY_CODES = [
  "POSITIVE",
  "BOUNDARY",
  "EXCEPTION",
  "REVERSE_ACTION",
  "INPUT_TYPE",
  "INTERACTION_FEEDBACK",
  "STATE_TRANSITION",
  "ROLE_PERMISSION",
  "SOURCE_ENTRY",
  "IDEMPOTENCY",
  "CONCURRENCY",
  "CONSISTENCY",
  "BACKWARD_COMPATIBILITY",
  "ENVIRONMENT_COMPATIBILITY",
  "PERFORMANCE",
  "SECURITY_AUDIT",
  "OBSERVABILITY",
  "RESULT_VALIDITY",
  "INSTRUCTION_COMPLIANCE",
  "FACTUAL_GROUNDING",
  "OUTPUT_STABILITY",
  "CONTEXT",
  "AGENT_EXECUTION",
  "OTHER",
] as const;

export type TestPointCategoryCode = (typeof TESTPOINT_CATEGORY_CODES)[number];

/** Category codes that automatic tag classification may produce; `OTHER` is manual-only. */
export type AutoMappableCategoryCode = Exclude<TestPointCategoryCode, "OTHER">;

/** Allowed values for a test-point's `priority`. */
export const TESTPOINT_PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export type TestPointPriority = (typeof TESTPOINT_PRIORITIES)[number];

/** One test-point item as sent to the API (five caller keys + two CLI-injected fields). */
export interface TestPointDraft {
  title: string;
  tags: string[];
  group: string;
  priority: TestPointPriority;
  is_edited: boolean;
  is_ai_generated: typeof IS_AI_GENERATED;
  category_code: TestPointCategoryCode | null;
}

/** @deprecated Use TESTPOINT_CALLER_KEYS — legacy alias for the five-key caller contract. */
export const TESTPOINT_BODY_KEYS = TESTPOINT_CALLER_KEYS;

/**
 * Keys that must never appear in a Requirement write body.
 * Note the read/write asymmetry: GET responses DO include product_id and
 * review_status — that is expected and is not a violation.
 */
export const FORBIDDEN_WRITE_BODY_KEYS = ["product_id", "review_status", "is_edited"] as const;

export interface QAInsightsReconcileInfo {
  strategy: ReconcileStrategy;
  decision: ReconcileDecision;
  matched_requirement_ids?: string[];
  count_before?: number;
  count_after?: number;
  batch_size?: number;
}

export interface QAInsightsError {
  type: QAInsightsErrorType;
  message: string;
  status?: number;
  api_code?: string;
}

export interface QAInsightsMeta {
  product_id: string;
  requirement_id?: string;
  module_tree_node_id?: string;
  version_id?: string;
  ticket_id?: string;
  ticket_ids?: string[];
  plan_mapping_id?: string;
  plan_mapping_ids?: string[];
  result_id?: number;
  case_id?: number;
  run_id?: number;
  test_id?: number;
  suite_id?: number;
  parent_section_id?: number;
  refresh?: boolean;
  limit?: number;
  offset?: number;
  milestone_strategy?: TestrailPlanMilestoneStrategy;
  milestone_id?: number;
  has_mapping?: boolean;
  valid?: boolean;
  cross_product_conflict?: boolean;
  ticket_reuse_strategy?: TestrailPlanTicketReuseStrategy;
  reused_plan_mapping_ids?: string[];
  created_plan_mapping_ids?: string[];
  job_id?: string;
  preview_id?: string;
  dry_run: boolean;
}

/** Single JSON object printed to stdout by every write/reconcile command. */
export interface QAInsightsWriteEnvelope {
  outcome: QAInsightsOutcome;
  command: string;
  api?: { code: string; msg: string; data?: unknown };
  reconcile?: QAInsightsReconcileInfo;
  patch_body?: Record<string, unknown>;
  post_body?: Record<string, unknown>;
  error?: QAInsightsError;
  meta: QAInsightsMeta;
}

/** Read commands never emit RECONCILED or NOOP. */
export type QAInsightsReadOutcome = "SUCCESS" | "FAILURE" | "UNKNOWN";

/**
 * stdout envelope for read commands (`requirements get`, `testpoints list`).
 * On SUCCESS, `data` is the API `data` field verbatim — skills read it directly.
 */
export interface QAInsightsReadEnvelope {
  outcome: QAInsightsReadOutcome;
  command: string;
  /** Present on SUCCESS — same object as `{ code, msg, data }`.data from the API. */
  data?: unknown;
  error?: QAInsightsError;
  meta: QAInsightsMeta;
}

export type ImportSourceType = "REQUIREMENT" | "INLINE" | "VERSION";

export interface ImportPreviewSource {
  type: ImportSourceType;
  requirement_id?: string;
  version_id?: string;
}

export type SectionStrategy = "AUTO_BY_GROUP" | "MAP_BY_MODULE" | "FIXED_SECTION";

export interface ImportStepDraft {
  content: string;
  expected: string;
}

export interface InlineCaseDraft {
  test_point_id?: string;
  requirement_id?: string;
  title: string;
  group?: string;
  module_tree_node_id?: string;
  tags?: string[];
  priority?: string;
  importance?: string;
  version_name?: string;
  preconditions?: string;
  steps?: ImportStepDraft[];
  automation_type?: string | null;
  automation_result?: string | null;
  source_case_key?: string;
  content_hash?: string;
}

export type TestrailPlanRuleKey = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7";

export interface TestrailPlanRuleConfig {
  enabled: boolean;
  description?: string;
  [key: string]: unknown;
}

export interface TestrailPlanRulesBody {
  rules?: Partial<Record<TestrailPlanRuleKey, TestrailPlanRuleConfig>>;
  automation_detection?: {
    fields?: string[];
    rule?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type TestrailPlanMilestoneStrategy = "AUTO" | "CREATE" | "REUSE_LATEST" | "REUSE_BY_ID";

export type TestrailPlanTicketReuseStrategy = "AUTO" | "CREATE_ALL";

export interface TestrailPlanPreviewInput {
  versionId?: string;
  ticketId?: string | null;
  ticketIds?: string[] | string;
  milestoneName?: string;
  milestoneStrategy?: TestrailPlanMilestoneStrategy;
  milestoneId?: number | string;
  ticketReuseStrategy?: TestrailPlanTicketReuseStrategy;
  startDate?: string;
  endDate?: string;
}

export type TestrailDefectTicketType = "FEATURE" | "BUGFIX";

export interface TestrailDefectDraftInput {
  versionId?: string;
  runId?: number | string;
  caseId?: number | string;
  testId?: number | string;
}

export interface TestrailDefectCreateTicketInput {
  draft: Record<string, unknown>;
  link_existing_ticket_id?: string | null;
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskRulesBody {
  pass_rate_min?: number;
  p1_open_failures_max?: number;
  new_feature_unexecuted_rate_max?: number;
  high_plus_open_tickets_max?: number;
  critical_case?: {
    importance_field?: string;
    importance_values?: string[];
    priority_values?: string[];
    [key: string]: unknown;
  };
  flaky?: {
    consecutive_failures?: number;
    use_historical_mark?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RiskAssessmentComputeInput {
  refreshExecution?: boolean;
  noRefreshExecution?: boolean;
  ticketId?: string | null;
  planMappingIds?: string[] | string;
}

export interface RiskAssessmentSaveBody {
  risk_level?: RiskLevel;
  reasons?: unknown[];
  note?: string;
  ai_summary?: string;
  override_rule_engine?: boolean;
  [key: string]: unknown;
}

/** `POST .../qa/testrail/link/cases/preview` — Workflow A (T2-A8). */
export interface TestrailLinkCasesPreviewInput {
  suiteId?: number;
  requirementId?: string;
  parentSectionId?: number;
}

/** One Ticket ↔ TestRail Plan/Run binding for link plans preview. */
export interface TestrailLinkPlanBindingInput {
  ticketId: string;
  planId: number;
  runIds?: number[];
}

/** `POST .../qa/testrail/link/plans/preview` — Workflow B (T2-A8). */
export interface TestrailLinkPlansPreviewInput {
  versionId?: string;
  bindings?: TestrailLinkPlanBindingInput[];
  /** Single-binding shortcut when --body is omitted. */
  ticketId?: string;
  planId?: number;
  runIds?: number[] | string;
}
