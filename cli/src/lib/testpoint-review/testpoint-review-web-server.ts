import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { openBrowser } from "../oauth.js";
import { runTestPointsArchive, runTestPointsReconcile } from "../../commands/qa-insights.js";
import { testPointReviewHtml } from "./testpoint-review-html.js";
import {
  checkUnresolvedFeedback,
  markTestPointsArchived,
  testPointsPendingArchive,
  toArchiveSubmissionItem,
} from "./archive-submission.js";
import { loadReviewState, saveReviewState } from "./store.js";
import { formatTestPointId } from "./test-point-id.js";
import type { ReviewState, TestPointFields } from "./types.js";
import type { QAInsightsWriteEnvelope } from "../qa-insights/types.js";

const localHost = "127.0.0.1";

export type ArchiveTestPointsFn = (
  productId: string,
  requirementId: string,
  body: { test_points: unknown[] },
) => Promise<QAInsightsWriteEnvelope>;

const defaultArchiveTestPoints: ArchiveTestPointsFn = async (productId, requirementId, body) => {
  let envelope: QAInsightsWriteEnvelope | undefined;
  await runTestPointsArchive(productId, requirementId, { body: JSON.stringify(body) }, {
    emit: (e) => {
      envelope = e;
      // HTML saves run inside the long-lived `testpoint-review open` process.
      // Preserve the normal qa-insights receipt on that process's stdout so
      // session collection can count this successful archive exactly as it
      // counts the legacy CLI save flow.
      console.log(JSON.stringify(e));
    },
  });
  if (!envelope) throw new Error("testpoints archive did not produce an envelope");
  return envelope;
};

export type ReconcileTestPointsFn = (
  productId: string,
  requirementId: string,
  countBefore: number,
  batchSize: number,
) => Promise<QAInsightsWriteEnvelope>;

export const defaultReconcileTestPoints: ReconcileTestPointsFn = async (productId, requirementId, countBefore, batchSize) => {
  let envelope: QAInsightsWriteEnvelope | undefined;
  await runTestPointsReconcile(
    productId,
    requirementId,
    { countBefore: String(countBefore), batchSize: String(batchSize) },
    {
      emit: (e) => {
        envelope = e;
      },
    },
  );
  if (!envelope) throw new Error("testpoints reconcile did not produce an envelope");
  return envelope;
};

export interface TestPointReviewServerDeps {
  renderHtml?: typeof testPointReviewHtml;
  reviewState?: ReviewState;
  archiveTestPoints?: ArchiveTestPointsFn;
  reconcileTestPoints?: ReconcileTestPointsFn;
}

export interface TestPointReviewServerOptions {
  launchBrowser?: boolean;
}

export interface TestPointReviewDispatchResult {
  status: number;
  body: unknown;
  contentType?: string;
  closeServer?: boolean;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, body: string, contentType = "text/plain; charset=utf-8"): void {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function requestHasToken(req: Pick<IncomingMessage, "url">, token: string): boolean {
  const url = new URL(req.url ?? "/", `http://${localHost}`);
  return url.searchParams.get("token") === token;
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

const TEST_POINTS_PATH = "/api/test-points";
const EDIT_PATH_PREFIX = "/api/test-points/";
const DELETE_PATH_SUFFIX = "/delete";
const RESTORE_PATH_SUFFIX = "/restore";
const COMMENTS_PATH_SUFFIX = "/comments";
const COMMENTS_PATH_INFIX = "/comments/";
const GLOBAL_COMMENTS_PATH = "/api/global-comments";
const GLOBAL_COMMENTS_PATH_PREFIX = "/api/global-comments/";
const OPTIMIZE_PATH = "/api/optimize";
const SAVE_TO_CAWPLAN_PATH = "/api/save-to-cawplan";

function isEditableField(key: string): key is keyof TestPointFields {
  return key === "title" || key === "group" || key === "tags" || key === "priority";
}

function fieldsEqual(a: TestPointFields, b: TestPointFields): boolean {
  return (
    a.title === b.title &&
    a.group === b.group &&
    a.priority === b.priority &&
    a.tags.length === b.tags.length &&
    a.tags.every((t, i) => t === b.tags[i])
  );
}

function isReviewLocked(reviewState: ReviewState): boolean {
  return reviewState.review_status === "pending_optimize" || reviewState.review_status === "optimizing";
}

function conflictResult(reviewState: ReviewState): TestPointReviewDispatchResult {
  return {
    status: 409,
    body: { error: "conflict", reason: "stale_updated_at", server_updated_at: reviewState.updated_at },
  };
}

function hasConflict(reviewState: ReviewState, clientUpdatedAt: string | undefined): boolean {
  return typeof clientUpdatedAt === "string" && clientUpdatedAt !== "" && clientUpdatedAt !== reviewState.updated_at;
}

function applyTestPointEdit(
  reviewState: ReviewState,
  testPointId: string,
  fields: Partial<TestPointFields>,
  clientUpdatedAt: string | undefined,
): TestPointReviewDispatchResult {
  const testPoint = reviewState.test_points.find((tp) => tp.id === testPointId);
  if (!testPoint) {
    return { status: 404, body: { error: "test point not found" } };
  }
  if (isReviewLocked(reviewState)) {
    return { status: 409, body: { error: "review is locked for AI optimization" } };
  }
  if (hasConflict(reviewState, clientUpdatedAt)) {
    return conflictResult(reviewState);
  }

  for (const [key, value] of Object.entries(fields)) {
    if (!isEditableField(key)) continue;
    if (key === "tags") {
      if (!Array.isArray(value) || !value.every((t) => typeof t === "string")) continue;
      testPoint.current.tags = value;
    } else if (typeof value === "string") {
      testPoint.current[key] = value;
    }
  }

  if (testPoint.status === "added" && testPoint.source === "ai") {
    testPoint.status = "edited";
  } else if (testPoint.status !== "deleted" && testPoint.status !== "added") {
    testPoint.status = "edited";
  }
  reviewState.updated_at = new Date().toISOString();
  saveReviewState(reviewState);

  return { status: 200, body: { test_point: testPoint, updated_at: reviewState.updated_at } };
}

function setTestPointDeleted(
  reviewState: ReviewState,
  testPointId: string,
  deleted: boolean,
  clientUpdatedAt: string | undefined,
): TestPointReviewDispatchResult {
  const testPoint = reviewState.test_points.find((tp) => tp.id === testPointId);
  if (!testPoint) {
    return { status: 404, body: { error: "test point not found" } };
  }
  if (isReviewLocked(reviewState)) {
    return { status: 409, body: { error: "review is locked for AI optimization" } };
  }
  if (hasConflict(reviewState, clientUpdatedAt)) {
    return conflictResult(reviewState);
  }

  if (deleted) {
    if (testPoint.status !== "deleted") {
      testPoint.pre_delete_status = testPoint.status;
    }
    testPoint.status = "deleted";
  } else if (testPoint.status === "deleted") {
    testPoint.status =
      testPoint.pre_delete_status ??
      (fieldsEqual(testPoint.current, testPoint.original) ? "unchanged" : "edited");
    delete testPoint.pre_delete_status;
  }

  reviewState.updated_at = new Date().toISOString();
  saveReviewState(reviewState);

  return { status: 200, body: { test_point: testPoint, updated_at: reviewState.updated_at } };
}

function addTestPointComment(
  reviewState: ReviewState,
  testPointId: string,
  input: { text?: unknown },
  clientUpdatedAt: string | undefined,
): TestPointReviewDispatchResult {
  const testPoint = reviewState.test_points.find((tp) => tp.id === testPointId);
  if (!testPoint) {
    return { status: 404, body: { error: "test point not found" } };
  }
  if (isReviewLocked(reviewState)) {
    return { status: 409, body: { error: "review is locked for AI optimization" } };
  }
  if (hasConflict(reviewState, clientUpdatedAt)) {
    return conflictResult(reviewState);
  }

  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) {
    return { status: 400, body: { error: "comment text is required" } };
  }

  const comment = {
    id: `c_${randomUUID()}`,
    text,
    author: "qa" as const,
    resolved: false,
  };
  testPoint.comments.push(comment);
  reviewState.updated_at = new Date().toISOString();
  saveReviewState(reviewState);

  return { status: 200, body: { test_point: testPoint, updated_at: reviewState.updated_at } };
}

function deleteTestPointComment(
  reviewState: ReviewState,
  testPointId: string,
  commentId: string,
  clientUpdatedAt: string | undefined,
): TestPointReviewDispatchResult {
  const testPoint = reviewState.test_points.find((tp) => tp.id === testPointId);
  if (!testPoint) {
    return { status: 404, body: { error: "test point not found" } };
  }
  if (isReviewLocked(reviewState)) {
    return { status: 409, body: { error: "review is locked for AI optimization" } };
  }
  if (hasConflict(reviewState, clientUpdatedAt)) {
    return conflictResult(reviewState);
  }

  const index = testPoint.comments.findIndex((c) => c.id === commentId);
  if (index === -1) {
    return { status: 404, body: { error: "comment not found" } };
  }

  testPoint.comments.splice(index, 1);
  reviewState.updated_at = new Date().toISOString();
  saveReviewState(reviewState);

  return { status: 200, body: { test_point: testPoint, updated_at: reviewState.updated_at } };
}

function addGlobalComment(
  reviewState: ReviewState,
  input: { text?: unknown },
  clientUpdatedAt: string | undefined,
): TestPointReviewDispatchResult {
  if (isReviewLocked(reviewState)) {
    return { status: 409, body: { error: "review is locked for AI optimization" } };
  }
  if (hasConflict(reviewState, clientUpdatedAt)) {
    return conflictResult(reviewState);
  }

  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) {
    return { status: 400, body: { error: "comment text is required" } };
  }

  const comment = {
    id: `c_${randomUUID()}`,
    text,
    author: "qa" as const,
    resolved: false,
  };
  reviewState.global_comments.push(comment);
  reviewState.updated_at = new Date().toISOString();
  saveReviewState(reviewState);

  return { status: 200, body: { global_comments: reviewState.global_comments, updated_at: reviewState.updated_at } };
}

function addTestPoint(
  reviewState: ReviewState,
  input: Partial<TestPointFields>,
  clientUpdatedAt: string | undefined,
): TestPointReviewDispatchResult {
  if (isReviewLocked(reviewState)) {
    return { status: 409, body: { error: "review is locked for AI optimization" } };
  }
  if (hasConflict(reviewState, clientUpdatedAt)) {
    return conflictResult(reviewState);
  }

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) {
    return { status: 400, body: { error: "title is required" } };
  }

  const fields: TestPointFields = {
    title,
    group: typeof input.group === "string" ? input.group.trim() : "",
    tags: Array.isArray(input.tags) && input.tags.every((t) => typeof t === "string") ? input.tags : [],
    priority: typeof input.priority === "string" ? input.priority.trim() : "",
  };

  const id = formatTestPointId(reviewState.next_seq);
  reviewState.next_seq += 1;

  const testPoint = {
    id,
    original: { ...fields },
    current: { ...fields },
    status: "added" as const,
    source: "qa" as const,
    ai_status: "none" as const,
    comments: [],
  };
  reviewState.test_points.push(testPoint);
  reviewState.updated_at = new Date().toISOString();
  saveReviewState(reviewState);

  return { status: 200, body: { test_point: testPoint, updated_at: reviewState.updated_at } };
}

function deleteGlobalComment(
  reviewState: ReviewState,
  commentId: string,
  clientUpdatedAt: string | undefined,
): TestPointReviewDispatchResult {
  if (isReviewLocked(reviewState)) {
    return { status: 409, body: { error: "review is locked for AI optimization" } };
  }
  if (hasConflict(reviewState, clientUpdatedAt)) {
    return conflictResult(reviewState);
  }

  const index = reviewState.global_comments.findIndex((c) => c.id === commentId);
  if (index === -1) {
    return { status: 404, body: { error: "comment not found" } };
  }

  reviewState.global_comments.splice(index, 1);
  reviewState.updated_at = new Date().toISOString();
  saveReviewState(reviewState);

  return { status: 200, body: { global_comments: reviewState.global_comments, updated_at: reviewState.updated_at } };
}

function allTestPointIds(reviewState: ReviewState): string[] {
  return reviewState.test_points.map((tp) => tp.id);
}

export type RequestOptimizeResult = {
  reviewState: ReviewState;
  alreadyLocked: boolean;
  lockedIds: string[];
};

/**
 * Locks the whole review for AI optimization (design §3.1/§8.2). Shared by the page's
 * POST /api/optimize route and the `testpoint-review request-optimize` CLI command
 * (Chat-only trigger, no browser/page required) so both entry points use one lock transition.
 */
export function requestOptimize(reviewState: ReviewState): RequestOptimizeResult {
  if (isReviewLocked(reviewState)) {
    return { reviewState, alreadyLocked: true, lockedIds: allTestPointIds(reviewState) };
  }

  reviewState.review_status = "pending_optimize";
  reviewState.optimize_requested_at = new Date().toISOString();
  reviewState.updated_at = reviewState.optimize_requested_at;
  saveReviewState(reviewState);

  return { reviewState, alreadyLocked: false, lockedIds: allTestPointIds(reviewState) };
}

function optimizeReview(reviewState: ReviewState): TestPointReviewDispatchResult {
  const hasPageChanges = reviewState.test_points.some(
    (tp) =>
      tp.archived !== true &&
      (tp.comments.length > 0 ||
        tp.status === "edited" ||
        tp.status === "deleted" ||
        (tp.status === "added" && tp.source === "qa")),
  ) || reviewState.global_comments.length > 0;
  if (!hasPageChanges) {
    return { status: 200, body: { outcome: "NO_CHANGES" } };
  }

  const { alreadyLocked, lockedIds } = requestOptimize(reviewState);
  return {
    status: 200,
    body: { review_status: reviewState.review_status, locked_ids: lockedIds },
    closeServer: !alreadyLocked,
  };
}

/**
 * A successful archive closes the local server (same hand-back mechanism as /api/optimize,
 * design §7's channel) so the host Agent that's been waiting on `testpoint-review open` regains
 * control and can post a Chat receipt automatically (step 20 §9). Continuing to review afterward
 * requires re-running `open` — deliberate trade-off vs. the original "stays open, repeatable"
 * design (§4.1): without closing, nothing tells a Chat-only caller the save succeeded.
 * NOOP/failure/conflict paths do not close the server — there is nothing to hand back, and QA may
 * want to retry without relaunching the page.
 *
 * On a non-SUCCESS archive outcome (transport failure / post-write 5xx → `UNKNOWN`), this runs the
 * same count-reconcile SKILL.md §9/§10 previously did before Chat called `testpoints archive`
 * directly — the page must not treat UNKNOWN as a flat failure, or QA retrying after a false
 * failure would double-submit the batch. `count_before` is `reviewState.count_before`, the
 * baseline recorded when this Review was created/last refreshed — advanced after every
 * successfully-confirmed batch (SUCCESS or reconciled `count_matched`) so the next save's
 * baseline is correct.
 */
async function saveToCawPlan(
  reviewState: ReviewState,
  archiveTestPoints: ArchiveTestPointsFn,
  reconcileTestPoints: ReconcileTestPointsFn,
): Promise<TestPointReviewDispatchResult> {
  if (isReviewLocked(reviewState)) {
    return { status: 409, body: { error: "review is locked for AI optimization" } };
  }

  const feedback = checkUnresolvedFeedback(reviewState);
  if (feedback.hasUnresolvedFeedback) {
    return {
      status: 409,
      body: {
        error: "unresolved_feedback",
        commented_test_point_count: feedback.commentedTestPointCount,
        global_comment_count: feedback.globalCommentCount,
      },
    };
  }

  const pending = testPointsPendingArchive(reviewState);
  if (pending.length === 0) {
    return { status: 200, body: { archived_count: 0, outcome: "NOOP" } };
  }

  const body = { test_points: pending.map(toArchiveSubmissionItem) };
  const batchSize = pending.length;

  let envelope: QAInsightsWriteEnvelope;
  try {
    envelope = await archiveTestPoints(reviewState.product_id, reviewState.requirement_id, body);
  } catch (err) {
    return { status: 502, body: { error: "archive request failed", message: (err as Error).message } };
  }

  if (envelope.outcome === "FAILURE") {
    // Definitive failure (e.g. validation) — the body was built wrong or the API rejected it.
    // Nothing was written; reconcile would be pointless (SKILL.md §9's FAILURE branch: fix and
    // resend, never reconcile a batch that's known not to have landed).
    return { status: 502, body: { error: "archive did not succeed", envelope } };
  }

  if (envelope.outcome !== "SUCCESS") {
    // UNKNOWN — transport failure or post-write 5xx, result indeterminate. Reconcile before
    // reporting failure so a QA retry doesn't double-submit a batch that actually landed.
    let reconcileEnvelope: QAInsightsWriteEnvelope;
    try {
      reconcileEnvelope = await reconcileTestPoints(
        reviewState.product_id,
        reviewState.requirement_id,
        reviewState.count_before,
        batchSize,
      );
    } catch (err) {
      return {
        status: 502,
        body: { error: "archive did not succeed and reconcile failed", envelope, message: (err as Error).message },
      };
    }

    if (reconcileEnvelope.reconcile?.decision !== "count_matched") {
      // retry_same_batch (nothing landed) or count_unexpected (ambiguous) — both must stop and
      // surface to a human, never silently re-POST or silently swallow (SKILL.md §10 rule).
      return { status: 502, body: { error: "archive did not succeed", envelope, reconcile: reconcileEnvelope } };
    }

    // count_matched: the batch already landed despite the UNKNOWN outcome — mark it archived
    // exactly like a SUCCESS, without re-submitting.
    const { archivedCount } = markTestPointsArchived(reviewState, pending.map((tp) => tp.id));
    reviewState.count_before += batchSize;
    saveReviewState(reviewState);
    return {
      status: 200,
      body: { archived_count: archivedCount, outcome: "RECONCILED" },
      closeServer: true,
    };
  }

  const { archivedCount } = markTestPointsArchived(reviewState, pending.map((tp) => tp.id));
  reviewState.count_before += batchSize;
  saveReviewState(reviewState);

  return { status: 200, body: { archived_count: archivedCount, outcome: envelope.outcome }, closeServer: true };
}

export async function dispatchTestPointReviewRequest(
  req: Pick<IncomingMessage, "method" | "url">,
  rawBody: string,
  token: string,
  deps: TestPointReviewServerDeps = {},
): Promise<TestPointReviewDispatchResult> {
  if (!requestHasToken(req, token)) {
    return { status: 403, body: { error: "invalid token" } };
  }

  const url = new URL(req.url ?? "/", `http://${localHost}`);
  const renderHtml = deps.renderHtml ?? testPointReviewHtml;
  const clientUpdatedAt = url.searchParams.get("updated_at") ?? undefined;

  if (req.method === "GET" && url.pathname === "/") {
    return { status: 200, body: renderHtml(deps.reviewState, token), contentType: "text/html; charset=utf-8" };
  }

  if (req.method === "DELETE" && url.pathname.startsWith(GLOBAL_COMMENTS_PATH_PREFIX)) {
    if (!deps.reviewState) {
      return { status: 404, body: { error: "no review state loaded" } };
    }

    const commentId = decodeURIComponent(url.pathname.slice(GLOBAL_COMMENTS_PATH_PREFIX.length));
    return deleteGlobalComment(deps.reviewState, commentId, clientUpdatedAt);
  }

  if (req.method === "DELETE" && url.pathname.startsWith(EDIT_PATH_PREFIX)) {
    if (!deps.reviewState) {
      return { status: 404, body: { error: "no review state loaded" } };
    }

    const remainder = url.pathname.slice(EDIT_PATH_PREFIX.length);
    const commentsIndex = remainder.indexOf(COMMENTS_PATH_INFIX);
    if (commentsIndex === -1) {
      return { status: 404, body: { error: "not found" } };
    }

    const testPointId = decodeURIComponent(remainder.slice(0, commentsIndex));
    const commentId = decodeURIComponent(remainder.slice(commentsIndex + COMMENTS_PATH_INFIX.length));
    return deleteTestPointComment(deps.reviewState, testPointId, commentId, clientUpdatedAt);
  }

  if (req.method === "POST" && url.pathname === GLOBAL_COMMENTS_PATH) {
    if (!deps.reviewState) {
      return { status: 404, body: { error: "no review state loaded" } };
    }

    let commentInput: { text?: unknown };
    try {
      commentInput = rawBody ? (JSON.parse(rawBody) as { text?: unknown }) : {};
    } catch {
      return { status: 400, body: { error: "invalid JSON body" } };
    }
    return addGlobalComment(deps.reviewState, commentInput, clientUpdatedAt);
  }

  if (req.method === "POST" && url.pathname === TEST_POINTS_PATH) {
    if (!deps.reviewState) {
      return { status: 404, body: { error: "no review state loaded" } };
    }

    let fields: Partial<TestPointFields>;
    try {
      fields = rawBody ? (JSON.parse(rawBody) as Partial<TestPointFields>) : {};
    } catch {
      return { status: 400, body: { error: "invalid JSON body" } };
    }
    return addTestPoint(deps.reviewState, fields, clientUpdatedAt);
  }

  if (req.method === "POST" && url.pathname === OPTIMIZE_PATH) {
    if (!deps.reviewState) {
      return { status: 404, body: { error: "no review state loaded" } };
    }

    return optimizeReview(deps.reviewState);
  }

  if (req.method === "POST" && url.pathname === SAVE_TO_CAWPLAN_PATH) {
    if (!deps.reviewState) {
      return { status: 404, body: { error: "no review state loaded" } };
    }

    return saveToCawPlan(
      deps.reviewState,
      deps.archiveTestPoints ?? defaultArchiveTestPoints,
      deps.reconcileTestPoints ?? defaultReconcileTestPoints,
    );
  }

  if (req.method === "POST" && url.pathname.startsWith(EDIT_PATH_PREFIX)) {
    if (!deps.reviewState) {
      return { status: 404, body: { error: "no review state loaded" } };
    }

    const remainder = url.pathname.slice(EDIT_PATH_PREFIX.length);

    if (remainder.endsWith(DELETE_PATH_SUFFIX)) {
      const testPointId = decodeURIComponent(remainder.slice(0, -DELETE_PATH_SUFFIX.length));
      return setTestPointDeleted(deps.reviewState, testPointId, true, clientUpdatedAt);
    }

    if (remainder.endsWith(RESTORE_PATH_SUFFIX)) {
      const testPointId = decodeURIComponent(remainder.slice(0, -RESTORE_PATH_SUFFIX.length));
      return setTestPointDeleted(deps.reviewState, testPointId, false, clientUpdatedAt);
    }

    if (remainder.endsWith(COMMENTS_PATH_SUFFIX)) {
      const testPointId = decodeURIComponent(remainder.slice(0, -COMMENTS_PATH_SUFFIX.length));
      let commentInput: { text?: unknown };
      try {
        commentInput = rawBody ? (JSON.parse(rawBody) as { text?: unknown }) : {};
      } catch {
        return { status: 400, body: { error: "invalid JSON body" } };
      }
      return addTestPointComment(deps.reviewState, testPointId, commentInput, clientUpdatedAt);
    }

    const testPointId = decodeURIComponent(remainder);
    let fields: Partial<TestPointFields>;
    try {
      fields = rawBody ? (JSON.parse(rawBody) as Partial<TestPointFields>) : {};
    } catch {
      return { status: 400, body: { error: "invalid JSON body" } };
    }
    return applyTestPointEdit(deps.reviewState, testPointId, fields, clientUpdatedAt);
  }

  return { status: 404, body: { error: "not found" } };
}

export async function handleTestPointReviewHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  deps: TestPointReviewServerDeps = {},
): Promise<boolean> {
  const rawBody = req.method === "POST" ? await readRequestBody(req) : "";
  const result = await dispatchTestPointReviewRequest(req, rawBody, token, deps);
  if (typeof result.body === "string") {
    sendText(res, result.status, result.body, result.contentType ?? "text/html; charset=utf-8");
  } else {
    sendJson(res, result.status, result.body);
  }
  return Boolean(result.closeServer);
}

export async function startTestPointReviewWebServer(
  reviewId: string,
  deps: TestPointReviewServerDeps = {},
  options: TestPointReviewServerOptions = {},
): Promise<void> {
  const reviewState = deps.reviewState ?? loadReviewState(reviewId);
  const effectiveDeps: TestPointReviewServerDeps = { ...deps, reviewState };
  const reloadFromDisk = deps.reviewState === undefined;
  const token = randomBytes(16).toString("hex");
  let closed = false;

  await new Promise<void>((resolve, reject) => {
    let server: ReturnType<typeof createServer>;

    const closeServer = () => {
      if (closed) return;
      closed = true;
      server.close(() => resolve());
    };
    const closeServerSoon = () => {
      if (closed) return;
      closed = true;
      // The page has already received its success response. A browser can still retain a
      // local keep-alive/preconnect socket, and `server.close()` waits for that socket to
      // disappear naturally. That delays the background `open` command (and therefore the
      // Chat-side success receipt) by up to several minutes. Stop accepting requests first,
      // then release every remaining local connection after the response has had a moment to
      // flush.
      setTimeout(() => {
        server.close(() => resolve());
        server.closeAllConnections();
      }, 50);
    };

    server = createServer((req, res) => {
      // The Chat-side optimize commands run in a separate process and persist the next
      // round to disk. Keep the long-lived page server in sync with that canonical state,
      // and make stale updated_at checks compare against the latest round rather than the
      // snapshot that happened to be loaded when `open` started.
      if (reloadFromDisk) {
        try {
          effectiveDeps.reviewState = loadReviewState(reviewId);
        } catch (err) {
          sendJson(res, 500, { error: "failed to reload review state", message: (err as Error).message });
          return;
        }
      }
      void handleTestPointReviewHttpRequest(req, res, token, effectiveDeps).then((shouldClose) => {
        if (shouldClose) {
          console.error("Optimization requested; review is saved and locked. Closing local server.");
          closeServerSoon();
        }
      });
    });

    server.on("error", reject);
    server.listen(0, localHost, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to determine local test point review server address"));
        return;
      }
      const url = `http://${localHost}:${address.port}/?token=${token}`;
      console.error(`Open this URL to review test points: ${url}`);
      if (options.launchBrowser !== false) {
        void openBrowser(url).catch(() => {
          console.error("Could not open the browser automatically; please open the URL manually.");
        });
      }
      console.error("Waiting... press Ctrl+C to stop the local server.");
    });

    process.once("SIGINT", () => {
      closeServer();
    });
  });
}
