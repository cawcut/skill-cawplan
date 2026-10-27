import {normalizePortalBase} from "./format.js";

export function ticketDetailUrl(portalBase: string, ticket: string): string {
    return normalizePortalBase(portalBase) + "/issue/" + encodeURIComponent(ticket);
}
