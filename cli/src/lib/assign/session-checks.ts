import type {DailyApiJson} from "../collect/types.js";

export function findSessionById(daily: DailyApiJson, sessionId: string) {
    const session = daily.sessions.find((s) => s.session_id === sessionId);
    if (!session) throw new Error(`session not found: ${sessionId}`);
    return session;
}

export function missingProductSessionLabels(daily: DailyApiJson): string[] {
    return daily.sessions
        .filter((session) => !session.product_id)
        .map((session) => session.session_title ?? session.session_name ?? session.session_id);
}

export function assertAllSessionsHaveProduct(daily: DailyApiJson): void {
    const missing = missingProductSessionLabels(daily);
    if (missing.length === 0) return;
    throw new Error(`product is required for every session; missing: ${missing.join(", ")}`);
}

export function warnMissingProductAssignment(file: string, daily: DailyApiJson): boolean {
    const missing = missingProductSessionLabels(daily);
    if (missing.length === 0) return false;
    console.error(
        `Product assignment is incomplete for ${missing.length} session(s) in ${file}: ${missing.join(", ")}`
    );
    console.error("Please complete product assignment before uploading.");
    console.error(`Batch multiple reports: cawplan session assign --web --files ${file}`);
    console.error(`Single-file web fallback: cawplan session assign --file ${file} --web`);
    console.error(`TTY alternative: cawplan session assign --file ${file} --tty`);
    return true;
}
