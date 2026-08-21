const ISSUE_URL_RE = /https?:\/\/[^\s/]+\/issue\/([A-Za-z]+-\d+)/i;
const DISPLAY_ID_RE = /^[A-Za-z][A-Za-z0-9]+-\d+$/;

/** Parse one user-entered ticket reference into an uppercase display id, or "". */
export function parseTicketDisplayIdFromInput(value: unknown): string {
    const trimmed = String(value ?? "").trim();
    const urlMatch = ISSUE_URL_RE.exec(trimmed);
    if (urlMatch?.[1]) return urlMatch[1].toUpperCase();
    const displayMatch = DISPLAY_ID_RE.exec(trimmed);
    return displayMatch ? trimmed.toUpperCase() : "";
}

/** Normalize a list of ticket references. Caller decides non-array handling. */
export function normalizeTicketDisplayIdList(items: unknown[]): string[] {
    return [...new Set(items
        .map((item) => parseTicketDisplayIdFromInput(item))
        .filter(Boolean))];
}

/** QA apply path: non-array input becomes []. */
export function normalizeTicketDisplayIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return normalizeTicketDisplayIdList(value);
}

/** Coding web-server path: non-array input stays undefined. */
export function normalizeTicketDisplayIdsIfArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return normalizeTicketDisplayIdList(value);
}
