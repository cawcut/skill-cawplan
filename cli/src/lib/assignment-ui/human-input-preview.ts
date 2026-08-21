import {escapeHtml} from "./format.js";

export function humanInputContent(input: unknown): unknown {
    if (typeof input === "string") return input;
    const record = input as {content?: unknown; raw_block?: unknown; topic?: unknown} | null | undefined;
    return record && (record.content || record.raw_block || record.topic || "");
}

export function truncateHumanInput(input: unknown): string {
    const text = String(input || "");
    return text.length > 200 ? text.slice(0, 200) + "..." : text;
}

export function humanInputsForSession(
    report: {human_inputs?: unknown[]},
    session: {session_id?: string | null},
): unknown[] {
    const allInputs = Array.isArray(report.human_inputs) ? report.human_inputs : [];
    const sessionId = String(session.session_id || "");
    return allInputs.filter((input) => String(
        input && typeof input === "object"
            ? (input as Record<string, unknown>).session_id || ""
            : "",
    ) === sessionId);
}

export function humanInputsHtml(
    report: {human_inputs?: unknown[]},
    session: {session_id?: string | null},
    escape: (value: unknown) => string = escapeHtml,
): string {
    const inputs = humanInputsForSession(report, session)
        .filter((input) => humanInputContent(input))
        .slice(0, 3);
    if (inputs.length === 0) return '<span class="muted">No human inputs</span>';
    return '<ol class="human-inputs">' + inputs.map((input) => {
        const text = escape(truncateHumanInput(humanInputContent(input)));
        return "<li>" + text + "</li>";
    }).join("") + "</ol>";
}
