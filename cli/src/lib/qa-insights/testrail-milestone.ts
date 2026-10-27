import { BodyValidationError } from "./body-builders.js";
import { normalizeField } from "./normalize.js";

export interface TestrailMilestoneValidateQueryInput {
  versionId?: string;
}

function requiredString(value: unknown, label: string): string {
  const normalized = normalizeField(value);
  if (!normalized) {
    throw new BodyValidationError(`${label} is required`);
  }
  return normalized;
}

export function buildTestrailMilestoneValidateQuery(
  input: TestrailMilestoneValidateQueryInput,
): Record<string, string> {
  return { version_id: requiredString(input.versionId, "version_id") };
}
