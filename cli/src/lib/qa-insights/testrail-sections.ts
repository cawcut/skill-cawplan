import { BodyValidationError } from "./body-builders.js";
import { normalizeField } from "./normalize.js";

export interface TestrailSuiteSectionsQueryInput {
  refresh?: boolean;
}

/** `GET /qa/testrail/suites/{suite_id}/sections` — §3.0 of the QA Testing contract. */
export function buildTestrailSuiteSectionsQuery(
  input: TestrailSuiteSectionsQueryInput,
): Record<string, string> {
  const query: Record<string, string> = {};
  if (input.refresh) query.refresh = "true";
  return query;
}

function optionalString(value: unknown): string | undefined {
  const normalized = normalizeField(value);
  return normalized || undefined;
}

export interface TestrailSuiteCreateInput {
  name?: string;
  description?: string;
}

/** `POST /qa/testrail/suites` — §1.3 of the QA Testing contract. */
export function buildTestrailSuiteCreateBody(
  input: TestrailSuiteCreateInput,
): Record<string, unknown> {
  const name = optionalString(input.name);
  if (!name) {
    throw new BodyValidationError("suite-create requires a non-empty --name");
  }
  const body: Record<string, unknown> = { name };
  const description = optionalString(input.description);
  if (description !== undefined) body.description = description;
  return body;
}
