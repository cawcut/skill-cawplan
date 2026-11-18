/**
 * Validation for `cawplan tickets update` flags.
 *
 * The update endpoint is a sparse PUT: any text field present in the body
 * overwrites the stored value, and an empty string wipes it. Agents and skills
 * often substitute shell variables straight into flags, so an unset variable
 * (`--progress_comment "$progress_comment"`) must never clear live data. An
 * explicitly passed empty or whitespace-only value is therefore rejected, and
 * clearing a field requires its dedicated `--clear-<field>` flag.
 */

export class TicketUpdateInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketUpdateInputError";
  }
}

/** Text fields that overwrite stored content; the ones with a clear flag can be emptied on purpose. */
export const TICKET_UPDATE_TEXT_FIELDS = [
  { field: "progress_comment", flag: "--progress_comment", optKey: "progress_comment", clearFlag: "--clear-progress-comment", clearKey: "clearProgressComment" },
  { field: "remarks", flag: "--remarks", optKey: "remarks", clearFlag: "--clear-remarks", clearKey: "clearRemarks" },
  { field: "root_cause", flag: "--root_cause", optKey: "root_cause", clearFlag: "--clear-root-cause", clearKey: "clearRootCause" },
  { field: "solution", flag: "--solution", optKey: "solution", clearFlag: "--clear-solution", clearKey: "clearSolution" },
  // The title cannot be cleared, and a comment is appended rather than stored in place.
  { field: "description", flag: "--description", optKey: "description" },
  { field: "comment", flag: "--comment", optKey: "comment" },
] as const;

/** Scalar / id flags whose empty value would otherwise be silently dropped. */
export const TICKET_UPDATE_SCALAR_FLAGS = [
  { flag: "--status", optKey: "status" },
  { flag: "--priority", optKey: "priority" },
  { flag: "--target_version_id", optKey: "target_version_id" },
  { flag: "--target-ver", optKey: "targetVer" },
  { flag: "--parent_id", optKey: "parent_id" },
  { flag: "--due_date", optKey: "due_date" },
  { flag: "--assignees", optKey: "assignees" },
  { flag: "--label_ids", optKey: "label_ids" },
  { flag: "--module", optKey: "module" },
  { flag: "--expected_version", optKey: "expected_version" },
] as const;

function isBlank(value: string): boolean {
  return value.trim() === "";
}

/**
 * Validate the raw commander options of `tickets update` and return the text
 * fields to send. Throws {@link TicketUpdateInputError} before any request is
 * made when a flag carries an empty value or a value conflicts with its clear flag.
 */
export function buildTicketUpdateTextFields(opts: Record<string, unknown>): Record<string, string> {
  for (const { flag, optKey } of TICKET_UPDATE_SCALAR_FLAGS) {
    const value = opts[optKey];
    if (typeof value === "string" && isBlank(value)) {
      throw new TicketUpdateInputError(`${flag} was given an empty value; omit the flag to leave the field unchanged`);
    }
  }
  for (const { flag, optKey } of [
    { flag: "--assignees", optKey: "assignees" },
    { flag: "--label_ids", optKey: "label_ids" },
  ]) {
    const value = opts[optKey];
    if (typeof value === "string" && value.split(",").every((item) => isBlank(item))) {
      throw new TicketUpdateInputError(`${flag} has no ids; omit the flag to leave the field unchanged`);
    }
  }
  const expectedVersion = opts.expected_version;
  if (typeof expectedVersion === "string" && !/^\d+$/.test(expectedVersion.trim())) {
    throw new TicketUpdateInputError(`--expected_version must be a non-negative integer, got "${expectedVersion}"`);
  }

  const body: Record<string, string> = {};
  for (const spec of TICKET_UPDATE_TEXT_FIELDS) {
    const value = opts[spec.optKey];
    const clear = "clearKey" in spec && opts[spec.clearKey] === true;
    if (clear && value !== undefined) {
      throw new TicketUpdateInputError(`${spec.flag} and ${spec.clearFlag} cannot be used together`);
    }
    if (clear) {
      body[spec.field] = "";
      continue;
    }
    if (value === undefined) continue;
    if (typeof value !== "string" || isBlank(value)) {
      const hint = "clearFlag" in spec
        ? `; use ${spec.clearFlag} to clear it on purpose`
        : "; omit the flag to leave it unchanged";
      throw new TicketUpdateInputError(`${spec.flag} was given an empty value, which would erase the ticket's ${spec.field}${hint}`);
    }
    body[spec.field] = value;
  }
  return body;
}
