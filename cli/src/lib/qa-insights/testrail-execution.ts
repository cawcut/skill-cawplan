import { BodyValidationError } from "./body-builders.js";
import { normalizeField } from "./normalize.js";

export interface TestrailExecutionSummaryQueryInput {
  refresh?: boolean;
  ticketId?: string;
  planMappingId?: string;
  planMappingIds?: string[] | string;
  includeZeroStatuses?: boolean;
}

export interface TestrailExecutionFailuresQueryInput {
  refresh?: boolean;
  runId?: number | string;
  testId?: number | string;
  includeFlaky?: boolean;
  limit?: number | string;
  offset?: number | string;
}

function optionalString(value: unknown): string | undefined {
  const normalized = normalizeField(value);
  return normalized || undefined;
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const rawValues = typeof value === "string" ? value.split(",") : value;
  if (!Array.isArray(rawValues)) {
    throw new BodyValidationError(`${label} must be an array or comma-separated string`);
  }

  const values = rawValues.map((item, index) => {
    const normalized = optionalString(item);
    if (!normalized) {
      throw new BodyValidationError(`${label}[${index}] must be a non-empty string`);
    }
    return normalized;
  });
  if (values.length === 0) {
    throw new BodyValidationError(`${label} must not be empty`);
  }
  return values;
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BodyValidationError(`${label} must be a positive integer`);
  }
  return parsed;
}

function optionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BodyValidationError(`${label} must be a non-negative integer`);
  }
  return parsed;
}

export function buildTestrailExecutionSummaryQuery(
  input: TestrailExecutionSummaryQueryInput,
): Record<string, string> {
  const planMappingId = optionalString(input.planMappingId);
  const planMappingIds = optionalStringArray(input.planMappingIds, "plan_mapping_ids");
  if (planMappingId && planMappingIds) {
    throw new BodyValidationError(
      "testrail execution summary accepts either --plan-mapping-id or --plan-mapping-ids, not both",
    );
  }

  const query: Record<string, string> = {};
  if (input.refresh) query.refresh = "true";
  if (input.includeZeroStatuses) query.include_zero_statuses = "true";
  const ticketId = optionalString(input.ticketId);
  if (ticketId) query.ticket_id = ticketId;
  if (planMappingId) query.plan_mapping_id = planMappingId;
  if (planMappingIds) query.plan_mapping_ids = planMappingIds.join(",");
  return query;
}

export function buildTestrailExecutionFailuresQuery(
  input: TestrailExecutionFailuresQueryInput,
): Record<string, string> {
  const query: Record<string, string> = {};
  if (input.refresh) query.refresh = "true";
  if (input.includeFlaky) query.include_flaky = "true";

  const testId = optionalPositiveInteger(input.testId, "test_id");
  if (testId !== undefined) query.test_id = String(testId);

  const runId = optionalPositiveInteger(input.runId, "run_id");
  if (runId !== undefined) query.run_id = String(runId);

  const limit = optionalPositiveInteger(input.limit, "limit");
  if (limit !== undefined) query.limit = String(limit);

  const offset = optionalNonNegativeInteger(input.offset, "offset");
  if (offset !== undefined) query.offset = String(offset);

  return query;
}

export interface TestrailResolveUrlInput {
  url?: string;
}

export function buildTestrailResolveUrlBody(
  input: TestrailResolveUrlInput,
): Record<string, unknown> {
  const url = optionalString(input.url);
  if (!url) {
    throw new BodyValidationError("resolve-url requires a non-empty url");
  }
  return { url };
}
