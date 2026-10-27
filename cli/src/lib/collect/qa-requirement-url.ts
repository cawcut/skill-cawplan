import {parseEvents} from "./agents/claude-code.js";

const REQUIREMENT_URL_RE =
    /\/product\/([0-9a-f-]{36})\/qa-insights\/test-suites\/requirements\/([0-9a-f-]{36})/gi;

export interface QaRequirementRef {
    productId: string;
    requirementId: string;
}

/**
 * Scan free text for CawPlan requirement URLs and return unique, trimmed
 * (product_id, requirement_id) pairs in the order first seen.
 */
export function requirementRefsFromText(text: string): QaRequirementRef[] {
    const seen = new Set<string>();
    const refs: QaRequirementRef[] = [];
    let match: RegExpExecArray | null;
    // Reset lastIndex in case the shared regex was used elsewhere mid-scan.
    REQUIREMENT_URL_RE.lastIndex = 0;
    while ((match = REQUIREMENT_URL_RE.exec(text)) !== null) {
        const productId = match[1].trim();
        const requirementId = match[2].trim();
        const key = `${productId}|${requirementId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push({productId, requirementId});
    }
    return refs;
}

/**
 * Fallback source for requirement_ids[] (the primary source is the structured
 * stdout receipt from a testpoints-archive call). This module exists because
 * not every session that touches a requirement actually archives against it —
 * a session might only read/list against a requirement, or the user might
 * paste the requirement's web URL directly as a prompt, in which case the
 * structured stdout never carries a requirement_id but the URL still shows up
 * somewhere in the conversation text.
 *
 * The URL can appear in several different places depending on how the
 * conversation unfolded, so this scans all of them: assistant reply text,
 * qa-insights Bash command lines, the user's typed prompt (which Claude Code
 * logs as either a plain string or a content-block array depending on
 * whether it was a plain message or included tool results), and the
 * session's cached last-prompt record. Returns a deduplicated array of
 * requirement_id strings only — no anchor metadata, since nothing in this
 * pipeline retains the transcript an anchor would point into.
 */
export function requirementIdsFromJsonl(jsonlPath: string, date?: string): string[] {
    return requirementRefsFromJsonl(jsonlPath, date).map((ref) => ref.requirementId);
}

/**
 * Same scan as requirementIdsFromJsonl, but keeps the product_id half of
 * each pair — needed by the product-association fallback (tier 2), which
 * has no other way to recover which product a read-only, non-archiving
 * session touched.
 */
export function requirementRefsFromJsonl(jsonlPath: string, date?: string): QaRequirementRef[] {
    const events = parseEvents(jsonlPath, date);
    const seen = new Set<string>();
    const refs: QaRequirementRef[] = [];

    const addFromText = (text: string) => {
        for (const ref of requirementRefsFromText(text)) {
            if (seen.has(ref.requirementId)) continue;
            seen.add(ref.requirementId);
            refs.push(ref);
        }
    };

    for (const event of events) {
        const type = event["type"];

        if (type === "last-prompt") {
            const lastPrompt = event["lastPrompt"];
            if (typeof lastPrompt === "string") addFromText(lastPrompt);
            continue;
        }

        if (type !== "assistant" && type !== "user") continue;

        const content = (event["message"] as {content?: unknown} | undefined)?.content;
        if (typeof content === "string") {
            addFromText(content);
            continue;
        }
        if (!Array.isArray(content)) continue;

        for (const block of content) {
            const b = block as {type?: string; text?: string; name?: string; input?: {command?: string}};
            if (b.type === "text" && typeof b.text === "string") {
                addFromText(b.text);
            } else if (b.type === "tool_use" && b.name === "Bash" && typeof b.input?.command === "string") {
                addFromText(b.input.command);
            }
        }
    }

    return refs;
}
