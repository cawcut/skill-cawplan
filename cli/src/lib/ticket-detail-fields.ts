/**
 * Sparse fieldset tokens for GET single-ticket detail (OpenAPI + internal).
 * Mirrors uid.core-product/internal/handler/http/ticket_detail_fields.go
 */
export const TICKET_DETAIL_FIELD_TOKENS = [
  "labels",
  "children",
  "relations",
  "product_line",
  "ai_sessions",
  "qa_reports",
] as const;

export type TicketDetailFieldToken = (typeof TICKET_DETAIL_FIELD_TOKENS)[number];

const ALLOWED = new Set<string>(TICKET_DETAIL_FIELD_TOKENS);

/**
 * Normalize and validate a CSV `fields` query value before sending to BE.
 * Omitted at call site => full enrich (do not pass `fields` query param).
 */
export function normalizeTicketDetailFieldsCsv(csv: string): string {
  const tokens = csv
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    throw new Error(
      `invalid fields: empty value (allowed: ${TICKET_DETAIL_FIELD_TOKENS.join(", ")})`,
    );
  }

  const invalid = tokens.filter((t) => !ALLOWED.has(t));
  if (invalid.length > 0) {
    throw new Error(
      `invalid fields: ${invalid.join(", ")} (allowed: ${TICKET_DETAIL_FIELD_TOKENS.join(", ")})`,
    );
  }

  // Preserve caller order; BE accepts any order.
  return tokens.join(",");
}
