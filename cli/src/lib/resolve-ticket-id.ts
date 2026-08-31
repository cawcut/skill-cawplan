import { cawplanRequest } from "./http.js";
import { resolveApiPath } from "./products.js";
import { extractList } from "./ai-session/helpers.js";
import { ticketDisplayIdFromRef } from "./ai-session/ticket-context.js";

export interface TicketRouteScope {
  productId?: string;
  versionId?: string;
}

export interface ResolvedTicketRouteId {
  uniqueId: string;
  resolvedFromDisplayId: boolean;
  displayId?: string;
}

interface TicketSearchItem {
  unique_id?: string;
  display_id?: string;
  product_id?: string;
  version_id?: string;
}

function normalizeScopeId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function matchesRouteScope(item: TicketSearchItem, scope?: TicketRouteScope): boolean {
  const productId = normalizeScopeId(scope?.productId);
  const versionId = normalizeScopeId(scope?.versionId);
  if (productId && item.product_id?.trim() !== productId) return false;
  if (versionId && item.version_id?.trim() !== versionId) return false;
  return true;
}

function formatTicketCandidate(item: TicketSearchItem): string {
  const displayId = item.display_id?.trim() || "?";
  const uniqueId = item.unique_id?.trim() || "?";
  const productId = item.product_id?.trim() || "?";
  const versionId = item.version_id?.trim() || "?";
  return `${displayId} (unique_id=${uniqueId}, product_id=${productId}, version_id=${versionId})`;
}

async function searchTicketsByDisplayId(displayId: string): Promise<TicketSearchItem[]> {
  const result = await cawplanRequest({
    method: "POST",
    path: resolveApiPath("/api/v1/public/openapi/tickets/search"),
    query: { page_size: "20" },
    body: { display_ids: [displayId] },
  });
  return extractList<TicketSearchItem>(result);
}

/**
 * OpenAPI ticket routes use ticket unique_id in the path. Display IDs (e.g. CAWP-20544)
 * must be resolved first or RBAC returns INSUFFICIENT_PERMISSIONS even when the caller
 * has ticket.edit on the product.
 */
export async function resolveTicketUniqueIdForRoute(
  ticketId: string,
  scope?: TicketRouteScope,
): Promise<ResolvedTicketRouteId> {
  const trimmed = ticketId.trim();
  if (!trimmed) {
    throw new Error("ticket_id is required");
  }

  const displayId = ticketDisplayIdFromRef(trimmed);
  if (!displayId) {
    return { uniqueId: trimmed, resolvedFromDisplayId: false };
  }

  const items = await searchTicketsByDisplayId(displayId);
  const withUniqueId = items.filter((item) => item.unique_id?.trim());
  const scoped = withUniqueId.filter((item) => matchesRouteScope(item, scope));
  const candidates = scoped.length > 0 ? scoped : withUniqueId;

  if (candidates.length === 0) {
    const scopeHint = scope?.productId || scope?.versionId
      ? ` under product_id=${scope.productId ?? "?"} version_id=${scope.versionId ?? "?"}`
      : "";
    throw new Error(
      `No ticket found for display_id ${displayId}${scopeHint}. `
      + "Use tickets search --display_ids to verify the ticket exists, then pass its unique_id.",
    );
  }

  if (candidates.length > 1) {
    const listed = candidates.map(formatTicketCandidate).join("; ");
    throw new Error(
      `Multiple tickets match display_id ${displayId}: ${listed}. `
      + "Pass the ticket unique_id explicitly or narrow product_id/version_id.",
    );
  }

  const match = candidates[0]!;
  const uniqueId = match.unique_id!.trim();
  if (scoped.length === 0 && withUniqueId.length === 1) {
    const candidate = withUniqueId[0]!;
    if (!matchesRouteScope(candidate, scope)) {
      process.stderr.write(
        `Warning: ticket ${displayId} belongs to product_id=${candidate.product_id ?? "?"} `
        + `version_id=${candidate.version_id ?? "?"}, not the route scope `
        + `(product_id=${scope?.productId ?? "?"}, version_id=${scope?.versionId ?? "?"}). `
        + `Using unique_id ${uniqueId} anyway.\n`,
      );
    }
  }

  return {
    uniqueId,
    resolvedFromDisplayId: true,
    displayId,
  };
}

/** Resolve ticket path param; logs a short note when a display_id was converted. */
export async function resolveTicketIdArg(
  ticketId: string,
  scope?: TicketRouteScope,
): Promise<string> {
  const resolved = await resolveTicketUniqueIdForRoute(ticketId, scope);
  if (resolved.resolvedFromDisplayId && resolved.displayId) {
    process.stderr.write(
      `Note: resolved ticket display_id ${resolved.displayId} to unique_id ${resolved.uniqueId}\n`,
    );
  }
  return resolved.uniqueId;
}
