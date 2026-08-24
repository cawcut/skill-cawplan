export function escapeHtml(value: unknown): string {
    return String(value ?? "").replace(/[&<>"']/g, (c) => (
        {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]!
    ));
}

export function normalizePortalBase(portalBase: string): string {
    return portalBase.replace(/\/$/, "");
}
