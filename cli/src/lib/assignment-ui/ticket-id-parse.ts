const ISSUE_URL_RE = /https?:\/\/[^\s/]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)/i;
const DISPLAY_ID_RE = /^[A-Za-z][A-Za-z0-9]+-\d+$/;

/** CawPlan display ids zero-pad the number to 5 digits (PRM-00699); `PRM-699` never matches in search. */
function padDisplayIdNumber(displayId: string): string {
    const dash = displayId.lastIndexOf("-");
    return `${displayId.slice(0, dash).toUpperCase()}-${displayId.slice(dash + 1).padStart(5, "0")}`;
}

/** Parse one user-entered ticket reference into an uppercase, zero-padded display id, or "". */
export function parseTicketDisplayIdFromInput(value: unknown): string {
    const trimmed = String(value ?? "").trim();
    const urlMatch = ISSUE_URL_RE.exec(trimmed);
    if (urlMatch?.[1]) return padDisplayIdNumber(urlMatch[1]);
    const displayMatch = DISPLAY_ID_RE.exec(trimmed);
    return displayMatch ? padDisplayIdNumber(trimmed) : "";
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
