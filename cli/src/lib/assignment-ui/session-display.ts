export interface SessionTitleSource {
    session_title?: string | null;
    session_name?: string | null;
    session_id?: string | null;
}

/** coding: session_title || session_name || session_id; qa: session_title ?? session_id */
export type ResolveSessionTitleMode = "coding" | "qa";

export function resolveSessionTitle(
    session: SessionTitleSource,
    mode: ResolveSessionTitleMode,
): string | undefined {
    if (mode === "coding") {
        return session.session_title || session.session_name || session.session_id || undefined;
    }
    return session.session_title ?? session.session_id ?? undefined;
}
