import {resolveTicketContexts, ticketContextIsResolved} from "../ai-session/ticket-context.js";
import type {QaAssetChange, QaDailyApiJson, QaSessionData} from "../collect/qa-types.js";
import type {QaExcludedSession} from "../collect/aggregators/qa-daily.js";
import type {QaWebAssignment} from "./types.js";
import {toQaUploadPayload} from "../collect/aggregators/qa-daily.js";
import {normalizeTicketDisplayIds} from "../assignment-ui/ticket-id-parse.js";

export {normalizeTicketDisplayIds} from "../assignment-ui/ticket-id-parse.js";

export class QaAssignmentValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "QaAssignmentValidationError";
    }
}

function emptyAssetChange(): QaAssetChange {
    return {added: 0, modified: 0, deleted: 0};
}

/**
 * Each active session must have one product and may appear at most once; conflicting
 * product_id values for the same session_id are rejected.
 */
export function validateQaAssignments(assignments: QaWebAssignment[]): void {
    const productBySession = new Map<string, string | undefined>();
    for (const assignment of assignments) {
        const sessionId = assignment.session_id?.trim();
        if (!sessionId) {
            throw new QaAssignmentValidationError("session_id is required for every assignment");
        }
        const productId = assignment.product_id?.trim();
        if (assignment.ignored !== undefined && typeof assignment.ignored !== "boolean") {
            throw new QaAssignmentValidationError("ignored must be a boolean");
        }
        if (!productId && !assignment.ignored) {
            throw new QaAssignmentValidationError(`product_id is required for session ${sessionId}`);
        }
        if (productBySession.has(sessionId)) {
            const previous = productBySession.get(sessionId);
            if (previous !== productId) {
                throw new QaAssignmentValidationError(
                    `session ${sessionId} cannot be assigned more than one product`
                );
            }
            throw new QaAssignmentValidationError(`duplicate assignment for session ${sessionId}`);
        }
        productBySession.set(sessionId, productId);
    }
}

export function findQaSessionById(daily: QaDailyApiJson, sessionId: string): QaSessionData | undefined {
    return daily.sessions.find((session) => session.session_id === sessionId);
}

/** Build a minimal session row from a layer 2/3 excluded entry (optional supplement). */
function createSupplementedSession(
    excluded: QaExcludedSession,
    assignment: QaWebAssignment,
): QaSessionData {
    return {
        session_id: excluded.session_id,
        agent: excluded.agent,
        session_title: excluded.title ?? excluded.session_id,
        product_id: assignment.product_id?.trim() || undefined,
        ticket_ids: [],
        ticket_display_ids: [],
        requirement_ids: [],
        skill_layers: [],
        models: [],
        testpoint: emptyAssetChange(),
        testcase: emptyAssetChange(),
        review_stats: {messages: {user: 0, assistant: 0, tool_calls: 0}, usage_breakdown: []},
    };
}

async function applyTicketDisplayIds(session: QaSessionData, assignment: QaWebAssignment): Promise<void> {
    const displayIds = normalizeTicketDisplayIds(assignment.ticket_display_ids);
    if (displayIds.length === 0) {
        session.ticket_display_ids = [];
        session.ticket_ids = [];
        return;
    }

    const contexts = await resolveTicketContexts(displayIds);
    const contextByDisplayId = new Map(contexts
        .filter((context) => context.ticket_display_id && context.ticket_id && ticketContextIsResolved(context))
        .map((context) => [String(context.ticket_display_id).toUpperCase(), context]));
    const unresolved = displayIds.filter((displayId) => {
        const context = contextByDisplayId.get(displayId);
        return !context || context.ticket_id === displayId;
    });
    if (unresolved.length > 0) {
        throw new Error(`unable to resolve ticket display ID(s): ${unresolved.join(", ")}`);
    }

    session.ticket_display_ids = displayIds;
    session.ticket_ids = displayIds
        .map((displayId) => contextByDisplayId.get(displayId)?.ticket_id)
        .filter((ticketId): ticketId is string => Boolean(ticketId));
}

function refreshTotals(daily: QaDailyApiJson): void {
    const payload = toQaUploadPayload(daily, true);
    daily.totals = payload.totals;
    daily.usage_breakdown = payload.usage_breakdown;
    daily.model_usage = payload.model_usage;
}

export async function applyQaWebAssignments(
    daily: QaDailyApiJson,
    assignments: QaWebAssignment[],
    excludedSessions: QaExcludedSession[] = [],
): Promise<number> {
    validateQaAssignments(assignments);
    if (assignments.some((assignment) => assignment.ignored) && daily.sessions.some((session) => !session.review_stats)) {
        throw new QaAssignmentValidationError(
            "This report lacks per-session statistics. Re-collect this date before ignoring sessions."
        );
    }
    let applied = 0;

    for (const assignment of assignments) {
        const sessionId = assignment.session_id!.trim();
        let session = findQaSessionById(daily, sessionId);

        if (!session && assignment.manually_added) {
            const excluded = excludedSessions.find((entry) => entry.session_id === sessionId);
            if (!excluded) {
                throw new Error(`cannot supplement unknown session ${sessionId}`);
            }
            session = createSupplementedSession(excluded, assignment);
            daily.sessions.push(session);
        }

        if (!session) {
            throw new Error(`session not found: ${sessionId}`);
        }

        if (assignment.ignored) {
            session.ignored = true;
            if (assignment.product_id) session.product_id = assignment.product_id.trim();
            if (assignment.ticket_display_ids) {
                const refs = normalizeTicketDisplayIds(assignment.ticket_display_ids);
                if (JSON.stringify(refs) !== JSON.stringify(session.ticket_display_ids)) session.ticket_ids = [];
                session.ticket_display_ids = refs;
            }
            continue;
        }
        delete session.ignored;
        session.product_id = assignment.product_id!.trim();

        await applyTicketDisplayIds(session, assignment);
        applied += 1;
    }

    refreshTotals(daily);
    return applied;
}
