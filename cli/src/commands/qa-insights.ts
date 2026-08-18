import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { cawplanRequest } from "../lib/http.js";
import { parseApiEnvelope, batchReturnedCount } from "../lib/qa-insights/api-codes.js";
import {
  BodyValidationError,
  buildModuleTreeNodeBody,
  applyAiGeneratedToRequirementPatch,
  buildRequirementCreateBody,
  buildTestPointBatchBody,
  buildTestrailImportExecuteBody,
  buildTestrailImportPreviewBody,
  buildTestrailDefectCreateTicketBody,
  buildTestrailDefectDraftBody,
  buildTestrailDefectLinkTicketBody,
  buildTestrailPlanExecuteBody,
  buildTestrailPlanPreviewBody,
  buildTestrailPlanRulesBody,
  mergeTestrailImportPreviewBody,
  mergeTestrailDefectDraftBody,
  mergeTestrailPlanPreviewBody,
  requiredPositiveInteger,
  validateRequirementPatchBody,
} from "../lib/qa-insights/body-builders.js";
import { buildEnvelope, buildReadEnvelope, emitEnvelopeAndExit, emitReadEnvelopeAndExit } from "../lib/qa-insights/envelope.js";
import { mapCawplanRequestError, mapEnvelopeFailure } from "../lib/qa-insights/errors.js";
import { computePatchBody, isEmptyDiff } from "../lib/qa-insights/snapshot-diff.js";
import { reconcileRequirement } from "../lib/qa-insights/reconcile-requirement.js";
import {
  CountReconcileValidationError,
  reconcileTestPoints,
} from "../lib/qa-insights/reconcile-testpoints.js";
import {
  buildTestrailExecutionFailuresQuery,
  buildTestrailExecutionSummaryQuery,
  buildTestrailResolveUrlBody,
} from "../lib/qa-insights/testrail-execution.js";
import type {
  ImportSourceType,
  QAInsightsMeta,
  QAInsightsReadEnvelope,
  QAInsightsWriteEnvelope,
  RequirementRow,
  SectionStrategy,
  TestrailDefectDraftInput,
  TestrailPlanPreviewInput,
} from "../lib/qa-insights/types.js";

/**
 * `cawplan qa-insights` — QA Insights Test Suites reads, writes, and reconcile.
 *
 * Distinct from `cawplan qa-reports` (version-level /qa_report CRUD).
 *
 * Design notes carried over from the plan:
 * - `requirements create` issues a plain POST with NO pre-flight GET. A1 step 11
 *   routes a first-time archive straight to 11a, and de-duplication is the
 *   skill's Table B decision plus `requirements reconcile` — not a CLI guard.
 * - `testpoints archive` judges success purely from the POST envelope; it does
 *   not GET afterwards (A2 §8.5).
 * - No reconcile path ever re-POSTs. UNKNOWN means the outcome is genuinely
 *   unknown, and a blind retry is how duplicates get created.
 */

const API_BASE = "/api/v1/public/openapi/product";
const INTERNAL_PRODUCT_API_BASE = "/api/v1/product";

/** Injectable for tests; defaults to the real HTTP client. */
export type RequestFn = typeof cawplanRequest;

export interface CommandDeps {
  request?: RequestFn;
  /** Returns instead of exiting, so tests can assert on the envelope. */
  emit?: (envelope: QAInsightsWriteEnvelope) => never | void;
}

export interface ReadCommandDeps {
  request?: RequestFn;
  emit?: (envelope: QAInsightsReadEnvelope) => never | void;
}

function emitter(deps?: CommandDeps) {
  return deps?.emit ?? emitEnvelopeAndExit;
}

function readEmitter(deps?: ReadCommandDeps) {
  return deps?.emit ?? emitReadEnvelopeAndExit;
}

function requester(deps?: { request?: RequestFn }): RequestFn {
  return deps?.request ?? cawplanRequest;
}

/**
 * Read JSON from either a file or an inline string — exactly one of the two.
 *
 * Callers pass the flag names so the error text names the flags the user
 * actually typed (`--body-file`/`--body`, `--desired-file`/`--desired`, …).
 * File-only inputs pass the same name twice; the error text then names it once.
 */
async function readJsonInput(
  bodyFile: string | undefined,
  inlineBody: string | undefined,
  label: string,
  fileFlag = "--body-file",
  inlineFlag = "--body",
): Promise<unknown> {
  const flags = fileFlag === inlineFlag ? fileFlag : `${fileFlag} or ${inlineFlag}`;
  if (bodyFile && inlineBody) {
    throw new BodyValidationError(`${label}: pass either ${fileFlag} or ${inlineFlag}, not both`);
  }
  const raw = bodyFile ? await readFile(bodyFile, "utf8") : inlineBody;
  if (!raw) {
    throw new BodyValidationError(`${label}: ${flags} is required`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new BodyValidationError(
      `${label}: input is not valid JSON — ${(err as Error).message}`,
    );
  }
}

async function readOptionalJsonInput(
  bodyFile: string | undefined,
  inlineBody: string | undefined,
  label: string,
): Promise<unknown | undefined> {
  if (!bodyFile && !inlineBody) return undefined;
  return readJsonInput(bodyFile, inlineBody, label);
}

/** Validation failures never reach the network. */
function validationEnvelope(
  command: string,
  meta: QAInsightsMeta,
  err: unknown,
): QAInsightsWriteEnvelope {
  return buildEnvelope({
    outcome: "FAILURE",
    command,
    meta,
    error: { type: "validation", message: err instanceof Error ? err.message : String(err) },
  });
}

interface WriteCallResult {
  envelope: QAInsightsWriteEnvelope;
}

/**
 * Issue one write and map the response through both layers: transport/HTTP
 * (thrown ApiError) and the business envelope (HTTP 200 + FAILURE_*).
 */
async function performWrite(options: {
  request: RequestFn;
  method: "POST" | "PATCH";
  path: string;
  body: Record<string, unknown>;
  command: string;
  meta: QAInsightsMeta;
  bodyKey: "post_body" | "patch_body";
  /** Extra success check, e.g. batch length. Returns an error message or null. */
  verifySuccess?: (data: unknown) => string | null;
}): Promise<WriteCallResult> {
  const { request, method, path, body, command, meta, bodyKey } = options;
  const bodySection = { [bodyKey]: body } as Record<string, Record<string, unknown>>;

  let payload: unknown;
  try {
    payload = await request({ method, path, body });
  } catch (err) {
    const mapped = mapCawplanRequestError(err, { isWrite: true });
    return {
      envelope: buildEnvelope({
        outcome: mapped.outcome,
        command,
        meta,
        error: mapped.error,
        ...bodySection,
      }),
    };
  }

  const envelope = parseApiEnvelope(payload);
  const failure = mapEnvelopeFailure(payload);
  if (failure) {
    return {
      envelope: buildEnvelope({
        outcome: failure.outcome,
        command,
        meta,
        api: { code: envelope.code, msg: envelope.msg, data: envelope.data },
        error: failure.error,
        ...bodySection,
      }),
    };
  }

  const verifyError = options.verifySuccess?.(envelope.data) ?? null;
  if (verifyError) {
    return {
      envelope: buildEnvelope({
        outcome: "FAILURE",
        command,
        meta,
        api: { code: envelope.code, msg: envelope.msg, data: envelope.data },
        error: { type: "api", message: verifyError, api_code: envelope.code },
        ...bodySection,
      }),
    };
  }

  return {
    envelope: buildEnvelope({
      outcome: "SUCCESS",
      command,
      meta,
      api: { code: envelope.code, msg: envelope.msg, data: envelope.data },
      ...bodySection,
    }),
  };
}

/** Read helper for reconcile commands (read-only, never mutates). */
async function performRead(options: {
  request: RequestFn;
  path: string;
  query?: Record<string, string>;
  command: string;
  meta: QAInsightsMeta;
}): Promise<{ data?: unknown; envelope?: QAInsightsWriteEnvelope }> {
  const { request, path, query, command, meta } = options;
  let payload: unknown;
  try {
    payload = await request({ method: "GET", path, query });
  } catch (err) {
    const mapped = mapCawplanRequestError(err, { isWrite: false });
    return {
      envelope: buildEnvelope({ outcome: mapped.outcome, command, meta, error: mapped.error }),
    };
  }

  const failure = mapEnvelopeFailure(payload);
  if (failure) {
    const parsed = parseApiEnvelope(payload);
    return {
      envelope: buildEnvelope({
        outcome: failure.outcome,
        command,
        meta,
        api: { code: parsed.code, msg: parsed.msg, data: parsed.data },
        error: failure.error,
      }),
    };
  }

  return { data: parseApiEnvelope(payload).data };
}

/** Map a performRead failure envelope into the read-command stdout shape. */
function readFailureFromWriteEnvelope(
  command: string,
  meta: QAInsightsMeta,
  writeEnvelope: QAInsightsWriteEnvelope,
): QAInsightsReadEnvelope {
  const outcome = writeEnvelope.outcome === "UNKNOWN" ? "UNKNOWN" : "FAILURE";
  return buildReadEnvelope({
    outcome,
    command,
    meta,
    error: writeEnvelope.error,
  });
}

// ---------------------------------------------------------------------------
// requirements get — single-item read (HTTP 404 on missing)
// ---------------------------------------------------------------------------

export async function runRequirementsGet(
  productId: string,
  requirementId: string,
  deps?: ReadCommandDeps,
) {
  const command = "requirements get";
  const meta: QAInsightsMeta = {
    product_id: productId,
    requirement_id: requirementId,
    dry_run: false,
  };
  const emit = readEmitter(deps);

  const read = await performRead({
    request: requester(deps),
    path: `${API_BASE}/${productId}/qa/requirements/${requirementId}`,
    command,
    meta,
  });
  if (read.envelope) {
    return emit(readFailureFromWriteEnvelope(command, meta, read.envelope));
  }
  return emit(buildReadEnvelope({ outcome: "SUCCESS", command, meta, data: read.data }));
}

// ---------------------------------------------------------------------------
// module-tree get — full module tree for a product
// ---------------------------------------------------------------------------

export async function runModuleTreeGet(productId: string, deps?: ReadCommandDeps) {
  const command = "module-tree get";
  const meta: QAInsightsMeta = { product_id: productId, dry_run: false };
  const emit = readEmitter(deps);

  const read = await performRead({
    request: requester(deps),
    path: `${API_BASE}/${productId}/qa/module-tree`,
    command,
    meta,
  });
  if (read.envelope) {
    return emit(readFailureFromWriteEnvelope(command, meta, read.envelope));
  }
  return emit(buildReadEnvelope({ outcome: "SUCCESS", command, meta, data: read.data }));
}

// ---------------------------------------------------------------------------
// requirements list — requirements under a module-tree node
// ---------------------------------------------------------------------------

export async function runRequirementsList(
  productId: string,
  opts: { moduleTreeNodeId?: string },
  deps?: ReadCommandDeps,
) {
  const command = "requirements list";
  const meta: QAInsightsMeta = {
    product_id: productId,
    module_tree_node_id: opts.moduleTreeNodeId,
    dry_run: false,
  };
  const emit = readEmitter(deps);

  if (!opts.moduleTreeNodeId) {
    return emit(
      buildReadEnvelope({
        outcome: "FAILURE",
        command,
        meta,
        error: {
          type: "validation",
          message: `${command}: --module-tree-node-id is required`,
        },
      }),
    );
  }

  const read = await performRead({
    request: requester(deps),
    path: `${API_BASE}/${productId}/qa/requirements`,
    query: { module_tree_node_id: opts.moduleTreeNodeId },
    command,
    meta,
  });
  if (read.envelope) {
    return emit(readFailureFromWriteEnvelope(command, meta, read.envelope));
  }
  return emit(buildReadEnvelope({ outcome: "SUCCESS", command, meta, data: read.data }));
}

// ---------------------------------------------------------------------------
// testpoints list — all test points for a requirement
// ---------------------------------------------------------------------------

export async function runTestPointsList(
  productId: string,
  requirementId: string,
  deps?: ReadCommandDeps,
) {
  const command = "testpoints list";
  const meta: QAInsightsMeta = {
    product_id: productId,
    requirement_id: requirementId,
    dry_run: false,
  };
  const emit = readEmitter(deps);

  const read = await performRead({
    request: requester(deps),
    path: `${API_BASE}/${productId}/qa/requirements/${requirementId}/testpoints`,
    command,
    meta,
  });
  if (read.envelope) {
    return emit(readFailureFromWriteEnvelope(command, meta, read.envelope));
  }
  return emit(buildReadEnvelope({ outcome: "SUCCESS", command, meta, data: read.data }));
}

// ---------------------------------------------------------------------------
// module-tree node create
// ---------------------------------------------------------------------------

export async function runModuleTreeNodeCreate(
  productId: string,
  opts: { parentId?: string; name?: string; dryRun?: boolean },
  deps?: CommandDeps,
) {
  const command = "module-tree node create";
  const meta: QAInsightsMeta = { product_id: productId, dry_run: opts.dryRun === true };
  const emit = emitter(deps);

  let body: { parent_id: string | null; name: string };
  try {
    body = buildModuleTreeNodeBody({ parentId: opts.parentId, name: opts.name });
  } catch (err) {
    return emit(validationEnvelope(command, meta, err));
  }

  if (opts.dryRun) {
    return emit(
      buildEnvelope({ outcome: "SUCCESS", command, meta, post_body: body as unknown as Record<string, unknown> }),
    );
  }

  const { envelope } = await performWrite({
    request: requester(deps),
    method: "POST",
    path: `${API_BASE}/${productId}/qa/module-tree`,
    body: body as unknown as Record<string, unknown>,
    command,
    meta,
    bodyKey: "post_body",
  });
  return emit(envelope);
}

// ---------------------------------------------------------------------------
// requirements create — plain POST, no pre-flight GET
// ---------------------------------------------------------------------------

export async function runRequirementsCreate(
  productId: string,
  opts: { bodyFile?: string; body?: string; dryRun?: boolean },
  deps?: CommandDeps,
) {
  const command = "requirements create";
  const meta: QAInsightsMeta = { product_id: productId, dry_run: opts.dryRun === true };
  const emit = emitter(deps);

  let body: Record<string, unknown>;
  try {
    const input = await readJsonInput(opts.bodyFile, opts.body, command);
    body = buildRequirementCreateBody(input);
  } catch (err) {
    return emit(validationEnvelope(command, meta, err));
  }

  meta.module_tree_node_id = String(body.module_tree_node_id);

  if (opts.dryRun) {
    return emit(buildEnvelope({ outcome: "SUCCESS", command, meta, post_body: body }));
  }

  const { envelope } = await performWrite({
    request: requester(deps),
    method: "POST",
    path: `${API_BASE}/${productId}/qa/requirements`,
    body,
    command,
    meta,
    bodyKey: "post_body",
  });
  return emit(envelope);
}

// ---------------------------------------------------------------------------
// requirements update — PATCH changed keys only
// ---------------------------------------------------------------------------

export async function runRequirementsUpdate(
  productId: string,
  requirementId: string,
  opts: {
    desiredFile?: string;
    desired?: string;
    snapshotFile?: string;
    snapshot?: string;
    dryRun?: boolean;
  },
  deps?: CommandDeps,
) {
  const command = "requirements update";
  const meta: QAInsightsMeta = {
    product_id: productId,
    requirement_id: requirementId,
    dry_run: opts.dryRun === true,
  };
  const emit = emitter(deps);

  let patchBody: Record<string, unknown>;
  try {
    // Each pair accepts a file OR an inline string — readJsonInput enforces
    // "exactly one"; these checks only cover "neither was supplied".
    if (!opts.desiredFile && !opts.desired) {
      throw new BodyValidationError(`${command}: --desired-file or --desired is required`);
    }
    if (!opts.snapshotFile && !opts.snapshot) {
      throw new BodyValidationError(`${command}: --snapshot-file or --snapshot is required`);
    }
    const desired = await readJsonInput(
      opts.desiredFile, opts.desired, `${command} desired`, "--desired-file", "--desired",
    );
    const snapshot = await readJsonInput(
      opts.snapshotFile, opts.snapshot, `${command} snapshot`, "--snapshot-file", "--snapshot",
    );
    patchBody = applyAiGeneratedToRequirementPatch(
      computePatchBody(
        desired as Record<string, unknown>,
        snapshot as Record<string, unknown>,
      ),
    );
    if (!isEmptyDiff(patchBody)) validateRequirementPatchBody(patchBody);
  } catch (err) {
    return emit(validationEnvelope(command, meta, err));
  }

  // Empty diff must not become a PATCH: sending nothing is meaningless, and
  // sending everything would clobber concurrent edits.
  if (isEmptyDiff(patchBody)) {
    return emit(buildEnvelope({ outcome: "NOOP", command, meta, patch_body: patchBody }));
  }

  if (opts.dryRun) {
    return emit(buildEnvelope({ outcome: "SUCCESS", command, meta, patch_body: patchBody }));
  }

  const { envelope } = await performWrite({
    request: requester(deps),
    method: "PATCH",
    path: `${API_BASE}/${productId}/qa/requirements/${requirementId}`,
    body: patchBody,
    command,
    meta,
    bodyKey: "patch_body",
  });
  return emit(envelope);
}

// ---------------------------------------------------------------------------
// requirements reconcile — read-only Table A
// ---------------------------------------------------------------------------

export async function runRequirementsReconcile(
  productId: string,
  opts: {
    moduleTreeNodeId?: string;
    probeFile?: string;
    targetRequirementId?: string;
    intendedPatchFile?: string;
    operation?: string;
  },
  deps?: CommandDeps,
) {
  const command = "requirements reconcile";
  const meta: QAInsightsMeta = {
    product_id: productId,
    module_tree_node_id: opts.moduleTreeNodeId,
    requirement_id: opts.targetRequirementId,
    dry_run: false,
  };
  const emit = emitter(deps);

  let probe: unknown;
  let intendedPatch: Record<string, unknown> | undefined;
  try {
    if (!opts.moduleTreeNodeId) {
      throw new BodyValidationError(`${command}: --module-tree-node-id is required`);
    }
    // Both inputs are file-only (no inline counterpart), so they pass the same
    // flag name for both slots — the error text names the one flag that exists.
    probe = await readJsonInput(
      opts.probeFile,
      undefined,
      command,
      "--probe-file",
      "--probe-file",
    );
    if (opts.intendedPatchFile) {
      intendedPatch = (await readJsonInput(
        opts.intendedPatchFile,
        undefined,
        command,
        "--intended-patch-file",
        "--intended-patch-file",
      )) as Record<string, unknown>;
    }
  } catch (err) {
    return emit(validationEnvelope(command, meta, err));
  }

  const read = await performRead({
    request: requester(deps),
    path: `${API_BASE}/${productId}/qa/requirements`,
    query: { module_tree_node_id: opts.moduleTreeNodeId! },
    command,
    meta,
  });
  if (read.envelope) return emit(read.envelope);

  const rows = (Array.isArray(read.data) ? read.data : []) as RequirementRow[];
  const result = reconcileRequirement({
    probe,
    rows,
    targetRequirementId: opts.targetRequirementId,
    intendedPatch,
    operation: opts.operation === "PATCH" ? "PATCH" : "POST",
  });

  return emit(
    buildEnvelope({
      outcome: result.outcome,
      command,
      meta,
      reconcile: result.reconcile,
      error:
        result.outcome === "FAILURE"
          ? { type: "api", message: result.message }
          : undefined,
    }),
  );
}

// ---------------------------------------------------------------------------
// testpoints archive — POST batch, success judged from the envelope alone
// ---------------------------------------------------------------------------

export async function runTestPointsArchive(
  productId: string,
  requirementId: string,
  opts: { bodyFile?: string; body?: string; dryRun?: boolean },
  deps?: CommandDeps,
) {
  const command = "testpoints archive";
  const meta: QAInsightsMeta = {
    product_id: productId,
    requirement_id: requirementId,
    dry_run: opts.dryRun === true,
  };
  const emit = emitter(deps);

  let body: { test_points: unknown[] };
  try {
    const input = await readJsonInput(opts.bodyFile, opts.body, command);
    body = buildTestPointBatchBody(input);
  } catch (err) {
    return emit(validationEnvelope(command, meta, err));
  }

  if (opts.dryRun) {
    return emit(
      buildEnvelope({ outcome: "SUCCESS", command, meta, post_body: body as unknown as Record<string, unknown> }),
    );
  }

  const expected = body.test_points.length;
  const { envelope } = await performWrite({
    request: requester(deps),
    method: "POST",
    path: `${API_BASE}/${productId}/qa/requirements/${requirementId}/testpoints/batch`,
    body: body as unknown as Record<string, unknown>,
    command,
    meta,
    bodyKey: "post_body",
    // The batch is all-or-nothing, so a SUCCESS envelope whose array is short
    // is a contract violation, not a partial success.
    verifySuccess: (data) => {
      const returned = batchReturnedCount(data);
      if (returned === null) {
        return `API reported SUCCESS but returned no test_points array — cannot confirm ${expected} test points were archived`;
      }
      if (returned !== expected) {
        return `API reported SUCCESS but returned ${returned} test points for a batch of ${expected} — batch is all-or-nothing; verify the requirement manually`;
      }
      return null;
    },
  });
  return emit(envelope);
}

// ---------------------------------------------------------------------------
// testpoints reconcile — one GET, count comparison, never re-POSTs
// ---------------------------------------------------------------------------

export async function runTestPointsReconcile(
  productId: string,
  requirementId: string,
  opts: { countBefore?: string; batchSize?: string },
  deps?: CommandDeps,
) {
  const command = "testpoints reconcile";
  const meta: QAInsightsMeta = {
    product_id: productId,
    requirement_id: requirementId,
    dry_run: false,
  };
  const emit = emitter(deps);

  const countBefore = Number(opts.countBefore);
  const batchSize = Number(opts.batchSize);
  if (opts.countBefore === undefined || !Number.isInteger(countBefore) || countBefore < 0) {
    return emit(
      validationEnvelope(
        command,
        meta,
        new CountReconcileValidationError(
          "--count-before is required and must be a non-negative integer — " +
            "pass the baseline captured by the refresh GET taken BEFORE the batch " +
            "(the command will not guess it: a concurrent append between two GETs would corrupt the comparison)",
        ),
      ),
    );
  }
  if (opts.batchSize === undefined || !Number.isInteger(batchSize) || batchSize <= 0) {
    return emit(
      validationEnvelope(
        command,
        meta,
        new CountReconcileValidationError("--batch-size is required and must be a positive integer"),
      ),
    );
  }

  const read = await performRead({
    request: requester(deps),
    path: `${API_BASE}/${productId}/qa/requirements/${requirementId}/testpoints`,
    command,
    meta,
  });
  if (read.envelope) return emit(read.envelope);

  const data = read.data as { test_points?: unknown[] } | undefined;
  const points = data?.test_points;
  if (!Array.isArray(points)) {
    return emit(
      buildEnvelope({
        outcome: "FAILURE",
        command,
        meta,
        error: { type: "api", message: "GET testpoints returned no test_points array — cannot compare counts" },
      }),
    );
  }

  let result;
  try {
    result = reconcileTestPoints({ countBefore, countAfter: points.length, batchSize });
  } catch (err) {
    return emit(validationEnvelope(command, meta, err));
  }

  return emit(
    buildEnvelope({
      outcome: result.outcome,
      command,
      meta,
      reconcile: result.reconcile,
      error:
        result.outcome === "FAILURE"
          ? { type: "api", message: result.message }
          : undefined,
    }),
  );
}

// ---------------------------------------------------------------------------
// TestRail integration (T2) — A1 import
// ---------------------------------------------------------------------------

function testrailApiPath(productId: string, suffix: string): string {
  return `${INTERNAL_PRODUCT_API_BASE}/${productId}/qa/testrail${suffix}`;
}

function versionTestrailApiPath(productId: string, versionId: string, suffix: string): string {
  return `${INTERNAL_PRODUCT_API_BASE}/${productId}/versions/${versionId}/qa/testrail${suffix}`;
}

async function performTestrailPost(options: {
  request: RequestFn;
  method?: "POST" | "PUT";
  path: string;
  body: Record<string, unknown>;
  command: string;
  meta: QAInsightsMeta;
  isWrite: boolean;
}): Promise<QAInsightsWriteEnvelope> {
  const { request, method = "POST", path, body, command, meta, isWrite } = options;
  let payload: unknown;
  try {
    payload = await request({ method, path, body });
  } catch (err) {
    const mapped = mapCawplanRequestError(err, { isWrite });
    return buildEnvelope({
      outcome: mapped.outcome,
      command,
      meta,
      post_body: body,
      error: mapped.error,
    });
  }

  const parsed = parseApiEnvelope(payload);
  const failure = mapEnvelopeFailure(payload);
  if (failure) {
    return buildEnvelope({
      outcome: failure.outcome,
      command,
      meta,
      api: { code: parsed.code, msg: parsed.msg, data: parsed.data },
      post_body: body,
      error: failure.error,
    });
  }

  return buildEnvelope({
    outcome: "SUCCESS",
    command,
    meta,
    api: { code: parsed.code, msg: parsed.msg, data: parsed.data },
    post_body: body,
  });
}

export async function runTestrailMappingsGet(
  productId: string,
  deps?: CommandDeps,
): Promise<void> {
  const command = "qa-insights testrail mappings get";
  const meta: QAInsightsMeta = { product_id: productId, dry_run: false };
  const emit = emitter(deps);

  const read = await performRead({
    request: requester(deps),
    path: testrailApiPath(productId, "/mappings"),
    command,
    meta,
  });
  if (read.envelope) return emit(read.envelope);

  return emit(
    buildEnvelope({
      outcome: "SUCCESS",
      command,
      meta,
      api: { code: "SUCCESS", msg: "success", data: read.data },
    }),
  );
}

export async function runTestrailPlanRulesGet(
  productId: string,
  deps?: CommandDeps,
): Promise<void> {
  const command = "qa-insights testrail plan-rules get";
  const meta: QAInsightsMeta = { product_id: productId, dry_run: false };
  const emit = emitter(deps);

  const read = await performRead({
    request: requester(deps),
    path: testrailApiPath(productId, "/plan-rules"),
    command,
    meta,
  });
  if (read.envelope) return emit(read.envelope);

  return emit(
    buildEnvelope({
      outcome: "SUCCESS",
      command,
      meta,
      api: { code: "SUCCESS", msg: "success", data: read.data },
    }),
  );
}

export interface TestrailPlanRulesSetOptions {
  bodyFile?: string;
  body?: string;
  dryRun?: boolean;
}

export async function runTestrailPlanRulesSet(
  productId: string,
  opts: TestrailPlanRulesSetOptions,
  deps?: CommandDeps,
): Promise<void> {
  const command = "qa-insights testrail plan-rules set";
  const meta: QAInsightsMeta = { product_id: productId, dry_run: Boolean(opts.dryRun) };
  const emit = emitter(deps);

  let body: Record<string, unknown>;
  try {
    body = buildTestrailPlanRulesBody(
      await readJsonInput(opts.bodyFile, opts.body, "testrail plan-rules set"),
    );
  } catch (err) {
    return emit(validationEnvelope(command, meta, err));
  }

  if (opts.dryRun) {
    return emit(buildEnvelope({ outcome: "SUCCESS", command, meta, post_body: body }));
  }

  const envelope = await performTestrailPost({
    request: requester(deps),
    method: "PUT",
    path: testrailApiPath(productId, "/plan-rules"),
    body,
    command,
    meta,
    isWrite: true,
  });
  return emit(envelope);
}

export interface TestrailImportPreviewOptions {
  bodyFile?: string;
  body?: string;
  sourceType?: ImportSourceType;
  requirementId?: string;
  versionId?: string;
  suiteId?: number;
  versionName?: string;
  sectionStrategy?: SectionStrategy;
  fixedSectionId?: number;
  dryRun?: boolean;
}

export async function runTestrailImportPreview(
  productId: string,
  opts: TestrailImportPreviewOptions,
  deps?: CommandDeps,
): Promise<void> {
  const command = "qa-insights testrail import preview";
  const meta: QAInsightsMeta = { product_id: productId, dry_run: Boolean(opts.dryRun) };
  const emit = emitter(deps);

  let body: Record<string, unknown>;
  try {
    const parsed = await readOptionalJsonInput(opts.bodyFile, opts.body, "testrail import preview");
    if (parsed !== undefined) {
      body = mergeTestrailImportPreviewBody(parsed, {
        sourceType: opts.sourceType as ImportSourceType,
        requirementId: opts.requirementId,
        versionId: opts.versionId,
        suiteId: opts.suiteId,
        versionName: opts.versionName,
        sectionStrategy: opts.sectionStrategy,
        fixedSectionId: opts.fixedSectionId,
      });
    } else {
      if (!opts.sourceType) {
        return emit(
          validationEnvelope(
            command,
            meta,
            new BodyValidationError("--source-type or --body-file is required"),
          ),
        );
      }
      body = buildTestrailImportPreviewBody({
        sourceType: opts.sourceType,
        requirementId: opts.requirementId,
        versionId: opts.versionId,
        suiteId: opts.suiteId,
        versionName: opts.versionName,
        sectionStrategy: opts.sectionStrategy,
        fixedSectionId: opts.fixedSectionId,
      });
    }
  } catch (err) {
    return emit(validationEnvelope(command, meta, err));
  }

  if (opts.dryRun) {
    return emit(buildEnvelope({ outcome: "SUCCESS", command, meta, post_body: body }));
  }

  const envelope = await performTestrailPost({
    request: requester(deps),
    path: testrailApiPath(productId, "/import/preview"),
    body,
    command,
    meta,
    isWrite: false,
  });
  const previewData = envelope.api?.data as { preview_id?: string; previewId?: string } | undefined;
  const previewId = previewData?.preview_id ?? previewData?.previewId;
  if (previewId) meta.preview_id = previewId;
  return emit(envelope);
}

export interface TestrailImportExecuteOptions {
  previewId: string;
  confirm?: boolean;
  dryRun?: boolean;
}

export async function runTestrailImportExecute(
  productId: string,
  opts: TestrailImportExecuteOptions,
  deps?: CommandDeps,
): Promise<void> {
  const command = "qa-insights testrail import execute";
  const meta: QAInsightsMeta = {
    product_id: productId,
    preview_id: opts.previewId,
    dry_run: Boolean(opts.dryRun),
  };
  const emit = emitter(deps);

  let body: Record<string, unknown>;
  try {
    body = buildTestrailImportExecuteBody(opts.previewId, Boolean(opts.confirm));
  } catch (err) {
    return emit(validationEnvelope(command, meta, err));
  }

  if (opts.dryRun) {
    return emit(buildEnvelope({ outcome: "SUCCESS", command, meta, post_body: body }));
  }

  if (!opts.confirm) {
    return emit(
      buildEnvelope({
        outcome: "FAILURE",
        command,
        meta,
        post_body: body,
        error: {
          type: "validation",
          message: "testrail import execute requires --confirm (safety gate; preview must be reviewed first)",
          api_code: "CONFIRMATION_REQUIRED",
        },
      }),
    );
  }

  const envelope = await performTestrailPost({
    request: requester(deps),
    path: testrailApiPath(productId, "/import/execute"),
    body,
    command,
    meta,
    isWrite: true,
  });

  const data = envelope.api?.data as { job_id?: string; jobId?: string; status?: string } | undefined;
  const jobId = data?.job_id ?? data?.jobId;
  if (jobId) meta.job_id = jobId;
  return emit(envelope);
}

export interface TestrailPlanPreviewOptions extends TestrailPlanPreviewInput {
  bodyFile?: string;
  body?: string;
  dryRun?: boolean;
}

function planPreviewMeta(
  productId: string,
  dryRun: boolean,
  body?: Record<string, unknown>,
): QAInsightsMeta {
  return {
    product_id: productId,
    dry_run: dryRun,
    version_id: typeof body?.version_id === "string" ? body.version_id : undefined,
    ticket_id: typeof body?.ticket_id === "string" ? body.ticket_id : undefined,
    ticket_ids: Array.isArray(body?.ticket_ids) ? (body.ticket_ids as string[]) : undefined,
    milestone_strategy:
      typeof body?.milestone_strategy === "string"
        ? (body.milestone_strategy as QAInsightsMeta["milestone_strategy"])
        : undefined,
    milestone_id: typeof body?.milestone_id === "number" ? body.milestone_id : undefined,
    ticket_reuse_strategy:
      typeof body?.ticket_reuse_strategy === "string"
        ? (body.ticket_reuse_strategy as QAInsightsMeta["ticket_reuse_strategy"])
        : undefined,
  };
}

export async function runTestrailPlanPreview(
  productId: string,
  opts: TestrailPlanPreviewOptions,
  deps?: CommandDeps,
): Promise<void> {
  const command = "qa-insights testrail plan preview";
  const emit = emitter(deps);
  let meta: QAInsightsMeta = planPreviewMeta(productId, Boolean(opts.dryRun));

  let body: Record<string, unknown>;
  try {
    const parsed = await readOptionalJsonInput(opts.bodyFile, opts.body, "testrail plan preview");
    body =
      parsed === undefined
        ? buildTestrailPlanPreviewBody(opts)
        : mergeTestrailPlanPreviewBody(parsed, opts);
    meta = planPreviewMeta(productId, Boolean(opts.dryRun), body);
  } catch (err) {
    return emit(validationEnvelope(command, meta, err));
  }

  if (opts.dryRun) {
    return emit(buildEnvelope({ outcome: "SUCCESS", command, meta, post_body: body }));
  }

  const envelope = await performTestrailPost({
    request: requester(deps),
    path: testrailApiPath(productId, "/plan/preview"),
    body,
    command,
    meta,
    isWrite: false,
  });
  const previewData = envelope.api?.data as { preview_id?: string; previewId?: string } | undefined;
  const previewId = previewData?.preview_id ?? previewData?.previewId;
  if (previewId) meta.preview_id = previewId;
  return emit(envelope);
}

export interface TestrailPlanExecuteOptions {
  previewId: string;
  confirm?: boolean;
  dryRun?: boolean;
}

export async function runTestrailPlanExecute(
  productId: string,
  opts: TestrailPlanExecuteOptions,
  deps?: CommandDeps,
): Promise<void> {
  const command = "qa-insights testrail plan execute";
  const meta: QAInsightsMeta = {
    product_id: productId,
    preview_id: opts.previewId,
    dry_run: Boolean(opts.dryRun),
  };
  const emit = emitter(deps);

  let body: Record<string, unknown>;
  try {
    body = buildTestrailPlanExecuteBody(opts.previewId, Boolean(opts.confirm));
  } catch (err) {
    return emit(validationEnvelope(command, meta, err));
  }

  if (opts.dryRun) {
    return emit(buildEnvelope({ outcome: "SUCCESS", command, meta, post_body: body }));
  }

  if (!opts.confirm) {
    return emit(
      buildEnvelope({
        outcome: "FAILURE",
        command,
        meta,
        post_body: body,
        error: {
          type: "validation",
          message: "testrail plan execute requires --confirm (safety gate; preview must be reviewed first)",
          api_code: "CONFIRMATION_REQUIRED",
        },
      }),
    );
  }

  const envelope = await performTestrailPost({
    request: requester(deps),
    path: testrailApiPath(productId, "/plan/execute"),
    body,
    command,
    meta,
    isWrite: true,
  });

  const data = envelope.api?.data as {
    job_id?: string;
    jobId?: string;
    status?: string;
    mapping?: {
      reused_plan_mapping_ids?: string[];
      created_plan_mapping_ids?: string[];
      reusedPlanMappingIds?: string[];
      createdPlanMappingIds?: string[];
    };
  } | undefined;
  const jobId = data?.job_id ?? data?.jobId;
  if (jobId) meta.job_id = jobId;
  const mapping = data?.mapping;
  const reusedIds = mapping?.reused_plan_mapping_ids ?? mapping?.reusedPlanMappingIds;
  const createdIds = mapping?.created_plan_mapping_ids ?? mapping?.createdPlanMappingIds;
  if (reusedIds?.length) meta.reused_plan_mapping_ids = reusedIds;
  if (createdIds?.length) meta.created_plan_mapping_ids = createdIds;
  return emit(envelope);
}

// ---------------------------------------------------------------------------
// TestRail integration (T2) — A3 execution progress
// ---------------------------------------------------------------------------

export interface TestrailExecutionSummaryOptions {
  refresh?: boolean;
  ticketId?: string;
  planMappingId?: string;
  planMappingIds?: string[] | string;
  includeZeroStatuses?: boolean;
}

export async function runTestrailExecutionSummary(
  productId: string,
  versionId: string,
  opts: TestrailExecutionSummaryOptions,
  deps?: CommandDeps,
): Promise<void> {
  const command = "qa-insights testrail execution summary";
  const meta: QAInsightsMeta = { product_id: productId, version_id: versionId, dry_run: false };
  const emit = emitter(deps);

  let query: Record<string, string>;
  try {
    query = buildTestrailExecutionSummaryQuery(opts);
    if (query.ticket_id) meta.ticket_id = query.ticket_id;
    if (query.plan_mapping_id) meta.plan_mapping_id = query.plan_mapping_id;
    if (query.plan_mapping_ids) meta.plan_mapping_ids = query.plan_mapping_ids.split(",");
  } catch (err) {
    return emit(validationEnvelope(command, meta, err));
  }

  const read = await performRead({
    request: requester(deps),
    path: versionTestrailApiPath(productId, versionId, "/execution/summary"),
    query,
    command,
    meta,
  });
  if (read.envelope) return emit(read.envelope);

  return emit(
    buildEnvelope({
      outcome: "SUCCESS",
      command,
      meta,
      api: { code: "SUCCESS", msg: "success", data: read.data },
    }),
  );
}

export interface TestrailExecutionFailuresOptions {
  refresh?: boolean;
  runId?: number | string;
  testId?: number | string;
  includeFlaky?: boolean;
  limit?: number | string;
  offset?: number | string;
}

export async function runTestrailExecutionFailures(
  productId: string,
  versionId: string,
  opts: TestrailExecutionFailuresOptions,
  deps?: CommandDeps,
): Promise<void> {
  const command = "qa-insights testrail execution failures";
  const meta: QAInsightsMeta = { product_id: productId, version_id: versionId, dry_run: false };
  const emit = emitter(deps);

  let query: Record<string, string>;
  try {
    query = buildTestrailExecutionFailuresQuery(opts);
    if (query.test_id) meta.test_id = Number(query.test_id);
    if (query.run_id) meta.run_id = Number(query.run_id);
    if (query.limit) meta.limit = Number(query.limit);
    if (query.offset) meta.offset = Number(query.offset);
  } catch (err) {
    return emit(validationEnvelope(command, meta, err));
  }

  const read = await performRead({
    request: requester(deps),
    path: versionTestrailApiPath(productId, versionId, "/execution/failures"),
    query,
    command,
    meta,
  });
  if (read.envelope) return emit(read.envelope);

  return emit(
    buildEnvelope({
      outcome: "SUCCESS",
      command,
      meta,
      api: { code: "SUCCESS", msg: "success", data: read.data },
    }),
  );
}

export interface TestrailResolveUrlOptions {
  url?: string;
}

export async function runTestrailResolveUrl(
  productId: string,
  opts: TestrailResolveUrlOptions,
  deps?: CommandDeps,
): Promise<void> {
  const command = "qa-insights testrail resolve-url";
  const meta: QAInsightsMeta = { product_id: productId, dry_run: false };
  const emit = emitter(deps);

  let body: Record<string, unknown>;
  try {
    body = buildTestrailResolveUrlBody(opts);
  } catch (err) {
    return emit(validationEnvelope(command, meta, err));
  }

  const envelope = await performTestrailPost({
    request: requester(deps),
    path: testrailApiPath(productId, "/resolve-url"),
    body,
    command,
    meta,
    isWrite: false,
  });
  const data = envelope.api?.data as { version_id?: string; run_id?: number } | undefined;
  if (data?.version_id) meta.version_id = data.version_id;
  if (typeof data?.run_id === "number") meta.run_id = data.run_id;
  return emit(envelope);
}

// ---------------------------------------------------------------------------
// TestRail integration (T2) — A4 failure-to-defect
// ---------------------------------------------------------------------------

export interface TestrailDefectDraftOptions extends TestrailDefectDraftInput {
  bodyFile?: string;
  body?: string;
  dryRun?: boolean;
}

function defectMeta(
  productId: string,
  resultId: number,
  dryRun: boolean,
  body?: Record<string, unknown>,
): QAInsightsMeta {
  return {
    product_id: productId,
    result_id: resultId,
    version_id: typeof body?.version_id === "string" ? body.version_id : undefined,
    run_id: typeof body?.run_id === "number" ? body.run_id : undefined,
    case_id: typeof body?.case_id === "number" ? body.case_id : undefined,
    test_id: typeof body?.test_id === "number" ? body.test_id : undefined,
    dry_run: dryRun,
  };
}

export async function runTestrailDefectDraft(
  productId: string,
  resultIdRaw: string | number,
  opts: TestrailDefectDraftOptions,
  deps?: CommandDeps,
): Promise<void> {
  const command = "qa-insights testrail defects draft";
  const emit = emitter(deps);

  let resultId: number;
  try {
    resultId = requiredPositiveInteger(resultIdRaw, "result_id");
  } catch (err) {
    return emit(validationEnvelope(command, { product_id: productId, dry_run: Boolean(opts.dryRun) }, err));
  }

  let body: Record<string, unknown>;
  let meta: QAInsightsMeta = defectMeta(productId, resultId, Boolean(opts.dryRun));
  try {
    const parsed = await readOptionalJsonInput(opts.bodyFile, opts.body, "testrail defects draft");
    body =
      parsed === undefined
        ? buildTestrailDefectDraftBody(opts)
        : mergeTestrailDefectDraftBody(parsed, opts);
    meta = defectMeta(productId, resultId, Boolean(opts.dryRun), body);
  } catch (err) {
    return emit(validationEnvelope(command, meta, err));
  }

  if (opts.dryRun) {
    return emit(buildEnvelope({ outcome: "SUCCESS", command, meta, post_body: body }));
  }

  const envelope = await performTestrailPost({
    request: requester(deps),
    path: testrailApiPath(productId, `/results/${resultId}/defect-draft`),
    body,
    command,
    meta,
    isWrite: false,
  });
  return emit(envelope);
}

export interface TestrailDefectCreateTicketOptions {
  bodyFile?: string;
  body?: string;
  confirm?: boolean;
  dryRun?: boolean;
}

export async function runTestrailDefectCreateTicket(
  productId: string,
  resultIdRaw: string | number,
  opts: TestrailDefectCreateTicketOptions,
  deps?: CommandDeps,
): Promise<void> {
  const command = "qa-insights testrail defects create-ticket";
  const emit = emitter(deps);

  let resultId: number;
  try {
    resultId = requiredPositiveInteger(resultIdRaw, "result_id");
  } catch (err) {
    return emit(validationEnvelope(command, { product_id: productId, dry_run: Boolean(opts.dryRun) }, err));
  }

  let body: Record<string, unknown>;
  let meta: QAInsightsMeta = defectMeta(productId, resultId, Boolean(opts.dryRun));
  try {
    body = buildTestrailDefectCreateTicketBody(
      await readJsonInput(opts.bodyFile, opts.body, "testrail defects create-ticket"),
    ) as unknown as Record<string, unknown>;
    const draft = body.draft as Record<string, unknown>;
    meta = {
      ...meta,
      version_id: typeof draft.version_id === "string" ? draft.version_id : undefined,
      ticket_id: typeof body.link_existing_ticket_id === "string" ? body.link_existing_ticket_id : undefined,
    };
  } catch (err) {
    return emit(validationEnvelope(command, meta, err));
  }

  if (opts.dryRun) {
    return emit(buildEnvelope({ outcome: "SUCCESS", command, meta, post_body: body }));
  }

  if (!opts.confirm) {
    return emit(
      buildEnvelope({
        outcome: "FAILURE",
        command,
        meta,
        post_body: body,
        error: {
          type: "validation",
          message: "testrail defects create-ticket requires --confirm (draft must be reviewed first)",
          api_code: "CONFIRMATION_REQUIRED",
        },
      }),
    );
  }

  const envelope = await performTestrailPost({
    request: requester(deps),
    path: testrailApiPath(productId, `/results/${resultId}/create-ticket`),
    body,
    command,
    meta,
    isWrite: true,
  });
  return emit(envelope);
}

export interface TestrailDefectLinkTicketOptions {
  ticketId?: string;
  confirm?: boolean;
  dryRun?: boolean;
}

export async function runTestrailDefectLinkTicket(
  productId: string,
  resultIdRaw: string | number,
  opts: TestrailDefectLinkTicketOptions,
  deps?: CommandDeps,
): Promise<void> {
  const command = "qa-insights testrail defects link-ticket";
  const emit = emitter(deps);

  let resultId: number;
  try {
    resultId = requiredPositiveInteger(resultIdRaw, "result_id");
  } catch (err) {
    return emit(validationEnvelope(command, { product_id: productId, dry_run: Boolean(opts.dryRun) }, err));
  }

  let body: Record<string, unknown>;
  const meta: QAInsightsMeta = defectMeta(productId, resultId, Boolean(opts.dryRun));
  try {
    body = buildTestrailDefectLinkTicketBody(opts.ticketId);
    meta.ticket_id = body.ticket_id as string;
  } catch (err) {
    return emit(validationEnvelope(command, meta, err));
  }

  if (opts.dryRun) {
    return emit(buildEnvelope({ outcome: "SUCCESS", command, meta, post_body: body }));
  }

  if (!opts.confirm) {
    return emit(
      buildEnvelope({
        outcome: "FAILURE",
        command,
        meta,
        post_body: body,
        error: {
          type: "validation",
          message: "testrail defects link-ticket requires --confirm (existing Ticket must be reviewed first)",
          api_code: "CONFIRMATION_REQUIRED",
        },
      }),
    );
  }

  const envelope = await performTestrailPost({
    request: requester(deps),
    path: testrailApiPath(productId, `/results/${resultId}/link-ticket`),
    body,
    command,
    meta,
    isWrite: true,
  });
  return emit(envelope);
}

export async function runTestrailJobGet(
  productId: string,
  jobId: string,
  deps?: CommandDeps,
): Promise<void> {
  const command = "qa-insights testrail jobs get";
  const meta: QAInsightsMeta = { product_id: productId, job_id: jobId, dry_run: false };
  const emit = emitter(deps);

  const read = await performRead({
    request: requester(deps),
    path: testrailApiPath(productId, `/jobs/${jobId}`),
    command,
    meta,
  });
  if (read.envelope) return emit(read.envelope);

  return emit(
    buildEnvelope({
      outcome: "SUCCESS",
      command,
      meta,
      api: { code: "SUCCESS", msg: "success", data: read.data },
    }),
  );
}

const TERMINAL_JOB_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export interface TestrailJobPollOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

export async function runTestrailJobPoll(
  productId: string,
  jobId: string,
  opts: TestrailJobPollOptions,
  deps?: CommandDeps,
): Promise<void> {
  const command = "qa-insights testrail jobs poll";
  const meta: QAInsightsMeta = { product_id: productId, job_id: jobId, dry_run: false };
  const emit = emitter(deps);
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const started = Date.now();

  while (true) {
    const read = await performRead({
      request: requester(deps),
      path: testrailApiPath(productId, `/jobs/${jobId}`),
      command,
      meta,
    });
    if (read.envelope) return emit(read.envelope);

    const data = read.data as { status?: string } | undefined;
    const status = data?.status ?? "UNKNOWN";
    if (TERMINAL_JOB_STATUSES.has(status)) {
      return emit(
        buildEnvelope({
          outcome: status === "COMPLETED" ? "SUCCESS" : "FAILURE",
          command,
          meta,
          api: { code: "SUCCESS", msg: "success", data: read.data },
          error:
            status !== "COMPLETED"
              ? { type: "api", message: `TestRail import job ended with status ${status}` }
              : undefined,
        }),
      );
    }

    if (Date.now() - started >= timeoutMs) {
      return emit(
        buildEnvelope({
          outcome: "UNKNOWN",
          command,
          meta,
          api: { code: "SUCCESS", msg: "success", data: read.data },
          error: {
            type: "transport",
            message: `job poll timed out after ${timeoutMs}ms; last status=${status}`,
          },
        }),
      );
    }

    await sleep(intervalMs);
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerQAInsightsCommand(program: Command): void {
  const qa = program
    .command("qa-insights")
    .description("QA Insights: T1 test suites and T2 TestRail integration");

  const moduleTree = qa.command("module-tree").description("Module tree operations");
  moduleTree
    .command("get <product_id>")
    .description("Get the module tree for a product")
    .action((productId: string) => runModuleTreeGet(productId));

  const node = moduleTree.command("node").description("Module tree node operations");
  node
    .command("create <product_id>")
    .description("Create a module tree node")
    .option("--parent-id <id>", "Parent node id, or null for a root node")
    .requiredOption("--name <name>", "Node name")
    .option("--dry-run", "Print the body without sending the request")
    .action((productId: string, opts) => runModuleTreeNodeCreate(productId, opts));

  const requirements = qa.command("requirements").description("Requirement operations");
  requirements
    .command("get <product_id> <requirement_id>")
    .description("Get a single requirement (five fields + metadata)")
    .action((productId: string, requirementId: string) =>
      runRequirementsGet(productId, requirementId),
    );

  requirements
    .command("list <product_id>")
    .description("List requirements under a module-tree node")
    .requiredOption("--module-tree-node-id <id>", "Module tree node to list")
    .action((productId: string, opts: { moduleTreeNodeId?: string }) =>
      runRequirementsList(productId, opts),
    );

  requirements
    .command("create <product_id>")
    .description("Create a requirement (plain POST; de-duplication is the skill's job)")
    .option("--body-file <path>", "JSON file containing the requirement body")
    .option("--body <json>", "Inline JSON requirement body")
    .option("--dry-run", "Print the body without sending the request")
    .action((productId: string, opts) => runRequirementsCreate(productId, opts));

  requirements
    .command("update <product_id> <requirement_id>")
    .description("Update a requirement, sending only changed keys")
    .option("--desired-file <path>", "JSON file with the desired state")
    .option("--desired <json>", "Inline JSON desired state")
    .option("--snapshot-file <path>", "JSON file with the last-written snapshot")
    .option("--snapshot <json>", "Inline JSON snapshot — the values last written to CawPlan")
    .option("--dry-run", "Print the patch body without sending the request")
    .action((productId: string, requirementId: string, opts) =>
      runRequirementsUpdate(productId, requirementId, opts),
    );

  requirements
    .command("reconcile <product_id>")
    .description("Read-only: resolve an UNKNOWN write outcome (Table A)")
    .requiredOption("--module-tree-node-id <id>", "Module tree node to list")
    .requiredOption("--probe-file <path>", "JSON file with the five probe fields")
    .option("--target-requirement-id <id>", "Target requirement for a pending PATCH")
    .option("--intended-patch-file <path>", "JSON file with the intended changed keys")
    .option("--operation <op>", "POST or PATCH")
    .action((productId: string, opts) => runRequirementsReconcile(productId, opts));

  const testpoints = qa.command("testpoints").description("Test point operations");
  testpoints
    .command("list <product_id> <requirement_id>")
    .description("List test points for a requirement")
    .action((productId: string, requirementId: string) =>
      runTestPointsList(productId, requirementId),
    );

  testpoints
    .command("archive <product_id> <requirement_id>")
    .description("Batch-create test points")
    .option("--body-file <path>", "JSON file with { test_points: [...] }")
    .option("--body <json>", "Inline JSON batch body")
    .option("--dry-run", "Print the body without sending the request")
    .action((productId: string, requirementId: string, opts) =>
      runTestPointsArchive(productId, requirementId, opts),
    );

  testpoints
    .command("reconcile <product_id> <requirement_id>")
    .description("Read-only: compare test point counts after an UNKNOWN batch")
    .requiredOption("--count-before <n>", "Row count captured BEFORE the batch")
    .requiredOption("--batch-size <n>", "Number of test points in the batch")
    .action((productId: string, requirementId: string, opts) =>
      runTestPointsReconcile(productId, requirementId, opts),
    );

  const testrail = qa.command("testrail").description("TestRail integration operations (T2)");
  testrail
    .command("mappings")
    .description("TestRail mapping configuration")
    .command("get <product_id>")
    .description("Get Product TestRail mappings (suite, sections, templates)")
    .action((productId: string) => runTestrailMappingsGet(productId));

  const testrailPlanRules = testrail
    .command("plan-rules")
    .description("TestRail plan layout rule configuration (A2)");
  testrailPlanRules
    .command("get <product_id>")
    .description("Get Product TestRail plan layout rules (R1-R7)")
    .action((productId: string) => runTestrailPlanRulesGet(productId));
  testrailPlanRules
    .command("set <product_id>")
    .description("Update Product TestRail plan layout rules (R1-R7)")
    .option("--body-file <path>", "JSON file containing plan-rules body")
    .option("--body <json>", "Inline JSON plan-rules body")
    .option("--dry-run", "Print request body without calling API")
    .action((productId: string, opts) => runTestrailPlanRulesSet(productId, opts));

  const testrailPlan = testrail.command("plan").description("TestRail test plan layout (A2)");
  testrailPlan
    .command("preview <product_id>")
    .description("Preview Version/Ticket-scoped TestRail Plan/Run layout")
    .option("--body-file <path>", "Full plan preview request JSON")
    .option("--body <json>", "Inline plan preview request JSON")
    .option("--version-id <id>", "Version unique_id; required unless body provides version_id")
    .option("--ticket-id <id>", "Preview one Ticket in the Version")
    .option("--ticket-ids <ids>", "Comma-separated Ticket ids to preview")
    .option("--milestone-name <name>", "Milestone name; default is derived by BE")
    .option("--milestone-strategy <strategy>", "AUTO | CREATE | REUSE_LATEST | REUSE_BY_ID")
    .option("--milestone-id <id>", "Required when milestone-strategy=REUSE_BY_ID", (v: string) => Number(v))
    .option("--ticket-reuse-strategy <strategy>", "AUTO | CREATE_ALL (BE default AUTO)")
    .option("--start-date <date>", "Milestone start date (YYYY-MM-DD)")
    .option("--end-date <date>", "Milestone end date (YYYY-MM-DD)")
    .option("--dry-run", "Print request body without calling API")
    .action((productId: string, opts) => runTestrailPlanPreview(productId, opts));

  testrailPlan
    .command("execute <product_id>")
    .description("Execute a confirmed TestRail plan preview")
    .requiredOption("--preview-id <id>", "preview_id from plan preview response")
    .option("--confirm", "Required safety gate — must be set to execute")
    .option("--dry-run", "Print request body without calling API")
    .action((productId: string, opts) => runTestrailPlanExecute(productId, opts));

  const testrailImport = testrail.command("import").description("TestRail case import (A1)");
  testrailImport
    .command("preview <product_id>")
    .description("Preview import plan (no TestRail writes)")
    .option("--body-file <path>", "Full preview request JSON")
    .option("--body <json>", "Inline preview request JSON")
    .option("--source-type <type>", "REQUIREMENT | INLINE | VERSION")
    .option("--requirement-id <id>", "Required when source-type=REQUIREMENT")
    .option("--version-id <id>", "Required when source-type=VERSION (BE not implemented)")
    .option("--suite-id <n>", "TestRail suite id", (v: string) => Number(v))
    .option("--version-name <name>", "Value for TestRail custom_case_version")
    .option(
      "--section-strategy <strategy>",
      "AUTO_BY_GROUP | MAP_BY_MODULE | FIXED_SECTION",
    )
    .option("--fixed-section-id <n>", "Required for FIXED_SECTION", (v: string) => Number(v))
    .option("--dry-run", "Print request body without calling API")
    .action((productId: string, opts) => runTestrailImportPreview(productId, opts));

  testrailImport
    .command("execute <product_id>")
    .description("Execute a confirmed import preview")
    .requiredOption("--preview-id <id>", "preview_id from import preview response")
    .option("--confirm", "Required safety gate — must be set to execute")
    .option("--dry-run", "Print request body without calling API")
    .action((productId: string, opts) => runTestrailImportExecute(productId, opts));

  const testrailExecution = testrail.command("execution").description("TestRail execution progress (A3)");
  testrailExecution
    .command("summary <product_id> <version_id>")
    .description("Get Version/Ticket-scoped TestRail execution summary")
    .option("--refresh", "Bypass execution cache and refresh TestRail status metadata")
    .option("--ticket-id <id>", "Filter by Ticket scoped Plan/Run")
    .option("--plan-mapping-id <id>", "Filter by one PlanMapping")
    .option("--plan-mapping-ids <ids>", "Comma-separated PlanMapping ids")
    .option("--include-zero-statuses", "Return non-core status counts even when count=0")
    .action((productId: string, versionId: string, opts) =>
      runTestrailExecutionSummary(productId, versionId, opts),
    );

  testrailExecution
    .command("failures <product_id> <version_id>")
    .description("List failed/blocked TestRail execution results")
    .option("--refresh", "Reserved; failures has no server cache (same as default)")
    .option("--run-id <n>", "List mode: filter by TestRail run id", (v: string) => Number(v))
    .option(
      "--test-id <n>",
      "test_id mode: resolve failed/blocked results for one Test (A4 cold start)",
      (v: string) => Number(v),
    )
    .option(
      "--include-flaky",
      "Compute is_flaky and consecutive_failures from TestRail history (slower)",
    )
    .option("--limit <n>", "Page size (default 50)", (v: string) => Number(v))
    .option("--offset <n>", "Page offset (default 0)", (v: string) => Number(v))
    .action((productId: string, versionId: string, opts) =>
      runTestrailExecutionFailures(productId, versionId, opts),
    );

  testrail
    .command("resolve-url <product_id>")
    .description("Resolve a TestRail Plan/Run URL to Version context (A4/A6 cold start)")
    .requiredOption("--url <url>", "TestRail Plan or Run URL")
    .action((productId: string, opts) => runTestrailResolveUrl(productId, opts));

  const testrailDefects = testrail.command("defects").description("TestRail failure-to-defect filing (A4)");
  testrailDefects
    .command("draft <product_id> <result_id>")
    .description("Generate an editable defect draft from a TestRail result")
    .option("--body-file <path>", "Full defect draft request JSON")
    .option("--body <json>", "Inline defect draft request JSON")
    .option("--version-id <id>", "Version unique_id")
    .option("--run-id <n>", "TestRail run id", (v: string) => Number(v))
    .option("--case-id <n>", "TestRail case id", (v: string) => Number(v))
    .option("--test-id <n>", "TestRail test id", (v: string) => Number(v))
    .option("--dry-run", "Print request body without calling API")
    .action((productId: string, resultId: string, opts) =>
      runTestrailDefectDraft(productId, resultId, opts),
    );

  testrailDefects
    .command("create-ticket <product_id> <result_id>")
    .description("Create a CawPlan Ticket from a reviewed defect draft and write TestRail defects")
    .option("--body-file <path>", "JSON body containing { draft, link_existing_ticket_id? }")
    .option("--body <json>", "Inline JSON body containing { draft, link_existing_ticket_id? }")
    .option("--confirm", "Required safety gate — draft must be reviewed first")
    .option("--dry-run", "Print request body without calling API")
    .action((productId: string, resultId: string, opts) =>
      runTestrailDefectCreateTicket(productId, resultId, opts),
    );

  testrailDefects
    .command("link-ticket <product_id> <result_id>")
    .description("Link an existing CawPlan Ticket to a TestRail result and write TestRail defects")
    .requiredOption("--ticket-id <id>", "Existing CawPlan Ticket unique_id")
    .option("--confirm", "Required safety gate — existing Ticket must be reviewed first")
    .option("--dry-run", "Print request body without calling API")
    .action((productId: string, resultId: string, opts) =>
      runTestrailDefectLinkTicket(productId, resultId, opts),
    );

  const testrailJobs = testrail.command("jobs").description("Async TestRail jobs");
  testrailJobs
    .command("get <product_id> <job_id>")
    .description("Get job status and result")
    .action((productId: string, jobId: string) => runTestrailJobGet(productId, jobId));

  testrailJobs
    .command("poll <product_id> <job_id>")
    .description("Poll job until COMPLETED/FAILED/CANCELLED or timeout")
    .option("--interval-ms <n>", "Poll interval in ms", (v: string) => Number(v))
    .option("--timeout-ms <n>", "Max wait in ms (default 600000)", (v: string) => Number(v))
    .action((productId: string, jobId: string, opts) =>
      runTestrailJobPoll(productId, jobId, opts),
    );
}
