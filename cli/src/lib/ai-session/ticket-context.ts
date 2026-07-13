import {cawplanRequest} from "../http.js";
import {resolveApiPath} from "../products.js";
import {extractList} from "./helpers.js";
import type {AiSessionTicketContext, DailyApiJson, HumanInput, SessionData} from "../collect/types.js";

interface TicketSearchItem {
    unique_id?: string;
    display_id?: string;
    product_id?: string;
    product_line_id?: string;
    version_id?: string;
    title?: string;
    name?: string;
    summary?: string;
    content?: string;
    body?: string;
    description?: string;
    url?: string;
}

const displayIdOnlyPattern = /^[A-Z][A-Z0-9]+-\d+$/i;
const issueUrlPattern = /https?:\/\/[^\s)"'<>]+\/issue\/([A-Za-z]+-\d+)/gi;
const displayIdTextPattern = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const ticketFieldPattern = /\b(ticket_ids?|ticket_display_ids?)\b\s*[:=]\s*([^\n\r]+)/gi;

export function ticketDisplayIdFromRef(ref: string): string | undefined {
    const trimmed = ref.trim();
    const urlMatch = /https?:\/\/[^\s/]+\/issue\/([A-Za-z]+-\d+)/i.exec(trimmed);
    if (urlMatch?.[1]) return urlMatch[1].toUpperCase();
    const displayMatch = /^[A-Za-z][A-Za-z0-9]+-\d+$/.exec(trimmed);
    return displayMatch ? trimmed.toUpperCase() : undefined;
}

function ticketContextFromSearchItem(item: TicketSearchItem, fallbackRef: string): AiSessionTicketContext {
    const displayId = item.display_id ?? ticketDisplayIdFromRef(fallbackRef);
    const ticketId = item.unique_id ?? displayId ?? fallbackRef;
    const content = item.content ?? item.description ?? item.summary ?? item.body;
    return {
        ticket_id: ticketId,
        ticket_display_id: displayId,
        product_id: item.product_id,
        product_line_id: item.product_line_id,
        version_id: item.version_id,
        title: item.title ?? item.name,
        content,
        url: item.url ?? (displayId ? `https://www.cawplan.com/issue/${displayId}` : undefined),
    };
}

export async function resolveTicketContexts(refs: string[]): Promise<AiSessionTicketContext[]> {
    const uniqueRefs = [...new Set(refs.map((ref) => ref.trim()).filter(Boolean))];
    if (uniqueRefs.length === 0) throw new Error("at least one ticket ref is required");

    const displayIds = [...new Set(uniqueRefs.map(ticketDisplayIdFromRef).filter(Boolean) as string[])];
    const uniqueIds = uniqueRefs.filter((ref) => !ticketDisplayIdFromRef(ref));
    const body: Record<string, unknown> = {};
    if (displayIds.length > 0) body.display_ids = displayIds;
    if (uniqueIds.length > 0) body.unique_ids = uniqueIds;

    const result = await cawplanRequest({
        method: "POST",
        path: resolveApiPath("/api/v1/public/openapi/tickets/search"),
        query: {page_size: String(Math.max(uniqueRefs.length, 20))},
        body,
    });
    const items = extractList<TicketSearchItem>(result);
    const byDisplayId = new Map(items
        .filter((item) => item.display_id)
        .map((item) => [String(item.display_id).toUpperCase(), item]));
    const byUniqueId = new Map(items
        .filter((item) => item.unique_id)
        .map((item) => [String(item.unique_id), item]));

    return uniqueRefs.map((ref) => {
        const displayId = ticketDisplayIdFromRef(ref);
        const item = displayId ? byDisplayId.get(displayId) : byUniqueId.get(ref);
        return ticketContextFromSearchItem(item ?? {}, ref);
    });
}

function appendUnique(values: string[] | undefined, value: string): string[] {
    const existing = values ?? [];
    return existing.includes(value) ? existing : [...existing, value];
}

export function ticketContextIsResolved(context: AiSessionTicketContext): boolean {
    return Boolean(
        context.product_id
        || context.version_id
        || context.title
        || context.content
        || (context.ticket_display_id && context.ticket_id !== context.ticket_display_id)
    );
}

function attachContextsToSession(session: SessionData, contexts: AiSessionTicketContext[]): SessionData {
    let next = {...session};
    for (const context of contexts) {
        if (!ticketContextIsResolved(context)) continue;
        next = {
            ...next,
            ticket_ids: appendUnique(next.ticket_ids, context.ticket_id),
            ticket_display_ids: context.ticket_display_id
                ? appendUnique(next.ticket_display_ids, context.ticket_display_id)
                : next.ticket_display_ids,
        };
    }
    return next;
}

export function ticketContextMatchesSessionProduct(session: Pick<SessionData, "product_id">, context: AiSessionTicketContext): boolean {
    const sessionProductId = session.product_id?.trim();
    if (!sessionProductId) return true;
    return context.product_id?.trim() === sessionProductId;
}

function splitTicketValues(value: unknown): string[] {
    if (Array.isArray(value)) return value.flatMap(splitTicketValues);
    const text = String(value ?? "").trim();
    if (!text) return [];
    return text
        .split(/[\s,;]+/)
        .map((part) => part.trim().replace(/^["'`([{]+|["'`)\]}.,:;]+$/g, ""))
        .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function displayRefsFromText(text: string): string[] {
    const refs: string[] = [];
    for (const match of text.matchAll(issueUrlPattern)) {
        if (match[1]) refs.push(match[1].toUpperCase());
    }
    for (const match of text.matchAll(displayIdTextPattern)) {
        refs.push(match[0].toUpperCase());
    }
    return uniqueStrings(refs);
}

function humanInputText(input: HumanInput): string {
    return [
        input.content,
        input.raw_block,
        input.topic,
    ].filter(Boolean).map(String).join("\n");
}

function extractTicketRefsFromHumanInput(input: HumanInput): string[] {
    const refs: string[] = [];
    const record = input as unknown as Record<string, unknown>;
    for (const key of ["ticket_id", "ticket_ids"]) {
        refs.push(...splitTicketValues(record[key]));
    }
    for (const key of ["ticket_display_id", "ticket_display_ids"]) {
        refs.push(...splitTicketValues(record[key]).flatMap(displayRefsFromText));
    }

    const text = humanInputText(input);
    for (const match of text.matchAll(ticketFieldPattern)) {
        const key = String(match[1] ?? "").toLowerCase();
        const value = match[2] ?? "";
        if (key.startsWith("ticket_display")) {
            refs.push(...displayRefsFromText(value));
        } else {
            refs.push(...splitTicketValues(value));
        }
    }
    refs.push(...displayRefsFromText(text));

    return uniqueStrings(refs);
}

export function extractTicketRefsFromHumanInputs(inputs: HumanInput[] | undefined): string[] {
    return [...new Set((inputs ?? []).flatMap(extractTicketRefsFromHumanInput))];
}

export async function applyHumanInputTicketRefsToSessions(
    sessions: SessionData[],
    resolveContexts: (refs: string[]) => Promise<AiSessionTicketContext[]> = resolveTicketContexts
): Promise<number> {
    const refsBySession = sessions.map((session) => extractTicketRefsFromHumanInputs(session.human_inputs));
    const allRefs = [...new Set(refsBySession.flat())];
    if (allRefs.length === 0) return 0;

    const contexts = await resolveContexts(allRefs);
    const contextByRef = new Map<string, AiSessionTicketContext>();
    for (let i = 0; i < allRefs.length; i++) {
        const ref = allRefs[i]!;
        const context = contexts[i];
        if (!context) continue;
        contextByRef.set(ref, context);
        if (context.ticket_display_id) contextByRef.set(context.ticket_display_id.toUpperCase(), context);
        contextByRef.set(context.ticket_id, context);
    }

    let applied = 0;
    for (let i = 0; i < sessions.length; i++) {
        const refs = refsBySession[i]!;
        const sessionContexts = refs
            .map((ref) => contextByRef.get(ref))
            .filter((context): context is AiSessionTicketContext => Boolean(context))
            .filter(ticketContextIsResolved);
        if (sessionContexts.length === 0) continue;
        const before = sessions[i]!.ticket_ids?.length ?? 0;
        sessions[i] = attachContextsToSession(sessions[i]!, sessionContexts);
        applied += Math.max((sessions[i]!.ticket_ids?.length ?? 0) - before, 0);
    }
    return applied;
}

export async function normalizeSessionTicketIdsToUniqueIds(
    sessions: SessionData[],
    resolveContexts: (refs: string[]) => Promise<AiSessionTicketContext[]> = resolveTicketContexts
): Promise<number> {
    const displayIds = [...new Set(sessions
        .flatMap((session) => session.ticket_ids ?? [])
        .filter((ticketId) => displayIdOnlyPattern.test(ticketId))
        .map((ticketId) => ticketId.toUpperCase()))];
    if (displayIds.length === 0) return 0;

    const contexts = await resolveContexts(displayIds);
    const contextByDisplayId = new Map(contexts
        .filter((context) => context.ticket_display_id && context.ticket_id && ticketContextIsResolved(context))
        .map((context) => [String(context.ticket_display_id).toUpperCase(), context]));

    let replaced = 0;
    for (const session of sessions) {
        if (!session.ticket_ids?.length) continue;
        const nextTicketIds: string[] = [];
        const nextTicketDisplayIds = [...(session.ticket_display_ids ?? [])];
        for (const ticketId of session.ticket_ids) {
            const isDisplayId = displayIdOnlyPattern.test(ticketId);
            const context = isDisplayId ? contextByDisplayId.get(ticketId.toUpperCase()) : undefined;
            const normalized = isDisplayId && context && ticketContextMatchesSessionProduct(session, context)
                ? context.ticket_id
                : isDisplayId
                    ? undefined
                    : ticketId;
            if (!normalized) {
                replaced++;
                continue;
            }
            if (normalized !== ticketId) replaced++;
            if (!nextTicketIds.includes(normalized)) nextTicketIds.push(normalized);
            if (isDisplayId && !nextTicketDisplayIds.includes(ticketId.toUpperCase())) {
                nextTicketDisplayIds.push(ticketId.toUpperCase());
            }
        }
        session.ticket_ids = nextTicketIds;
        if (nextTicketDisplayIds.length > 0) session.ticket_display_ids = nextTicketDisplayIds;
    }
    return replaced;
}
