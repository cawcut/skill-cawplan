import {resolveTicketContexts, ticketContextIsResolved} from "../ai-session/ticket-context.js";
import type {QaAssetChange, QaDailyApiJson, QaSessionData} from "../collect/qa-types.js";
import type {QaExcludedSession} from "../collect/aggregators/qa-daily.js";
import type {QaWebAssignment} from "./types.js";

export class QaAssignmentValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "QaAssignmentValidationError";
    }
}

function emptyAssetChange(): QaAssetChange {
    return {added: 0, modified: 0, deleted: 0};
}

export function normalizeTicketDisplayIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
        .map((item) => {
            const trimmed = String(item ?? "").trim();
            const urlMatch = /https?:\/\/[^\s/]+\/issue\/([A-Za-z]+-\d+)/i.exec(trimmed);
            if (urlMatch?.[1]) return urlMatch[1].toUpperCase();
            const displayMatch = /^[A-Za-z][A-Za-z0-9]+-\d+$/.exec(trimmed);
            return displayMatch ? trimmed.toUpperCase() : "";
        })
        .filter(Boolean))];
}

/**
 * Each session may appear at most once; conflicting product_id values for the
 * same session_id are rejected. Empty product_id is allowed (manual fallback).
 */
export function validateQaAssignments(assignments: QaWebAssignment[]): void {
    const productBySession = new Map<string, string | undefined>();
    for (const assignment of assignments) {
        const sessionId = assignment.session_id?.trim();
        if (!sessionId) {
            throw new QaAssignmentValidationError("session_id is required for every assignment");
        }
        const productId = assignment.product_id?.trim() || undefined;
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
        testpoint: emptyAssetChange(),
        testcase: emptyAssetChange(),
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
    daily.totals.sessions = daily.sessions.length;
    daily.totals.agents = [...new Set(daily.sessions.map((session) => session.agent).filter(Boolean))];
}

export async function applyQaWebAssignments(
    daily: QaDailyApiJson,
    assignments: QaWebAssignment[],
    excludedSessions: QaExcludedSession[] = [],
): Promise<number> {
    validateQaAssignments(assignments);
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

        const productId = assignment.product_id?.trim();
        if (productId) {
            session.product_id = productId;
        } else {
            delete session.product_id;
        }

        await applyTicketDisplayIds(session, assignment);
        applied += 1;
    }

    refreshTotals(daily);
    return applied;
}
