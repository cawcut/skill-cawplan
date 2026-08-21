import type {QaDailyApiJson} from "../collect/qa-types.js";
import type {QaExcludedSession} from "../collect/aggregators/qa-daily.js";

export interface QaAssignmentReport {
    file: string;
    daily: QaDailyApiJson;
    excludedSessions: QaExcludedSession[]; // commit-only or empty sessions only
}

/** Payload the confirmation page posts back to the server. */
export interface QaWebAssignment {
    session_id: string;
    product_id?: string;
    product_line_id?: string;
    product_name?: string;
    ticket_display_ids?: string[];
    /** Set when the row was added from the layer 2/3 excluded-session supplement list. */
    manually_added?: boolean;
}

export interface QaAssignmentBootstrap {
    daily: QaDailyApiJson;
    products: Array<{
        product_id: string;
        product_name: string;
        product_line_id?: string;
    }>;
    excludedSessions: QaExcludedSession[]; // commit-only or empty sessions only
}
