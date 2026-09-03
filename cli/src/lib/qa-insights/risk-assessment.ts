/**
 * T2-A5 release risk assessment — API path helpers.
 *
 * Paths live under `/qa/risk-rules` and `/versions/{version_id}/qa/risk-assessment`
 * (not under `/qa/testrail`).
 */

const API_BASE = "/api/v1/public/openapi/product";

export function qaApiPath(productId: string, suffix: string): string {
  return `${API_BASE}/${productId}/qa${suffix}`;
}

export function versionQaApiPath(productId: string, versionId: string, suffix: string): string {
  return `${API_BASE}/${productId}/versions/${versionId}/qa${suffix}`;
}
