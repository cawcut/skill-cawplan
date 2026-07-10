/**
 * Helpers for pairing human prompts with the assistant text that follows them.
 * Only plain text blocks are included — tool_use / tool output is excluded.
 */

export function joinAssistantMessages(parts: string[] | undefined): string | undefined {
    if (!parts?.length) return undefined;
    const joined = parts.map((part) => part.trim()).filter(Boolean).join("\n\n");
    return joined || undefined;
}

export function appendAssistantMessage(
    existing: string | undefined,
    part: string
): string | undefined {
    const trimmed = part.trim();
    if (!trimmed) return existing;
    if (!existing?.trim()) return trimmed;
    return `${existing}\n\n${trimmed}`;
}

export function extractAssistantTextFromBlocks(content: unknown): string {
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return "";
    const parts: string[] = [];
    for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const record = block as Record<string, unknown>;
        const type = record["type"];
        if (type !== "text" && type !== "output_text") continue;
        const text = String(record["text"] ?? "").trim();
        if (text) parts.push(text);
    }
    return parts.join("\n").trim();
}
