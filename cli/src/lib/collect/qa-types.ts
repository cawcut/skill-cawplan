import {ModelUsageEntry, UsageBucket} from "./types.js";

/**
 * Backend asset add/modify/delete counts — "adopted volume" only (archived /
 * persisted to CawPlan), not in-session generation volume. All three fields are
 * required non-negative integers; the backend stores them as-is without recomputing.
 *
 * All six numbers must flow through the single qa-asset-changes.ts collector.
 * Do not inline literal zeros in builders. V1 only testpoint.added has a real
 * source; the other five slots return 0 until a later phase wires them up — without
 * changing this shape or the upload payload.
 */
export interface QaAssetChange {
    added: number;
    modified: number;
    deleted: number;
}

/**
 * Skill layer identifier — the skill package name itself (self-describing).
 *
 * The backend stores skill_layers as opaque strings (trim/dedupe only, no enum
 * validation), unlike category which rejects invalid enum values. Readable skill
 * names are preferred over internal shorthand so dashboards and search need no
 * lookup table.
 */
export type QaSkillLayer =
    | "cawplan-requirement-analyze"   // Requirement analyze / archive
    | "cawplan-testpoint-generate"    // Test-point generate / batch archive
    | "cawplan-testcase-generate";    // Test-case expand / CSV export

/** Assignment UI only — stripped from upload payload by toQaUploadPayload(). */
export interface QaDisplayTimeRange {
    start?: string;
    display?: string;
}

export interface QaSessionData {
    // Required
    session_id: string;
    agent: string;

    // Optional (nullable backend columns)
    source?: string;
    session_title?: string;
    product_id?: string;
    cwd?: string;
    session_cost?: number;

    // Arrays (backend NOT NULL DEFAULT []; emit [] when empty)
    ticket_ids: string[];
    ticket_display_ids: string[];
    requirement_ids: string[];            // id strings only, not anchor objects
    skill_layers: QaSkillLayer[];

    // V1 required asset slots (backend stores as-is; see QaAssetChange)
    testpoint: QaAssetChange;
    testcase: QaAssetChange;

    /** Assignment UI only — omitted from upload payload (see toQaUploadPayload). */
    display_time_range?: QaDisplayTimeRange;

    // Optional (not produced in V1)
    conversation?: QaConversation;
}

export interface QaConversation {
    schema: "ai-session-conversation/1.0";
    session_id: string;
    messages: Array<{
        role: "user" | "assistant";
        content: string;
        timestamp?: string;
    }>;
}

/**
 * Human input entry for QA daily upload — only these five keys are sent.
 *
 * CRITICAL: category and topic must never appear in serialized JSON.
 * Backend columns default to 'other' but reject invalid enum values with 400
 * (FAILURE_INVALID_INPUT), rejecting the whole report. Those fields are filled
 * by backend enrichment — the correct client behavior is to omit the keys entirely.
 *
 *   OK:      { "content": "...", "session_id": "..." }
 *   BAD:     { "content": "...", "category": null }   → null is invalid → 400
 *   BAD:     { "content": "...", "category": "" }     → empty is invalid → 400
 *
 * Keys are omitted from this interface (not even optional) so they cannot be
 * assigned accidentally. Same for topic_source / topic_confidence / topic_reason.
 */
export interface QaHumanInput {
    // Required
    content: string;

    // Optional
    assistant_message?: string;
    session_id?: string;                  // backend resolves entry_id from this when present
    start_time?: string | null;
    end_time?: string | null;

    // Not declared — category, topic, topic_source, topic_confidence, topic_reason
}

export interface QaDailyApiJson {
    // Required
    schema: "qa-session.1";
    date: string;                         // YYYY-MM-DD
    author: string;
    generated_at: string;                 // ISO
    include_conversation: boolean;        // always false in V1

    totals: {
        sessions: number;
        agents: string[];
        messages: { user: number; assistant: number; tool_calls: number };
        cost: { [currency: string]: number };
        // no excluded_sessions or files_changed
    };
    usage_breakdown: UsageBucket[];
    model_usage: Record<string, ModelUsageEntry>;
    sessions: QaSessionData[];
    human_inputs: QaHumanInput[];

    // Not produced: collect_mode, summary, ticket_contexts, repos, files_*,
    // sessions[].transcript / requirements[] / skill_markers / derived /
    // exclude_from_stats / is_empty_session / message_stats
}
