import { getCache, pruneCacheEntries, setCache } from "../cache.js";
import type { SessionData } from "./types.js";

const ASSIGNMENT_TICKET_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ASSIGNMENT_TICKET_CACHE_PREFIX = "ai-session:assignment-ticket-refs:";

export interface CachedAssignmentTicketRefs {
  product_id?: string;
  ticket_ids: string[];
  ticket_display_ids: string[];
  date?: string;
}

function normalizeRefs(refs: string[]): string[] {
  return [...new Set(refs.map((ref) => ref.trim()).filter(Boolean))];
}

function assignmentCacheKey(sessionId: string): string {
  return `${ASSIGNMENT_TICKET_CACHE_PREFIX}${sessionId}`;
}

export function getCachedAssignmentTicketRefs(sessionId: string): CachedAssignmentTicketRefs | undefined {
  pruneExpiredAssignmentTicketRefs();
  const cached = getCache(
    assignmentCacheKey(sessionId),
    false,
    ASSIGNMENT_TICKET_CACHE_TTL_MS
  ) as Partial<CachedAssignmentTicketRefs> | undefined;
  if (!cached) return undefined;
  return {
    product_id: typeof cached.product_id === "string" ? cached.product_id : undefined,
    ticket_ids: normalizeRefs((cached.ticket_ids ?? []).map(String)),
    ticket_display_ids: normalizeRefs((cached.ticket_display_ids ?? []).map(String)),
    date: typeof cached.date === "string" ? cached.date : undefined,
  };
}

export function pruneExpiredAssignmentTicketRefs(): number {
  return pruneCacheEntries(ASSIGNMENT_TICKET_CACHE_PREFIX, ASSIGNMENT_TICKET_CACHE_TTL_MS);
}

export function setCachedAssignmentTicketRefsFromSession(session: Pick<
  SessionData,
  "session_id" | "product_id" | "ticket_ids" | "ticket_display_ids" | "date"
>): void {
  pruneExpiredAssignmentTicketRefs();
  setCache(assignmentCacheKey(session.session_id), {
    product_id: session.product_id,
    ticket_ids: normalizeRefs(session.ticket_ids ?? []),
    ticket_display_ids: normalizeRefs(session.ticket_display_ids ?? []),
    date: session.date,
  });
}
