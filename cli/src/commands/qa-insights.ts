import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { cawplanRequest } from "../lib/http.js";
import { parseApiEnvelope, batchReturnedCount } from "../lib/qa-insights/api-codes.js";
import {
  BodyValidationError,
  buildModuleTreeNodeBody,
  buildRequirementCreateBody,
  buildTestPointBatchBody,
  validateRequirementPatchBody,
} from "../lib/qa-insights/body-builders.js";
import { buildEnvelope, emitEnvelopeAndExit } from "../lib/qa-insights/envelope.js";
import { mapCawplanRequestError, mapEnvelopeFailure } from "../lib/qa-insights/errors.js";
import { computePatchBody, isEmptyDiff } from "../lib/qa-insights/snapshot-diff.js";
import { reconcileRequirement } from "../lib/qa-insights/reconcile-requirement.js";
import {
  CountReconcileValidationError,
  reconcileTestPoints,
} from "../lib/qa-insights/reconcile-testpoints.js";
import type {
  QAInsightsMeta,
  QAInsightsWriteEnvelope,
  RequirementRow,
} from "../lib/qa-insights/types.js";

/**
 * `cawplan qa-insights` — QA Insights Test Suites writes and reconcile.
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

/** Injectable for tests; defaults to the real HTTP client. */
export type RequestFn = typeof cawplanRequest;

export interface CommandDeps {
  request?: RequestFn;
  /** Returns instead of exiting, so tests can assert on the envelope. */
  emit?: (envelope: QAInsightsWriteEnvelope) => never | void;
}

function emitter(deps?: CommandDeps) {
  return deps?.emit ?? emitEnvelopeAndExit;
}

function requester(deps?: CommandDeps): RequestFn {
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
    patchBody = computePatchBody(
      desired as Record<string, unknown>,
      snapshot as Record<string, unknown>,
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
// Registration
// ---------------------------------------------------------------------------

export function registerQAInsightsCommand(program: Command): void {
  const qa = program
    .command("qa-insights")
    .description("QA Insights Test Suites: module tree, requirements, test points");

  const moduleTree = qa.command("module-tree").description("Module tree operations");
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
}
